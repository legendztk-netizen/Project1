import { seedCatalogItemBaseline } from "./fixtures/catalog-item-baseline";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createD1ProductManagementRepository } from "../app/modules/catalog/infrastructure/d1-product-management-repository";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1PublicCatalogRepository } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import { captureQuoteRequestProductSnapshot } from "../app/modules/quote-request/domain/quote-request";
import type { CatalogItemCommand } from "../app/modules/catalog/domain/catalog-item-publication";

const root = join(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "catalog-items-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let database: D1Database;
let repository: ReturnType<typeof createD1CatalogItemRepository>;
let catalog: ReturnType<typeof createD1PublicCatalogRepository>;
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
  database = platform.env.DB;
  await seedCatalogItemBaseline(database);

  repository = createD1CatalogItemRepository(
    database,
    () => new Date("2026-09-08T00:00:00Z"),
  );
  catalog = createD1PublicCatalogRepository(database);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { force: true, recursive: true });
});

const image = "uploaded-v2";
const command = (
  payload: CatalogItemCommand["payload"],
  targetState: CatalogItemCommand["targetState"] = "online",
  mode: "create" | "edit" = "create",
): CatalogItemCommand => ({
  payload,
  targetState,
  mode,
  commandId: crypto.randomUUID(),
  actorId: "owner-1",
  ipAddress: "local",
  baselineRevisionId: null,
  source: { channel: "manual" },
});
const fixtures = [
  {
    type: "hose_end",
    code: "FJX-04-04",
    series: "FJX",
    variant: {
      coating: "Zinc nickel",
      competitorPartNumber: null,
      connectionDash: "-04",
      cutoffBMm: 18,
      dimensionAMm: 45,
      drawingNumber: null,
      drawingRevision: null,
      fittingSeries: "FJX",
      hex1Mm: 14,
      hex2Mm: 17,
      hoseTailDash: "-04",
      material: "Carbon steel",
      maxWorkingBar: 350,
      minimumBoreMm: 5,
      notes: "Launch size",
      saltSprayHours: 720,
      sku: "FJX-04-04",
      source: null,
      technicalDataStatus: "Complete",
      thread: "7/16-20 UNF",
      unitWeightG: 82,
    },
  },
  {
    type: "ferrule",
    code: "601R1_1WB_TEST",
    series: "601R1",
    variant: {
      sku: "601R1_1WB_TEST",
      ferruleSeries: "601R1",
      hoseTailDash: "-4",
      hoseConstruction: "1-wire braid",
      skiveRequirement: "Other",
      coating: "Zinc plating",
      material: "Carbon steel",
      source: "Manual test",
      technicalDataStatus: "Complete",
    },
  },
  {
    type: "adapter",
    code: "ADP_ST_JIC_M_10_NPT_M_04",
    series: "ADP-ST-JIC-NPT",
    variant: {
      sku: "ADP_ST_JIC_M_10_NPT_M_04",
      adapterFamilyId: "ADP-ST-JIC-NPT",
      catalogModel: "2404",
      connectionForm1: "M",
      connectionForm2: "M",
      interface1: "JIC",
      interface2: "NPT",
      shapeCode: "ST",
      size1: "-10",
      size2: "-4",
      skuTemplate: "ADP_ST_JIC_M_{SIZE1}_NPT_M_{SIZE2}",
      source: "Manual test",
      technicalDataStatus: "Complete",
      websiteDisplay: "Straight JIC to NPT adapter",
      websiteProductName: "Straight JIC to NPT Adapter",
    },
  },
  {
    type: "quick_coupler",
    code: "QDC_16028_SOC_04_FNPT_04",
    series: "FEM",
    variant: {
      sku: "QDC_16028_SOC_04_FNPT_04",
      bodyMaterial: "Carbon steel",
      bodySize: "1/4 in",
      connectionMechanism: "Push-to-connect",
      couplerSeries: "FEM",
      interchangeStandard: "ISO 16028",
      matingSeries: "FEM",
      maxWorkingBar: 350,
      portGender: "Female",
      portInterface: "NPTF",
      portThread: "1/4-18 NPTF",
      role: "Coupler/Socket",
      source: "Manual test",
      technicalDataStatus: "Complete",
      valving: "Flat face",
    },
  },
] as const;
it("publishes each additional product type and retains original currencies and history", async () => {
  await repository.enable({ environment: "local", actorId: "owner-1" });
  for (const fixture of fixtures) {
    const series = {
      seriesCode: fixture.series,
      seriesName: fixture.series,
      ...(fixture.type === "hose_end"
        ? {
            angle: "0° Straight",
            gender: "Female",
            interfaceFamily: "JIC 37°",
            interfaceStandard: "SAE J514",
            representativeImageReference: "",
            sealingForm: "37° flare",
            swivelForm: "Swivel",
          }
        : {}),
    };
    const commercialRule = {
      productType: fixture.type,
      seriesCode: fixture.series,
      salesUnit: "each",
      quantityInputMode: "Quantity",
      moq: 1,
      leadTimeDays: 10,
      countryOfOrigin: "China",
      hsCode: null,
      minimumLengthPerPieceFt: null,
      lengthIncrementFt: null,
      presetLength1Ft: null,
      presetLength2Ft: null,
      presetLength3Ft: null,
      continuousLengthConfirmation: null,
      notes: null,
    };
    await repository.apply(
      command({
        kind: "series",
        productType: fixture.type,
        series,
        commercialRule,
        mediaVersionId: image,
      } as CatalogItemCommand["payload"]),
    );
    const payload = {
      kind: "sku",
      productType: fixture.type,
      variant: fixture.variant,
      price: { amount: 12.5, currency: "EUR", packageLengthFt: null },
      mediaVersionId: image,
    } as CatalogItemCommand["payload"];
    await repository.apply(command(payload));
    const product = await catalog.findItem(fixture.code);
    expect(product, fixture.type).toMatchObject({
      productType: fixture.type,
      canAddToQuote: true,
      offer: { referencePrice: 12.5, currency: "EUR" },
    });
    const snapshot = captureQuoteRequestProductSnapshot(product!);
    const saved = await repository.findProductPayload(
      fixture.type,
      "sku",
      fixture.code,
    );
    expect(saved?.kind).toBe("sku");
    if (!saved || saved.kind !== "sku") throw new Error("missing SKU");
    saved.price = {
      ...saved.price,
      amount: 100,
      currency: "CNY",
      packageLengthFt: null,
    };
    await repository.apply(command(saved, "online", "edit"));
    expect((await catalog.findItem(fixture.code))?.offer).toMatchObject({
      referencePrice: 100,
      currency: "CNY",
    });
    expect(snapshot.offer).toMatchObject({
      referencePrice: 12.5,
      currency: "EUR",
    });
  }
  const manager = createD1ProductManagementRepository(database);
  const list = await manager.list({
    types: [],
    query: "",
    page: 1,
    pageSize: 20,
  });
  expect(list.items.flatMap((g) => g.children).map((p) => p.code)).toEqual(
    expect.arrayContaining(fixtures.map((f) => f.code)),
  );
});
it("blocks a live series deletion and returns per-SKU partial results with retained history", async () => {
  const manager = createD1ProductManagementRepository(database);
  expect(
    (
      await manager.deletionPlan([
        { kind: "series", productType: "hose_end", code: "FJX" },
      ])
    ).blockers,
  ).toBe(1);
  const result = await manager.remove(
    [
      { kind: "sku", productType: "hose_end", code: "FJX-04-04" },
      { kind: "sku", productType: "adapter", code: "MISSING" },
    ],
    "delete-batch",
    "owner-1",
    "local",
  );
  expect(result).toMatchObject({
    results: [
      { code: "FJX-04-04", ok: true },
      { code: "MISSING", ok: false },
    ],
  });
  expect((await manager.all()).some((p) => p.code === "FJX-04-04")).toBe(false);
  expect(
    (await repository.history("sku", "FJX-04-04", "hose_end")).length,
  ).toBe(3);
  await manager.remove(
    [{ kind: "series", productType: "hose_end", code: "FJX" }],
    "delete-series",
    "owner-1",
    "local",
  );
  expect(
    (await manager.all()).some((p) => p.kind === "series" && p.code === "FJX"),
  ).toBe(false);
});
