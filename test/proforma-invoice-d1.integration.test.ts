import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AdminIdentity } from "../workers/admin-access";
import {
  createProformaInvoiceService,
  type IssueProformaInvoiceCommand,
  type ProformaInvoiceServiceOptions,
} from "../app/modules/proforma-invoice/application/proforma-invoice-service";
import {
  piSha256,
  type PiConditions,
} from "../app/modules/proforma-invoice/domain/proforma-invoice";
import { renderProformaInvoicePdf } from "../app/modules/proforma-invoice/domain/proforma-invoice-pdf";
import { createD1SellerCommercialSettingsRepository } from "../app/modules/seller-settings/infrastructure/d1-seller-commercial-settings-repository";
import {
  captureQuoteRequestProductSnapshot,
  type QuoteRequestSnapshot,
} from "../app/modules/quote-request/domain/quote-request";
import type { QuoteRevisionSnapshot } from "../app/modules/quote-review/domain/quote-revision";
import { commercialTotals } from "../app/modules/quote-review/domain/quote-commercial-terms";
import {
  commercialAddress,
  commercialTerms,
} from "./fixtures/quote-commercial";
import { publicHoseFixture } from "./fixtures/public-hose";
import {
  createPiPdfJobs,
  type PiPdfJob,
} from "../app/modules/proforma-invoice/application/pi-pdf-jobs";

const directory = mkdtempSync(join(tmpdir(), "pi-d1-"));
let platform: Awaited<
  ReturnType<
    typeof getPlatformProxy<{ DB: D1Database; PRIVATE_FILES: R2Bucket }>
  >
>;
let db: D1Database;
let bucket: R2Bucket;
const actor: AdminIdentity = {
  id: "pi-owner",
  email: "pi-owner@example.test",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
const issuedAt = "2026-09-14T10:00:00.000Z";
const conditions: PiConditions = {
  cancellation: {
    version: "test-cancel-v1",
    text: "Test-only cancellation terms supplied by configuration.",
  },
  refund: {
    version: "test-refund-v1",
    text: "Test-only refund terms supplied by configuration.",
  },
  generalAcknowledgement: {
    version: "test-ack-v1",
    text: "Test-only approval of the quoted specification.",
  },
  madeToOrderAcknowledgements: [],
};
const service = (
  options: ProformaInvoiceServiceOptions = {},
  database = db,
  storage = bucket,
) =>
  createProformaInvoiceService(database, storage, {
    conditions,
    now: () => new Date(issuedAt),
    ...options,
  });

beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{
    DB: D1Database;
    PRIVATE_FILES: R2Bucket;
  }>({
    configPath: "wrangler.jsonc",
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  bucket = platform.env.PRIVATE_FILES;
  expect(
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='proforma_invoices'",
      )
      .first(),
    "The registered migrations must create the PI tables",
  ).not.toBeNull();
  const settings = createD1SellerCommercialSettingsRepository(db);
  await settings.saveSellerIdentity({
    id: "pi-test-seller",
    actorId: actor.id,
    address: "1 Testing Road\nHangzhou, Zhejiang, China",
    commandId: crypto.randomUUID(),
    now: issuedAt,
  });
  for (const channel of ["bank_transfer", "paypal"] as const)
    await settings.savePaymentInstructions({
      id: `pi-test-${channel}`,
      actorId: actor.id,
      channel,
      instructions: `TEST ONLY ${channel}\nPayment reference required.`,
      commandId: crypto.randomUUID(),
      now: issuedAt,
    });
}, 60000);

afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

