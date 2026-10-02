import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { metered } from "./fixtures/metered-d1";
import {
  clearPublicCatalogCache,
  createD1PublicCatalogRepository,
} from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import {
  groupCatalogFamilies,
  type PublicCatalogItem,
} from "../app/modules/catalog/domain/public-catalog";

// Storefront pages must not read the whole catalog per request: a category page reads only its product
// types, and repeated reads are served from a per-isolate cache that is revalidated on every request by a
// few-row freshness token (active release version, item generation and fee rates).
const BULK = 200;
const directory = mkdtempSync(join(tmpdir(), "public-catalog-cache-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
let full: PublicCatalogItem[];
const meter = () => metered(db);

beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(import.meta.dirname, "..", "wrangler.jsonc"),
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  await seedManagedAssemblyBaseline(db, BULK);
  full = (await createD1PublicCatalogRepository(db).browse({})).items;
}, 120000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(() => clearPublicCatalogCache());

it("reads only the requested category and returns exactly that category", async () => {
  const categories = [...new Set(full.map((item) => item.category))];
  expect(categories.length).toBeGreaterThan(1);
  const all = meter();
  await createD1PublicCatalogRepository(all.binding).browse({});
  for (const category of categories) {
    const { binding, counter } = meter();
    const { items, families } = await createD1PublicCatalogRepository(
      binding,
    ).browse({ category });
    const expected = full.filter((item) => item.category === category);
    expect(items).toEqual(expected);
    expect(families).toEqual(groupCatalogFamilies(expected));
    if (category !== "hydraulic-hose")
      expect(counter.reads).toBeLessThan(all.counter.reads / 2);
  }
  const family = groupCatalogFamilies(full).find(
    (candidate) => candidate.category === "hydraulic-hose",
  )!;
  const sku = family.variants.at(-1)!.sku;
  expect(
    await createD1PublicCatalogRepository(db).findFamily({
      category: family.category,
      familyKey: family.familyKey,
      sku,
    }),
  ).toEqual({
    family,
    selected: family.variants.find((variant) => variant.sku === sku),
  });
}, 120000);

it("serves repeated storefront reads from the shared cache after a few-row freshness check", async () => {
  const { binding, counter } = meter();
  const first = await createD1PublicCatalogRepository(binding, {
    sharedCache: true,
  }).browse({});
  expect(first.items).toEqual(full);
  expect(counter.reads).toBeGreaterThan(1000);

  // Each request builds a new repository; the cache outlives it.
  counter.reads = 0;
  const second = await createD1PublicCatalogRepository(binding, {
    sharedCache: true,
  }).browse({});
  expect(second.items).toEqual(full);
  expect(counter.reads).toBeLessThan(50);

  counter.reads = 0;
  const hoses = await createD1PublicCatalogRepository(binding, {
    sharedCache: true,
  }).browse({ category: "hydraulic-hose" });
  expect(hoses.items).toEqual(
    full.filter((item) => item.category === "hydraulic-hose"),
  );
  const sku = hoses.items[3].sku;
  expect(
    await createD1PublicCatalogRepository(binding, {
      sharedCache: true,
    }).findItem(sku),
  ).toEqual(full.find((item) => item.sku === sku));
  expect(counter.reads).toBeLessThan(100);
}, 120000);

it("drops the cached catalog as soon as a product or a fee rate changes", async () => {
  const { binding, counter } = meter();
  const read = () =>
    createD1PublicCatalogRepository(binding, { sharedCache: true }).browse({});
  await read();

  const items = createD1CatalogItemRepository(db);
  const payload = (await items.findPayload("sku", "601R1_B0042"))!;
  if (payload.kind !== "sku" || !payload.price) throw new Error("no price");
  payload.price.amount = 77.25;
  await items.apply({
    payload,
    targetState: "online",
    mode: "edit",
    commandId: "cache-price-edit",
    actorId: "owner-1",
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  counter.reads = 0;
  const afterEdit = await read();
  expect(counter.reads).toBeGreaterThan(1000);
  expect(
    afterEdit.items.find((item) => item.sku === "601R1_B0042")?.offer
      ?.referencePrice,
  ).toBe(77.25);

  await db
    .prepare(
      "UPDATE cutting_labeling_fee_rates SET rate_per_piece = rate_per_piece + 1.5, version = version + 1 WHERE scope_key = 'global'",
    )
    .run();
  counter.reads = 0;
  const afterFee = await read();
  expect(counter.reads).toBeGreaterThan(1000);
  expect(JSON.stringify(afterFee.items)).not.toBe(
    JSON.stringify(afterEdit.items),
  );
}, 120000);

it("keeps request-scoped reads (quoting) off the shared cache", async () => {
  const warm = meter();
  await createD1PublicCatalogRepository(warm.binding, {
    sharedCache: true,
  }).browse({});
  // Earlier tests changed prices and fees, so compare with a fresh uncached read.
  const expected = (await createD1PublicCatalogRepository(db).browse({}))
    .items[0];
  const { binding, counter } = meter();
  expect(
    await createD1PublicCatalogRepository(binding).findItem(expected.sku),
  ).toEqual(expected);
  expect(counter.reads).toBeGreaterThan(50);
}, 120000);
