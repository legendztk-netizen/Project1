import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createQuotePreparation } from "../app/modules/quote-review/infrastructure/d1-quote-preparation";
import {
  completeTechnicalReview,
  technicalReviewContext,
} from "../app/modules/quote-review/infrastructure/d1-technical-review";
import { createD1AdminQuoteReviewRepository } from "../app/modules/quote-review/infrastructure/d1-admin-quote-review-repository";
import { createQuoteRevisions } from "../app/modules/quote-review/infrastructure/d1-quote-revisions";
import { saveQuoteLineRevisions } from "../app/modules/quote-review/infrastructure/d1-quote-line-revisions";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CustomerQuoteOffer } from "../app/modules/quote-review/ui/customer-quote-offer";
import { createD1QuoteRequestRepository } from "../app/modules/quote-request/infrastructure/d1-quote-request-repository";
import type { AdminIdentity } from "../workers/admin-access";
import { seedCatalogItemBaseline } from "./fixtures/catalog-item-baseline";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import { loader as pricingLoader } from "../app/modules/admin/routes/quote-pricing";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import {
  commercialAddress,
  commercialTerms,
} from "./fixtures/quote-commercial";

const directory = mkdtempSync(join(tmpdir(), "quote-preparation-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const actor: AdminIdentity = {
  id: "local-owner",
  email: "owner@local.invalid",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
const source = {
  version: 2,
  destination: commercialAddress,
  amounts: { manualCommercialReview: true },
  importResponsibility: { fulfillmentTerm: "DDP" },
  lines: [
    {
      lineKind: "standard",
      id: "line-standard",
      sku: "601R1_001",
      catalogReleaseId: "active-release",
      salesUnit: "roll",
      productSnapshot: {
        catalogBasis: {
          skuRevisionId: "captured-sku-v1",
          seriesRevisionId: "captured-series-v1",
        },
        mainImageUrl: "/media/catalog/captured-v1/storefront",
      },
      quantity: 2,
      currency: "CNY",
      referenceUnitPrice: 50,
    },
    {
      lineKind: "length_based_hose",
      id: "line-length",
      sku: "fixture-length",
      catalogReleaseId: "active-release",
      salesUnit: "ft",
      quantity: 3,
      currency: "USD",
      referenceUnitPrice: 2,
      lengthOrder: {
        totalFootage: 2.5,
        originalLengthValue: 2.5 / 3,
        originalLengthUnit: "ft",
      },
    },
    {
      lineKind: "configured_assembly",
      id: "line-assembly",
      sku: "fixture-assembly",
      catalogReleaseId: "active-release",
      salesUnit: "EA",
      quantity: 4,
      currency: "USD",
      referenceUnitPrice: 70,
      configuredAssembly: {
        snapshot: {
          review: { outcome: "technical_review", issues: [] },
          configuration: {
            hose: { sku: "fixture-assembly" },
            finishedLength: { originalValue: 30, originalUnit: "in" },
          },
        },
      },
    },
  ],
};
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
  await seedCatalogItemBaseline(db, 987654.32);
  await db.batch([
    db.prepare(
      "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES('pricing-profile','pricing@example.com','pricing@example.com','2026-09-14','2026-09-14','2026-09-14')",
    ),
    db.prepare(
      "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,created_at,updated_at) VALUES('pricing-context','individual','pricing-profile','2026-09-14','2026-09-14')",
    ),
    db
      .prepare(
        "INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at) VALUES('pricing-rfq','QR-PRICING','pricing-profile','pricing-context','session','1','address','individual','DDP','USD',0,0,'pricing-request',?,'2026-09-14')",
      )
      .bind(JSON.stringify(source)),
  ]);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("starts one draft with exact source context and no inferred USD prices", async () => {
  const service = createQuotePreparation(db, actor);
  const [first, second] = await Promise.all([
    service.start("pricing-rfq"),
    service.start("pricing-rfq"),
  ]);
  expect(first).toEqual(second);
  expect(first.source).toEqual(source);
  expect(first.prices.every((price) => price.unitPriceCents === null)).toBe(
    true,
  );
  await expect(
    db
      .prepare("UPDATE quote_preparation_drafts SET source_snapshot_json='{}'")
      .run(),
  ).rejects.toThrow(/immutable/);
});

it("audits exact previous/new USD prices, rejects stale writes and replays commands", async () => {
  const service = createQuotePreparation(db, actor);
  const prices = [1000, 200, 7000].map((unitPriceCents) => ({
    unitPriceCents,
    discountBasisPoints: 1000,
  }));
  const commandId = crypto.randomUUID();
  expect(
    await service.savePrices(
      "pricing-rfq",
      1,
      prices,
      "reviewed USD offer",
      commandId,
    ),
  ).toBe(2);
  expect(
    await service.savePrices(
      "pricing-rfq",
      1,
      prices,
      "reviewed USD offer",
      commandId,
    ),
  ).toBe(2);
  await expect(
    service.savePrices("pricing-rfq", 1, prices, "stale", crypto.randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  const audit = await db
    .prepare("SELECT actor_id,payload_json FROM admin_audit_events WHERE id=?")
    .bind(`quote-pricing:${commandId}`)
    .first<{ actor_id: string; payload_json: string }>();
  expect(audit?.actor_id).toBe(actor.id);
  expect(JSON.parse(audit!.payload_json)).toMatchObject({
    currency: "USD",
    former: [
      { unitPriceCents: null },
      { unitPriceCents: null },
      { unitPriceCents: null },
    ],
    current: prices,
    reason: "reviewed USD offer",
    version: 2,
  });
  const results = await Promise.allSettled([
    service.savePrices("pricing-rfq", 2, prices, "race-a", crypto.randomUUID()),
    service.savePrices("pricing-rfq", 2, prices, "race-b", crypto.randomUUID()),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect((await service.find("pricing-rfq"))?.version).toBe(3);
  const customer = await createD1QuoteRequestRepository(db).findOwned(
    "pricing-profile",
    "pricing-rfq",
  );
  expect(customer?.snapshot).toEqual(source);
  expect(JSON.stringify(customer)).not.toContain("reviewed USD offer");
});

it("exposes legacy cost only in authorized Admin projection, preserving item/image source evidence", async () => {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    adminIdentity: actor,
    env: platform.env as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
  });
  const url = new URL(
    "http://admin.localhost/admin/quotes/pricing-rfq/pricing",
  );
  const args = {
    context,
    url,
    request: new Request(url),
    params: { requestId: "pricing-rfq" },
    pattern: "/admin/quotes/:requestId/pricing",
  };
  const admin = await pricingLoader(args);
  expect(admin.data.costs[0][0].factory_unit_price).toBe(987654.32);
  const saved = await createQuotePreparation(db, actor).find("pricing-rfq");
  expect(saved?.source).toEqual(source);
  const customer = JSON.stringify(
    await createD1QuoteRequestRepository(db).findOwned(
      "pricing-profile",
      "pricing-rfq",
    ),
  );
  const audit = JSON.stringify(
    (
      await db
        .prepare(
          "SELECT payload_json FROM admin_audit_events WHERE entity_type='quote_preparation'",
        )
        .all()
    ).results,
  );
  for (const content of [customer, audit, JSON.stringify(saved)]) {
    expect(content).not.toContain("987654.32");
    expect(content).not.toContain("factory_unit_price");
  }
  context.set(cloudflareContext, {
    env: platform.env as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
  });
  await expect(pricingLoader(args)).rejects.toMatchObject({ status: 403 });
  const catalog = createD1CatalogItemRepository(db);
  await catalog.enable({ environment: "local", actorId: actor.id });
  const series = (await catalog.findPayload("series", "601R1"))!;
  if (series.kind !== "series") throw new Error("Expected series fixture");
  series.series.seriesName = "Changed after RFQ";
  series.mediaVersionId = "uploaded-v2";
  await catalog.apply({
    payload: series,
    targetState: "online",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: actor.id,
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  expect(
    (await createQuotePreparation(db, actor).start("pricing-rfq"))?.source,
  ).toEqual(source);
  expect(
    (await createQuotePreparation(db, actor).find("pricing-rfq"))?.prices,
  ).toEqual(saved?.prices);
});

it("persists terms atomically, rejects missing tax evidence and shares pricing concurrency", async () => {
  const service = createQuotePreparation(db, actor);
  const draft = (await service.find("pricing-rfq"))!;
  await expect(
    service.saveTerms(
      "pricing-rfq",
      draft.version,
      {
        ...commercialTerms(),
        taxTreatment: "Exempt",
        taxEvidenceId: "missing-file",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 400 });
  const command = crypto.randomUUID();
  const version = await service.saveTerms(
    "pricing-rfq",
    draft.version,
    commercialTerms(),
    command,
  );
  const equivalent = Object.fromEntries(
    Object.entries({
      ...commercialTerms(),
      leadTime: ` ${commercialTerms().leadTime} `,
    }).reverse(),
  ) as unknown as ReturnType<typeof commercialTerms>;
  expect(
    await service.saveTerms("pricing-rfq", draft.version, equivalent, command),
  ).toBe(version);
  await expect(
    service.savePrices(
      "pricing-rfq",
      draft.version,
      draft.prices,
      "stale after terms",
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const saved = (await service.find("pricing-rfq"))!;
  expect(saved.terms).toEqual(commercialTerms());
  expect(saved.source).toEqual(source);
});

it("requires an associated private exemption record, not another RFQ's evidence", async () => {
  await db
    .prepare(
      "INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at) SELECT 'other-tax-rfq','QR-OTHER-TAX',profile_id,purchasing_context_id,'other-session',1,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,'other-tax-command',snapshot_json,submitted_at FROM customer_quote_requests WHERE id='pricing-rfq'",
    )
    .run();
  for (const requestId of ["pricing-rfq", "other-tax-rfq"]) {
    await db
      .prepare(
        "INSERT INTO quote_private_evidence(id,request_id,actor_id,kind,filename,content_type,byte_size,checksum,object_key,created_at) VALUES(?,?,?,'tax_exemption','exemption.pdf','application/pdf',100,'test-checksum',?,'2026-09-14')",
      )
      .bind(`tax:${requestId}`, requestId, actor.id, `private/${requestId}`)
      .run();
  }
  const service = createQuotePreparation(db, actor);
  const draft = (await service.find("pricing-rfq"))!;
  await expect(
    service.saveTerms(
      "pricing-rfq",
      draft.version,
      {
        ...commercialTerms(),
        taxTreatment: "Exempt",
        taxEvidenceId: "tax:other-tax-rfq",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await service.saveTerms(
    "pricing-rfq",
    draft.version,
    {
      ...commercialTerms(),
      taxTreatment: "Exempt",
      taxEvidenceId: "tax:pricing-rfq",
    },
    crypto.randomUUID(),
  );
  expect((await service.find("pricing-rfq"))?.terms?.taxEvidenceId).toBe(
    "tax:pricing-rfq",
  );
});

it("issues once under concurrency, freezes exact source and excludes internal review from owned offers", async () => {
  const revisions = createQuoteRevisions(db);
  const preparation = createQuotePreparation(db, actor);
  const draft = (await preparation.find("pricing-rfq"))!;
  const input = {
    requestId: "pricing-rfq",
    preparationVersion: draft.version,
    sourceHash: draft.sourceHash,
    factoryReviewConfirmed: true,
    commandId: crypto.randomUUID(),
  };
  await expect(
    revisions.issueRevision(undefined as unknown as AdminIdentity, input),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    revisions.issueRevision(actor, { ...input, factoryReviewConfirmed: false }),
  ).rejects.toThrow(/factory/);
  await expect(
    revisions.issueRevision(actor, {
      ...input,
      preparationVersion: draft.version - 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    revisions.issueRevision(actor, { ...input, sourceHash: "stale" }),
  ).rejects.toMatchObject({ status: 409 });
  const [first, repeated] = await Promise.all([
    revisions.issueRevision(actor, input),
    revisions.issueRevision(actor, input),
  ]);
  expect(first).toEqual(repeated);
  expect(first.snapshot.source).toEqual(source);
  expect(first.snapshot.prices).toEqual(draft.prices);
  expect(first.snapshot.terms).toEqual(draft.terms);
  expect(first.snapshot.revisionNumber).toBe(1);
  await expect(
    revisions.issueRevision(actor, {
      ...input,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    revisions.issueRevision({ ...actor, id: "another-admin" }, input),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await revisions.customerCurrent("not-owner", "pricing-rfq"),
  ).toBeNull();
  const offer = await revisions.customerCurrent(
    "pricing-profile",
    "pricing-rfq",
  );
  expect(offer?.totals).toEqual(first.snapshot.totals);
  const html = renderToStaticMarkup(
    createElement(CustomerQuoteOffer, { offer: offer! }),
  );
  expect(html).toContain("Formal quote");
  expect(html).toContain("Pricing quantity 2.5 ft");
  expect(html).toContain("3 pieces");
  expect(html).toContain("2.5 ft total");
  expect(JSON.stringify(offer)).not.toMatch(
    /taxEvidenceId|issuedBy|factoryReviewConfirmed|987654|manualCurrencyConfirmed|addressReplacementReason/,
  );
  await expect(
    db.prepare("UPDATE quote_revisions SET snapshot_json='{}'").run(),
  ).rejects.toThrow(/immutable/);
  await expect(db.prepare("DELETE FROM quote_revisions").run()).rejects.toThrow(
    /immutable/,
  );
  const nextDraft = await revisions.startNext(
    actor,
    "pricing-rfq",
    first.id,
    draft.version,
  );
  await preparation.savePrices(
    "pricing-rfq",
    nextDraft.version,
    draft.prices.map((price) => ({ ...price, unitPriceCents: 1 })),
    "later preparation change",
    crypto.randomUUID(),
  );
  expect(await revisions.current("pricing-rfq")).toEqual(first);
  const catalog = createD1CatalogItemRepository(db);
  const series = (await catalog.findPayload("series", "601R1"))!;
  if (series.kind !== "series") throw new Error("Expected series");
  series.series.seriesName = "Changed after formal quote issuance";
  await catalog.apply({
    payload: series,
    targetState: "online",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: actor.id,
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  expect(await revisions.current("pricing-rfq")).toEqual(first);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM admin_audit_events WHERE event_type='quote_revision.issued'",
      )
      .first("n"),
  ).toBe(1);
});

async function prepareOtherQuote(id: string) {
  const snapshot = {
    ...source,
    lines: source.lines.filter(
      (line) => line.lineKind !== "configured_assembly",
    ),
  };
  await db
    .prepare(
      "INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at) SELECT ?,?,profile_id,purchasing_context_id,?,1,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,?,? ,submitted_at FROM customer_quote_requests WHERE id='pricing-rfq'",
    )
    .bind(
      id,
      `QR-${id}`,
      `session-${id}`,
      `command-${id}`,
      JSON.stringify(snapshot),
    )
    .run();
  const preparation = createQuotePreparation(db, actor);
  const initial = await preparation.start(id);
  await preparation.savePrices(
    id,
    initial.version,
    initial.prices.map(() => ({ unitPriceCents: 200, discountBasisPoints: 0 })),
    "Reviewed USD prices",
    crypto.randomUUID(),
  );
  const priced = (await preparation.find(id))!;
  await preparation.saveTerms(
    id,
    priced.version,
    commercialTerms(),
    crypto.randomUUID(),
  );
  return (await preparation.find(id))!;
}

it("records technical approval independently, rejects stale configuration and reuses approval at issuance", async () => {
  const draft = await prepareOtherQuote("technical-review-test");
  const id = draft.requestId;
  const before = await technicalReviewContext(db, id);
  await expect(
    completeTechnicalReview(db, actor, id, before.fingerprint, " "),
  ).rejects.toThrow();
  await completeTechnicalReview(
    db,
    actor,
    id,
    before.fingerprint,
    "Factory verified dimensions and connections",
  );
  await completeTechnicalReview(
    db,
    actor,
    id,
    before.fingerprint,
    "Factory verified dimensions and connections",
  );
  expect(
    (await createD1AdminQuoteReviewRepository(db).find(id))?.technicalReview
      .state,
  ).toBe("completed");
  const changed = structuredClone(draft.source.lines);
  changed[0].quantity += 1;
  await db
    .prepare(
      "UPDATE quote_preparation_drafts SET quoted_lines_json=?,version=version+1 WHERE request_id=?",
    )
    .bind(JSON.stringify(changed), id)
    .run();
  expect((await technicalReviewContext(db, id)).completion).toBeNull();
  await expect(
    completeTechnicalReview(
      db,
      actor,
      id,
      before.fingerprint,
      "stale approval",
    ),
  ).rejects.toThrow(/配置版本/);
  const after = await technicalReviewContext(db, id);
  await completeTechnicalReview(
    db,
    actor,
    id,
    after.fingerprint,
    "Reviewed revised quantity",
  );
  const revision = await createQuoteRevisions(db).issueRevision(actor, {
    requestId: id,
    preparationVersion: draft.version + 1,
    sourceHash: draft.sourceHash,
    factoryReviewConfirmed: false,
    commandId: crypto.randomUUID(),
  });
  expect(revision.snapshot.factoryReviewConfirmed).toBe(true);
  expect((await technicalReviewContext(db, id)).completion?.actor).toBe(
    actor.id,
  );
  await createQuoteRevisions(db).startNext(
    actor,
    id,
    revision.id,
    draft.version + 1,
  );
  expect((await technicalReviewContext(db, id)).completion).toBeNull();
});

it("allows only one of distinct issuance commands and batches customer-list progress reads", async () => {
  const draft = await prepareOtherQuote("competing-issue");
  const revisions = createQuoteRevisions(db);
  const input = {
    requestId: draft.requestId,
    preparationVersion: draft.version,
    sourceHash: draft.sourceHash,
    factoryReviewConfirmed: false,
    commandId: crypto.randomUUID(),
  };
  const outcomes = await Promise.allSettled([
    revisions.issueRevision(actor, input),
    revisions.issueRevision(actor, {
      ...input,
      commandId: crypto.randomUUID(),
    }),
  ]);
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(outcomes.find((result) => result.status === "rejected")).toMatchObject(
    { reason: { status: 409 } },
  );
  expect(
    await db
      .prepare("SELECT count(*) AS n FROM quote_revisions WHERE request_id=?")
      .bind(draft.requestId)
      .first("n"),
  ).toBe(1);
  let reads = 0;
  const tracked = new Proxy(db, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          reads++;
          return target.prepare(sql);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const list =
    await createD1QuoteRequestRepository(tracked).listOwned("pricing-profile");
  expect(reads).toBe(1);
  expect(
    list.find((record) => record.id === draft.requestId)?.hasCurrentOffer,
  ).toBe(true);
});

it("rejects issuance when preparation changes after validation but before atomic insert", async () => {
  const draft = await prepareOtherQuote("edited-during-issue");
  let intercepted = false;
  const racing = new Proxy(db, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (!intercepted) {
            intercepted = true;
            await createQuotePreparation(db, actor).savePrices(
              draft.requestId,
              draft.version,
              draft.prices.map((price) => ({ ...price, unitPriceCents: 300 })),
              "Concurrent reviewed price",
              crypto.randomUUID(),
            );
          }
          return target.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    createQuoteRevisions(racing).issueRevision(actor, {
      requestId: draft.requestId,
      preparationVersion: draft.version,
      sourceHash: draft.sourceHash,
      factoryReviewConfirmed: false,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await createQuoteRevisions(db).current(draft.requestId)).toBeNull();
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM admin_audit_events WHERE event_type='quote_revision.issued' AND json_extract(payload_json,'$.requestId')=?",
      )
      .bind(draft.requestId)
      .first("n"),
  ).toBe(0);
});

it("revises products and terms without replacing history, rejects no-op and stale revisions", async () => {
  const initial = await prepareOtherQuote("revision-lifecycle");
  const revisions = createQuoteRevisions(db);
  const preparation = createQuotePreparation(db, actor);
  const first = await revisions.issueRevision(actor, {
    requestId: initial.requestId,
    preparationVersion: initial.version,
    sourceHash: initial.sourceHash,
    factoryReviewConfirmed: false,
    commandId: crypto.randomUUID(),
  });
  const [draft, retry] = await Promise.all([
    revisions.startNext(actor, initial.requestId, first.id, initial.version),
    revisions.startNext(actor, initial.requestId, first.id, initial.version),
  ]);
  expect(draft.version).toBe(retry.version);
  expect(draft.source).toEqual(first.snapshot.source);
  const issueInput = {
    requestId: draft.requestId,
    preparationVersion: draft.version,
    sourceHash: draft.sourceHash,
    baseRevisionId: first.id,
    changeReason: "Buyer changed product specifications and quantity",
    factoryReviewConfirmed: true,
    commandId: crypto.randomUUID(),
  };
  await expect(revisions.issueRevision(actor, issueInput)).rejects.toThrow(
    /No material/,
  );
  const editInput = {
    requestId: draft.requestId,
    version: draft.version,
    reason: "Confirmed quantity and surface-finish amendment",
    commandId: crypto.randomUUID(),
    edits: [
      {
        id: "line-standard",
        sku: "601R1_001",
        quantity: 5,
        lengthValue: "",
        lengthUnit: "ft" as const,
        specifications: [
          { label: "Surface finish", value: "Customer-approved finish B" },
        ],
      },
      {
        id: "line-length",
        sku: "601R1_001",
        quantity: 3,
        lengthValue: "10",
        lengthUnit: "ft" as const,
        specifications: [],
      },
    ],
  };
  const editedVersion = await saveQuoteLineRevisions(db, actor, editInput);
  expect(await saveQuoteLineRevisions(db, actor, editInput)).toBe(
    editedVersion,
  );
  const edited = (await preparation.find(draft.requestId))!;
  expect(edited.originalSource).toEqual(initial.originalSource);
  expect(edited.source.lines[1].productSnapshot.catalogBasis).toBeTruthy();
  expect(edited.prices[1].unitPriceCents).toBeNull();
  expect(edited.terms?.leadTime).toBe("");
  const preview = await revisions.customerProposedChanges(
    "pricing-profile",
    draft.requestId,
    first.id,
  );
  expect(preview.map((change) => change.field)).toContain("Quantities");
  expect(
    await revisions.customerProposedChanges(
      "not-owner",
      draft.requestId,
      first.id,
    ),
  ).toEqual([]);
  await expect(
    revisions.issueRevision(actor, {
      ...issueInput,
      preparationVersion: editedVersion,
    }),
  ).rejects.toThrow();
  const pricedVersion = await preparation.savePrices(
    draft.requestId,
    editedVersion,
    [
      { unitPriceCents: 300, discountBasisPoints: 1000 },
      { unitPriceCents: 250, discountBasisPoints: 0 },
    ],
    "Reviewed final USD pricing",
    crypto.randomUUID(),
  );
  const finalVersion = await preparation.saveTerms(
    draft.requestId,
    pricedVersion,
    {
      ...commercialTerms(),
      destination: { ...commercialAddress, city: "Boston" },
      addressReplacementReason: "Buyer confirmed new site",
      shipmentMode: "split",
      splitPlan: "Line1 on day10; line2 on day20",
      transportMethod: "Ocean freight",
      incoterm: "DAP",
      termReplacementReason: "Buyer confirmed import handling",
      namedPlace: "Boston, US",
      leadTime: "20 days for revised quantities",
      taxTreatment: "Collected",
      charges: {
        ...commercialTerms().charges,
        salesTax: 100,
        freight: 4000,
        dutiesImport: 0,
      },
    },
    crypto.randomUUID(),
  );
  const issue = {
    ...issueInput,
    preparationVersion: finalVersion,
    commandId: crypto.randomUUID(),
  };
  const second = await revisions.issueRevision(actor, issue);
  expect(await revisions.issueRevision(actor, issue)).toEqual(second);
  expect(second.snapshot.revisionNumber).toBe(2);
  expect(second.snapshot.previousRevisionId).toBe(first.id);
  expect(
    await revisions.customerProposedChanges(
      "pricing-profile",
      draft.requestId,
      first.id,
    ),
  ).toEqual([]);
  expect(second.snapshot.originalRfqSource).toEqual(initial.originalSource);
  expect(second.snapshot.differences?.map((change) => change.field)).toEqual(
    expect.arrayContaining([
      "Products",
      "Quantities",
      "Specifications",
      "Delivery address",
      "Shipment plan",
      "Transport",
      "Sales tax",
      "USD prices and discounts",
      "Freight",
      "Import terms and charges",
      "Lead time",
    ]),
  );
  expect((await revisions.history(draft.requestId))[1]).toEqual(first);
  expect(await revisions.customerHistory("not-owner", draft.requestId)).toEqual(
    [],
  );
  const visible = await revisions.customerHistory(
    "pricing-profile",
    draft.requestId,
  );
  expect(visible.map((revision) => revision.revisionNumber)).toEqual([2, 1]);
  expect(JSON.stringify(visible)).not.toMatch(
    /taxEvidenceId|issuedBy|987654|addressReplacementReason/,
  );
  await expect(
    revisions.startNext(actor, draft.requestId, first.id, finalVersion),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    revisions.issueRevision(actor, {
      ...issue,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  const thirdDraft = await revisions.startNext(
    actor,
    draft.requestId,
    second.id,
    finalVersion,
  );
  const thirdVersion = await preparation.savePrices(
    draft.requestId,
    thirdDraft.version,
    thirdDraft.prices.map((price) => ({ ...price, unitPriceCents: 400 })),
    "Third reviewed offer",
    crypto.randomUUID(),
  );
  const successorInput = {
    ...issue,
    preparationVersion: thirdVersion,
    baseRevisionId: second.id,
    changeReason: "Revised USD offer",
    commandId: crypto.randomUUID(),
  };
  const successors = await Promise.allSettled([
    revisions.issueRevision(actor, successorInput),
    revisions.issueRevision(actor, {
      ...successorInput,
      commandId: crypto.randomUUID(),
    }),
  ]);
  expect(
    successors.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    (await revisions.history(draft.requestId)).map(
      (revision) => revision.snapshot.revisionNumber,
    ),
  ).toEqual([3, 2, 1]);
});
