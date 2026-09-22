import { componentImportFixtures } from "./fixtures/component-item-import";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
import { seedCatalogItemBaseline } from "./fixtures/catalog-item-baseline";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1ItemImportReview } from "../app/modules/catalog/infrastructure/d1-item-import-review";
import type { CatalogWorkbookSheet } from "../app/modules/catalog/domain/catalog-workbook";
const root = join(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "item-import-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
let items: ReturnType<typeof createD1CatalogItemRepository>;
let review: ReturnType<typeof createD1ItemImportReview>;
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
  await seedCatalogItemBaseline(db);
  items = createD1CatalogItemRepository(db);
  review = createD1ItemImportReview(db, {
    id: "owner-1",
    catalogPermission: "edit",
  });
  await items.enable({ environment: "local", actorId: "owner-1" });
  const payload = (await items.findPayload("sku", "601R1_001"))!;
  if (payload.kind === "sku") payload.variant.notes = "Reviewed baseline";
  await items.apply({
    payload,
    targetState: "online",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: "owner-1",
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { force: true, recursive: true });
});
async function importRows(sheets: CatalogWorkbookSheet[]) {
  const batchId = crypto.randomUUID();
  await review.importWorkbook({
    batchId,
    fileName: "test.xlsx",
    fileSize: 100,
    sheets,
    actorId: "owner-1",
    ipAddress: "local",
  });
  return (await review.all()).filter((r) => r.batchId === batchId);
}
const priceSheet = (
  amount: number,
  currency = "USD",
): CatalogWorkbookSheet => ({
  sheet: "07_价格包装",
  data: [
    ["productType", "baseSku", "amount", "currency"],
    ["Hose Variant", "601R1_001", amount, currency],
  ],
});
const approve = (rows: { id: string; version: number }[]) =>
  review.review({
    selected: rows,
    intent: "approve",
    actorId: "owner-1",
    ipAddress: "local",
  });
