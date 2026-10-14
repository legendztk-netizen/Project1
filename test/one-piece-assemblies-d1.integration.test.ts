import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1ItemImportReview } from "../app/modules/catalog/infrastructure/d1-item-import-review";
import { createD1ManagedAssemblies } from "../app/modules/catalog/infrastructure/d1-managed-assemblies";
import { createD1ConfiguratorRepository } from "../app/modules/configurator/infrastructure/d1-configurator-repository";
import type { ApplicationBindings } from "#workers/environment";
import { customerIdentitySigningKey } from "#workers/session-secrets";
import { createD1CustomerIdentityRepository } from "../app/modules/customer-identity/infrastructure/d1-customer-identity-repository";
import {
  createCustomerSessionCookie,
  digestCustomerSessionToken,
  generateCustomerSessionToken,
} from "../app/modules/customer-identity/domain/customer-session";
import { createCustomerAccountService } from "../app/modules/customer-identity/application/customer-account-service";
import { createAnonymousQuoteListService } from "../app/modules/quote-list/application/anonymous-quote-list-service";
import { createQuoteRequestService } from "../app/modules/quote-request/application/quote-request-service";
import { createD1PublicCatalogRepository } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import { createD1ConfiguratorReferenceRepository } from "../app/modules/configurator-reference/infrastructure/d1-configurator-reference-repository";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../app/modules/configurator/domain/compatible-end-a";
import {
  evaluateFinishedAssemblyLength,
  selectMeasurementNotSure,
} from "../app/modules/configurator/domain/finished-assembly-length";
import { calculateAssemblyLengthReferencePricing } from "../app/modules/configurator/domain/protection-and-application";

