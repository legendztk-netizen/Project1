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

it("rejects series deletion when a child publishes after impact planning", async () => {
  const original = await repository.findProductPayload(
    "ferrule",
    "series",
    "601R1",
  );
  if (!original || original.kind !== "series")
    throw new Error("missing parent");
  const parent = {
    ...original,
    series: { ...original.series, seriesCode: "RACE", seriesName: "RACE" },
    commercialRule: { ...original.commercialRule!, seriesCode: "RACE" },
  } as CatalogItemCommand["payload"];
  await repository.apply(command(parent));
  const child = await repository.findProductPayload(
    "ferrule",
    "sku",
    "601R1_1WB_TEST",
  );
  if (!child || child.kind !== "sku" || child.productType !== "ferrule")
    throw new Error("missing child");
  const proposed = {
    ...child,
    variant: { ...child.variant, sku: "RACE_1WB_TEST", ferruleSeries: "RACE" },
  };
  await repository.apply(command(proposed, "draft"));
  let injected = false;
  const wrapped = {
    prepare: database.prepare.bind(database),
    async batch(statements: D1PreparedStatement[]) {
      const result = await database.batch(statements);
      if (!injected && statements.length === 3) {
        injected = true;
        await repository.apply(command(proposed, "online", "edit"));
      }
      return result;
    },
  } as D1Database;
  await expect(
    createD1ProductManagementRepository(wrapped).remove(
      [{ kind: "series", productType: "ferrule", code: "RACE" }],
      "race-child",
      "owner-1",
      "local",
    ),
  ).rejects.toThrow("catalog changed during deletion");
  expect((await catalog.findItem("RACE_1WB_TEST"))?.canAddToQuote).toBe(true);
  expect(
    (await createD1ProductManagementRepository(database).all()).some(
      (p) => p.kind === "series" && p.code === "RACE",
    ),
  ).toBe(true);
});
it("rejects deletion if a pending target request arrives after the plan", async () => {
  const original = await repository.findProductPayload(
    "ferrule",
    "series",
    "601R1",
  );
  if (!original || original.kind !== "series")
    throw new Error("missing parent");
  const parent = {
    ...original,
    series: {
      ...original.series,
      seriesCode: "REQUEST-RACE",
      seriesName: "Request race",
    },
    commercialRule: { ...original.commercialRule!, seriesCode: "REQUEST-RACE" },
  } as CatalogItemCommand["payload"];
  await repository.apply(command(parent));
  let pendingId = "";
  const wrapped = {
    prepare: database.prepare.bind(database),
    async batch(statements: D1PreparedStatement[]) {
      if (statements.length > 3 && !pendingId)
        pendingId = await repository.createRequest(
          command(parent, "online", "edit"),
          { row: "race" },
        );
      return database.batch(statements);
    },
  } as D1Database;
  await expect(
    createD1ProductManagementRepository(wrapped).remove(
      [{ kind: "series", productType: "ferrule", code: "REQUEST-RACE" }],
      "race-request",
      "owner-1",
      "local",
    ),
  ).rejects.toThrow("pending requests changed during deletion");
  expect(
    await database
      .prepare("SELECT status FROM catalog_product_change_requests WHERE id=?")
      .bind(pendingId)
      .first(),
  ).toEqual({ status: "pending" });
});

it("rejects read-only product commands before touching D1", async () => {
  const { RouterContextProvider } = await import("react-router");
  const { cloudflareContext } = await import("../workers/context");
  const { action } =
    await import("../app/modules/admin/routes/catalog-products");
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { DB: database, APP_ENV: "local" } as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
    adminIdentity: {
      accountType: "subaccount",
      catalogPermission: "view",
      canManageSubaccounts: false,
      email: "viewer@example.com",
      id: "viewer",
      source: "cloudflare-access",
    },
  });
  await expect(
    action({
      context,
      request: new Request("http://admin.localhost/admin/catalog/products", {
        method: "POST",
      }),
      params: {},
      url: new URL("http://admin.localhost/admin/catalog/products"),
      pattern: "/admin/catalog/products",
    } as Parameters<typeof action>[0]),
  ).rejects.toMatchObject({ status: 403 });
});

