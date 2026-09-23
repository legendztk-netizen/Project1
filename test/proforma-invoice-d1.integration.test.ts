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
import { createPiPaymentService } from "../app/modules/proforma-invoice/application/pi-payment-service";
import { createPiAcceptanceService } from "../app/modules/proforma-invoice/application/pi-acceptance-service";
import { createPiLatePaymentService } from "../app/modules/proforma-invoice/application/pi-late-payment-service";
import { createConfirmedOrderService } from "../app/modules/proforma-invoice/application/confirmed-order-service";
import { createPiFundResolutionService } from "../app/modules/proforma-invoice/application/pi-fund-resolution-service";
import { createPiPaymentCorrectionService } from "../app/modules/proforma-invoice/application/pi-payment-correction-service";
import { createFollowOnQuoteService } from "../app/modules/proforma-invoice/application/follow-on-quote-service";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { createD1CustomerIdentityRepository } from "../app/modules/customer-identity/infrastructure/d1-customer-identity-repository";
import {
  createCustomerSessionCookie,
  digestCustomerSessionToken,
  generateCustomerSessionToken,
} from "../app/modules/customer-identity/domain/customer-session";
import { customerIdentitySigningKey } from "#workers/session-secrets";
import type { ApplicationBindings } from "#workers/environment";
import { createCustomerAccountService } from "../app/modules/customer-identity/application/customer-account-service";
import { createAnonymousQuoteListService } from "../app/modules/quote-list/application/anonymous-quote-list-service";
import { createQuoteRequestService } from "../app/modules/quote-request/application/quote-request-service";
import { orderCreationStatements } from "../app/modules/proforma-invoice/infrastructure/d1-order-creation";
import { createPiAcceptedAgreementService } from "../app/modules/proforma-invoice/application/pi-accepted-agreement-service";
import { createD1ProformaInvoiceRepository } from "../app/modules/proforma-invoice/infrastructure/d1-proforma-invoice-repository";
import { createPiLifecycleService } from "../app/modules/proforma-invoice/application/pi-lifecycle-service";
import { createD1AdminQuoteReviewRepository } from "../app/modules/quote-review/infrastructure/d1-admin-quote-review-repository";
import { createShipmentPlanService } from "../app/modules/shipment/application/shipment-plan-service";

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
  existingProfileId?: string,
) {
  const id = crypto.randomUUID();
  const profileId = existingProfileId ?? id;
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
    ...(!existingProfileId
      ? [
          db
            .prepare(
              "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            )
            .bind(
              profileId,
              `${profileId}@example.test`,
              `${profileId}@example.test`,
              issuedAt,
              issuedAt,
              issuedAt,
            ),
        ]
      : []),
    ...(existingProfileId
      ? []
      : organization
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
        profileId,
        profileId,
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
  return { command, revision, json, profileId };
}

async function acceptFixturePi(
  profileId: string,
  requestId: string,
  pi: Awaited<ReturnType<ReturnType<typeof service>["issue"]>>,
) {
  const acceptedAt = "2026-09-14T11:00:00.000Z";
  const acceptance = createPiAcceptanceService(db, bucket, {
    now: () => new Date(acceptedAt),
  });
  const target = {
    piId: pi.id,
    documentVersion: pi.snapshot.documentVersion,
    snapshotHash: pi.snapshotHash,
  };
  const viewed = await acceptance.customerView(
    profileId,
    requestId,
    target,
    "view",
    { requestId: "test-view", ipAddress: null, userAgent: null },
  );
  await acceptance.accept(
    profileId,
    new Request("https://shop.test/account/quotes/accept", {
      method: "POST",
      headers: { Origin: "https://shop.test" },
    }),
    {
      ...target,
      requestId,
      commandId: crypto.randomUUID(),
      viewId: viewed.view.id,
      legalName: "Test Buyer",
      acknowledgements: {
        general: {
          version: conditions.generalAcknowledgement.version,
          confirmed: true,
        },
        madeToOrder: [],
      },
    },
    { requestId: "test-accept", ipAddress: null, userAgent: null },
  );
}

async function legacyFixturePi(f: Awaited<ReturnType<typeof fixture>>) {
  await service().reserve(actor, f.command);
  const repository = createD1ProformaInvoiceRepository(db);
  const original = (await repository.intent(f.command.commandId))!;
  const snapshot = JSON.parse(original.snapshot_json);
  delete snapshot.paymentTerms;
  const json = JSON.stringify(snapshot);
  const intent = {
    ...original,
    id: crypto.randomUUID(),
    command_id: crypto.randomUUID(),
    snapshot_json: json,
    snapshot_hash: await piSha256(new TextEncoder().encode(json)),
  };
  // Seed a genuine old-format immutable document, without modifying any published PI.
  await repository.reserve(intent);
  return service().renderReserved(intent.command_id);
}

async function retainCommand(piId: string) {
  const ready = await createPiAcceptedAgreementService(db).readiness(
    actor,
    piId,
  );
  return {
    piId,
    commandId: crypto.randomUUID(),
    expectedVersion: ready.paymentVersion,
    expectedHeadVersion: ready.headVersion,
    acceptanceId: ready.acceptanceId!,
    documentVersion: ready.documentVersion,
    snapshotHash: ready.snapshotHash,
    latestQuoteRevisionId: ready.latestQuoteRevisionId,
    reviewed: true,
    noPaymentDeadline: ready.noPaymentDeadline,
    reason: "Accidental terms save; retain accepted agreement",
  };
}

async function nextQuote(
  f: Awaited<ReturnType<typeof fixture>>,
  number: number,
) {
  const json = JSON.stringify({
    ...f.revision,
    revisionNumber: number,
    preparationVersion: number + 2,
  });
  await db
    .prepare(
      `INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,
    snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at) VALUES(?,?,?,?,?,?,?,'hash',?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      f.command.requestId,
      number,
      number + 2,
      json,
      await piSha256(new TextEncoder().encode(json)),
      crypto.randomUUID(),
      actor.id,
      issuedAt,
    )
    .run();
}

it("retains an accepted legacy PI without inventing a deadline or clearing funds", async () => {
  const f = await fixture();
  const pi = await legacyFixturePi(f);
  await acceptFixturePi(f.profileId, f.command.requestId, pi);
  const agreements = createPiAcceptedAgreementService(db);
  const payments = createPiPaymentService(db, {
    now: () => new Date("2026-11-01T10:00:00.000Z"),
  });
  const before = await payments.adminRead(actor, pi.id);
  const original = await db
    .prepare("SELECT * FROM proforma_invoices WHERE id=?")
    .bind(pi.id)
    .first();
  const accepted = await db
    .prepare("SELECT * FROM pi_acceptances WHERE pi_id=?")
    .bind(pi.id)
    .first();
  const command = await retainCommand(pi.id);
  for (const invalid of [
    { reviewed: false },
    { noPaymentDeadline: false },
    { acceptanceId: "wrong" },
    { expectedVersion: 999 },
  ]) {
    await expect(
      agreements.retain(actor, { ...command, ...invalid }),
    ).rejects.toBeInstanceOf(Response);
  }
  await agreements.retain(actor, command);
  await agreements.retain(actor, command);
  await expect(
    agreements.retain(actor, { ...command, reason: "different" }),
  ).rejects.toMatchObject({ status: 409 });
  const retained = await payments.adminRead(actor, pi.id);
  expect(retained).toMatchObject({
    dueAt: null,
    paymentDeadlineUnspecified: true,
    acceptedAgreementRetained: true,
    paymentConfirmed: false,
    orderId: null,
    amountReceivedCents: before.amountReceivedCents,
    version: before.version + 1,
  });
  expect(
    await db
      .prepare("SELECT * FROM proforma_invoices WHERE id=?")
      .bind(pi.id)
      .first(),
  ).toEqual(original);
  expect(
    await db
      .prepare("SELECT * FROM pi_acceptances WHERE pi_id=?")
      .bind(pi.id)
      .first(),
  ).toEqual(accepted);
  await expect(
    payments.confirmPayment(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: retained.version,
      externallyVerified: true,
      externalReference: "Not fully paid",
    }),
  ).rejects.toMatchObject({ status: 409 });
  const funded = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: retained.version,
    amount: (retained.totalDueCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Verified bank funds",
  });
  await expect(
    payments.confirmPayment(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: funded.version,
      externallyVerified: false,
      externalReference: "Unverified",
    }),
  ).rejects.toMatchObject({ status: 400 });
  await payments.confirmPayment(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: funded.version,
    externallyVerified: true,
    externalReference: "Verified bank funds",
  });
  const order = await db
    .prepare("SELECT snapshot_hash FROM confirmed_orders WHERE pi_id=?")
    .bind(pi.id)
    .first();
  expect(order).toEqual({ snapshot_hash: pi.snapshotHash });
  expect((await payments.adminRead(actor, pi.id)).dueAt).toBeNull();
  await expect(
    db
      .prepare("DELETE FROM pi_accepted_agreement_reviews WHERE pi_id=?")
      .bind(pi.id)
      .run(),
  ).rejects.toThrow("immutable");
});

it("binds retention to the reviewed quote head and preserves dated payment deadlines", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  const agreements = createPiAcceptedAgreementService(db);
  expect((await agreements.readiness(actor, pi.id)).blockedReason).toContain(
    "尚未接受",
  );
  await expect(
    agreements.retain(actor, await retainCommand(pi.id)),
  ).rejects.toMatchObject({ status: 409 });
  await acceptFixturePi(f.profileId, f.command.requestId, pi);
  const payments = createPiPaymentService(db, {
    now: () => new Date("2026-09-15T12:00:00.000Z"),
  });
  const original = await payments.adminRead(actor, pi.id);
  const stale = await retainCommand(pi.id);
  await nextQuote(f, 2);
  await expect(agreements.retain(actor, stale)).rejects.toMatchObject({
    status: 409,
  });
  expect((await payments.adminRead(actor, pi.id)).quoteReviewRequired).toBe(
    true,
  );
  await agreements.retain(actor, await retainCommand(pi.id));
  expect(await payments.adminRead(actor, pi.id)).toMatchObject({
    dueAt: original.dueAt,
    paymentDeadlineUnspecified: false,
    quoteReviewRequired: false,
  });
  const lifecycle = createPiLifecycleService(db, bucket, { conditions });
  expect(
    (await lifecycle.replacementReadiness(actor, f.command.requestId)).lifecycle
      .awaitingReplacement,
  ).toBe(false);
  await nextQuote(f, 3);
  expect(await payments.adminRead(actor, pi.id)).toMatchObject({
    acceptedAgreementRetained: false,
    quoteReviewRequired: true,
  });
  await agreements.retain(actor, await retainCommand(pi.id));
  const retained = await payments.adminRead(actor, pi.id);
  const funded = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: retained.version,
    amount: (retained.totalDueCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Bank",
  });
  await expect(
    createPiPaymentService(db, {
      now: () => new Date("2026-11-01T10:00:00.000Z"),
    }).confirmPayment(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: funded.version,
      externallyVerified: true,
      externalReference: "Late funds",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await payments.confirmPayment(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: funded.version,
    externallyVerified: true,
    externalReference: "Bank",
  });
  expect((await payments.adminRead(actor, pi.id)).orderId).toBeTruthy();
});

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

it("records exact cumulative USD receipts with guarded versions and no payment confirmation", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  const payments = createPiPaymentService(db, {
    now: () => new Date(issuedAt),
    auditIp: "203.0.113.10",
  });
  const initial = await payments.adminRead(actor, pi.id);
  expect(initial.amountReceivedCents).toBe(0);
  expect(initial.termKind).toBe("ten_us_business_days");
  expect(initial.dueAt).toBeNull();
  await expect(
    payments.customerRead("other", f.command.requestId, pi.id),
  ).rejects.toMatchObject({ status: 404 });
  const commandId = crypto.randomUUID();
  const received = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId,
    expectedVersion: initial.version,
    amount: "7.01",
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Bank settlement test 42",
  });
  expect(received.amountReceivedCents).toBe(701);
  expect(received.balanceCents).toBe(pi.snapshot.totals.totalCents - 701);
  expect(received.paymentConfirmed).toBe(false);
  const audit = await db
    .prepare(
      "SELECT payload_json FROM admin_audit_events WHERE event_type='pi.amount_received_updated' AND entity_id=?",
    )
    .bind(pi.id)
    .first<{ payload_json: string }>();
  expect(JSON.parse(audit!.payload_json)).toMatchObject({
    requestId: f.command.requestId,
    commandId,
    ipAddress: "203.0.113.10",
  });
  expect(
    await payments.updateReceived(actor, {
      piId: pi.id,
      commandId,
      expectedVersion: initial.version,
      amount: "7.01",
      currency: "USD",
      actualChannel: "bank_transfer",
      verificationReference: "Bank settlement test 42",
    }),
  ).toEqual(received);
  await expect(
    payments.updateReceived(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: initial.version,
      amount: "8.00",
      currency: "USD",
      actualChannel: "bank_transfer",
      verificationReference: "Bank settlement test 43",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    payments.updateReceived(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: received.version,
      amount: "7.001",
      currency: "USD",
      actualChannel: "bank_transfer",
      verificationReference: "Invalid precision",
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    payments.updateReceived(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: received.version,
      amount: "0.00",
      currency: "USD",
      actualChannel: "bank_transfer",
      verificationReference: "Corrected settlement",
    }),
  ).rejects.toMatchObject({ status: 400 });
  const corrected = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: received.version,
    amount: "0.00",
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Corrected settlement",
    reason: "Bank reversal verified",
  });
  expect(corrected.amountReceivedCents).toBe(0);
  await expect(
    payments.changeInstructions(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: corrected.version,
      instructionId: "pi-test-paypal",
      instructionVersion: 1,
      channel: "paypal",
      reason: "Customer request",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM pi_payment_events WHERE pi_id=? AND kind='amount_received'",
      )
      .bind(pi.id)
      .first("n"),
  ).toBe(2);
  await payments.recordOriginalCurrencyReceipt(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    currency: "JPY",
    amount: "500",
    actualChannel: "bank_transfer",
    verificationReference: "Unexpected JPY settlement",
  });
  await expect(
    payments.recordOriginalCurrencyReceipt(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      currency: "JPY",
      amount: "500.10",
      actualChannel: "bank_transfer",
      verificationReference: "Invalid JPY precision",
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(
    (await payments.adminRead(actor, pi.id)).originalCurrencyReceipts,
  ).toMatchObject([{ currency: "JPY", amount: "500" }]);
  const foreign = (await payments.adminRead(actor, pi.id))
    .originalCurrencyReceipts[0];
  const refunds = createPiFundResolutionService(db, {
    now: () => new Date(issuedAt),
  });
  const foreignRefund = {
    piId: pi.id,
    receiptId: foreign.id,
    commandId: crypto.randomUUID(),
    amount: "200",
    customerAuthorization: "Customer email authorization 4",
    externalReference: "Completed JPY return 4",
  };
  expect(await refunds.refundOriginalCurrency(actor, foreignRefund)).toEqual({
    recorded: true,
  });
  await expect(
    refunds.refundOriginalCurrency(actor, {
      ...foreignRefund,
      piId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await refunds.refundOriginalCurrency(actor, foreignRefund)).toEqual({
    recorded: true,
  });
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM quote_conversation_messages WHERE request_id=? AND id LIKE 'original-currency-refund:%'",
      )
      .bind(f.command.requestId)
      .first("n"),
  ).toBe(1);
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM quote_notification_outbox WHERE message_id LIKE 'original-currency-refund:%'",
      )
      .first("n"),
  ).toBeGreaterThanOrEqual(1);
  await expect(
    refunds.refundOriginalCurrency(actor, {
      ...foreignRefund,
      commandId: crypto.randomUUID(),
      amount: "301",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await payments.customerRead(f.profileId, f.command.requestId, pi.id))
      .amountReceivedCents,
  ).toBe(0);
});

it("freezes the default payment deadline exactly once on website acceptance", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  const acceptedAt = "2026-09-14T11:00:00.000Z";
  const acceptance = createPiAcceptanceService(db, bucket, {
    now: () => new Date(acceptedAt),
  });
  const target = {
    piId: pi.id,
    documentVersion: pi.snapshot.documentVersion,
    snapshotHash: pi.snapshotHash,
  };
  const viewed = await acceptance.customerView(
    f.profileId,
    f.command.requestId,
    target,
    "view",
    { requestId: "test-view", ipAddress: null, userAgent: null },
  );
  const viewId = viewed.view.id;
  const commandId = crypto.randomUUID();
  const accepted = await acceptance.accept(
    f.profileId,
    new Request("https://shop.test/account/quotes/accept", {
      method: "POST",
      headers: { Origin: "https://shop.test" },
    }),
    {
      ...target,
      requestId: f.command.requestId,
      commandId,
      viewId,
      legalName: "Test Buyer",
      acknowledgements: {
        general: {
          version: conditions.generalAcknowledgement.version,
          confirmed: true,
        },
        madeToOrder: [],
      },
    },
    { requestId: "test-accept", ipAddress: null, userAgent: null },
  );
  expect(accepted.status).toBe("PI Accepted");
  const payment = await createPiPaymentService(db).adminRead(actor, pi.id);
  expect(payment.dueDateEt).toBe("2026-09-28");
  expect(payment.dueAt).toBe("2026-09-29T03:59:00.000Z");
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM pi_payment_events WHERE pi_id=? AND kind='deadline_frozen'",
      )
      .bind(pi.id)
      .first("n"),
  ).toBe(1);
  const payments = createPiPaymentService(db, {
    now: () => new Date(acceptedAt),
  });
  const account = await payments.adminRead(actor, pi.id);
  const funded = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: account.version,
    amount: (pi.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Bank net settlement",
  });
  expect(
    await db
      .prepare("SELECT id FROM confirmed_orders WHERE pi_id=?")
      .bind(pi.id)
      .first(),
  ).toBeNull();
  const reviews = createD1AdminQuoteReviewRepository(db);
  expect((await reviews.find(f.command.requestId))?.reviewState).toBe(
    "pi_accepted",
  );
  const confirmCommand = {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: funded.version,
    externallyVerified: true,
    externalReference: "Seller account statement 17",
  };
  const confirmed = await payments.confirmPayment(actor, confirmCommand);
  expect(confirmed.order?.id).toBe(`order:${pi.id}`);
  expect(await reviews.find(f.command.requestId)).toMatchObject({
    reviewState: "order_created",
    orderId: confirmed.order?.id,
  });
  expect(await payments.confirmPayment(actor, confirmCommand)).toEqual(
    confirmed,
  );
  const plan = createShipmentPlanService(db);
  const customerPlan = await plan.customerRead(
    f.profileId,
    confirmed.order!.id,
  );
  expect(customerPlan).toMatchObject({
    status: "ready",
    shipments: [
      {
        status: "planned",
        allocations: [{ lineId: "line-a", physicalQuantity: 2 }],
      },
    ],
  });
  expect(JSON.stringify(customerPlan)).not.toContain("reviewNote");
  await expect(
    plan.customerRead("different-profile", confirmed.order!.id),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    await db
      .prepare("SELECT count(*) n FROM order_shipments WHERE order_id=?")
      .bind(confirmed.order!.id)
      .first("n"),
  ).toBe(1);
  expect(
    await db
      .prepare("SELECT count(*) n FROM confirmed_order_lines WHERE order_id=?")
      .bind(confirmed.order!.id)
      .first("n"),
  ).toBe(1);
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM order_fulfillment_initializations WHERE order_id=?",
      )
      .bind(confirmed.order!.id)
      .first("n"),
  ).toBe(1);
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM order_assembly_production_initializations WHERE order_id=?",
      )
      .bind(confirmed.order!.id)
      .first("n"),
  ).toBe(0);
});

it("creates exactly the accepted split shipments after payment and acceptance", async () => {
  const f = await fixture((revision) => {
    revision.terms.shipmentMode = "split";
    revision.terms.splitPlan = "One item in each of two dispatches";
    revision.terms.shipmentGroups = [
      {
        id: "first",
        label: "First dispatch",
        allocations: [{ lineId: "line-a", physicalQuantity: 1 }],
        freightCents: 1200,
        insuranceCents: 60,
        dutiesImportCents: 200,
        transportMethod: "Air freight",
        incoterm: "DDP",
        namedPlace: "New York, US",
      },
      {
        id: "second",
        label: "Second dispatch",
        allocations: [{ lineId: "line-a", physicalQuantity: 1 }],
        freightCents: 800,
        insuranceCents: 40,
        dutiesImportCents: 100,
        transportMethod: "Air freight",
        incoterm: "DDP",
        namedPlace: "New York, US",
      },
    ];
  });
  const pi = await service().issue(actor, f.command);
  const acceptedAt = "2026-09-14T11:00:00.000Z";
  const payments = createPiPaymentService(db, {
    now: () => new Date(acceptedAt),
  });
  const account = await payments.adminRead(actor, pi.id);
  const funded = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: account.version,
    amount: (pi.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Split plan settlement",
  });
  await payments.confirmPayment(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: funded.version,
    externallyVerified: true,
    externalReference: "Split plan bank statement",
  });
  const acceptance = createPiAcceptanceService(db, bucket, {
    now: () => new Date(acceptedAt),
  });
  const target = {
    piId: pi.id,
    documentVersion: pi.snapshot.documentVersion,
    snapshotHash: pi.snapshotHash,
  };
  const viewed = await acceptance.customerView(
    f.profileId,
    f.command.requestId,
    target,
    "view",
    { requestId: "split-view", ipAddress: null, userAgent: null },
  );
  await acceptance.accept(
    f.profileId,
    new Request("https://shop.test/account/quotes/accept", {
      method: "POST",
      headers: { Origin: "https://shop.test" },
    }),
    {
      ...target,
      requestId: f.command.requestId,
      commandId: crypto.randomUUID(),
      viewId: viewed.view.id,
      legalName: "Test Buyer",
      acknowledgements: {
        general: {
          version: conditions.generalAcknowledgement.version,
          confirmed: true,
        },
        madeToOrder: [],
      },
    },
    { requestId: "split-accept", ipAddress: null, userAgent: null },
  );
  const orderId = `order:${pi.id}`;
  const plan = await createShipmentPlanService(db).customerRead(
    f.profileId,
    orderId,
  );
  expect(plan.status).toBe("ready");
  expect(
    plan.shipments.map((shipment) => ({
      key: shipment.groupKey,
      quantity: shipment.allocations[0].physicalQuantity,
      freightCents: shipment.freightCents,
    })),
  ).toEqual([
    { key: "first", quantity: 1, freightCents: 1200 },
    { key: "second", quantity: 1, freightCents: 800 },
  ]);
  expect(plan.originalCharges.freight).toBe(2000);
});

it("holds confirmed funds until website acceptance then creates the same single order", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  const eventTime = "2026-09-14T11:00:00.000Z";
  const payments = createPiPaymentService(db, {
    now: () => new Date(eventTime),
  });
  const initial = await payments.adminRead(actor, pi.id);
  const funded = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: initial.version,
    amount: (pi.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Bank net settlement",
  });
  const confirmed = await payments.confirmPayment(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: funded.version,
    externallyVerified: true,
    externalReference: "Bank statement payment-first",
  });
  expect(confirmed.order).toBeNull();
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM quote_conversation_messages WHERE request_id=? AND body LIKE '%review and accept%'",
      )
      .bind(f.command.requestId)
      .first("n"),
  ).toBe(1);
  const acceptance = createPiAcceptanceService(db, bucket, {
    now: () => new Date(eventTime),
  });
  const target = {
    piId: pi.id,
    documentVersion: pi.snapshot.documentVersion,
    snapshotHash: pi.snapshotHash,
  };
  const viewed = await acceptance.customerView(
    f.profileId,
    f.command.requestId,
    target,
    "view",
    { requestId: "test-view", ipAddress: null, userAgent: null },
  );
  await acceptance.accept(
    f.profileId,
    new Request("https://shop.test/account/quotes/accept", {
      method: "POST",
      headers: { Origin: "https://shop.test" },
    }),
    {
      ...target,
      requestId: f.command.requestId,
      commandId: crypto.randomUUID(),
      viewId: viewed.view.id,
      legalName: "Test Buyer",
      acknowledgements: {
        general: {
          version: conditions.generalAcknowledgement.version,
          confirmed: true,
        },
        madeToOrder: [],
      },
    },
    { requestId: "test-accept", ipAddress: null, userAgent: null },
  );
  const order = await db
    .prepare(
      "SELECT id,acceptance_id,confirmation_id FROM confirmed_orders WHERE pi_id=?",
    )
    .bind(pi.id)
    .first<{ id: string; acceptance_id: string; confirmation_id: string }>();
  expect(order?.id).toBe(`order:${pi.id}`);
  expect(
    await db
      .prepare("SELECT count(*) n FROM confirmed_orders WHERE request_id=?")
      .bind(f.command.requestId)
      .first("n"),
  ).toBe(1);
  expect(
    await db
      .prepare("SELECT count(*) n FROM confirmed_order_lines WHERE order_id=?")
      .bind(order!.id)
      .first("n"),
  ).toBe(1);
});

it("changes a current PI's selected instructions only before any receipt", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  const payments = createPiPaymentService(db, {
    now: () => new Date(issuedAt),
  });
  const initial = await payments.adminRead(actor, pi.id);
  const choice = (
    await service().readiness(actor, f.command.requestId)
  ).payments.find((p) => p.channel === "paypal")!;
  const changed = await payments.changeInstructions(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: initial.version,
    instructionId: choice.id,
    instructionVersion: choice.version,
    channel: "paypal",
    reason: "Customer approved PayPal",
  });
  expect(changed.instructionChannel).toBe("paypal");
  const customerPi = await service().customerRead(
    f.profileId,
    f.command.requestId,
    pi.id,
  );
  expect(customerPi.paymentInstructions?.channel).toBe("paypal");
  expect(customerPi.snapshot.paymentSelection.channel).toBe("bank_transfer");
  await payments.recordOriginalCurrencyReceipt(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    currency: "EUR",
    amount: "25.00",
    actualChannel: "paypal",
    verificationReference: "Original-currency receipt before USD settlement",
  });
  const afterOriginal = await payments.adminRead(actor, pi.id);
  expect(afterOriginal.amountReceivedCents).toBe(0);
  expect(afterOriginal.hasEverReceived).toBe(true);
  await expect(
    payments.changeInstructions(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: afterOriginal.version,
      instructionId: initial.instructionId!,
      instructionVersion: initial.instructionVersion!,
      channel: "bank_transfer",
      reason: "Should remain locked after an original-currency receipt",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await payments.adminRead(actor, pi.id)).instructionId).toBe(
    choice.id,
  );
});

it("extends accepted deadlines without clearing funds or creating an order, then approves late funds atomically", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  await acceptFixturePi(f.profileId, f.command.requestId, pi);
  const payments = createPiPaymentService(db, {
    now: () => new Date("2026-10-01T10:00:00.000Z"),
  });
  const before = await payments.adminRead(actor, pi.id);
  const extension = createPiLatePaymentService(db, {
    now: () => new Date("2026-09-30T10:00:00.000Z"),
  });
  const commandId = crypto.randomUUID();
  const extended = await extension.extend(actor, {
    piId: pi.id,
    commandId,
    expectedVersion: before.version,
    newDateEt: "2026-10-05",
    reason: "Customer shipping review",
  });
  expect(extended.dueDateEt).toBe("2026-10-05");
  expect(extended.overdue).toBe(true);
  expect(
    await extension.extend(actor, {
      piId: pi.id,
      commandId,
      expectedVersion: before.version,
      newDateEt: "2026-10-05",
      reason: "Customer shipping review",
    }),
  ).toEqual(extended);
  await expect(
    extension.extend(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: before.version + 1,
      newDateEt: "2026-10-04",
      reason: "Too early",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await db
      .prepare("SELECT id FROM confirmed_orders WHERE pi_id=?")
      .bind(pi.id)
      .first(),
  ).toBeNull();
  const funded = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: before.version + 1,
    amount: (pi.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Bank late funds",
  });
  await expect(
    createPiPaymentService(db, {
      now: () => new Date("2026-10-01T10:00:00.000Z"),
    }).confirmPayment(actor, {
      piId: pi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: funded.version,
      externallyVerified: true,
      externalReference: "Late bank funds",
    }),
  ).rejects.toMatchObject({ status: 409 });
  const late = createPiLatePaymentService(db, {
    now: () => new Date("2026-10-01T10:00:00.000Z"),
  });
  const review = {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: funded.version,
    decision: "same_terms_approved" as const,
    reason: "All terms still fulfillable",
    pricingChecked: true,
    availabilityChecked: true,
    freightChecked: true,
    tradeTermsChecked: true,
    leadTimeChecked: true,
    externalReference: "Seller bank statement 99",
  };
  const result = await late.review(actor, review);
  expect(result.overdue).toBe(false);
  expect(result.reviews).toHaveLength(1);
  expect(await late.review(actor, review)).toEqual(result);
  const order = await createConfirmedOrderService(db).customerRead(
    f.profileId,
    `order:${pi.id}`,
  );
  expect(order.totalCents).toBe(pi.snapshot.totals.totalCents);
  expect(order.snapshot.lines[0].product.catalogBasis?.skuRevisionId).toBe(
    "captured-sku",
  );
  await expect(
    createConfirmedOrderService(db).customerRead("wrong-profile", order.id),
  ).rejects.toMatchObject({ status: 404 });
});

it("lets authorized unconsumed transferred funds move again without creating money", async () => {
  const first = await fixture();
  const second = await fixture(undefined, false, first.profileId);
  const third = await fixture(undefined, false, first.profileId);
  const [a, b, c] = await Promise.all([
    service().issue(actor, first.command),
    service().issue(actor, second.command),
    service().issue(actor, third.command),
  ]);
  const payments = createPiPaymentService(db, {
    now: () => new Date("2026-09-15T10:00:00.000Z"),
  });
  const initial = await payments.adminRead(actor, a.id);
  const paid = await payments.updateReceived(actor, {
    piId: a.id,
    commandId: crypto.randomUUID(),
    expectedVersion: initial.version,
    amount: (b.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Verified bank receipt",
  });
  const funds = createPiFundResolutionService(db, {
    now: () => new Date("2026-09-15T10:00:00.000Z"),
  });
  const targetB = await payments.adminRead(actor, b.id);
  await funds.allocate(actor, {
    sourcePiId: a.id,
    targetPiId: b.id,
    commandId: crypto.randomUUID(),
    sourceVersion: paid.version,
    targetVersion: targetB.version,
    amount: (b.snapshot.totals.totalCents / 100).toFixed(2),
    customerAuthorization: "Verified transfer A to B",
    externalReference: "A to B",
  });
  const sourceB = await funds.read(actor, b.id);
  expect(sourceB.availableCents).toBe(b.snapshot.totals.totalCents);
  const targetC = await payments.adminRead(actor, c.id);
  await funds.allocate(actor, {
    sourcePiId: b.id,
    targetPiId: c.id,
    commandId: crypto.randomUUID(),
    sourceVersion: sourceB.version,
    targetVersion: targetC.version,
    amount: (c.snapshot.totals.totalCents / 100).toFixed(2),
    customerAuthorization: "Verified transfer B to C",
    externalReference: "B to C",
  });
  expect((await funds.read(actor, b.id)).availableCents).toBe(0);
  expect((await funds.read(actor, c.id)).allocatedInCents).toBe(
    c.snapshot.totals.totalCents,
  );
  await expect(
    funds.recordRefund(actor, {
      piId: b.id,
      commandId: crypto.randomUUID(),
      expectedVersion: sourceB.version + 1,
      amount: "0.01",
      customerAuthorization: "No remaining funds",
      externalReference: "No refund",
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it("allocates only authorized available USD to another current PI and creates its order once", async () => {
  const sourceFixture = await fixture();
  const targetFixture = await fixture(
    undefined,
    false,
    sourceFixture.profileId,
  );
  const sourcePi = await service().issue(actor, sourceFixture.command);
  const targetPi = await service().issue(actor, targetFixture.command);
  await acceptFixturePi(
    sourceFixture.profileId,
    targetFixture.command.requestId,
    targetPi,
  );
  const payments = createPiPaymentService(db, {
    now: () => new Date("2026-09-15T10:00:00.000Z"),
  });
  const source = await payments.adminRead(actor, sourcePi.id);
  const received = await payments.updateReceived(actor, {
    piId: sourcePi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: source.version,
    amount: (targetPi.snapshot.totals.totalCents / 100 + 5).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Source bank settlement",
  });
  const target = await payments.adminRead(actor, targetPi.id);
  const resolutions = createPiFundResolutionService(db, {
    now: () => new Date("2026-09-15T10:00:00.000Z"),
  });
  const command = {
    sourcePiId: sourcePi.id,
    targetPiId: targetPi.id,
    commandId: crypto.randomUUID(),
    sourceVersion: received.version,
    targetVersion: target.version,
    amount: (targetPi.snapshot.totals.totalCents / 100).toFixed(2),
    customerAuthorization: "Signed customer instruction #7",
    externalReference: "Verified authorization #7",
  };
  const allocated = await resolutions.allocate(actor, command);
  expect(allocated.availableCents).toBe(500);
  expect(await resolutions.allocate(actor, command)).toEqual(allocated);
  const order = await createConfirmedOrderService(db).customerRead(
    sourceFixture.profileId,
    `order:${targetPi.id}`,
  );
  expect(order.totalCents).toBe(targetPi.snapshot.totals.totalCents);
  await expect(
    resolutions.allocate(actor, {
      ...command,
      commandId: crypto.randomUUID(),
      amount: "0.01",
      sourceVersion: allocated.version,
      targetVersion: target.version + 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const refunded = await resolutions.recordRefund(actor, {
    piId: sourcePi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: allocated.version,
    amount: "5.00",
    customerAuthorization: "Signed refund #8",
    externalReference: "Completed bank return #8",
  });
  expect(refunded.availableCents).toBe(0);
  await expect(
    resolutions.recordRefund(actor, {
      piId: sourcePi.id,
      commandId: crypto.randomUUID(),
      expectedVersion: refunded.version,
      amount: "0.01",
      customerAuthorization: "Signed refund #9",
      externalReference: "Completed bank return #9",
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it("keeps an order frozen on correction, enforces its release gate, and requires Owner review", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  await acceptFixturePi(f.profileId, f.command.requestId, pi);
  const timestamp = "2026-09-15T10:00:00.000Z";
  const payments = createPiPaymentService(db, {
    now: () => new Date(timestamp),
  });
  const initial = await payments.adminRead(actor, pi.id);
  const funded = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: initial.version,
    amount: (pi.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Bank settlement",
  });
  await payments.confirmPayment(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: funded.version,
    externallyVerified: true,
    externalReference: "Bank cleared",
  });
  const corrections = createPiPaymentCorrectionService(db, {
    now: () => new Date(timestamp),
  });
  const before = await corrections.read(actor, pi.id);
  const command = {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: before.version,
    correctedAmount: "0.00",
    reason: "Bank reversal after mistaken clearing",
  };
  const held = await corrections.correct(actor, command);
  expect(held.confirmationValid).toBe(false);
  expect(held.disputes).toMatchObject([{ active: 1, held: 1 }]);
  expect(await corrections.correct(actor, command)).toEqual(held);
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM releasable_confirmed_orders WHERE order_id=?",
      )
      .bind(`order:${pi.id}`)
      .first("n"),
  ).toBe(0);
  const correctionId = String(held.disputes[0].correction_id);
  const resolve = {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    correctionId,
    expectedVersion: held.version,
    reason: "Reviewed bank correction",
    verificationReference: "Bank statement recheck",
  };
  await expect(
    corrections.resolve({ ...actor, accountType: "subaccount" }, resolve),
  ).rejects.toMatchObject({ status: 403 });
  await expect(corrections.resolve(actor, resolve)).rejects.toMatchObject({
    status: 409,
  });
  const restored = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: held.version,
    amount: (pi.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Replacement cleared funds",
  });
  const released = await corrections.resolve(actor, {
    ...resolve,
    expectedVersion: restored.version,
  });
  expect(released.disputes).toMatchObject([{ active: 0, held: 0 }]);
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM releasable_confirmed_orders WHERE order_id=?",
      )
      .bind(`order:${pi.id}`)
      .first("n"),
  ).toBe(1);
  expect(
    await db
      .prepare("SELECT count(*) n FROM confirmed_orders WHERE pi_id=?")
      .bind(pi.id)
      .first("n"),
  ).toBe(1);
});

it("rolls back payment confirmation when accepted evidence cannot produce an order", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  await acceptFixturePi(f.profileId, f.command.requestId, pi);
  const timestamp = "2026-09-16T10:00:00.000Z";
  const payments = createPiPaymentService(db, {
    now: () => new Date(timestamp),
  });
  const initial = await payments.adminRead(actor, pi.id);
  await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: initial.version,
    amount: (pi.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Bank settlement",
  });
  await db
    .prepare(
      "UPDATE pi_payment_accounts SET due_at='2026-09-15T03:59:59.000Z' WHERE pi_id=?",
    )
    .bind(pi.id)
    .run();
  const confirmationId = crypto.randomUUID();
  await expect(
    db.batch([
      db
        .prepare(
          `INSERT INTO pi_payment_confirmations(id,command_id,command_hash,pi_id,
      confirmed_cents,currency,actual_channel,external_reference,actor_id,confirmed_at)
      VALUES(?,?,?,?,?,'USD','bank_transfer','Bank cleared',?,?)`,
        )
        .bind(
          confirmationId,
          crypto.randomUUID(),
          "a".repeat(64),
          pi.id,
          pi.snapshot.totals.totalCents,
          actor.id,
          timestamp,
        ),
      ...(await orderCreationStatements(db, {
        piId: pi.id,
        requestId: f.command.requestId,
        now: timestamp,
        finalEvent: "payment",
      })),
    ]),
  ).rejects.toThrow();
  expect(
    await db
      .prepare("SELECT count(*) n FROM pi_payment_confirmations WHERE pi_id=?")
      .bind(pi.id)
      .first("n"),
  ).toBe(0);
  expect(
    await db
      .prepare("SELECT count(*) n FROM confirmed_orders WHERE pi_id=?")
      .bind(pi.id)
      .first("n"),
  ).toBe(0);
});

it("creates independent customer and Admin follow-on drafts without changing the source order", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  await acceptFixturePi(f.profileId, f.command.requestId, pi);
  const payments = createPiPaymentService(db, {
    now: () => new Date("2026-09-15T10:00:00.000Z"),
  });
  const initial = await payments.adminRead(actor, pi.id);
  const funded = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: initial.version,
    amount: (pi.snapshot.totals.totalCents / 100).toFixed(2),
    currency: "USD",
    actualChannel: "bank_transfer",
    verificationReference: "Bank 102",
  });
  await payments.confirmPayment(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: funded.version,
    externallyVerified: true,
    externalReference: "Bank 102",
  });
  const orderId = `order:${pi.id}`;
  const followOn = createFollowOnQuoteService(db, {
    now: () => new Date("2026-09-16T10:00:00.000Z"),
  });
  const customerCommand = crypto.randomUUID();
  const first = await followOn.customerCreate(
    f.profileId,
    orderId,
    customerCommand,
  );
  expect(first.submittedRequestId).toBeNull();
  expect(
    await followOn.customerCreate(f.profileId, orderId, customerCommand),
  ).toEqual(first);
  await expect(
    followOn.customerRead("wrong-profile", first.id),
  ).rejects.toMatchObject({ status: 404 });
  const adminDraft = await followOn.adminCreate(
    actor,
    orderId,
    crypto.randomUUID(),
  );
  expect(adminDraft.id).not.toBe(first.id);
  expect(
    await followOn.customerListForOrder(f.profileId, orderId),
  ).toHaveLength(2);
  expect(
    (await createConfirmedOrderService(db).customerRead(f.profileId, orderId))
      .totalCents,
  ).toBe(pi.snapshot.totals.totalCents);
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM customer_quote_requests WHERE source_order_id=?",
      )
      .bind(orderId)
      .first("n"),
  ).toBe(0);
  await seedManagedAssemblyBaseline(db);
  const env = { APP_ENV: "local", DB: db } as ApplicationBindings;
  const sessionNow = new Date();
  const token = generateCustomerSessionToken();
  await createD1CustomerIdentityRepository(db).createSessionForProfile({
    profileId: f.profileId,
    sessionId: crypto.randomUUID(),
    tokenDigest: await digestCustomerSessionToken(
      token,
      customerIdentitySigningKey(env),
    ),
    previousTokenDigest: null,
    now: sessionNow.toISOString(),
    expiresAt: new Date(sessionNow.getTime() + 86400000).toISOString(),
  });
  const request = new Request("http://localhost/quote-list", {
    headers: {
      cookie: createCustomerSessionCookie({
        now: sessionNow,
        secure: false,
        token,
      }).split(";")[0],
    },
  });
  await createCustomerAccountService(env).createAddress({
    request,
    addressLine1: "1 Test Street",
    addressLine2: "",
    city: "Portland",
    countryCode: "US",
    label: "Follow-on delivery",
    postalCode: "97201",
    recipientEmail: `${f.profileId}@example.test`,
    recipientName: "Test Buyer",
    recipientPhone: "5550100",
    stateProvince: "OR",
  });
  const lists = createAnonymousQuoteListService(env);
  for (const feet of [2, 3])
    await lists.addLengthBasedHose(request, "601R1_001", {
      normalizedLengthFt: feet,
      originalLengthUnit: "ft",
      originalLengthValue: feet,
      pieceCount: 100,
      totalFootage: feet * 100,
    });
  const lines = (await lists.read(request)).lines;
  const submit = {
    request,
    accuracyConfirmed: true,
    commercialReviewConfirmed: true,
    idempotencyKey: crypto.randomUUID(),
    selectedLineIds: [lines[0].id],
    followOnDraftId: first.id,
  };
  const newRfq = await createQuoteRequestService(env).submitIndividual(submit);
  expect(newRfq.id).not.toBe(f.command.requestId);
  expect(
    (await createQuoteRequestService(env).submitIndividual(submit)).id,
  ).toBe(newRfq.id);
  expect(
    await db
      .prepare("SELECT source_order_id FROM customer_quote_requests WHERE id=?")
      .bind(newRfq.id)
      .first("source_order_id"),
  ).toBe(orderId);
  expect(
    (await followOn.customerRead(f.profileId, first.id)).submittedRequestId,
  ).toBe(newRfq.id);
  expect((await lists.read(request)).lines).toHaveLength(1);
  expect(
    (await createConfirmedOrderService(db).customerRead(f.profileId, orderId))
      .totalCents,
  ).toBe(pi.snapshot.totals.totalCents);
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

it("records which superseded instruction version received verified funds", async () => {
  const f = await fixture();
  const pi = await service().issue(actor, f.command);
  const oldInstructionId = pi.snapshot.paymentSelection.instructionId;
  await createD1SellerCommercialSettingsRepository(db).savePaymentInstructions({
    id: crypto.randomUUID(),
    actorId: actor.id,
    channel: "bank_transfer",
    instructions: "TEST NEXT BANK VERSION",
    commandId: crypto.randomUUID(),
    now: "2026-09-15T09:00:00.000Z",
  });
  const payments = createPiPaymentService(db, {
    now: () => new Date("2026-09-15T10:00:00.000Z"),
  });
  const initial = await payments.adminRead(actor, pi.id);
  const received = await payments.updateReceived(actor, {
    piId: pi.id,
    commandId: crypto.randomUUID(),
    expectedVersion: initial.version,
    amount: "5.00",
    currency: "USD",
    actualChannel: "bank_transfer",
    receivedInstructionId: oldInstructionId,
    verificationReference: "Bank receipt under old instructions",
  });
  expect(received.paymentConfirmed).toBe(false);
  const history = (await payments.adminRead(actor, pi.id))
    .receiptInstructionHistory;
  expect(history).toMatchObject([
    { version: expect.any(Number), status: "superseded" },
  ]);
  expect(
    await db
      .prepare(
        "SELECT received_instruction_id FROM pi_payment_events WHERE pi_id=? AND kind='amount_received'",
      )
      .bind(pi.id)
      .first("received_instruction_id"),
  ).toBe(oldInstructionId);
});