async function fixture(
  mutate?: (revision: QuoteRevisionSnapshot) => void,
  organization = false,
) {
  const id = crypto.randomUUID();
  const product = publicHoseFixture({
    catalogBasis: {
      generation: 4,
      skuRevisionId: "captured-sku",
      seriesRevisionId: "captured-series",
      mediaVersionId: "captured-image",
    },
    specs: [{ label: "Working pressure", value: "250 bar" }],
  });
  const source = {
    version: 2,
    submittedAt: "2026-09-14T08:00:00.000Z",
    destination: commercialAddress,
    acknowledgements: { version: "captured-rfq-ack" },
    amounts: { manualCommercialReview: true },
    importResponsibility: { fulfillmentTerm: "DDP", version: "captured-ddp" },
    purchasingContext: {
      kind: organization ? "organization" : "individual",
      legalName: "Test Buyer",
      tradeName: null,
      countryCode: "US",
      registrationOrTaxId: null,
      primaryContactName: "Test Buyer",
      primaryContactEmail: "buyer@example.test",
    },
    lines: [
      {
        id: "line-a",
        sku: product.sku,
        displayName: product.displayName,
        lineKind: "standard",
        quantity: 2,
        salesUnit: "EA",
        catalogReleaseId: product.releaseId,
        currency: "CNY",
        referenceUnitPrice: 99,
        productSnapshot: captureQuoteRequestProductSnapshot(product),
      },
    ],
  } as unknown as QuoteRequestSnapshot;
  const terms = commercialTerms();
  const prices = [{ unitPriceCents: 1500, discountBasisPoints: 1000 }];
  const revision: QuoteRevisionSnapshot = {
    version: 1,
    requestId: id,
    sourceHash: "captured-rfq-hash",
    source,
    preparationVersion: 3,
    revisionNumber: 1,
    prices,
    terms,
    totals: commercialTotals(source, prices, terms.charges),
    issuedAt: "2026-09-14T09:00:00.000Z",
    issuedBy: "PRIVATE-ADMIN-SENTINEL",
    factoryReviewConfirmed: true,
  };
  Object.assign(revision, {
    internalNotes: "PRIVATE-NOTE-SENTINEL",
    costBasis: "PRIVATE-COST-SENTINEL",
  });
  mutate?.(revision);
  const json = JSON.stringify(revision);
  const hash = await piSha256(new TextEncoder().encode(json));
  const quoteId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        id,
        `${id}@example.test`,
        `${id}@example.test`,
        issuedAt,
        issuedAt,
        issuedAt,
      ),
    ...(organization
      ? [
          db
            .prepare(
              "INSERT INTO customer_organizations(id,legal_name,country_code,created_at,updated_at) VALUES(?,'PI Test Organization','US',?,?)",
            )
            .bind(id, issuedAt, issuedAt),
          db
            .prepare(
              "INSERT INTO customer_purchasing_contexts(id,kind,organization_id,created_at,updated_at) VALUES(?,'organization',?,?,?)",
            )
            .bind(id, id, issuedAt, issuedAt),
        ]
      : [
          db
            .prepare(
              "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,created_at,updated_at) VALUES(?,'individual',?,?,?)",
            )
            .bind(id, id, issuedAt, issuedAt),
        ]),
    db
      .prepare(
        "INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at) VALUES(?,?,?,?,?,'1','address',?,'DDP','USD',0,0,?,?,?)",
      )
      .bind(
        id,
        `QR-${id}`,
        id,
        id,
        `session-${id}`,
        organization ? "organization" : "individual",
        id,
        JSON.stringify(source),
        source.submittedAt,
      ),
    db
      .prepare(
        "INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at) VALUES(?,?,1,3,?,?,?,'hash',?,?)",
      )
      .bind(
        quoteId,
        id,
        json,
        hash,
        crypto.randomUUID(),
        actor.id,
        revision.issuedAt,
      ),
  ]);
  const ready = await service().readiness(actor, id);
  const payment = ready.payments.find((p) => p.channel === "bank_transfer")!;
  const command: IssueProformaInvoiceCommand = {
    requestId: id,
    commandId: crypto.randomUUID(),
    quoteRevisionId: quoteId,
    quoteRevisionHash: hash,
    sellerIdentityId: ready.seller!.id,
    sellerVersion: ready.seller!.version,
    paymentChannel: "bank_transfer",
    paymentInstructionId: payment.id,
    paymentInstructionVersion: payment.version,
  };
  return { command, revision, json, profileId: id };
}