it("approves a split-template price and packaging atomically without invalidating assemblies, then gates a Dash change", async () => {
  const before = await db
    .prepare("SELECT * FROM catalog_item_assembly_state ORDER BY hose_series")
    .all();
  const rows = await importRows([
    { sheet: "00_填写说明", data: [["填写说明"]] },
    { sheet: "09_字段字典", data: [["字段"]] },
    { sheet: "10_下拉选项", data: [["USD", "CNY"]] },
    {
      sheet: "01_胶管主数据",
      data: [
        [
          "Hose SKU / 胶管SKU [必填]",
          "Retail Unit Price / 零售单价 [上线必填]",
          "Currency / 币种 [选填]",
          "Units per Sales Pack / 每销售包装数量 [选填]",
        ],
        ["601R1_001", 38, "CNY", 2],
      ],
    },
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].issues).toEqual([]);
  expect((await approve(rows))[0]).toMatchObject({ ok: true });
  expect(await items.findPayload("sku", "601R1_001")).toMatchObject({
    price: { amount: 38, currency: "CNY", unitsPerSalesPack: 2 },
  });
  expect(
    (
      await db
        .prepare(
          "SELECT * FROM catalog_item_assembly_state ORDER BY hose_series",
        )
        .all()
    ).results,
  ).toEqual(before.results);
  const changed = await importRows([
    {
      sheet: "01_胶管主数据",
      data: [
        ["Hose SKU / 胶管SKU [必填]", "Hose Dash / 胶管Dash [必填]"],
        ["601R1_001", "-06"],
      ],
    },
  ]);
  expect(changed[0].issues).toEqual([]);
  expect((await approve(changed))[0]).toMatchObject({ ok: true });
  const state = await db
    .prepare(
      "SELECT * FROM catalog_item_assembly_state WHERE hose_series='601R1'",
    )
    .first<{ invalidated_sequence: number; generated_sequence: number }>();
  expect(state!.invalidated_sequence).toBeGreaterThan(
    state!.generated_sequence,
  );
});
it("imports without changing customers, self approves original currency, preserves history and makes replay harmless", async () => {
  const before = await items.findPayload("sku", "601R1_001");
  const rows = await importRows([
    priceSheet(28, "CNY"),
    {
      sheet: "04_兼容与扣压",
      data: [
        ["hoseSeries", "fittingSeries"],
        ["601R1", "FJX"],
      ],
    },
  ]);
  expect(rows).toHaveLength(1);
  expect(await items.findPayload("sku", "601R1_001")).toEqual(before);
  expect(rows[0].issues).toEqual([]);
  expect((await approve(rows))[0]).toMatchObject({ ok: true });
  expect(await items.findPayload("sku", "601R1_001")).toMatchObject({
    price: { amount: 28, currency: "CNY" },
  });
  const newer = await importRows([priceSheet(30, "EUR")]);
  expect((await approve(newer))[0].ok).toBe(true);
  expect((await approve(rows))[0].ok).toBe(true);
  expect(await items.findPayload("sku", "601R1_001")).toMatchObject({
    price: { amount: 30, currency: "EUR" },
  });
  expect(
    (
      await db
        .prepare(
          "SELECT reference_price_usd FROM catalog_sales_offers WHERE import_id='active-import'",
        )
        .first()
    )?.reference_price_usd,
  ).toBe(3.25);
  expect(await review.relations(rows[0].batchId!)).toHaveLength(1);
});
it("keeps conflicts pending, corrections audited, stale reviews rejected and immutable originals retained", async () => {
  const rows = await importRows([
    {
      sheet: "07_价格包装",
      data: [
        ["productType", "baseSku", "referencePriceUsd", "currency"],
        ["Hose Variant", "601R1_001", 5, "CNY"],
      ],
    },
  ]);
  const row = rows[0];
  expect((await approve(rows))[0].ok).toBe(false);
  const payload = structuredClone(row.command.payload);
  if (payload.kind === "sku")
    payload.price = { amount: 5, currency: "USD", packageLengthFt: null };
  await review.correct({
    id: row.id,
    version: row.version,
    payload,
    targetState: "online",
    actorId: "owner-1",
    ipAddress: "local",
    reason: "原价格确为美元",
  });
  expect((await approve(rows))[0].ok).toBe(false);
  const corrected = await review.get(row.id);
  expect(corrected.original).toEqual(row.original);
  expect(corrected.version).toBe(2);
  expect((await approve([corrected]))[0].ok).toBe(true);
  await expect(
    review.correct({
      id: row.id,
      version: 2,
      payload,
      targetState: "online",
      actorId: "owner-1",
      ipAddress: "local",
      reason: "不可修改已审核请求",
    }),
  ).rejects.toThrow();
  expect(
    (
      await db
        .prepare(
          "SELECT count(*) AS count FROM admin_audit_events WHERE event_type='catalog_item.request_corrected' AND entity_id=?",
        )
        .bind(row.id)
        .first()
    )?.count,
  ).toBe(1);
});
it("batch approval is independent and request deletion never removes relation sources or live data", async () => {
  const bad = await importRows([
    {
      sheet: "01_胶管主数据",
      data: [
        ["sku", "dash"],
        ["601R1_001", null],
      ],
    },
  ]);
  const good = await importRows([priceSheet(7)]);
  const results = await approve([...bad, ...good]);
  expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
  expect((await review.get(bad[0].id)).status).toBe("pending");
  await review.review({
    selected: bad,
    intent: "delete",
    actorId: "owner-1",
    ipAddress: "local",
  });
  expect((await review.get(bad[0].id)).status).toBe("deleted");
  expect(await items.findPayload("sku", "601R1_001")).toMatchObject({
    price: { amount: 7 },
  });
  expect(await review.relations()).toHaveLength(1);
});
it("orders newly imported series before children and leaves unselected children pending", async () => {
  const parent = (await items.findPayload("series", "601R1"))!;
  const child = (await items.findPayload("sku", "601R1_001"))!;
  if (parent.kind !== "series" || child.kind !== "sku")
    throw new Error("fixture");
  const master = {
    ...parent.series,
    ...child.variant,
    hoseSeries: "NEW84",
    sku: "NEW84_001",
    seriesName: "New series",
    seriesMediaVersionId: "uploaded-v2",
  };
  const price = {
    ...parent.commercialRule,
    productType: "Hose Variant",
    baseSku: "NEW84_001",
    amount: 18,
    currency: "EUR",
  };
  const requests = await importRows([
    {
      sheet: "01_胶管主数据",
      data: [Object.keys(master), Object.values(master)],
    },
    { sheet: "07_价格包装", data: [Object.keys(price), Object.values(price)] },
  ]);
  expect(requests).toHaveLength(2);
  const childRequest = requests.find((r) => r.command.payload.kind === "sku")!;
  expect((await approve([childRequest]))[0].ok).toBe(false);
  const result = await approve(requests);
  expect(result, JSON.stringify(result)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "NEW84", ok: true }),
      expect.objectContaining({ code: "NEW84_001", ok: true }),
    ]),
  );
  expect(await items.findPayload("sku", "NEW84_001")).toMatchObject({
    price: { amount: 18, currency: "EUR" },
  });
});
it("later approval of an older snapshot wins, but stale correction versions cannot be approved", async () => {
  const old = await importRows([priceSheet(21, "EUR")]);
  const newer = await importRows([priceSheet(22, "CNY")]);
  expect((await approve(newer))[0].ok).toBe(true);
  expect((await approve(old))[0].ok).toBe(true);
  expect(await items.findPayload("sku", "601R1_001")).toMatchObject({
    price: { amount: 21, currency: "EUR" },
  });
  const pending = (await importRows([priceSheet(23)]))[0];
  await review.correct({
    id: pending.id,
    version: pending.version,
    payload: pending.command.payload,
    targetState: "draft",
    actorId: "owner-1",
    ipAddress: "local",
    reason: "先保留草稿",
  });
  await expect(
    items.approveRequest(pending.id, "owner-1", "local", pending.version),
  ).rejects.toThrow("修正");
  expect((await approve([await review.get(pending.id)]))[0].ok).toBe(true);
  expect(await items.findPayload("sku", "601R1_001")).toMatchObject({
    price: { amount: 21, currency: "EUR" },
  });
});
it("imports and approves the remaining four product types and blocks inapplicable packaging", async () => {
  const sheetNames = {
    hose_end: "02_压接接头",
    ferrule: "03_套筒",
    adapter: "05_过渡接头",
    quick_coupler: "06_快速接头",
  };
  const offerNames = {
    hose_end: "Hose End",
    ferrule: "Ferrule",
    adapter: "Adapter",
    quick_coupler: "Quick Coupler",
  };
  for (const f of componentImportFixtures) {
    const master = Object.fromEntries(
      Object.entries({
        ...f.variant,
        seriesName: f.series,
        seriesMediaVersionId: "uploaded-v2",
        ...(f.type === "hose_end"
          ? {
              angle: "0° Straight",
              gender: "Female",
              interfaceFamily: "JIC 37°",
              connectionStandard: "SAE J514",
              sealingForm: "37° flare",
              swivelForm: "Swivel",
            }
          : {}),
      }).filter(([, v]) => v !== null),
    );
    const price = {
      productType: offerNames[f.type],
      baseSku: f.code,
      amount: 15,
      currency: "CAD",
      salesUnit: "each",
      quantityInputMode: "Units",
      moq: 1,
      leadTimeDays: 10,
      countryOfOrigin: "China",
    };
    const rows = await importRows([
      {
        sheet: sheetNames[f.type],
        data: [Object.keys(master), Object.values(master)],
      },
      {
        sheet: "07_价格包装",
        data: [Object.keys(price), Object.values(price)],
      },
    ]);
    const result = await approve(rows);
    expect(
      result,
      JSON.stringify({
        type: f.type,
        result,
        issues: rows.map((r) => r.issues),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: f.code, ok: true }),
      ]),
    );
    expect(await items.findProductPayload(f.type, "sku", f.code)).toMatchObject(
      { price: { amount: 15, currency: "CAD" } },
    );
    const bad = await importRows([
      {
        sheet: "07_价格包装",
        data: [
          ["productType", "baseSku", "packageLengthFt"],
          [offerNames[f.type], f.code, 10],
        ],
      },
    ]);
    expect((await approve(bad))[0].ok).toBe(false);
  }
}, 30000);
it("rejects a correction arriving after approval reads the request but before its transaction", async () => {
  const row = (await importRows([priceSheet(42)]))[0];
  let corrected = false;
  const racing = new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (!corrected) {
            corrected = true;
            const payload = structuredClone(row.command.payload);
            if (payload.kind === "sku")
              payload.price = {
                amount: 43,
                currency: "USD",
                packageLengthFt: null,
              };
            await review.correct({
              id: row.id,
              version: row.version,
              payload,
              targetState: "online",
              actorId: "owner-1",
              ipAddress: "local",
              reason: "并发修正",
            });
          }
          return target.batch(statements);
        };
      const value = target[key as keyof D1Database];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createD1CatalogItemRepository(racing).approveRequest(
      row.id,
      "owner-1",
      "local",
      row.version,
    ),
  ).rejects.toThrow();
  expect(corrected).toBe(true);
  expect((await review.get(row.id)).status).toBe("pending");
  expect(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM catalog_product_revisions WHERE request_id=?",
        )
        .bind(row.id)
        .first()
    )?.n,
  ).toBe(0);
  expect((await approve([await review.get(row.id)]))[0].ok).toBe(true);
  expect(await items.findPayload("sku", "601R1_001")).toMatchObject({
    price: { amount: 43 },
  });
});
it("records the current correction and rejection IP rather than the importer IP", async () => {
  const row = (await importRows([priceSheet(90)]))[0];
  await review.correct({
    id: row.id,
    version: row.version,
    payload: row.command.payload,
    targetState: "online",
    actorId: "owner-1",
    ipAddress: "203.0.113.84",
    reason: "检查审计来源",
  });
  await review.review({
    selected: [await review.get(row.id)],
    intent: "reject",
    actorId: "owner-1",
    ipAddress: "203.0.113.85",
  });
  const events = (
    await db
      .prepare(
        "SELECT event_type,payload_json FROM admin_audit_events WHERE entity_id=? AND event_type IN ('catalog_item.request_corrected','catalog_item.request_rejected') ORDER BY occurred_at",
      )
      .bind(row.id)
      .all<{ event_type: string; payload_json: string }>()
  ).results;
  expect(events.map((e) => JSON.parse(e.payload_json).ipAddress)).toEqual([
    "203.0.113.84",
    "203.0.113.85",
  ]);
  for (const event of events)
    expect(JSON.parse(event.payload_json).requestId).toBeTruthy();
});
it("retains the actual draft revision as an import baseline", async () => {
  const payload = structuredClone(
    (await items.findPayload("sku", "601R1_001"))!,
  );
  if (payload.kind !== "sku") throw new Error("fixture");
  payload.variant.sku = "DRAFT84_001";
  const draft = await items.apply({
    payload,
    targetState: "draft",
    mode: "create",
    commandId: crypto.randomUUID(),
    actorId: "owner-1",
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  const rows = await importRows([
    {
      sheet: "07_价格包装",
      data: [
        ["baseSku", "amount"],
        ["DRAFT84_001", 19],
      ],
    },
  ]);
  expect(rows[0].command.baselineRevisionId).toBe(draft.revisionId);
  expect(rows[0].command.targetState).toBe("draft");
});
it("resolves a corrected child's dependency against an existing legacy online series", async () => {
  const baseline = (await items.findPayload("sku", "601R1_001"))!;
  if (baseline.kind !== "sku") throw new Error("fixture");
  const values = {
    ...baseline.variant,
    sku: "REASSIGN84_001",
    hoseSeries: "UNREADY84",
  };
  const rows = await importRows([
    {
      sheet: "01_胶管主数据",
      data: [Object.keys(values), Object.values(values)],
    },
  ]);
  const child = rows.find((r) => r.command.payload.kind === "sku")!;
  expect(child.dependencies).toHaveLength(1);
  const payload = {
    ...baseline,
    variant: { ...baseline.variant, sku: "REASSIGN84_001" },
  };
  await review.correct({
    id: child.id,
    version: child.version,
    payload,
    targetState: "online",
    actorId: "owner-1",
    ipAddress: "local",
    reason: "改为已有上线系列",
  });
  const result = await approve([await review.get(child.id)]);
  expect(result, JSON.stringify(result)).toMatchObject([{ ok: true }]);
});

it("reviews explicit create, partial update and deletion while preserving history and rechecking duplicate creates", async () => {
  const original = (await items.findPayload("sku", "601R1_001"))!;
  if (original.kind !== "sku") throw new Error("fixture");
  const values = {
    ...original.variant,
    sku: "OPERATIONS_001",
    updateDelete: "Update",
    amount: 31,
    currency: "EUR",
  };
  const sheet: CatalogWorkbookSheet = {
    sheet: "01_胶管主数据",
    data: [Object.keys(values), Object.values(values)],
  };
  const first = await importRows([sheet]);
  const second = await importRows([sheet]);
  expect(first).toHaveLength(1);
  expect((await approve(first))[0]).toMatchObject({ ok: true });
  expect((await approve(second))[0]).toMatchObject({ ok: false });
  const partial = await importRows([
    {
      sheet: sheet.sheet,
      data: [
        ["Update Delete", "sku", "amount", "notes"],
        ["PartialUpdate", "OPERATIONS_001", 0, null],
      ],
    },
  ]);
  expect(partial[0].issues).toEqual([]);
  expect((await approve(partial))[0]).toMatchObject({ ok: true });
  expect(await items.findPayload("sku", "OPERATIONS_001")).toMatchObject({
    price: { amount: 0, currency: "EUR" },
    variant: { notes: original.variant.notes },
  });
  const history = await db
    .prepare(
      "SELECT id,payload_json FROM catalog_product_revisions WHERE entity_id=(SELECT id FROM catalog_product_entities WHERE code='OPERATIONS_001') ORDER BY sequence",
    )
    .all();
  const deletion = await importRows([
    {
      sheet: sheet.sheet,
      data: [
        ["Update Delete", "sku"],
        ["Delete", "OPERATIONS_001"],
      ],
    },
  ]);
  expect(deletion[0].issues).toEqual([]);
  expect((await approve(deletion))[0]).toMatchObject({ ok: true });
  expect((await review.get(deletion[0].id)).status).toBe("approved");
  expect((await approve(deletion))[0]).toMatchObject({ ok: true });
  expect(
    await db
      .prepare(
        "SELECT hidden_at FROM catalog_product_entities WHERE code='OPERATIONS_001'",
      )
      .first(),
  ).toMatchObject({ hidden_at: expect.any(String) });
  const after = await db
    .prepare(
      "SELECT id,payload_json FROM catalog_product_revisions WHERE entity_id=(SELECT id FROM catalog_product_entities WHERE code='OPERATIONS_001') ORDER BY sequence",
    )
    .all();
  expect(after.results.slice(0, history.results.length)).toEqual(
    history.results,
  );
});

it("publishes an imported hose with optional notes, source and technical status left blank", async () => {
  const original = (await items.findPayload("sku", "601R1_001"))!;
  if (original.kind !== "sku") throw new Error("fixture");
  const values = {
    ...original.variant,
    sku: "OPTIONAL_FIELDS_001",
    updateDelete: "Update",
    notes: null,
    source: null,
    technicalDataStatus: null,
    amount: 19,
    currency: "USD",
  };
  const rows = await importRows([
    {
      sheet: "01_胶管主数据",
      data: [Object.keys(values), Object.values(values)],
    },
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].issues).toEqual([]);
  expect((await approve(rows))[0]).toMatchObject({ ok: true });
  expect(await items.findPayload("sku", "OPTIONAL_FIELDS_001")).toMatchObject({
    variant: { notes: "", source: null },
  });
});
