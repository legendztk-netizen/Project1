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
});
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
