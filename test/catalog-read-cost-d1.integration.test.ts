import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedCatalogItemBaseline } from "./fixtures/catalog-item-baseline";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { legacyPublicCatalogSql } from "./fixtures/legacy-public-catalog-sql";
import { legacyManagedSkuRowsSql } from "./fixtures/legacy-managed-products-sql";
import { metered } from "./fixtures/metered-d1";
import {
  createD1PublicCatalogRepository,
  readPublicCatalogRows,
} from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import {
  createD1ProductManagementRepository,
  readManagedSkuRows,
} from "../app/modules/catalog/infrastructure/d1-product-management-repository";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";

// D1 bills rows scanned. The two storefront/admin reads used to join one materialized copy of every runtime
// view once per SKU (quadratic), reading ~1.7M rows for 645 SKUs. They must now read each view once.
const BULK = 300;
type Platform = Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>
>;
const directories: string[] = [];
const platforms: Platform[] = [];

async function openDatabase(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `catalog-read-cost-${label}-`));
  directories.push(directory);
  const migration = spawnSync("pnpm", ["migrate"], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(import.meta.dirname, "..", "wrangler.jsonc"),
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  platforms.push(platform);
  return platform.env.DB;
}

async function legacyRows(database: D1Database, sku?: string) {
  const statement = database.prepare(legacyPublicCatalogSql(sku !== undefined));
  return (sku !== undefined ? statement.bind(sku) : statement).all<
    Record<string, unknown>
  >();
}

function skusOfEveryType(rows: Array<{ sku: string; product_type: string }>) {
  const byType = new Map<string, string[]>();
  for (const row of rows)
    byType.set(row.product_type, [
      ...(byType.get(row.product_type) ?? []),
      row.sku,
    ]);
  return [...byType.values()].flatMap((skus) => [
    skus[0],
    skus[Math.floor(skus.length / 2)],
    skus.at(-1)!,
  ]);
}

afterAll(async () => {
  for (const platform of platforms) await platform.dispose();
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
});

describe("public catalog read before the cutover (legacy baseline)", () => {
  let db: D1Database;
  beforeAll(async () => {
    db = await openDatabase("public-legacy");
    await seedCatalogItemBaseline(db, null, BULK);
  }, 120000);

  it("returns exactly the rows of the reference join, in the same order", async () => {
    const reference = (await legacyRows(db)).results;
    expect(reference.length).toBe(BULK + 1);
    expect(await readPublicCatalogRows(db)).toEqual(reference);
    for (const sku of skusOfEveryType(
      reference as Array<{ sku: string; product_type: string }>,
    ))
      expect(await readPublicCatalogRows(db, { sku })).toEqual(
        (await legacyRows(db, sku)).results,
      );
    expect(await readPublicCatalogRows(db, { sku: "NO_SUCH_SKU" })).toEqual([]);
  }, 120000);

  it("reads each runtime view once instead of once per SKU", async () => {
    const { binding, counter } = metered(db);
    const items = await createD1PublicCatalogRepository(binding).browse({});
    expect(items.items.length).toBe(BULK + 1);
    expect(counter.reads).toBeLessThan(20 * (BULK + 1) + 1000);
    const reference = metered(db);
    await reference.binding.prepare(legacyPublicCatalogSql(false)).all();
    expect(reference.counter.reads).toBeGreaterThan(counter.reads * 20);
  }, 120000);
});

