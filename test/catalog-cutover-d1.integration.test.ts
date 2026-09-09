import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1CatalogCutover } from "../app/modules/catalog/infrastructure/d1-catalog-cutover";
const root = join(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "catalog-cutover-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const actor = {
  id: "owner-1",
  accountType: "owner",
  catalogPermission: "edit",
};
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

it("requires an owner and refuses a stale inventory; cancellation restores maintenance", async () => {
  const denied = createD1CatalogCutover(db, {
    ...actor,
    accountType: "subaccount",
  });
  await expect(denied.inventory("denied")).rejects.toThrow(/主账号/);
  const repo = createD1CatalogCutover(db, actor);
  await repo.inventory("stale");
  await db
    .prepare("UPDATE catalog_item_publication_state SET generation=generation")
    .run();
  await expect(repo.freeze("stale")).rejects.toThrow(/changed/);
  await repo.cancel("stale");
  await repo.inventory("other");
  await repo.inventory("cancel");
  await repo.freeze("cancel");
  await repo.cancel("other");
  await expect(
    db
      .prepare(
        "UPDATE catalog_item_publication_state SET generation=generation",
      )
      .run(),
  ).rejects.toThrow(/frozen/);
  await repo.cancel("cancel");
  await expect(
    db
      .prepare(
        "UPDATE catalog_item_publication_state SET generation=generation",
      )
      .run(),
  ).resolves.toBeDefined();
});
it("preserves changed draft contents while leaving inherited rows alone", async () => {
  const active = await db
    .prepare(
      "SELECT r.* FROM catalog_releases r JOIN catalog_active_release a ON a.release_id=r.id",
    )
    .first<{ id: string; source_import_id: string }>();
  async function clone(
    table: string,
    where: string,
    values: unknown[],
    overrides: Record<string, string>,
  ) {
    const columns = (
      await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
    ).results.map((r) => r.name);
    const selections = columns.map((k) => overrides[k] ?? `"${k}"`);
    await db
      .prepare(
        `INSERT INTO ${table} (${columns.map((k) => `"${k}"`).join(",")}) SELECT ${selections.join(",")} FROM ${table} WHERE ${where}`,
      )
      .bind(...values)
      .run();
  }
  await clone("catalog_imports", "id=?", [active!.source_import_id], {
    id: "'migration-draft-import'",
  });
  await clone("catalog_releases", "id=?", [active!.id], {
    id: "'migration-draft'",
    release_number: "'MIGRATION-DRAFT'",
    status: "'draft'",
    source_import_id: "'migration-draft-import'",
    published_at: "NULL",
  });
  for (const table of [
    "catalog_hose_series",
    "catalog_skus",
    "catalog_hose_variants",
    "catalog_sales_offers",
    "catalog_sku_price_packaging",
    "catalog_series_commercial_rules",
  ])
    await clone(table, "import_id=?", [active!.source_import_id], {
      id: "id||':draft'",
      import_id: "'migration-draft-import'",
    });
  await db
    .prepare(
      "UPDATE catalog_hose_variants SET notes='Migration changed note' WHERE import_id='migration-draft-import'",
    )
    .run();
  const repo = createD1CatalogCutover(db, actor);
  const r = await repo.inventory("draft-check");
  const report = JSON.parse(r.report_json);
  expect(report.requests).toBeGreaterThan(0);
  const records = await db
    .prepare(
      "SELECT payload_json FROM catalog_cutover_records WHERE run_id='draft-check' AND record_kind='request'",
    )
    .all<{ payload_json: string }>();
  expect(
    records.results.some(
      (row) => JSON.parse(row.payload_json).disposition === "changed",
    ),
  ).toBe(true);
  await repo.cancel(r.id);
});
it("freezes against concurrent writes, commits evidence atomically and replays without replacing item edits", async () => {
  const repo = createD1CatalogCutover(db, actor);
  const before = await db
    .prepare("SELECT COUNT(*) AS n FROM catalog_product_revisions")
    .first<{ n: number }>();
  const r = await repo.inventory("rehearsal");
  expect(JSON.parse(r.report_json).baselineProducts).toBeGreaterThan(0);
  await repo.freeze(r.id);
  await expect(
    db.prepare("UPDATE catalog_imports SET summary_json='{}'").run(),
  ).rejects.toThrow(/frozen/);
  await repo.commit(r.id);
  expect((await repo.commit(r.id)).status).toBe("committed");
  expect(
    (await db
      .prepare("SELECT COUNT(*) AS n FROM catalog_product_revisions")
      .first<{ n: number }>())!.n,
  ).toBe(before!.n + JSON.parse(r.report_json).baselineProducts);
  await expect(
    db.prepare("UPDATE catalog_imports SET summary_json='{}'").run(),
  ).rejects.toThrow(/frozen/);
  await expect(repo.cancel(r.id)).resolves.toMatchObject({
    status: "committed",
  });
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual(
    [],
  );
}, 60000);
