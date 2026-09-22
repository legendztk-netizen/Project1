import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ApplicationBindings } from "#workers/environment";
import { customerIdentitySigningKey } from "#workers/session-secrets";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1CustomerIdentityRepository } from "../app/modules/customer-identity/infrastructure/d1-customer-identity-repository";
import {
  createCustomerSessionCookie,
  digestCustomerSessionToken,
  generateCustomerSessionToken,
} from "../app/modules/customer-identity/domain/customer-session";
import { createCustomerAccountService } from "../app/modules/customer-identity/application/customer-account-service";
import { createAnonymousQuoteListService } from "../app/modules/quote-list/application/anonymous-quote-list-service";
import { createQuoteRequestService } from "../app/modules/quote-request/application/quote-request-service";
import { createD1ManagedAssemblies } from "../app/modules/catalog/infrastructure/d1-managed-assemblies";
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
import { calculateAssemblyLengthReferencePricing } from "../app/modules/configurator/domain/protection-and-application";

const directory = mkdtempSync(join(tmpdir(), "quote-submit-"));
const now = new Date();
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
let env: ApplicationBindings;
const queries: string[] = [];

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
  env = {
    APP_ENV: "local",
    DB: new Proxy(db, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            queries.push(sql);
            return target.prepare(sql);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  } as ApplicationBindings;
}, 60000);

afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

async function accountList(count: number, quantity = 100) {
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
  for (let i = 1; i <= count; i++) {
    await lists.addLengthBasedHose(request, "601R1_001", {
      normalizedLengthFt: i,
      originalLengthUnit: "ft",
      originalLengthValue: i,
      pieceCount: quantity,
      totalFootage: i * quantity,
    });
  }
  const lines = (await lists.read(request)).lines;
  return { request, lines, lists };
}

it("submits selected snapshots, preserves other lines and replays without creating another RFQ", async () => {
  const counts: number[] = [];
  for (const [count, selectedCount] of [
    [3, 3],
    [50, 3],
    [50, 50],
  ]) {
    const { request, lines, lists } = await accountList(
      count,
      selectedCount === 50 ? 1 : 100,
    );
    const input = {
      request,
      accuracyConfirmed: true,
      commercialReviewConfirmed: true,
      idempotencyKey: crypto.randomUUID(),
      selectedLineIds: lines.slice(0, selectedCount).map((line) => line.id),
    };
    queries.length = 0;
    const start = performance.now();
    const record = await createQuoteRequestService(env).submitIndividual(input);
    const elapsedMs = performance.now() - start;
    const queryCount = queries.length;
    counts.push(queryCount);
    expect(
      queries.filter((sql) => sql.includes("WITH active_catalog_runtime_skus")),
    ).toHaveLength(1);
    expect(
      queries.filter((sql) => sql.includes("FROM quote_reference_discounts")),
    ).toHaveLength(1);
    expect(record.snapshot.lines).toHaveLength(selectedCount);
    expect((await lists.read(request)).lines).toHaveLength(
      count - selectedCount,
    );
    queries.length = 0;
    const retryStart = performance.now();
    const replay = await createQuoteRequestService(env).submitIndividual(input);
    const retryMs = performance.now() - retryStart;
    expect(replay.id).toBe(record.id);
    expect(
      queries.some(
        (sql) =>
          sql.includes("catalog_runtime") ||
          sql.includes("quote_reference_discounts"),
      ),
    ).toBe(false);
    if (process.env.QUOTE_SUBMIT_BENCHMARK)
      process.stdout.write(
        JSON.stringify({
          count,
          selectedCount,
          elapsedMs,
          queryCount,
          retryMs,
          retryQueries: queries.length,
        }) + "\n",
      );
  }
  expect(counts[1]).toBe(counts[0]);
  expect(counts[2]).toBe(counts[0]);
}, 60000);

it("still rejects changed selected products and preserves the list", async () => {
  const { request, lines, lists } = await accountList(3);
  const input = {
    request,
    accuracyConfirmed: true,
    commercialReviewConfirmed: true,
    idempotencyKey: crypto.randomUUID(),
    selectedLineIds: [lines[0].id, "missing-line"],
  };
  await expect(
    createQuoteRequestService(env).submitIndividual(input),
  ).rejects.toMatchObject({ code: "LIST_CHANGED" });
  expect((await lists.read(request)).lines).toHaveLength(3);
  await expect(
    createQuoteRequestService(env).submitIndividual({
      ...input,
      selectedLineIds: [],
    }),
  ).rejects.toMatchObject({ code: "NO_LINES_SELECTED" });
});

