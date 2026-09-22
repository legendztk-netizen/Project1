import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { ApplicationBindings } from "#workers/environment";
import {
  customerIdentitySigningKey,
  quoteSessionSigningKey,
} from "#workers/session-secrets";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1ManagedAssemblies } from "../app/modules/catalog/infrastructure/d1-managed-assemblies";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1PublicCatalogRepository } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import { createD1ConfiguratorRepository } from "../app/modules/configurator/infrastructure/d1-configurator-repository";
import { createD1ConfiguratorReferenceRepository } from "../app/modules/configurator-reference/infrastructure/d1-configurator-reference-repository";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import { calculateAssemblyLengthReferencePricing } from "../app/modules/configurator/domain/protection-and-application";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../app/modules/configurator/domain/compatible-end-a";
import {
  evaluateFinishedAssemblyLength,
  selectMeasurementNotSure,
} from "../app/modules/configurator/domain/finished-assembly-length";
import { createAnonymousQuoteListService } from "../app/modules/quote-list/application/anonymous-quote-list-service";
import { createD1AnonymousQuoteListRepository } from "../app/modules/quote-list/infrastructure/d1-anonymous-quote-list-repository";
import { createD1QuoteListDisplayCache } from "../app/modules/quote-list/infrastructure/d1-quote-list-display-cache";
import { readAnonymousQuoteSessionId } from "../app/modules/quote-list/domain/anonymous-quote-session";
import {
  createCustomerSessionCookie,
  digestCustomerSessionToken,
  generateCustomerSessionToken,
} from "../app/modules/customer-identity/domain/customer-session";
import { createD1CustomerIdentityRepository } from "../app/modules/customer-identity/infrastructure/d1-customer-identity-repository";

const directory = mkdtempSync(join(tmpdir(), "quote-display-cache-"));
const now = new Date("2026-09-21T00:00:00Z");
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
let env: ApplicationBindings;
const queries: string[] = [];
const service = () => createAnonymousQuoteListService(env, { now: () => now });
const request = (cookie = "") =>
  new Request("http://localhost/quote-list", { headers: { cookie } });
const order = (feet: number) => ({
  normalizedLengthFt: feet,
  originalLengthUnit: "ft" as const,
  originalLengthValue: feet,
  pieceCount: 1,
  totalFootage: feet,
});

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
  const observed = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          queries.push(sql);
          return target.prepare(sql);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  env = { DB: observed, APP_ENV: "local" } as ApplicationBindings;
}, 60000);

afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

async function list(count = 2) {
  const added = await service().addLengthBasedHose(
    request(),
    "601R1_001",
    order(1),
  );
  const req = request(added.setCookie!.split(";")[0]);
  for (let i = 2; i <= count; i++)
    await service().addLengthBasedHose(req, "601R1_001", order(i));
  const sessionId = (await readAnonymousQuoteSessionId(
    req,
    quoteSessionSigningKey(env),
  ))!;
  return {
    req,
    sessionId,
    readLines: () =>
      createD1AnonymousQuoteListRepository(db).listLines(sessionId),
  };
}

it("reuses persisted results across service instances without catalog validation", async () => {
  const { req } = await list();
  queries.length = 0;
  const cold = await service().read(req);
  expect(
    queries.some((sql) => sql.includes("WITH active_catalog_runtime_skus")),
  ).toBe(true);
  queries.length = 0;
  const warm = await service().read(req);
  expect(warm.lines).toEqual(cold.lines);
  expect(
    queries.some((sql) => sql.includes("WITH active_catalog_runtime_skus")),
  ).toBe(false);
  expect(warm.lines.every((line) => line.refresh?.status === "ready")).toBe(
    true,
  );
});