describe("catalog reads after the cutover (item mode with edited items)", () => {
  let db: D1Database;
  beforeAll(async () => {
    db = await openDatabase("item-mode");
    await seedManagedAssemblyBaseline(db, BULK);
    const items = createD1CatalogItemRepository(db);
    for (const [index, sku] of ["601R1_B0007", "601R1_B0120"].entries()) {
      const payload = (await items.findPayload("sku", sku))!;
      if (payload.kind === "sku" && payload.price)
        payload.price.amount = 11.5 + index;
      await items.apply({
        payload,
        targetState: "online",
        mode: "edit",
        commandId: `read-cost-edit-${index}`,
        actorId: "owner-1",
        ipAddress: "local",
        baselineRevisionId: null,
        source: { channel: "manual" },
      });
    }
  }, 120000);

  it("public rows equal the reference join, including edited items and components", async () => {
    const reference = (await legacyRows(db)).results;
    expect(reference.length).toBeGreaterThan(BULK + 1);
    const rows = await readPublicCatalogRows(db);
    expect(rows).toEqual(reference);
    expect(
      rows.some((row) => row.item_revision_id !== null && row.item_generation),
    ).toBe(true);
    for (const sku of [
      "601R1_001",
      "601R1_B0007",
      "601R1_B0120",
      ...skusOfEveryType(
        reference as Array<{ sku: string; product_type: string }>,
      ),
    ])
      expect(await readPublicCatalogRows(db, { sku })).toEqual(
        (await legacyRows(db, sku)).results,
      );
  }, 120000);

  it("public catalog read stays linear in the number of SKUs", async () => {
    const { binding, counter } = metered(db);
    const { items } = await createD1PublicCatalogRepository(binding).browse({});
    expect(counter.reads).toBeLessThan(20 * items.length + 1000);
  }, 120000);

  it("admin SKU rows equal the reference join", async () => {
    const importId = (await db
      .prepare(
        "SELECT r.source_import_id AS id FROM catalog_active_release a JOIN catalog_releases r ON r.id = a.release_id",
      )
      .first<{ id: string }>())!.id;
    const reference = (
      await db.prepare(legacyManagedSkuRowsSql).bind(importId).all()
    ).results;
    expect(reference.length).toBeGreaterThan(BULK);
    const rows = await readManagedSkuRows(db, importId);
    expect(rows).toEqual(reference);
    expect(rows.some((row) => row.dirty !== null)).toBe(true);
  }, 120000);

  it("admin product list reads each view once instead of once per SKU", async () => {
    const { binding, counter } = metered(db);
    const page = await createD1ProductManagementRepository(binding).list({
      types: [],
      status: "",
      attention: "",
      query: "",
      page: 1,
      pageSize: 20,
    });
    expect(page.total).toBeGreaterThan(0);
    expect(counter.reads).toBeLessThan(40 * (BULK + 1) + 3000);
  }, 120000);
});

it("scopes admin list and editor reads while preserving the full projection", async () => {
  for (const db of platforms.map((platform) => platform.env.DB)) {
    const reference = metered(db);
    const full = await createD1ProductManagementRepository(
      reference.binding,
    ).all();
    const types = [
      "hose",
      "hose_end",
      "ferrule",
      "adapter",
      "quick_coupler",
    ] as const;
    for (const type of types) {
      const measured = metered(db);
      const manager = createD1ProductManagementRepository(measured.binding);
      expect(await manager.all({ types: [type] })).toEqual(
        full.filter((r) => r.productType === type),
      );
      // A small category must not pay for the hundreds of unrelated hose variants.
      if (type !== "hose")
        expect(measured.counter.reads).toBeLessThan(reference.counter.reads);
      measured.counter.reads = 0;
      const options = await manager.editorOptions(type);
      expect(options.series).toEqual(
        full
          .filter((r) => r.productType === type && r.kind === "series")
          .map(({ code, name, state }) => ({ code, name, state })),
      );
      expect(options.states).toEqual(
        full
          .filter((r) => r.productType === type)
          .map(({ kind, code, state }) => ({ kind, code, state })),
      );
      expect(measured.counter.reads).toBeLessThan(reference.counter.reads);
    }
    for (const row of full
      .filter((r) => r.kind === "sku")
      .filter((_, index) => index % 71 === 0)) {
      const measured = metered(db);
      expect(
        await createD1ProductManagementRepository(measured.binding).findSku(
          row.code,
          row.productType,
        ),
      ).toEqual(row);
      expect(measured.counter.reads).toBeLessThan(reference.counter.reads);
    }
    const manager = createD1ProductManagementRepository(db);
    expect(await manager.findSku("NO-SUCH-SKU")).toBeNull();
    const hose = full.find(
      (r) => r.kind === "sku" && r.productType === "hose",
    )!;
    expect(await manager.findSku(hose.code, "adapter")).toBeNull();
  }
}, 120000);
