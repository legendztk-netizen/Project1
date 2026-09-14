import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1ManagedAssemblies } from "../app/modules/catalog/infrastructure/d1-managed-assemblies";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1PublicCatalogRepository } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import { createD1ConfiguratorRepository } from "../app/modules/configurator/infrastructure/d1-configurator-repository";
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
import {
  reviseQuoteLine,
  type ReviewedQuoteLine,
  type QuoteLineEdit,
} from "../app/modules/quote-review/domain/quote-line-revision";
import {
  assemblyAmendmentFields,
  prepareQuoteAssemblyAmendment,
} from "../app/modules/quote-review/infrastructure/prepare-quote-assembly-amendment";
import { prepareConfiguredAssembly } from "../app/modules/quote-list/application/prepare-configured-assembly";
import { captureQuoteRequestProductSnapshot } from "../app/modules/quote-request/domain/quote-request";

const directory = mkdtempSync(join(tmpdir(), "quote-assembly-amend-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
let line: ReviewedQuoteLine;
beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "wrangler.jsonc",
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  await seedManagedAssemblyBaseline(db);
  await createD1ManagedAssemblies(db, {
    id: "owner-1",
    catalogPermission: "edit",
  }).update({ id: crypto.randomUUID(), ipAddress: "local" });
  const refs = createD1ConfiguratorReferenceRepository(db);
  const protection = {
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
  };
  for (const [key, payload] of [
    ["NONE", protection],
    [
      "NYLON",
      {
        ...protection,
        code: "NYLON",
        isNoAdditionalProtection: false,
        publicName: "Nylon Protective Sleeving",
        referenceBasePriceUsd: 8,
        referenceMaterialPricePerFootUsd: 1.35,
        referenceInstallationPricePerStartedFootUsd: 1,
      },
    ],
  ] as const) {
    const previous = (
      await refs.findActiveSnapshot()
    )?.installedProtections.find((p) => p.code === key);
    await refs.saveGlobalEntry({
      registryType: "installed_protection",
      entryKey: key,
      payload,
      expectedRecordVersion: previous?.recordVersion ?? 0,
      actorId: "owner-1",
      auditEventId: crypto.randomUUID(),
      requestCorrelationId: crypto.randomUUID(),
      ipAddress: "local",
      updatedAt: new Date().toISOString(),
    });
  }
  const scheduleVersion =
    (
      await db
        .prepare(
          "SELECT record_version FROM configurator_global_registry_entries WHERE registry_type='assembly_estimate_schedule' AND entry_key='DEFAULT'",
        )
        .first<{ record_version: number }>()
    )?.record_version ?? 0;
  await refs.saveGlobalEntry({
    registryType: "assembly_estimate_schedule",
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
    expectedRecordVersion: scheduleVersion,
    actorId: "owner-1",
    auditEventId: crypto.randomUUID(),
    requestCorrelationId: crypto.randomUUID(),
    ipAddress: "local",
    updatedAt: new Date().toISOString(),
  });
  const hose =
    (await createD1PublicCatalogRepository(db).findItem("601R1_001"))!;
  const [end] = await createD1ConfiguratorRepository(db).findCompatibleEndA(
    hose.releaseId,
    hose.sku,
  );
  const draft = attachEndBToDraft(
    attachEndAToDraft(createHoseConfigurationDraft(hose)!, end),
    end,
  );
  const length = evaluateFinishedAssemblyLength({
    hasBothEnds: true,
    requestedTighterTolerance: false,
    unit: "in",
    value: "30",
  });
  if (!length.valid) throw Error(length.error);
  draft.finishedLength = length.length;
  draft.measurementSelection = selectMeasurementNotSure();
  draft.installedProtection =
    (await refs.findActiveSnapshot())!.installedProtections.find(
      (p) => p.code === "NONE",
    );
  const prepared = await prepareConfiguredAssembly({
    database: db,
    draft,
    quantity: 1,
    referenceMode: "current",
  });
  line = {
    productSnapshot: captureQuoteRequestProductSnapshot(hose),
    id: "assembly-1",
    sku: hose.sku,
    lineKind: "configured_assembly",
    quantity: 1,
    salesUnit: "each",
    catalogReleaseId: hose.releaseId,
    category: hose.category,
    currency: "USD",
    displayName: hose.displayName,
    referenceUnitPrice: null,
    updatedAt: new Date().toISOString(),
    refresh: null,
    currentEstimateAmount: null,
    cuttingLabelingFeeAmount: null,
    cuttingLabelingFeeRate: null,
    estimatedMerchandiseAmount: null,
    lengthOrder: null,
    configuredAssembly: {
      snapshot: prepared.snapshot,
      estimateBasis: prepared.estimateBasis,
      unitEstimateAmount: prepared.unitEstimateAmount,
      currentIssue: null,
    },
  };
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});
const edit = (): QuoteLineEdit => ({
  id: line.id,
  sku: line.sku,
  quantity: 2,
  lengthValue: "30",
  lengthUnit: "in",
  specifications: [],
  assembly: {
    ...assemblyAmendmentFields(line)!,
    confirmCurrentComponentRefresh: true,
  },
});
it("rebuilds amended protection through actual D1 compatibility and immutable product evidence", async () => {
  const input = edit();
  input.assembly!.protectionCode = "NYLON";
  const result = await prepareQuoteAssemblyAmendment(
    db,
    line,
    reviseQuoteLine(line, input, null),
    input,
  );
  expect(result.changed).toBe(true);
  if (
    result.line.lineKind !== "configured_assembly" ||
    line.lineKind !== "configured_assembly"
  )
    throw Error("fixture");
  expect(
    result.line.configuredAssembly.snapshot.configuration.installedProtection
      ?.code,
  ).toBe("NYLON");
  expect(
    result.line.configuredAssembly.snapshot.configuration.measurementSelection
      ?.state,
  ).toBe("not_sure");
  expect(result.line.configuredAssembly.snapshot.productBasis?.length).toBe(5);
  expect(result.line.configuredAssembly.snapshot.review.outcome).toBe(
    "technical_review",
  );
  expect(
    line.configuredAssembly.snapshot.configuration.installedProtection?.code,
  ).toBe("NONE");
  expect(result.line.productSnapshot.catalogBasis).toEqual(
    result.line.configuredAssembly.snapshot.productBasis?.[0].catalogBasis,
  );
  input.assembly!.confirmCurrentComponentRefresh = false;
  await expect(
    prepareQuoteAssemblyAmendment(
      db,
      line,
      reviseQuoteLine(line, input, null),
      input,
    ),
  ).rejects.toThrow("Confirm revalidation");
});
it("rejects incompatible components, invalid measurement and inapplicable clocking", async () => {
  for (const patch of [
    { endASku: "not-compatible" },
    { measurement: "M99" },
    { clocking: "400" },
    { protectionCode: "missing" },
  ]) {
    const input = edit();
    Object.assign(input.assembly!, patch);
    await expect(
      prepareQuoteAssemblyAmendment(
        db,
        line,
        reviseQuoteLine(line, input, null),
        input,
      ),
    ).rejects.toThrow();
  }
  const input = edit();
  expect(
    (
      await prepareQuoteAssemblyAmendment(
        db,
        line,
        reviseQuoteLine(line, input, null),
        input,
      )
    ).changed,
  ).toBe(false);
});
it("captures updated end evidence and explicit double-elbow clocking without changing original snapshot", async () => {
  const items = createD1CatalogItemRepository(db);
  const series = (await items.findProductPayload("hose_end", "series", "FJX"))!;
  if (series.kind !== "series") throw Error("fixture");
  Object.assign(series.series, { angle: "90° Elbow" });
  await items.apply({
    payload: series,
    targetState: "online",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: "owner-1",
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  await createD1ManagedAssemblies(db, {
    id: "owner-1",
    catalogPermission: "edit",
  }).update({ id: crypto.randomUUID(), ipAddress: "local" });
  const input = edit();
  input.assembly!.clocking = "135";
  const result = await prepareQuoteAssemblyAmendment(
    db,
    line,
    reviseQuoteLine(line, input, null),
    input,
  );
  if (
    result.line.lineKind !== "configured_assembly" ||
    line.lineKind !== "configured_assembly"
  )
    throw Error("fixture");
  expect(
    result.line.configuredAssembly.snapshot.configuration.endA?.hoseEnd.angle,
  ).toBe("90° Elbow");
  expect(
    result.line.configuredAssembly.snapshot.configuration.clocking,
  ).toMatchObject({
    status: "specified",
    targetDegrees: 135,
    validation: "confirmed",
  });
  expect(
    line.configuredAssembly.snapshot.configuration.endA?.hoseEnd.angle,
  ).toBe("0° Straight");
});
it("keeps assembly kind when replacing its hose and requires the current compatible combination", async () => {
  const hose = (await createD1PublicCatalogRepository(db).findItem(line.sku))!;
  const input = edit();
  input.sku = "replacement-hose";
  const revised = reviseQuoteLine(line, input, { ...hose, sku: input.sku });
  expect(revised.lineKind).toBe("configured_assembly");
  await expect(
    prepareQuoteAssemblyAmendment(db, line, revised, input),
  ).rejects.toThrow("no longer available");
});
