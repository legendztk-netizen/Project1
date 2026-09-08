import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1ItemImportReview } from "../app/modules/catalog/infrastructure/d1-item-import-review";
import { createD1ManagedAssemblies } from "../app/modules/catalog/infrastructure/d1-managed-assemblies";
import { createD1ConfiguratorRepository } from "../app/modules/configurator/infrastructure/d1-configurator-repository";
import type { CatalogWorkbookSheet } from "../app/modules/catalog/domain/catalog-workbook";
const root = join(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "managed-assembly-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
let items: ReturnType<typeof createD1CatalogItemRepository>;
let assemblies: ReturnType<typeof createD1ManagedAssemblies>;
const actor = { id: "owner-1", catalogPermission: "edit" as const };
const command = () => ({ id: crypto.randomUUID(), ipAddress: "203.0.113.1" });
async function importRows(sheets: CatalogWorkbookSheet[]) {
  const review = createD1ItemImportReview(db, actor);
  const batchId = crypto.randomUUID();
  await review.importWorkbook({
    batchId,
    fileName: "relations.xlsx",
    fileSize: 100,
    sheets,
    actorId: actor.id,
    ipAddress: "local",
  });
  const rows = (await review.all()).filter((r) => r.batchId === batchId);
  if (rows.length) {
    const results = await review.review({
      selected: rows.map((r) => ({ id: r.id, version: r.version })),
      intent: "approve",
      actorId: actor.id,
      ipAddress: "local",
    });
    expect(
      results.every((r) => r.ok),
      JSON.stringify(results),
    ).toBe(true);
  }
  return batchId;
}
async function editHose(values: Record<string, unknown>, price?: number) {
  const payload = (await items.findPayload("sku", "601R1_001"))!;
  if (payload.kind !== "sku") throw Error("fixture");
  Object.assign(payload.variant, { notes: "Reviewed hose", ...values });
  if (price !== undefined && payload.price) payload.price.amount = price;
  return items.apply({
    payload,
    targetState: "online",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: actor.id,
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
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
  items = createD1CatalogItemRepository(db);
  assemblies = createD1ManagedAssemblies(db, actor);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});
it("gates published inputs until generation, preserves manual identity and exclusion across rebuilds", async () => {
  const config = createD1ConfiguratorRepository(db);
  expect(await assemblies.pending()).toEqual(["601R1"]);
  expect(
    await config.findCompatibleEndA("active-release", "601R1_001"),
  ).toEqual([]);
  expect(await assemblies.update(command())).toEqual([
    expect.objectContaining({ success: true }),
  ]);
  const [combination] = await assemblies.all();
  expect(combination).toBeDefined();
  expect(
    await config.findCompatibleEndA("active-release", "601R1_001"),
  ).toHaveLength(1);
  const manualCommand = command();
  await assemblies.add(combination, manualCommand);
  await assemblies.add(combination, manualCommand);
  expect(await assemblies.pending()).toEqual(["601R1"]);
  await assemblies.update(command());
  await expect(assemblies.add(combination, command())).rejects.toThrow(
    "已存在",
  );
  await assemblies.setEnabled(
    [combination.identity],
    false,
    "检修排除",
    command(),
  );
  await editHose({ dash: "-04" }); // Normalized equality may not dirty; force compatibility change and restore.
  await editHose({ skiveRequirement: "Other" });
  await editHose({ skiveRequirement: "No Skive" });
  await assemblies.update(command());
  expect((await assemblies.all())[0]).toMatchObject({
    source: "manual",
    disabled: true,
    pending: false,
  });
  expect(
    await config.hasDerivedAssemblyCombination({
      releaseId: "active-release",
      hoseSku: combination.hoseSku,
      endACompatibilityId: combination.endACompatibilityId,
      endBCompatibilityId: combination.endBCompatibilityId,
    }),
  ).toBe(false);
  await assemblies.setEnabled(
    [combination.identity],
    true,
    "检修完成",
    command(),
  );
  expect(
    await config.findCompatibleEndA("active-release", "601R1_001"),
  ).toHaveLength(1);
  await editHose({ workingBar: 190 }, 55);
  expect(await assemblies.pending()).toEqual([]);
  expect(await assemblies.update(command())).toEqual([]);
  const history = await assemblies.history();
  expect(history.some((h) => h.kind === "disable")).toBe(true);
  await expect(
    db.prepare("DELETE FROM catalog_assembly_operations").run(),
  ).rejects.toThrow("immutable");
});
it("rejects commands from a viewer and preserves pending state on stale commit", async () => {
  await expect(
    createD1ManagedAssemblies(db, {
      id: "viewer",
      catalogPermission: "view",
    }).update(command()),
  ).rejects.toThrow("权限");
  await editHose({ dash: "-8" });
  const token = (await db
    .prepare(
      "SELECT invalidated_sequence FROM catalog_item_assembly_state WHERE hose_series='601R1'",
    )
    .first<{ invalidated_sequence: number }>())!;
  await editHose({ dash: "-4" });
  await expect(
    db
      .prepare(
        `INSERT INTO catalog_assembly_operations(id,kind,hose_series,expected_sequence,expected_relation_version,payload_json,actor_id,ip_address,occurred_at)
 VALUES (?,'generate','601R1',?,1,'{"endpoints":[],"combinations":[]}','owner-1','local','2026-09-08')`,
      )
      .bind(crypto.randomUUID(), token.invalidated_sequence)
      .run(),
  ).rejects.toThrow("inputs changed");
  expect(await assemblies.pending()).toEqual(["601R1"]);
  await assemblies.update(command());
});
it("applies a sheet 04 source with its crimp data and audit, then requires generation", async () => {
  const values = {
    catalogPublicationStatus: "Published",
    compatibilityId: "IMPORTED-END",
    hoseSku: "601R1_001",
    hoseEndSku: "FJX-04-04",
    ferruleSku: "601R1_1WB_TEST",
    qualificationStatus: "Not Tested",
    rfqEligibility: "Eligible",
    technicalDataStatus: "Pending",
    crimpProgram: "KEEP-17",
    finalCrimpDiameterMm: 17.5,
  };
  const batch = await importRows([
    {
      sheet: "04_兼容压接",
      data: [Object.keys(values), Object.values(values)],
    },
  ]);
  const source = (await assemblies.sources()).find((s) =>
    s.source_json.includes("IMPORTED-END"),
  )!;
  expect(source).toBeDefined();
  expect(batch).toBeTruthy();
  await assemblies.processSource(source.id, "apply", "采用参考关系", command());
  expect(await assemblies.pending()).toEqual(["601R1"]);
  expect(
    await createD1ConfiguratorRepository(db).findCompatibleEndA(
      "active-release",
      "601R1_001",
    ),
  ).toEqual([]);
  await assemblies.update(command());
  const endpoint = await db
    .prepare(
      "SELECT * FROM catalog_runtime_compatibilities WHERE compatibility_id='IMPORTED-END'",
    )
    .first();
  expect(endpoint).toMatchObject({
    crimp_program: "KEEP-17",
    final_crimp_diameter_mm: 17.5,
    production_approval_status: "not_approved",
  });
  expect(
    await createD1ConfiguratorRepository(db).findCompatibleEndA(
      "active-release",
      "601R1_001",
    ),
  ).toEqual([expect.objectContaining({ compatibilityId: "IMPORTED-END" })]);
  expect(
    (await assemblies.sources()).find((s) => s.id === source.id)?.status,
  ).toBe("applied");
  await expect(
    assemblies.processSource(source.id, "apply", "再次应用", command()),
  ).rejects.toThrow("待处理");
});
it("keeps a failed series pending while committing another, and permits a price-only concurrent publication", async () => {
  await editHose({ skiveRequirement: "Other" });
  await editHose({ skiveRequirement: "No Skive" });
  await db
    .prepare(
      "INSERT INTO catalog_item_assembly_state(hose_series,invalidated_sequence) VALUES ('BROKEN',1)",
    )
    .run();
  await db
    .prepare(
      "CREATE TRIGGER test_series_failure BEFORE INSERT ON catalog_assembly_operations WHEN NEW.kind='generate' AND NEW.hose_series='BROKEN' BEGIN SELECT RAISE(ABORT,'fixture input failure'); END",
    )
    .run();
  const result = await assemblies.update(command());
  expect(result).toEqual([
    expect.objectContaining({ series: "601R1", success: true }),
    expect.objectContaining({ series: "BROKEN", success: false }),
  ]);
  expect(await assemblies.pending()).toEqual(["BROKEN"]);
  const before = await db
    .prepare(
      "SELECT generation_id FROM catalog_assembly_managed_series WHERE hose_series='601R1'",
    )
    .first();
  await db.prepare("DROP TRIGGER test_series_failure").run();
  await assemblies.update(command());
  expect(
    await db
      .prepare(
        "SELECT generation_id FROM catalog_assembly_managed_series WHERE hose_series='601R1'",
      )
      .first(),
  ).toEqual(before);
  await editHose({ skiveRequirement: "Other" });
  await editHose({ skiveRequirement: "No Skive" });
  let published = false;
  const intercepted = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      if (!sql.startsWith("INSERT INTO catalog_assembly_operations"))
        return statement;
      return {
        bind(...bindings: unknown[]) {
          const bound = statement.bind(...bindings);
          return {
            async run() {
              if (!published) {
                published = true;
                await editHose({}, 99);
              }
              return bound.run();
            },
          };
        },
      };
    },
  } as D1Database;
  expect(
    await createD1ManagedAssemblies(intercepted, actor).update(command()),
  ).toEqual([expect.objectContaining({ success: true })]);
  expect(await assemblies.pending()).toEqual([]);
});
it("reserves applied identifiers before generation, records new dependencies, and replays source commands", async () => {
  for (const sku of ["NEW-END-A", "NEW-END-B"]) {
    const payload = (await items.findProductPayload(
      "hose_end",
      "sku",
      "FJX-04-04",
    ))!;
    if (payload.kind !== "sku") throw Error("fixture");
    payload.variant.sku = sku;
    await items.apply({
      payload,
      targetState: "online",
      mode: "create",
      commandId: crypto.randomUUID(),
      actorId: actor.id,
      ipAddress: "local",
      baselineRevisionId: null,
      source: { channel: "manual" },
    });
  }
  const base = {
    catalogPublicationStatus: "Published",
    compatibilityId: "RESERVED-ID",
    hoseSku: "601R1_001",
    hoseEndSku: "NEW-END-A",
    ferruleSku: "601R1_1WB_TEST",
    qualificationStatus: "Not Tested",
    rfqEligibility: "Eligible",
    technicalDataStatus: "Pending",
  };
  await importRows([
    {
      sheet: "04_兼容压接",
      data: [
        Object.keys(base),
        Object.values(base),
        Object.values({ ...base, hoseEndSku: "NEW-END-B" }),
      ],
    },
  ]);
  const rows = (await assemblies.sources()).filter((s) =>
    s.source_json.includes("RESERVED-ID"),
  );
  const first = rows.find((s) => s.source_json.includes("NEW-END-A"))!;
  const second = rows.find((s) => s.source_json.includes("NEW-END-B"))!;
  const context = command();
  await assemblies.processSource(first.id, "apply", "验证编号唯一", context);
  await assemblies.processSource(first.id, "apply", "验证编号唯一", context);
  await expect(
    assemblies.processSource(first.id, "apply", "改变重放内容", context),
  ).rejects.toThrow("提交标识");
  const operation = await db
    .prepare("SELECT payload_json FROM catalog_assembly_operations WHERE id=?")
    .bind(context.id)
    .first<{ payload_json: string }>();
  expect(JSON.parse(operation!.payload_json).revisions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "NEW-END-A",
        revision_id: expect.any(String),
      }),
    ]),
  );
  await expect(
    assemblies.processSource(second.id, "apply", "重复编号", command()),
  ).rejects.toThrow("关系编号");
  expect(
    (await assemblies.sources()).find((s) => s.id === second.id)?.status,
  ).toBe("pending");
  const reject = command();
  await assemblies.processSource(second.id, "reject", "编号冲突", reject);
  await assemblies.processSource(second.id, "reject", "编号冲突", reject);
  await assemblies.update(command());
  expect(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM catalog_runtime_compatibilities WHERE compatibility_id='RESERVED-ID'",
        )
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
});