const root = join(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "one-piece-assembly-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const actor = { id: "owner-1", catalogPermission: "edit" as const };
const command = () => ({ id: crypto.randomUUID(), ipAddress: "203.0.113.1" });
const hose = "601R1_001";

async function importOnePieceEnd(sku: string, line: string, series: string) {
  // Technical data columns are left out: they are optional for one-piece ends.
  const master = {
    updateDelete: "Update",
    sku,
    fittingSeries: series,
    fittingLine: line,
    connectionDash: "-4",
    hoseTailDash: "-4",
    thread: "7/16-20 UNF",
    seriesName: series,
    seriesMediaVersionId: "uploaded-v2",
    interfaceFamily: "JIC 37°",
    connectionStandard: "SAE J514",
    gender: "Female",
    swivelForm: "Swivel",
    angle: "0° Straight",
    sealingForm: "37° flare",
    amount: 4.34,
    currency: "USD",
  };
  const price = {
    productType: "Hose End",
    baseSku: sku,
    amount: 4.34,
    currency: "USD",
    salesUnit: "each",
    quantityInputMode: "Units",
    moq: 1,
    leadTimeDays: 10,
    countryOfOrigin: "China",
  };
  const review = createD1ItemImportReview(db, actor);
  const batchId = crypto.randomUUID();
  await review.importWorkbook({
    batchId,
    fileName: "one-piece.xlsx",
    fileSize: 100,
    actorId: actor.id,
    ipAddress: "local",
    sheets: [
      {
        sheet: "02_压接接头",
        data: [Object.keys(master), Object.values(master)],
      },
      {
        sheet: "07_价格包装",
        data: [Object.keys(price), Object.values(price)],
      },
    ],
  });
  const rows = (await review.all()).filter((r) => r.batchId === batchId);
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

async function editHose(values: Record<string, unknown>) {
  const items = createD1CatalogItemRepository(db);
  const payload = (await items.findPayload("sku", hose))!;
  if (payload.kind !== "sku") throw Error("fixture");
  Object.assign(payload.variant, values);
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
  await importOnePieceEnd("B_JIC_F_SW_04_04", "B", "B_JIC_F_SW");
  await importOnePieceEnd("W_JIC_F_SW_04_04", "W", "W_JIC_F_SW");
}, 120000);

afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("pairs one-piece Hose Ends by accepted Fitting Line without a ferrule", async () => {
  const assemblies = createD1ManagedAssemblies(db, actor);
  const config = createD1ConfiguratorRepository(db);
  await editHose({ acceptedFittingLines: "b", crimpDiameterBMm: 15 });
  expect(await assemblies.pending()).toEqual(["601R1"]);
  await assemblies.update(command());

  const combinations = await assemblies.all();
  const identity = JSON.stringify([
    hose,
    "B_JIC_F_SW_04_04",
    null,
    "B_JIC_F_SW_04_04",
    null,
  ]);
  expect(combinations.map((c) => c.identity)).toContain(identity);
  // A one-piece end may sit opposite a legacy insert on the same hose.
  expect(combinations.map((c) => c.identity)).toContain(
    JSON.stringify([
      hose,
      "B_JIC_F_SW_04_04",
      null,
      "FJX-04-04",
      "601R1_1WB_TEST",
    ]),
  );
  // The legacy insert still pairs with its ferrule, and never with a one-piece end.
  expect(
    combinations.some(
      (c) =>
        c.endAHoseEndSku === "FJX-04-04" &&
        c.endAFerruleSku === "601R1_1WB_TEST",
    ),
  ).toBe(true);
  expect(
    combinations.some((c) =>
      [c.endAHoseEndSku, c.endBHoseEndSku].includes("W_JIC_F_SW_04_04"),
    ),
  ).toBe(false);

  const endpoint = await db
    .prepare(
      "SELECT * FROM catalog_runtime_compatibilities WHERE hose_end_sku='B_JIC_F_SW_04_04'",
    )
    .first<Record<string, unknown>>();
  expect(endpoint).toMatchObject({
    compatibility_id: `AUTO:${hose}:B_JIC_F_SW_04_04`,
    ferrule_sku: null,
    reference_crimp_diameter_mm: 15,
    production_approval_status: "not_approved",
  });

  const candidates = await config.findCompatibleEndA("active-release", hose);
  const candidate = candidates.find((c) => c.hoseEndSku === "B_JIC_F_SW_04_04");
  expect(candidate).toMatchObject({ ferrule: null });
  const point = {
    releaseId: "active-release",
    hoseSku: hose,
    endACompatibilityId: candidate!.compatibilityId,
    endBCompatibilityId: candidate!.compatibilityId,
  };
  expect(await config.hasDerivedAssemblyCombination(point)).toBe(true);
  expect(
    await config.hasDerivedAssemblyCombination({
      ...point,
      identity,
    }),
  ).toBe(true);
  expect(
    await config.findSelectedEnds(
      "active-release",
      hose,
      "B_JIC_F_SW_04_04",
      "B_JIC_F_SW_04_04",
    ),
  ).toEqual([expect.objectContaining({ ferrule: null })]);
});

it("regenerates when a hose accepts another Fitting Line or an end changes line", async () => {
  const assemblies = createD1ManagedAssemblies(db, actor);
  await editHose({ acceptedFittingLines: "B, W" });
  expect(await assemblies.pending()).toEqual(["601R1"]);
  await assemblies.update(command());
  const ends = new Set(
    (await assemblies.all())
      .filter((c) => c.endAFerruleSku === null)
      .map((c) => c.endAHoseEndSku),
  );
  expect(ends).toEqual(new Set(["B_JIC_F_SW_04_04", "W_JIC_F_SW_04_04"]));

  const items = createD1CatalogItemRepository(db);
  const end = (await items.findProductPayload(
    "hose_end",
    "sku",
    "W_JIC_F_SW_04_04",
  ))!;
  if (end.kind !== "sku" || end.productType !== "hose_end") throw Error();
  end.variant.fittingLine = "JJ";
  await items.apply({
    payload: end,
    targetState: "online",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: actor.id,
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  expect(await assemblies.pending()).toEqual(["601R1"]);
  await assemblies.update(command());
  expect(
    (await assemblies.all()).some(
      (c) => c.endAHoseEndSku === "W_JIC_F_SW_04_04",
    ),
  ).toBe(false);
});

it("rejects an unknown accepted Fitting Line", async () => {
  await expect(editHose({ acceptedFittingLines: "B,X" })).rejects.toMatchObject(
    { findings: [expect.objectContaining({ code: "invalid_fitting_lines" })] },
  );
});

it("quotes and submits a one-piece assembly with no ferrule component", async () => {
  const now = new Date();
  const env = { APP_ENV: "local", DB: db } as ApplicationBindings;
  const refs = createD1ConfiguratorReferenceRepository(db);
  for (const entry of [
    {
      registryType: "installed_protection" as const,
      entryKey: "NONE",
      payload: {
        availability: "available",
        code: "NONE",
        currency: "USD",
        isNoAdditionalProtection: true,
        publicName: "No additional installed protection",
        referenceBasePriceUsd: 0,
        referenceInstallationPricePerStartedFootUsd: 0,
        referenceMaterialPricePerFootUsd: 0,
        referencePriceUsd: 0,
        specification: "None",
      },
    },
    {
      registryType: "assembly_estimate_schedule" as const,
      entryKey: "DEFAULT",
      payload: {
        currency: "USD",
        assemblyServicePricePerStartedFootUsd: 0.5,
        assemblyServicePriceUsd: null,
        ferrulePriceSource: "catalog_sales_offer",
        hoseEndPriceSource: "catalog_sales_offer",
        hosePriceSource: "catalog_sales_offer_per_ft",
        protectionPriceSource: "installed_protection_registry",
      },
    },
  ]) {
    const previous = await db
      .prepare(
        "SELECT record_version FROM configurator_global_registry_entries WHERE registry_type=? AND entry_key=?",
      )
      .bind(entry.registryType, entry.entryKey)
      .first<{ record_version: number }>();
    await refs.saveGlobalEntry({
      ...entry,
      expectedRecordVersion: previous?.record_version ?? 0,
      actorId: actor.id,
      auditEventId: crypto.randomUUID(),
      requestCorrelationId: crypto.randomUUID(),
      ipAddress: "local",
      updatedAt: now.toISOString(),
    });
  }
  const product = (await createD1PublicCatalogRepository(db).findItem(hose))!;
  const end = (
    await createD1ConfiguratorRepository(db).findCompatibleEndA(
      product.releaseId,
      hose,
    )
  ).find((c) => c.hoseEndSku === "B_JIC_F_SW_04_04")!;
  const draft = attachEndBToDraft(
    attachEndAToDraft(createHoseConfigurationDraft(product)!, end),
    end,
  );
  draft.measurementSelection = selectMeasurementNotSure();
  const references = (await refs.findActiveSnapshot())!;
  draft.installedProtection = references.installedProtections.find(
    (p) => p.code === "NONE",
  );
  const length = evaluateFinishedAssemblyLength({
    hasBothEnds: true,
    requestedTighterTolerance: false,
    unit: "in",
    value: "30",
  });
  if (!length.valid) throw Error(length.error);
  draft.finishedLength = length.length;
  draft.lengthReferencePricing = calculateAssemblyLengthReferencePricing({
    canonicalLengthMm: length.length.canonicalMm,
    protection: draft.installedProtection!,
    schedule: references.assemblyEstimateSchedule,
  });

  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  const token = generateCustomerSessionToken();
  await db
    .prepare(
      "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      id,
      email,
      email,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  await createD1CustomerIdentityRepository(db).createSessionForProfile({
    profileId: id,
    sessionId: crypto.randomUUID(),
    tokenDigest: await digestCustomerSessionToken(
      token,
      customerIdentitySigningKey(env),
    ),
    previousTokenDigest: null,
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86400000).toISOString(),
  });
  const request = new Request("http://localhost/quote-list", {
    headers: {
      cookie: createCustomerSessionCookie({ now, secure: false, token }).split(
        ";",
      )[0],
    },
  });
  await createCustomerAccountService(env).createAddress({
    request,
    addressLine1: "1 Test Street",
    addressLine2: "",
    city: "Portland",
    countryCode: "US",
    label: "Test",
    postalCode: "97201",
    recipientEmail: email,
    recipientName: "Test Buyer",
    recipientPhone: "5550100",
    stateProvince: "OR",
  });
  const lists = createAnonymousQuoteListService(env);
  // Quantity keeps the subtotal above the USD 100 RFQ minimum.
  await lists.addConfiguredAssembly(request, draft, 20);
  const [line] = (await lists.read(request)).lines;
  const record = await createQuoteRequestService(env).submitIndividual({
    request,
    accuracyConfirmed: true,
    commercialReviewConfirmed: true,
    idempotencyKey: crypto.randomUUID(),
    selectedLineIds: [line.id],
  });
  const [submitted] = record.snapshot.lines;
  expect(submitted.refresh?.status).toBe("ready");
  if (submitted.lineKind !== "configured_assembly") throw Error("kind");
  expect(
    submitted.configuredAssembly.snapshot.configuration.endA?.ferrule,
  ).toBe(null);
  expect(submitted.configuredAssembly.estimateBasis).toMatchObject({
    ferruleAPriceUsd: 0,
    ferruleBPriceUsd: 0,
    hoseEndAPriceUsd: 4.34,
  });
}, 60000);