function beforeSubmission(change: () => Promise<unknown>) {
  let changed = false;
  let submitting = false;
  return {
    ...env,
    DB: new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            if (
              sql.includes(
                "INSERT INTO customer_quote_request_submission_guards",
              )
            )
              submitting = true;
            return target.prepare(sql);
          };
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (submitting && !changed) {
              changed = true;
              await change();
            }
            return target.batch(statements);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  };
}

it("rejects a concurrent quantity edit at the transaction boundary", async () => {
  const { request, lines, lists } = await accountList(3);
  const racingEnv = beforeSubmission(() =>
    lists.updateLengthBasedHose(request, lines[0].id, 101),
  );
  await expect(
    createQuoteRequestService(racingEnv).submitIndividual({
      request,
      accuracyConfirmed: true,
      commercialReviewConfirmed: true,
      idempotencyKey: crypto.randomUUID(),
      selectedLineIds: lines.map((line) => line.id),
    }),
  ).rejects.toMatchObject({ code: "LIST_CHANGED" });
  expect((await lists.read(request)).lines).toHaveLength(3);
});

it("validates selected assemblies afresh without validating unselected broken assemblies", async () => {
  await createD1ManagedAssemblies(db, {
    id: "owner-1",
    catalogPermission: "edit",
  }).update({ id: crypto.randomUUID(), ipAddress: "local" });
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
      actorId: "owner-1",
      auditEventId: crypto.randomUUID(),
      requestCorrelationId: crypto.randomUUID(),
      ipAddress: "local",
      updatedAt: now.toISOString(),
    });
  }
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
  draft.measurementSelection = selectMeasurementNotSure();
  const references = (await refs.findActiveSnapshot())!;
  draft.installedProtection = references.installedProtections.find(
    (p) => p.code === "NONE",
  );
  const { request, lists } = await accountList(0);
  for (let i = 0; i < 10; i++) {
    const length = evaluateFinishedAssemblyLength({
      hasBothEnds: true,
      requestedTighterTolerance: false,
      unit: "in",
      value: String(30 + i),
    });
    if (!length.valid) throw Error(length.error);
    draft.finishedLength = length.length;
    draft.lengthReferencePricing = calculateAssemblyLengthReferencePricing({
      canonicalLengthMm: length.length.canonicalMm,
      protection: draft.installedProtection!,
      schedule: references.assemblyEstimateSchedule,
    });
    await lists.addConfiguredAssembly(request, draft, 4);
  }
  const lines = (await lists.read(request)).lines;
  await db
    .prepare(
      "UPDATE anonymous_quote_lines SET configured_snapshot_json=json_set(configured_snapshot_json, '$.configuration.endA.hoseEnd.sku', 'MISSING-END') WHERE id=?",
    )
    .bind(lines[9].id)
    .run();
  queries.length = 0;
  const start = performance.now();
  const record = await createQuoteRequestService(env).submitIndividual({
    request,
    accuracyConfirmed: true,
    commercialReviewConfirmed: true,
    idempotencyKey: crypto.randomUUID(),
    selectedLineIds: lines.slice(0, 3).map((line) => line.id),
  });
  const elapsedMs = performance.now() - start;
  expect(record.snapshot.lines).toHaveLength(3);
  expect(
    record.snapshot.lines.every((line) => line.refresh?.status === "ready"),
  ).toBe(true);
  expect(
    queries.filter((sql) => sql.includes("WITH active_catalog_runtime_skus")),
  ).toHaveLength(3);
  if (process.env.QUOTE_SUBMIT_BENCHMARK)
    process.stdout.write(
      JSON.stringify({
        kind: "configured_assembly",
        count: 10,
        selectedCount: 3,
        elapsedMs,
        queryCount: queries.length,
      }) + "\n",
    );
  expect((await lists.read(request)).lines).toHaveLength(7);
  await expect(
    createQuoteRequestService(env).submitIndividual({
      request,
      accuracyConfirmed: true,
      commercialReviewConfirmed: true,
      idempotencyKey: crypto.randomUUID(),
      selectedLineIds: [lines[9].id],
    }),
  ).rejects.toMatchObject({ code: "LIST_NOT_READY" });
  expect((await lists.read(request)).lines).toHaveLength(7);
  const racingEnv = beforeSubmission(() =>
    db
      .prepare(
        "UPDATE configurator_global_registry_entries SET record_version=record_version+1 WHERE registry_type='installed_protection' AND entry_key='NONE'",
      )
      .run(),
  );
  await expect(
    createQuoteRequestService(racingEnv).submitIndividual({
      request,
      accuracyConfirmed: true,
      commercialReviewConfirmed: true,
      idempotencyKey: crypto.randomUUID(),
      selectedLineIds: [lines[3].id],
    }),
  ).rejects.toMatchObject({ code: "LIST_CHANGED" });
  expect((await lists.read(request)).lines).toHaveLength(7);
}, 60000);