it("reserves without rendering and completes the same immutable intent on repeated delivery", async () => {
  const f = await fixture();
  const reservationService = service({
    renderPdf: async () => {
      throw new Error("Reservation must not render PDF bytes");
    },
  });
  const reserved = await reservationService.reserve(actor, f.command);
  expect(await reservationService.reserve(actor, f.command)).toEqual(reserved);
  expect(await service().adminCurrent(actor, f.command.requestId)).toBeNull();
  const completed = await service().renderReserved(reserved.commandId);
  expect(completed.id).toBe(reserved.piId);
  expect(await service().renderReserved(reserved.commandId)).toEqual(completed);
  expect(await service().issue(actor, f.command)).toEqual(completed);
  await expect(
    service().renderReserved(crypto.randomUUID()),
  ).rejects.toMatchObject({
    status: 404,
  });
});

it("durably dispatches PDF jobs and records completion before duplicate delivery", async () => {
  const f = await fixture();
  const reserved = await service().reserve(actor, f.command);
  const delivered: PiPdfJob[] = [];
  let renders = 0;
  const jobs = createPiPdfJobs(
    db,
    {
      send: async (body) => {
        delivered.push(body);
      },
    },
    async (id) => {
      renders++;
      return service().renderReserved(id);
    },
    () => new Date(issuedAt),
  );
  await jobs.dispatch();
  const message = delivered.find(
    (item) => item.commandId === reserved.commandId,
  )!;
  expect(message).toBeDefined();
  expect(await jobs.consume(message)).toBe(true);
  expect(await jobs.consume(message)).toBe(true);
  expect(renders).toBe(1);
  expect(
    await db
      .prepare("SELECT state FROM proforma_invoice_pdf_jobs WHERE command_id=?")
      .bind(reserved.commandId)
      .first(),
  ).toEqual({ state: "completed" });
});

it("retains failed PDF jobs for manual review after bounded retries", async () => {
  const f = await fixture();
  const reserved = await service().reserve(actor, f.command);
  let timestamp = new Date(issuedAt).getTime();
  const dispatched: PiPdfJob[] = [];
  const jobs = createPiPdfJobs(
    db,
    {
      send: async (job) => {
        dispatched.push(job);
      },
    },
    async () => {
      throw new Error("private renderer failure");
    },
    () => new Date(timestamp),
  );
  const message: PiPdfJob = { type: "pi-pdf", commandId: reserved.commandId };
  for (let attempt = 0; attempt < 5; attempt++) {
    await jobs.consume(message);
    timestamp += 3600000;
  }
  expect(
    await db
      .prepare(
        "SELECT state,attempts FROM proforma_invoice_pdf_jobs WHERE command_id=?",
      )
      .bind(reserved.commandId)
      .first(),
  ).toEqual({ state: "failed", attempts: 5 });
  await jobs.dispatch();
  expect(dispatched.some((job) => job.commandId === reserved.commandId)).toBe(
    false,
  );
  expect(await service().adminCurrent(actor, f.command.requestId)).toBeNull();
  await expect(
    service().retryPdf(actor, "other-request", reserved.commandId),
  ).rejects.toMatchObject({ status: 409 });
  await service().retryPdf(actor, f.command.requestId, reserved.commandId);
  expect(
    await db
      .prepare(
        "SELECT state,attempts FROM proforma_invoice_pdf_jobs WHERE command_id=?",
      )
      .bind(reserved.commandId)
      .first(),
  ).toEqual({ state: "pending", attempts: 0 });
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM admin_audit_events WHERE event_type='proforma_invoice.pdf_retry' AND entity_id=?",
      )
      .bind(reserved.piId)
      .first("n"),
  ).toBe(1);
});

it("resolves trusted conditions from captured lines once and preserves them on replay", async () => {
  const f = await fixture((revision) => {
    revision.source.lines[0].productSnapshot.offer!.madeToOrder = true;
  });
  let calls = 0;
  const resolved = service({
    conditions: (revision) => {
      calls++;
      expect(revision).toEqual(JSON.parse(f.json));
      const lineId = revision.source.lines[0].id;
      revision.prices[0].unitPriceCents = 1;
      return {
        ...conditions,
        madeToOrderAcknowledgements: [
          {
            lineId,
            version: "reviewed-made-to-order-v1",
            text: "Test-only reviewed made-to-order acknowledgement.",
          },
        ],
      };
    },
  });
  const pi = await resolved.issue(actor, f.command);
  expect(pi.snapshot.conditions.madeToOrderAcknowledgements[0].lineId).toBe(
    "line-a",
  );
  expect(pi.snapshot.lines[0].price.unitPriceCents).toBe(1500);
  expect(await resolved.issue(actor, f.command)).toEqual(pi);
  expect(calls).toBe(1);
  expect(
    await service({
      conditions: () => {
        throw new Error("Must not resolve policy on replay");
      },
    }).issue(actor, f.command),
  ).toEqual(pi);
});