it("invalidates only the edited line and cascades removal of cached rows", async () => {
  const { req, sessionId, readLines } = await list();
  const cold = await service().read(req);
  await service().updateLengthBasedHose(req, cold.lines[0].id, 3);
  const refresh = vi.fn(async (lines: typeof cold.lines) => {
    const fresh = await service().read(req);
    return fresh.lines.filter((line) =>
      lines.some((changed) => changed.id === line.id),
    );
  });
  const result = await createD1QuoteListDisplayCache(db).read({
    sessionId,
    readLines,
    refresh,
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh.mock.calls[0][0].map((line) => line.id)).toEqual([
    cold.lines[0].id,
  ]);
  expect(result[0].quantity).toBe(3);
  expect(result[1]).toEqual(cold.lines[1]);
  await service().remove(req, cold.lines[0].id);
  expect(
    await db
      .prepare("SELECT line_id FROM quote_line_display_cache WHERE line_id = ?")
      .bind(cold.lines[0].id)
      .first(),
  ).toBeNull();
});

it("invalidates cached prices when fee rules change", async () => {
  const { req } = await list(1);
  const before = await service().read(req);
  await db
    .prepare(
      "UPDATE cutting_labeling_fee_rates SET rate_per_piece = rate_per_piece + 1, version = version + 1 WHERE scope_key = 'global'",
    )
    .run();
  queries.length = 0;
  const after = await service().read(req);
  expect(
    queries.some((sql) => sql.includes("WITH active_catalog_runtime_skus")),
  ).toBe(true);
  expect(after.lines[0].refresh!.current.serviceFeeAmount).toBe(
    before.lines[0].refresh!.current.serviceFeeAmount! + 1,
  );
});

it("refreshes malformed and obsolete cache entries", async () => {
  const { req } = await list();
  const before = await service().read(req);
  await db
    .prepare(
      "UPDATE quote_line_display_cache SET result_json = '{}' WHERE line_id = ?",
    )
    .bind(before.lines[0].id)
    .run();
  await db
    .prepare(
      "UPDATE quote_line_display_cache SET format_version = 0 WHERE line_id = ?",
    )
    .bind(before.lines[1].id)
    .run();
  expect((await service().read(req)).lines).toEqual(before.lines);
});

it("does not expose another session's lines or expired session caches", async () => {
  const first = await list();
  await service().read(first.req);
  const second = await list(1);
  const own = await service().read(second.req);
  expect(own.lines).toHaveLength(1);
  expect((await service().read(request())).lines).toEqual([]);
  await db
    .prepare(
      "UPDATE anonymous_quote_sessions SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?",
    )
    .bind(first.sessionId)
    .run();
  expect((await service().read(first.req)).lines).toEqual([]);
});

it("discards prior cache hits if a publication changes during the read", async () => {
  const { req, sessionId, readLines } = await list();
  const before = await service().read(req);
  await db
    .prepare("DELETE FROM quote_line_display_cache WHERE line_id = ?")
    .bind(before.lines[0].id)
    .run();
  const refresh = vi.fn(async (lines: typeof before.lines) => {
    if (lines.length === 1)
      await db
        .prepare(
          "UPDATE catalog_cutover_control SET epoch = epoch + 1 WHERE singleton = 1",
        )
        .run();
    return lines.map((line) =>
      before.lines.find((previous) => previous.id === line.id)!,
    );
  });
  await createD1QuoteListDisplayCache(db).read({
    sessionId,
    readLines,
    refresh,
  });
  expect(refresh.mock.calls.map((call) => call[0].length)).toEqual([1, 2]);
  expect(
    await db
      .prepare("SELECT line_id FROM quote_line_display_cache WHERE line_id = ?")
      .bind(before.lines[0].id)
      .first(),
  ).toBeNull();
});

it("always performs fresh validation for authenticated RFQ submission", async () => {
  const profileId = crypto.randomUUID();
  const token = generateCustomerSessionToken();
  const email = `${profileId}@example.test`;
  await db
    .prepare(
      "INSERT INTO customer_profiles (id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      profileId,
      email,
      email,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  await createD1CustomerIdentityRepository(db).createSessionForProfile({
    profileId,
    sessionId: crypto.randomUUID(),
    tokenDigest: await digestCustomerSessionToken(
      token,
      customerIdentitySigningKey(env),
    ),
    previousTokenDigest: null,
    now: now.toISOString(),
    expiresAt: "2026-10-21T00:00:00Z",
  });
  const req = request(
    createCustomerSessionCookie({ now, secure: false, token }).split(";")[0],
  );
  await service().addLengthBasedHose(req, "601R1_001", order(5));
  await service().read(req);
  await service().read(req);
  queries.length = 0;
  const submission = await service().readForSubmission(req);
  expect(submission?.lines).toHaveLength(1);
  expect(
    queries.some((sql) => sql.includes("WITH active_catalog_runtime_skus")),
  ).toBe(true);
});

it("keeps warm read query counts constant for 10 and 50 lines", async () => {
  const counts: number[] = [];
  for (const count of [10, 50]) {
    const { req } = await list(count);
    const coldStart = performance.now();
    await service().read(req);
    const coldMs = performance.now() - coldStart;
    queries.length = 0;
    const warmStart = performance.now();
    const warm = await service().read(req);
    const warmMs = performance.now() - warmStart;
    counts.push(queries.length);
    expect(warm.lines).toHaveLength(count);
    expect(
      queries.some((sql) => sql.includes("WITH active_catalog_runtime_skus")),
    ).toBe(false);
    if (process.env.QUOTE_CACHE_BENCHMARK)
      process.stdout.write(
        JSON.stringify({
          kind: "length_based_hose",
          count,
          coldMs,
          warmMs,
          queries: queries.length,
        }) + "\n",
      );
  }
  expect(counts[0]).toBe(counts[1]);
}, 60000);

it("caches 50 complete assembly results and invalidates them when a component is discontinued", async () => {
  const refs = createD1ConfiguratorReferenceRepository(db);
  const definitions = [
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
  ];
  for (const entry of definitions) {
    const previous = await db
      .prepare(
        "SELECT record_version FROM configurator_global_registry_entries WHERE registry_type = ? AND entry_key = ?",
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
  let req = request();
  for (let i = 0; i < 50; i++) {
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
    const added = await service().addConfiguredAssembly(req, draft, 1);
    if (added.setCookie) req = request(added.setCookie.split(";")[0]);
  }
  const coldStart = performance.now();
  const cold = await service().read(req);
  const coldMs = performance.now() - coldStart;
  queries.length = 0;
  const warmStart = performance.now();
  const warm = await service().read(req);
  const warmMs = performance.now() - warmStart;
  expect(warm.lines).toEqual(cold.lines);
  expect(warm.lines).toHaveLength(50);
  expect(warm.lines.every((line) => line.refresh?.status === "ready")).toBe(
    true,
  );
  expect(
    queries.some(
      (sql) =>
        sql.includes("catalog_runtime") ||
        sql.includes("quote_reference_discounts"),
    ),
  ).toBe(false);
  if (process.env.QUOTE_CACHE_BENCHMARK)
    process.stdout.write(
      JSON.stringify({
        kind: "configured_assembly",
        count: 50,
        coldMs,
        warmMs,
        queries: queries.length,
      }) + "\n",
    );
  const items = createD1CatalogItemRepository(db);
  const payload = (await items.findProductPayload(
    "hose_end",
    "sku",
    end.hoseEndSku,
  ))!;
  await items.apply({
    payload,
    targetState: "discontinued",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: "owner-1",
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  const blocked = await service().read(req);
  expect(
    blocked.lines.every((line) => line.refresh?.status === "blocked"),
  ).toBe(true);
  expect((await service().read(req)).lines).toEqual(blocked.lines);
}, 60000);
