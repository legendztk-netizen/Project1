import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1ManagedAssemblies } from "../app/modules/catalog/infrastructure/d1-managed-assemblies";
import { retainedAssemblySeriesSql } from "../app/modules/catalog/infrastructure/retained-assembly-series-sql";
import { scopedAssemblyCombinationsSql } from "../app/modules/configurator/infrastructure/scoped-assembly-combinations-sql";
import {
  hoseAssemblyCombinations,
  hoseAssemblyPartsSql,
} from "../app/modules/configurator/infrastructure/hose-assembly-combinations";

const root = join(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "retained-assembly-series-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const actor = { id: "owner-1", catalogPermission: "edit" as const };
const command = () => ({ id: crypto.randomUUID(), ipAddress: "203.0.113.1" });
// The view-based lookup the rewrite replaces.
const viewLookup = `SELECT DISTINCT hose_series FROM catalog_runtime_assembly_combinations
  WHERE release_id=(SELECT baseline_release_id FROM catalog_item_publication_state WHERE singleton=1)
    AND (hose_sku=?1 OR end_a_hose_end_sku=?1 OR end_b_hose_end_sku=?1 OR end_a_ferrule_sku=?1 OR end_b_ferrule_sku=?1)`;

async function compareEveryCode() {
  const codes = (
    await db
      .prepare(
        `SELECT hose_sku AS code FROM catalog_compatibilities UNION SELECT hose_end_sku FROM catalog_compatibilities
         UNION SELECT ferrule_sku FROM catalog_compatibilities UNION SELECT code FROM catalog_product_entities WHERE kind='sku'`,
      )
      .all<{ code: string }>()
  ).results.map((r) => r.code);
  let referenced = 0;
  for (const code of [...codes, "UNKNOWN-SKU"]) {
    const series = async (sql: string) =>
      (await db.prepare(sql).bind(code).all<{ hose_series: string }>()).results
        .map((r) => r.hose_series)
        .sort();
    const expected = await series(viewLookup);
    expect(await series(retainedAssemblySeriesSql), code).toEqual(expected);
    if (expected.length) referenced++;
  }
  return referenced;
}

// The Assembly Management list reads its own SQL; it must return the view's rows in its order.
async function compareAssemblyList() {
  const view = await db
    .prepare(
      `SELECT c.identity,c.hose_series AS hoseSeries,c.hose_sku AS hoseSku,
       c.end_a_compatibility_id AS endACompatibilityId,c.end_a_hose_end_sku AS endAHoseEndSku,c.end_a_ferrule_sku AS endAFerruleSku,
       c.end_b_compatibility_id AS endBCompatibilityId,c.end_b_hose_end_sku AS endBHoseEndSku,c.end_b_ferrule_sku AS endBFerruleSku
       FROM catalog_runtime_assembly_combinations c
       WHERE c.release_id=(SELECT baseline_release_id FROM catalog_item_publication_state WHERE singleton=1)
       ORDER BY c.hose_series,c.identity`,
    )
    .all();
  const assemblies = createD1ManagedAssemblies(db, actor);
  const listed = (await assemblies.all()).map((row) => ({
    identity: row.identity,
    hoseSeries: row.hoseSeries,
    hoseSku: row.hoseSku,
    endACompatibilityId: row.endACompatibilityId,
    endAHoseEndSku: row.endAHoseEndSku,
    endAFerruleSku: row.endAFerruleSku,
    endBCompatibilityId: row.endBCompatibilityId,
    endBHoseEndSku: row.endBHoseEndSku,
    endBFerruleSku: row.endBFerruleSku,
  }));
  expect(listed).toEqual(view.results);
  expect(await assemblies.count()).toBe(view.results.length);
  // Build a Hose pairs one hose's endpoints in code; the pairs must be the SQL-paired rows.
  const release = (await db
    .prepare(
      "SELECT baseline_release_id AS id FROM catalog_item_publication_state",
    )
    .first<{ id: string }>())!.id;
  for (const hose of new Set(listed.map((row) => row.hoseSku))) {
    const byIdentity = (rows: object[]) =>
      rows
        .map((row) => {
          const { release_id: _release, ...rest } = row as Record<
            string,
            unknown
          >;
          return rest;
        })
        .sort((a, b) => String(a.identity).localeCompare(String(b.identity)));
    const scoped = await db
      .prepare(scopedAssemblyCombinationsSql)
      .bind(release, hose)
      .all();
    const parts = await db
      .prepare(hoseAssemblyPartsSql)
      .bind(release, hose)
      .all<Parameters<typeof hoseAssemblyCombinations>[0][number]>();
    expect(byIdentity(hoseAssemblyCombinations(parts.results))).toEqual(
      byIdentity(scoped.results),
    );
  }
  return listed;
}

// Import-era relations of the baseline release, used until a series is first generated. The
// published release is immutable, so its insert guards are lifted for this seed only.
async function seedLegacyRelations() {
  const guards = (
    await db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='trigger'
         AND name IN ('catalogskus_immutable_insert','catalogcompatibilities_immutable_insert')`,
      )
      .all<{ name: string; sql: string }>()
  ).results;
  expect(guards).toHaveLength(2);
  await db.batch(guards.map((g) => db.prepare(`DROP TRIGGER ${g.name}`)));
  const release = await db
    .prepare(
      `SELECT r.source_import_id AS importId FROM catalog_item_publication_state s
       JOIN catalog_releases r ON r.id=s.baseline_release_id`,
    )
    .first<{ importId: string }>();
  const importId = release!.importId;
  const skus = [
    ["LEGACY-END-A", "hose_end"],
    ["LEGACY-END-B", "hose_end"],
    ["LEGACY-FERRULE", "ferrule"],
  ];
  await db.batch([
    ...skus.map(([sku, type]) =>
      db
        .prepare(
          `INSERT INTO catalog_skus (id, import_id, sku, source_worksheet, product_type, catalog_publication_status,
             rfq_eligibility, technical_data_status, supply_availability)
           VALUES (?, ?, ?, 'legacy', ?, 'Published', 'Eligible', 'Pending', 'available_for_quote')`,
        )
        .bind(`${importId}:sku:${sku}`, importId, sku, type),
    ),
    ...["LEGACY-END-A", "LEGACY-END-B"].map((end) =>
      db
        .prepare(
          `INSERT INTO catalog_compatibilities (id, import_id, compatibility_id, hose_sku, hose_end_sku, ferrule_sku,
             qualification_status, rfq_eligibility, technical_data_status, production_approval_status, catalog_publication_status)
           VALUES (?, ?, ?, '601R1_001', ?, 'LEGACY-FERRULE', 'Not Tested', 'Eligible', 'Pending', 'not_approved', 'Published')`,
        )
        .bind(
          `${importId}:compatibility:${end}`,
          importId,
          `LEGACY:${end}`,
          end,
        ),
    ),
  ]);
  await db.batch(guards.map((g) => db.prepare(g.sql)));
}

beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(root, "wrangler.jsonc"),
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  await seedManagedAssemblyBaseline(db);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("finds the same retained series as the assembly combination view for legacy, generated and manual combinations", async () => {
  const assemblies = createD1ManagedAssemblies(db, actor);
  // Before generation only the legacy compatibility arm can match.
  await seedLegacyRelations();
  expect(await compareEveryCode()).toBeGreaterThan(0);
  expect(
    (await compareAssemblyList()).filter((row) =>
      row.endACompatibilityId.startsWith("LEGACY:"),
    ),
  ).toHaveLength(4);
  await assemblies.update(command());
  expect(await compareEveryCode()).toBeGreaterThan(0);
  await compareAssemblyList();
  // A manual combination replaces the generated pair with the same identity.
  const [combination] = await assemblies.all();
  await assemblies.add(combination, command());
  expect(await compareEveryCode()).toBeGreaterThan(0);
  await compareAssemblyList();
});