it("issues immutable exact snapshots and private PDF once; keeps current selected instructions separate", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  expect(pi.snapshot.validUntil).toBe("2026-09-28T10:00:00.000Z");
  expect(pi.snapshot.lines[0].reference).toEqual({
    currency: "CNY",
    unitPrice: 99,
  });
  expect(pi.snapshot.lines[0].product.catalogBasis?.skuRevisionId).toBe(
    "captured-sku",
  );
  expect(pi.snapshot.conditions).toEqual(conditions);
  expect(pi.snapshot.totals).toEqual(f.revision.totals);
  expect(await service().issue(actor, f.command)).toEqual(pi);
  expect(
    await service({ conditions: undefined }).issue(actor, f.command),
  ).toEqual(pi);
  expect(
    await service({
      conditions: {
        ...conditions,
        refund: {
          version: "later-refund",
          text: "Later configured test terms.",
        },
      },
    }).issue(actor, f.command),
  ).toEqual(pi);
  expect(
    await service().customerCurrent(f.profileId, f.command.requestId),
  ).toEqual(pi);
  const download = await service().customerDownload(
    f.profileId,
    f.command.requestId,
    pi.id,
  );
  const originalBytes = new Uint8Array(await download.arrayBuffer());
  expect(await piSha256(originalBytes)).toBe(pi.pdf.sha256);
  expect(download.headers.get("Cache-Control")).toBe("private, no-store");
  const privateJson = await db
    .prepare(
      "SELECT source_revision_json FROM proforma_invoice_intents WHERE id=?",
    )
    .bind(pi.id)
    .first("source_revision_json");
  expect(privateJson).toBe(f.json);
  expect(JSON.stringify(pi)).not.toMatch(
    /PRIVATE-|pdf_object_key|source_revision_json|issued_by/,
  );
  await expect(
    db
      .prepare(
        "UPDATE proforma_invoices SET document_number='changed' WHERE id=?",
      )
      .bind(pi.id)
      .run(),
  ).rejects.toThrow(/immutable/);
  await expect(
    db.prepare("DELETE FROM proforma_invoices WHERE id=?").bind(pi.id).run(),
  ).rejects.toThrow(/immutable/);
  await expect(
    db
      .prepare(
        "UPDATE proforma_invoice_intents SET snapshot_json='{}' WHERE id=?",
      )
      .bind(pi.id)
      .run(),
  ).rejects.toThrow(/immutable/);
  const settings = createD1SellerCommercialSettingsRepository(db);
  await settings.savePaymentInstructions({
    id: crypto.randomUUID(),
    actorId: actor.id,
    channel: "bank_transfer",
    instructions: "TEST UPDATED BANK\nUse current instructions only.",
    commandId: crypto.randomUUID(),
    now: issuedAt,
  });
  const current = await service().customerRead(
    f.profileId,
    f.command.requestId,
    pi.id,
  );
  expect(current.paymentInstructions?.instructions).toContain(
    "TEST UPDATED BANK",
  );
  expect(current.snapshot).toEqual(pi.snapshot);
  expect(
    await (
      await service().customerDownload(f.profileId, f.command.requestId, pi.id)
    ).arrayBuffer(),
  ).toEqual(originalBytes.buffer);
  expect(JSON.stringify(current)).not.toContain("TEST ONLY paypal");
  expect(
    await db
      .prepare("SELECT count(*) n FROM admin_audit_events WHERE id=?")
      .bind(`pi-issued:${pi.id}`)
      .first("n"),
  ).toBe(1);
});

