import { spawnSync } from "node:child_process";
import { scopedAssemblyCombinationsSql } from "../app/modules/configurator/infrastructure/scoped-assembly-combinations-sql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { legacyCompatibleHoseEndSql } from "./fixtures/legacy-compatible-end-sql";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1ManagedAssemblies } from "../app/modules/catalog/infrastructure/d1-managed-assemblies";
import {
  compatibleHoseEndCandidateFromRow,
  createD1ConfiguratorRepository,
} from "../app/modules/configurator/infrastructure/d1-configurator-repository";

// Choosing a hose in Build a Hose lists the End A options. The former query validated every derived
// combination of the hose against whole runtime views (~6M rows per call on the preview data). The new
// reader must return exactly the same candidates in the same order through every availability state.
const directory = mkdtempSync(join(tmpdir(), "configurator-ends-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const actor = { id: "owner-1", catalogPermission: "edit" as const };
const command = () => ({ id: crypto.randomUUID(), ipAddress: "203.0.113.1" });
const hoses = ["601R1_001", "601R1_B0001"];

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
  await seedManagedAssemblyBaseline(db, 20);
}, 120000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

async function reference(hoseSku: string) {
  const rows = await db
    .prepare(legacyCompatibleHoseEndSql())
    .bind("active-release", hoseSku)
    .all<Parameters<typeof compatibleHoseEndCandidateFromRow>[0]>();
  return rows.results.map(compatibleHoseEndCandidateFromRow);
}

async function expectSameAsReference(label: string) {
  for (const hoseSku of hoses) {
    const scoped = (
      await db
        .prepare(scopedAssemblyCombinationsSql)
        .bind("active-release", hoseSku)
        .all<{ identity: string }>()
    ).results;
    const original = (
      await db
        .prepare(
          "SELECT * FROM catalog_runtime_assembly_combinations WHERE release_id=?1 AND hose_sku=?2",
        )
        .bind("active-release", hoseSku)
        .all<{ identity: string }>()
    ).results;
    const sort = (rows: typeof scoped) =>
      rows.sort((a, b) => a.identity.localeCompare(b.identity));
    expect(sort(scoped), label).toEqual(sort(original));
    expect(
      await createD1ConfiguratorRepository(db).findCompatibleEndA(
        "active-release",
        hoseSku,
      ),
      `${label} ${hoseSku}`,
    ).toEqual(await reference(hoseSku));
  }
}

it("lists exactly the reference End A candidates through every availability state", async () => {
  const assemblies = createD1ManagedAssemblies(db, actor);
  const items = createD1CatalogItemRepository(db);
  await expectSameAsReference("before generation");
  await assemblies.update(command());
  await expectSameAsReference("generated");
  expect(
    await createD1ConfiguratorRepository(db).findCompatibleEndA(
      "active-release",
      "601R1_001",
    ),
  ).toHaveLength(1);

  const [combination] = await assemblies.all();
  await assemblies.setEnabled(
    [combination.identity],
    false,
    "检修排除",
    command(),
  );
  await expectSameAsReference("excluded");
  await assemblies.setEnabled(
    [combination.identity],
    true,
    "检修完成",
    command(),
  );
  await expectSameAsReference("re-enabled");
  await assemblies.add(combination, command());
  await expectSameAsReference("manual override pending");
  await assemblies.update(command());
  await expectSameAsReference("manual override regenerated");

  // A component taken off sale removes the assembly; its lifecycle change marks the series for an
  // assembly update, so it returns only after the update.
  const ferruleSku = (await db
    .prepare(
      "SELECT ferrule_sku FROM catalog_runtime_compatibilities WHERE hose_sku = '601R1_001' LIMIT 1",
    )
    .first<{ ferrule_sku: string }>())!.ferrule_sku;
  const ferrule = (await items.findProductPayload(
    "ferrule",
    "sku",
    ferruleSku,
  ))!;
  const setFerrule = (targetState: "online" | "discontinued") =>
    items.apply({
      payload: ferrule,
      targetState,
      mode: "edit",
      commandId: `ferrule-${targetState}`,
      actorId: actor.id,
      ipAddress: "local",
      baselineRevisionId: null,
      source: { channel: "manual" },
    });
  const endA = () =>
    createD1ConfiguratorRepository(db).findCompatibleEndA(
      "active-release",
      "601R1_001",
    );
  await setFerrule("discontinued");
  await expectSameAsReference("ferrule discontinued");
  expect(await endA()).toEqual([]);
  await setFerrule("online");
  await expectSameAsReference("ferrule back online");
  await assemblies.update(command());
  await expectSameAsReference("assemblies updated");
  expect(await endA()).toHaveLength(1);

  const payload = (await items.findPayload("sku", "601R1_001"))!;
  if (payload.kind !== "sku") throw new Error("fixture");
  payload.variant.notes = "Temporarily blocked";
  await items.apply({
    payload,
    targetState: "discontinued",
    mode: "edit",
    commandId: "block-hose",
    actorId: actor.id,
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  await expectSameAsReference("hose discontinued");
  expect(
    await createD1ConfiguratorRepository(db).findCompatibleEndA(
      "active-release",
      "601R1_001",
    ),
  ).toEqual([]);
  expect(
    await createD1ConfiguratorRepository(db).findCompatibleEndA(
      "missing-release",
      "601R1_001",
    ),
  ).toEqual([]);
}, 180000);