it("deletes pending new-child requests with their series and prevents reuse of hidden parents", async () => {
  const original = await repository.findProductPayload(
    "ferrule",
    "series",
    "601R1",
  );
  const child = await repository.findProductPayload(
    "ferrule",
    "sku",
    "601R1_1WB_TEST",
  );
  if (
    !original ||
    original.kind !== "series" ||
    !child ||
    child.kind !== "sku" ||
    child.productType !== "ferrule"
  )
    throw new Error("missing fixtures");
  const parent = {
    ...original,
    series: {
      ...original.series,
      seriesCode: "PENDING",
      seriesName: "PENDING",
    },
    commercialRule: { ...original.commercialRule!, seriesCode: "PENDING" },
  } as CatalogItemCommand["payload"];
  await repository.apply(command(parent));
  const proposed = {
    ...child,
    variant: {
      ...child.variant,
      sku: "PENDING_1WB_TEST",
      ferruleSeries: "PENDING",
    },
  };
  const pending = await repository.createRequest(command(proposed), {
    row: "new child",
  });
  const manager = createD1ProductManagementRepository(database);
  const selected = [
    {
      kind: "series" as const,
      productType: "ferrule" as const,
      code: "PENDING",
    },
  ];
  expect((await manager.deletionPlan(selected)).requestIds).toContain(pending);
  await manager.remove(selected, "delete-pending-parent", "owner-1", "local");
  expect(
    await database
      .prepare("SELECT status FROM catalog_product_change_requests WHERE id=?")
      .bind(pending)
      .first(),
  ).toEqual({ status: "deleted" });
  await expect(repository.apply(command(proposed))).rejects.toThrow(
    "Parent series was deleted",
  );
  await expect(
    repository.createRequest(command(proposed), { row: "late child" }),
  ).rejects.toThrow("parent series was deleted");
});

it("preserves legacy mixed-case series identities while editing and attaching a child", async () => {
  const parent = await repository.findProductPayload(
    "hose_end",
    "series",
    "FJX",
  );
  const child = await repository.findProductPayload(
    "hose_end",
    "sku",
    "FJX-04-04",
  );
  if (
    !parent ||
    parent.kind !== "series" ||
    parent.productType !== "hose_end" ||
    !child ||
    child.kind !== "sku" ||
    child.productType !== "hose_end"
  )
    throw new Error("missing legacy fixtures");
  const legacyCode = "Legacy FJX family";
  const legacy = {
    ...parent,
    series: { ...parent.series, seriesCode: legacyCode },
    commercialRule: { ...parent.commercialRule!, seriesCode: legacyCode },
  };
  const generation = (await repository.state()).generation;
  await database.batch([
    database
      .prepare(
        "INSERT INTO catalog_product_entities(id,kind,product_type,code) VALUES('legacy-end-family','series','hose_end',?)",
      )
      .bind(legacyCode),
    database
      .prepare(
        "INSERT INTO catalog_product_revisions(id,entity_id,target_state,payload_json,media_version_id,source_json,affected_series_json,command_id,command_hash,expected_generation,actor_id,ip_address,occurred_at) VALUES('legacy-family-revision','legacy-end-family','online',?,?,'{\"channel\":\"migration\"}','[]','legacy-family-command','fixture',?,'owner-1','local','2026-09-01')",
      )
      .bind(JSON.stringify(legacy), legacy.mediaVersionId, generation),
  ]);
  await repository.apply(command(legacy, "online", "edit"));
  await repository.apply(
    command({
      ...child,
      variant: {
        ...child.variant,
        sku: "LJF-04-04",
        fittingSeries: legacyCode,
      },
    }),
  );
  expect(
    await repository.findProductPayload("hose_end", "sku", "LJF-04-04"),
  ).toMatchObject({ variant: { fittingSeries: legacyCode } });
  expect((await catalog.findItem("LJF-04-04"))?.canAddToQuote).toBe(true);
});