it("fails closed on missing policy configuration, invalid sources, actors, deadlines and commercial review", async () => {
  const f = await fixture();
  await expect(
    service().issue(undefined as unknown as AdminIdentity, f.command),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service({ conditions: undefined }).issue(actor, f.command),
  ).rejects.toThrow(/conditions configuration/);
  for (const patch of [
    { quoteRevisionId: "stale" },
    { sellerVersion: 1 },
    { paymentInstructionId: "stale" },
    { quoteRevisionHash: "changed" },
  ])
    await expect(
      service().issue(actor, { ...f.command, ...patch }),
    ).rejects.toMatchObject({ status: 409 });
  await expect(
    service().issue(actor, { ...f.command, validUntil: issuedAt }),
  ).rejects.toThrow(/future/);
  await expect(
    service().issue(actor, {
      ...f.command,
      validUntil: "2026-09-31T10:00:00.000Z",
    }),
  ).rejects.toThrow(/UTC/);
  const noPrice = await fixture((r) => {
    r.prices[0].unitPriceCents = null;
  });
  await expect(service().issue(actor, noPrice.command)).rejects.toThrow(
    /prices/,
  );
  const noConfirmation = await fixture((r) => {
    r.terms.manualCurrencyConfirmed = false;
  });
  await expect(service().issue(actor, noConfirmation.command)).rejects.toThrow(
    /USD/,
  );
  const noTaxEvidence = await fixture((r) => {
    r.terms.taxTreatment = "Exempt";
    r.terms.taxEvidenceId = "foreign-private-evidence";
  });
  await expect(
    service().issue(actor, noTaxEvidence.command),
  ).rejects.toMatchObject({ status: 409 });
  expect(await service().adminCurrent(actor, f.command.requestId)).toBeNull();
  const custom = await service().issue(actor, {
    ...f.command,
    validUntil: "2026-10-01T00:00:00.000Z",
  });
  expect(custom.snapshot.validUntil).toBe("2026-10-01T00:00:00.000Z");
});

it("rejects cross-owner and cross-quote reads/downloads and altered command replay", async () => {
  const f = await fixture();
  const other = await fixture();
  const pi = await service().issue(actor, f.command);
  await expect(
    service().customerRead(other.profileId, f.command.requestId, pi.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service().customerDownload(f.profileId, other.command.requestId, pi.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service().customerCurrent("", f.command.requestId),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service().issue({ ...actor, id: "another-admin" }, f.command),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    service().issue(actor, {
      ...f.command,
      validUntil: "2026-10-01T00:00:00.000Z",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    service().issue(actor, { ...f.command, commandId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
});

it("serializes identical and distinct concurrent issuance without conflicting authoritative PDFs", async () => {
  const f = await fixture();
  const [first, retry] = await Promise.all([
    service().issue(actor, f.command),
    service().issue(actor, f.command),
  ]);
  expect(first).toEqual(retry);
  const other = await fixture();
  const results = await Promise.allSettled([
    service().issue(actor, other.command),
    service().issue(actor, {
      ...other.command,
      commandId: crypto.randomUUID(),
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await db
      .prepare("SELECT count(*) n FROM proforma_invoices WHERE request_id=?")
      .bind(other.command.requestId)
      .first("n"),
  ).toBe(1);
});

it("rechecks current quote, seller and payment versions after rendering and R2 work", async () => {
  for (const changed of ["quote", "seller", "payment"] as const) {
    const f = await fixture();
    const racing = service({
      renderPdf: async (snapshot) => {
        const result = await renderProformaInvoicePdf(snapshot);
        if (changed === "quote") {
          const next = {
            ...f.revision,
            revisionNumber: 2,
            preparationVersion: 4,
          };
          const json = JSON.stringify(next);
          await db
            .prepare(
              "INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at) VALUES(?,?,2,4,?,?,?,'hash',?,?)",
            )
            .bind(
              crypto.randomUUID(),
              f.command.requestId,
              json,
              await piSha256(new TextEncoder().encode(json)),
              crypto.randomUUID(),
              actor.id,
              issuedAt,
            )
            .run();
        } else {
          const settings = createD1SellerCommercialSettingsRepository(db);
          if (changed === "seller")
            await settings.saveSellerIdentity({
              id: crypto.randomUUID(),
              actorId: actor.id,
              address: "2 Testing Road\nHangzhou, Zhejiang, China",
              commandId: crypto.randomUUID(),
              now: issuedAt,
            });
          else
            await settings.savePaymentInstructions({
              id: crypto.randomUUID(),
              actorId: actor.id,
              channel: "bank_transfer",
              instructions: "TEST RACING BANK\nNew payment version.",
              commandId: crypto.randomUUID(),
              now: issuedAt,
            });
        }
        return result;
      },
    });
    await expect(racing.issue(actor, f.command)).rejects.toMatchObject({
      status: 409,
    });
    expect(await service().adminCurrent(actor, f.command.requestId)).toBeNull();
  }
});

it("recovers uncertain R2/D1 success without deleting live PDF bytes", async () => {
  const f = await fixture();
  let failPut = true;
  const uncertainBucket = new Proxy(bucket, {
    get(target, key) {
      if (key === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          const result = await target.put(...args);
          if (failPut) {
            failPut = false;
            throw new Error("lost R2 response");
          }
          return result;
        };
      if (key === "delete")
        return () => {
          throw new Error("Must not delete potentially live bytes");
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let failCommit = true;
  const uncertainDb = new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (failCommit) {
            failCommit = false;
            throw new Error("lost D1 response");
          }
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const pi = await service({}, uncertainDb, uncertainBucket).issue(
    actor,
    f.command,
  );
  expect(await service().issue(actor, f.command)).toEqual(pi);
  expect(
    await (
      await service().customerDownload(f.profileId, f.command.requestId, pi.id)
    ).arrayBuffer(),
  ).toHaveProperty("byteLength", pi.pdf.byteSize);
});

it("uses current organization ownership and rechecks permission after fetching PDF bytes", async () => {
  const f = await fixture(undefined, true);
  const primary = await fixture();
  await db.batch([
    db
      .prepare(
        "INSERT INTO customer_organization_memberships(id,organization_id,profile_id,role,status,created_at) VALUES(?,?,?,'primary_contact','active',?)",
      )
      .bind(crypto.randomUUID(), f.profileId, primary.profileId, issuedAt),
    db
      .prepare(
        "INSERT INTO customer_profile_purchasing_context_access(profile_id,context_id,created_at) VALUES(?,?,?)",
      )
      .bind(primary.profileId, f.profileId, issuedAt),
  ]);
  const pi = await service().issue(actor, f.command);
  await expect(
    service().customerRead(f.profileId, f.command.requestId, pi.id),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (
      await service().customerRead(
        primary.profileId,
        f.command.requestId,
        pi.id,
      )
    ).id,
  ).toBe(pi.id);
  const revokingBucket = new Proxy(bucket, {
    get(target, key) {
      if (key === "get")
        return async (path: string) => {
          const result = await target.get(path);
          await db
            .prepare(
              "DELETE FROM customer_profile_purchasing_context_access WHERE profile_id=? AND context_id=?",
            )
            .bind(primary.profileId, f.profileId)
            .run();
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    service({}, db, revokingBucket).customerDownload(
      primary.profileId,
      f.command.requestId,
      pi.id,
    ),
  ).rejects.toMatchObject({ status: 404 });
});

it("rolls back PI, current pointer and audit together; retries preserve intent identity and issue time", async () => {
  const f = await fixture();
  await db
    .prepare(
      "CREATE TRIGGER pi_test_audit_failure BEFORE INSERT ON admin_audit_events WHEN NEW.event_type='proforma_invoice.issued' BEGIN SELECT RAISE(ABORT,'test audit failure'); END",
    )
    .run();
  try {
    await expect(service().issue(actor, f.command)).rejects.toThrow(
      /test audit failure/,
    );
    expect(
      await db
        .prepare("SELECT count(*) n FROM proforma_invoices WHERE request_id=?")
        .bind(f.command.requestId)
        .first("n"),
    ).toBe(0);
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM proforma_invoice_heads WHERE request_id=?",
        )
        .bind(f.command.requestId)
        .first("n"),
    ).toBe(0);
  } finally {
    await db.prepare("DROP TRIGGER pi_test_audit_failure").run();
  }
  const pi = await service({
    now: () => new Date("2026-09-15T10:00:00.000Z"),
  }).issue(actor, f.command);
  expect(pi.snapshot.issuedAt).toBe(issuedAt);
  expect(pi.snapshot.validUntil).toBe("2026-09-28T10:00:00.000Z");
  expect(pi.id).toBe(
    `pi-${await piSha256(new TextEncoder().encode(f.command.commandId))}`,
  );
});

it("detects PDF tampering and never overwrites a content-addressed object on retry", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  const key = await db
    .prepare("SELECT pdf_object_key FROM proforma_invoices WHERE id=?")
    .bind(pi.id)
    .first<string>("pdf_object_key");
  const object = await bucket.get(key!);
  const original = new Uint8Array(await object!.arrayBuffer());
  const changed = original.slice();
  changed[changed.length - 1] ^= 1;
  await bucket.put(key!, changed);
  await expect(
    service().customerDownload(f.profileId, f.command.requestId, pi.id),
  ).rejects.toMatchObject({ status: 409 });
  await service().issue(actor, f.command);
  expect(
    await piSha256(
      new Uint8Array(await (await bucket.get(key!))!.arrayBuffer()),
    ),
  ).not.toBe(pi.pdf.sha256);
  await bucket.put(key!, original);
});

it("rejects changed domain readiness and missing or invalid current seller/payment data before publication", async () => {
  for (const mutate of [
    (r: QuoteRevisionSnapshot) => {
      r.terms.addressConfirmed = false;
    },
    (r: QuoteRevisionSnapshot) => {
      r.terms.leadTime = "";
    },
    (r: QuoteRevisionSnapshot) => {
      r.terms.taxTreatment = "unknown" as typeof r.terms.taxTreatment;
    },
    (r: QuoteRevisionSnapshot) => {
      r.factoryReviewConfirmed = false;
      Object.assign(r.source.lines[0], {
        quotedSpecificationOverrides: [
          { label: "Marking", value: "Test marking" },
        ],
      });
    },
  ]) {
    const f = await fixture(mutate);
    await expect(service().issue(actor, f.command)).rejects.toThrow();
    expect(await service().adminCurrent(actor, f.command.requestId)).toBeNull();
  }
  const f = await fixture();
  const settings = createD1SellerCommercialSettingsRepository(db);
  const next = crypto.randomUUID();
  await settings.saveSellerIdentity({
    id: next,
    actorId: actor.id,
    address: "PLACEHOLDER address China",
    commandId: crypto.randomUUID(),
    now: issuedAt,
  });
  await expect(
    service().issue(actor, {
      ...f.command,
      sellerIdentityId: next,
      sellerVersion: f.command.sellerVersion + 1,
    }),
  ).rejects.toThrow(/seller/);
  await settings.saveSellerIdentity({
    id: crypto.randomUUID(),
    actorId: actor.id,
    address: "3 Testing Road\nHangzhou, Zhejiang, China",
    commandId: crypto.randomUUID(),
    now: issuedAt,
  });
  const g = await fixture();
  const badPayment = crypto.randomUUID();
  await settings.savePaymentInstructions({
    id: badPayment,
    actorId: actor.id,
    channel: "bank_transfer",
    instructions: "PLACEHOLDER INSTRUCTIONS",
    commandId: crypto.randomUUID(),
    now: issuedAt,
  });
  await expect(
    service().issue(actor, {
      ...g.command,
      paymentInstructionId: badPayment,
      paymentInstructionVersion: g.command.paymentInstructionVersion + 1,
    }),
  ).rejects.toThrow(/Payment Instructions/);
  await settings.savePaymentInstructions({
    id: crypto.randomUUID(),
    actorId: actor.id,
    channel: "bank_transfer",
    instructions: "TEST RESTORED BANK\nPayment reference required.",
    commandId: crypto.randomUUID(),
    now: issuedAt,
  });
});
