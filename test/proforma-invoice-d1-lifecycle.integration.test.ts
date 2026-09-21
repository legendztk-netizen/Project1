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
import { createQuotePreparation } from "../app/modules/quote-review/infrastructure/d1-quote-preparation";
import { createQuoteRevisions } from "../app/modules/quote-review/infrastructure/d1-quote-revisions";
import { createPiAcceptanceService } from "../app/modules/proforma-invoice/application/pi-acceptance-service";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  createPiPdfJobs,
  type PiPdfJob,
} from "../app/modules/proforma-invoice/application/pi-pdf-jobs";
import {
  createPiLifecycleService,
  type ReplaceProformaInvoiceCommand,
} from "../app/modules/proforma-invoice/application/pi-lifecycle-service";

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
    sourceHash: await piSha256(
      new TextEncoder().encode(JSON.stringify(source)),
    ),
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

const lifecycleService = (
  options: ProformaInvoiceServiceOptions = {},
  database = db,
  storage = bucket,
) =>
  createPiLifecycleService(database, storage, {
    conditions,
    now: () => new Date(issuedAt),
    ...options,
  });

async function acceptStored(
  pi: Awaited<ReturnType<ReturnType<typeof service>["issue"]>>,
  profileId: string,
) {
  const acceptance = createPiAcceptanceService(db, bucket, {
    now: () => new Date(issuedAt),
  });
  const target = {
    piId: pi.id,
    documentVersion: pi.snapshot.documentVersion,
    snapshotHash: pi.snapshotHash,
  };
  const evidence = {
    requestId: "lifecycle-fixture",
    ipAddress: "203.0.113.8",
    userAgent: "Lifecycle test",
  };
  const delivered = await acceptance.customerView(
    profileId,
    pi.requestId,
    target,
    "view",
    evidence,
  );
  const accepted = await acceptance.accept(
    profileId,
    new Request("https://example.test/accept", {
      method: "POST",
      headers: { Origin: "https://example.test" },
    }),
    {
      ...target,
      requestId: pi.requestId,
      commandId: crypto.randomUUID(),
      viewId: delivered.view.id,
      legalName: "PI Test Buyer",
      acknowledgements: {
        general: {
          version: pi.snapshot.conditions.generalAcknowledgement.version,
          confirmed: true,
        },
        madeToOrder: [],
      },
    },
    evidence,
  );
  return accepted.id;
}

async function replacementFixture(
  accepted = false,
  mutate: (q: QuoteRevisionSnapshot) => void = (q) => {
    q.source.lines[0].quantity++;
  },
  beforeRevision?: (
    pi: Awaited<ReturnType<ReturnType<typeof service>["issue"]>>,
    profileId: string,
  ) => Promise<void>,
) {
  const f = await fixture();
  const first = await service().issue(actor, f.command);
  if (accepted) await acceptStored(first, f.profileId);
  await beforeRevision?.(first, f.profileId);
  const next = structuredClone(f.revision);
  next.revisionNumber = 2;
  next.preparationVersion = 4;
  next.issuedAt = issuedAt;
  next.previousRevisionId = first.quoteRevisionId;
  mutate(next);
  next.totals = commercialTotals(next.source, next.prices, next.terms.charges);
  const json = JSON.stringify(next),
    hash = await piSha256(new TextEncoder().encode(json)),
    id = crypto.randomUUID();
  const evidenceId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at) VALUES(?,?,2,4,?,?,?,'hash',?,?)`,
      )
      .bind(
        id,
        f.command.requestId,
        json,
        hash,
        crypto.randomUUID(),
        actor.id,
        issuedAt,
      ),
    db
      .prepare(
        "INSERT INTO quote_internal_notes(id,request_id,actor_id,body,created_at) VALUES(?,?,?,'PRIVATE reviewed request evidence',?)",
      )
      .bind(evidenceId, f.command.requestId, actor.id, issuedAt),
  ]);
  const ready = await lifecycleService().replacementReadiness(
    actor,
    f.command.requestId,
  );
  const command: ReplaceProformaInvoiceCommand = {
    ...f.command,
    commandId: crypto.randomUUID(),
    quoteRevisionId: id,
    quoteRevisionHash: hash,
    replacement: {
      expectedPi: ready.expectedPi,
      expectedHeadVersion: ready.expectedHeadVersion,
      expectedAcceptanceId: ready.expectedAcceptanceId,
      nextQuoteRevisionId: id,
      reason: {
        code: "customer_requested_change",
        customerRequested: true,
        customerDataAccurate: true,
        explanation: "Reviewed customer amendment",
        evidenceIds: [evidenceId],
      },
    },
  };
  return { ...f, first, next, command };
}

it("reserves without rendering and publishes through the existing durable PDF job consumer", async () => {
  const f = await replacementFixture();
  let renders = 0;
  const replacement = lifecycleService({
    renderPdf: async (snapshot) => {
      renders++;
      return renderProformaInvoicePdf(snapshot);
    },
  });
  const reserved = await replacement.reserveReplacement(actor, f.command);
  expect(renders).toBe(0);
  expect((await service().adminCurrent(actor, f.first.requestId))!.id).toBe(
    f.first.id,
  );
  expect(await replacement.reserveReplacement(actor, f.command)).toEqual(
    reserved,
  );
  const messages: PiPdfJob[] = [];
  const jobs = createPiPdfJobs(
    db,
    {
      send: async (message) => {
        messages.push(message);
      },
    },
    async (commandId) => {
      const isReplacement = await db
        .prepare(
          `SELECT r.pi_id FROM pi_replacement_intents r JOIN proforma_invoice_intents i ON i.id=r.pi_id WHERE i.command_id=?`,
        )
        .bind(commandId)
        .first();
      return isReplacement
        ? replacement.renderReserved(commandId)
        : service().renderReserved(commandId);
    },
    () => new Date(issuedAt),
  );
  await jobs.dispatch();
  expect(
    messages.some((message) => message.commandId === reserved.commandId),
  ).toBe(true);
  const message = messages.find(
    (value) => value.commandId === reserved.commandId,
  )!;
  await jobs.consume(message);
  expect(renders).toBe(1);
  const second = (await service().adminCurrent(actor, f.first.requestId))!;
  expect(second.id).toBe(reserved.piId);
  expect(second.previousPiId).toBe(f.first.id);
  expect(
    (
      await db
        .prepare(
          "SELECT state FROM proforma_invoice_pdf_jobs WHERE command_id=?",
        )
        .bind(reserved.commandId)
        .first()
    )?.state,
  ).toBe("completed");
  await jobs.consume(message);
  expect((await replacement.renderReserved(reserved.commandId)).pdf).toEqual(
    second.pdf,
  );
  expect(renders).toBe(1);
  const original = await db
    .prepare("SELECT command_id FROM proforma_invoice_intents WHERE id=?")
    .bind(f.first.id)
    .first<{ command_id: string }>();
  await expect(
    replacement.renderReserved(original!.command_id),
  ).rejects.toMatchObject({ status: 409 });
});

it("atomically supersedes accepted PI and preserves private PDFs, source and acceptance history", async () => {
  const f = await replacementFixture(true);
  const originalPdf = new Uint8Array(
    await (
      await service().adminDownload(actor, f.first.requestId, f.first.id)
    ).arrayBuffer(),
  );
  const second = await lifecycleService().replace(actor, f.command);
  expect(second.previousPiId).toBe(f.first.id);
  expect(second.snapshot.documentVersion).toBe(2);
  expect(second.snapshot.lines[0].quantity).toBe(3);
  const history = await lifecycleService().customerHistory(
    f.profileId,
    f.first.requestId,
  );
  expect(history.map((p) => p.lifecycle.state)).toEqual([
    "current",
    "superseded",
  ]);
  expect(history[0].lifecycle.canAccept).toBe(true);
  expect(history[1].lifecycle.canAccept).toBe(false);
  expect(history[1].lifecycle.acceptedAt).toBe(issuedAt);
  expect(
    (await lifecycleService().adminHistory(actor, f.first.requestId))[1]
      .snapshot,
  ).toEqual(f.first.snapshot);
  expect(Object.keys(history[1].snapshot).sort()).toEqual([
    "documentNumber",
    "documentVersion",
    "issuedAt",
    "totals",
  ]);
  expect(
    await (
      await service().adminDownload(actor, f.first.requestId, f.first.id)
    ).arrayBuffer(),
  ).toEqual(originalPdf.buffer);
  expect(
    await db
      .prepare("SELECT id FROM pi_acceptances WHERE pi_id=?")
      .bind(second.id)
      .first(),
  ).toBeNull();
  expect(JSON.stringify(history)).not.toMatch(
    /PRIVATE|evidenceIds|previous_source_json|reason_json/,
  );
  expect(
    (
      await db
        .prepare("SELECT * FROM proforma_invoice_heads WHERE request_id=?")
        .bind(f.first.requestId)
        .first()
    )?.version,
  ).toBe(2);
  await expect(
    lifecycleService().customerHistory("not-owner", f.first.requestId),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    db
      .prepare(
        "UPDATE pi_supersessions SET superseded_at='changed' WHERE previous_pi_id=?",
      )
      .bind(f.first.id)
      .run(),
  ).rejects.toThrow(/immutable/);
});

it("replays exactly after supersession and rejects changed reason or actor without extra PDF", async () => {
  const f = await replacementFixture();
  const second = await lifecycleService().replace(actor, f.command);
  const replay = await lifecycleService({
    renderPdf: async () => {
      throw new Error("Replay rendered");
    },
  }).replace(actor, f.command);
  expect(replay).toEqual(second);
  await expect(
    lifecycleService().replace(actor, {
      ...f.command,
      replacement: {
        ...f.command.replacement,
        reason: { ...f.command.replacement.reason, explanation: "changed" },
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    lifecycleService().replace({ ...actor, id: "another-admin" }, f.command),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM proforma_invoices WHERE request_id=?",
        )
        .bind(f.first.requestId)
        .first()
    )?.n,
  ).toBe(2);
});

it("locks accepted estimate variances and rejects no-op and foreign evidence before publication", async () => {
  const f = await replacementFixture(true, (q) => {
    q.terms.charges.freight += 100;
  });
  f.command.replacement.reason = {
    ...f.command.replacement.reason,
    code: "seller_freight_estimate_error",
    customerRequested: false,
  };
  const blocked = await lifecycleService()
    .replace(actor, f.command)
    .catch((error) => error as Response);
  if (!(blocked instanceof Response)) throw new Error("Expected rejection");
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({
    decision: "accepted_total_locked",
    automaticRefundCents: 0,
  });
  expect(
    await db
      .prepare("SELECT id FROM proforma_invoice_intents WHERE command_id=?")
      .bind(f.command.commandId)
      .first(),
  ).toBeNull();
  const noop = await replacementFixture(false, () => {});
  await expect(
    lifecycleService().replace(actor, noop.command),
  ).rejects.toMatchObject({ status: 409 });
  const foreign = await replacementFixture();
  foreign.command.replacement.reason.evidenceIds =
    f.command.replacement.reason.evidenceIds;
  await expect(
    lifecycleService().replace(actor, foreign.command),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await service().adminCurrent(actor, foreign.first.requestId))!.id,
  ).toBe(foreign.first.id);
});

it("serializes identical and distinct replacement commands to one successor", async () => {
  const same = await replacementFixture();
  const copies = await Promise.all([
    lifecycleService().replace(actor, same.command),
    lifecycleService().replace(actor, same.command),
  ]);
  expect(copies[0].id).toBe(copies[1].id);
  const different = await replacementFixture();
  const results = await Promise.allSettled([
    lifecycleService().replace(actor, different.command),
    lifecycleService().replace(actor, {
      ...different.command,
      commandId: crypto.randomUUID(),
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM pi_supersessions WHERE previous_pi_id=?",
        )
        .bind(different.first.id)
        .first()
    )?.n,
  ).toBe(1);
  expect(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM proforma_invoices WHERE request_id=?",
        )
        .bind(different.first.requestId)
        .first()
    )?.n,
  ).toBe(2);
});

it("rechecks current quote after PDF generation and refuses stale acceptance tokens", async () => {
  const accepted = await replacementFixture(true);
  await expect(
    lifecycleService().replace(actor, {
      ...accepted.command,
      replacement: {
        ...accepted.command.replacement,
        expectedAcceptanceId: null,
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  const f = await replacementFixture();
  const racing = lifecycleService({
    renderPdf: async (snapshot) => {
      const pdf = await renderProformaInvoicePdf(snapshot);
      const next = { ...f.next, revisionNumber: 3, preparationVersion: 5 };
      const json = JSON.stringify(next);
      await db
        .prepare(
          "INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at) VALUES(?,?,3,5,?,?,?,'hash',?,?)",
        )
        .bind(
          crypto.randomUUID(),
          f.first.requestId,
          json,
          await piSha256(new TextEncoder().encode(json)),
          crypto.randomUUID(),
          actor.id,
          issuedAt,
        )
        .run();
      return pdf;
    },
  });
  await expect(racing.replace(actor, f.command)).rejects.toMatchObject({
    status: 409,
  });
  expect((await service().adminCurrent(actor, f.first.requestId))!.id).toBe(
    f.first.id,
  );
  expect(
    await db
      .prepare("SELECT * FROM pi_supersessions WHERE previous_pi_id=?")
      .bind(f.first.id)
      .first(),
  ).toBeNull();
});

it("rejects a real old-version acceptance attempted while replacement PDF renders", async () => {
  const acceptance = createPiAcceptanceService(db, bucket, {
    now: () => new Date(issuedAt),
  });
  const evidence = {
    requestId: "lifecycle-race",
    ipAddress: "203.0.113.8",
    userAgent: "Lifecycle test",
  };
  let viewId = "";
  const f = await replacementFixture(
    false,
    undefined,
    async (pi, profileId) => {
      const viewed = await acceptance.customerView(
        profileId,
        pi.requestId,
        {
          piId: pi.id,
          documentVersion: pi.snapshot.documentVersion,
          snapshotHash: pi.snapshotHash,
        },
        "view",
        evidence,
      );
      viewId = viewed.view.id;
    },
  );
  let rejected = false;
  const second = await lifecycleService({
    renderPdf: async (snapshot) => {
      await expect(
        acceptance.accept(
          f.profileId,
          new Request("https://example.test/accept", {
            method: "POST",
            headers: { Origin: "https://example.test" },
          }),
          {
            requestId: f.first.requestId,
            piId: f.first.id,
            documentVersion: f.first.snapshot.documentVersion,
            snapshotHash: f.first.snapshotHash,
            commandId: crypto.randomUUID(),
            viewId,
            legalName: "PI Test Buyer",
            acknowledgements: {
              general: {
                version:
                  f.first.snapshot.conditions.generalAcknowledgement.version,
                confirmed: true,
              },
              madeToOrder: [],
            },
          },
          evidence,
        ),
      ).rejects.toMatchObject({ status: 409 });
      rejected = true;
      return renderProformaInvoicePdf(snapshot);
    },
  }).replace(actor, f.command);
  expect(rejected).toBe(true);
  expect((await service().adminCurrent(actor, f.first.requestId))!.id).toBe(
    second.id,
  );
  expect(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM pi_acceptances WHERE request_id=?")
        .bind(f.first.requestId)
        .first()
    )?.n,
  ).toBe(0);
});

it("rolls back successor, head and supersession when audit fails; recovers uncertain committed publication", async () => {
  const f = await replacementFixture();
  await db
    .prepare(
      "CREATE TRIGGER test_lifecycle_abort BEFORE INSERT ON admin_audit_events WHEN NEW.event_type='proforma_invoice.replaced' BEGIN SELECT RAISE(ABORT,'test rollback'); END",
    )
    .run();
  try {
    await expect(
      lifecycleService().replace(actor, f.command),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    await db.prepare("DROP TRIGGER test_lifecycle_abort").run();
  }
  expect((await service().adminCurrent(actor, f.first.requestId))!.id).toBe(
    f.first.id,
  );
  expect(
    await db
      .prepare("SELECT * FROM pi_supersessions WHERE previous_pi_id=?")
      .bind(f.first.id)
      .first(),
  ).toBeNull();
  let threw = false;
  const uncertain = new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (!threw && statements.length === 4) {
            threw = true;
            throw new Error("response lost after commit");
          }
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const second = await lifecycleService({}, uncertain).replace(
    actor,
    f.command,
  );
  expect(threw).toBe(true);
  expect((await service().adminCurrent(actor, f.first.requestId))!.id).toBe(
    second.id,
  );
  expect(
    (await service().adminDownload(actor, f.first.requestId, second.id)).status,
  ).toBe(200);
});

it("derives expiry without a status write and prevents publication across the new deadline", async () => {
  const f = await replacementFixture();
  const expired = lifecycleService({
    now: () => new Date("2026-09-29T10:00:00.000Z"),
  });
  expect(
    (await expired.customerHistory(f.profileId, f.first.requestId))[0]
      .lifecycle,
  ).toMatchObject({
    state: "expired",
    canAccept: false,
    canView: true,
    canDownload: true,
  });
  const next = await expired.replace(actor, f.command);
  expect(next.snapshot.validUntil).toBe("2026-10-13T10:00:00.000Z");
  expect(
    (await expired.customerHistory(f.profileId, f.first.requestId)).map(
      (p) => p.lifecycle.state,
    ),
  ).toEqual(["current", "superseded"]);
  const g = await replacementFixture();
  let clock = issuedAt;
  const racing = lifecycleService({
    now: () => new Date(clock),
    renderPdf: async (snapshot) => {
      const pdf = await renderProformaInvoicePdf(snapshot);
      clock = snapshot.validUntil;
      return pdf;
    },
  });
  await expect(racing.replace(actor, g.command)).rejects.toThrow(/future/);
  expect((await service().adminCurrent(actor, g.first.requestId))!.id).toBe(
    g.first.id,
  );
});

it("rejects stale current seller and selected payment versions after rendering", async () => {
  for (const changed of ["seller", "payment"] as const) {
    const f = await replacementFixture();
    const racing = lifecycleService({
      renderPdf: async (snapshot) => {
        const pdf = await renderProformaInvoicePdf(snapshot);
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
            instructions: "TEST UPDATED BANK\nReference required",
            commandId: crypto.randomUUID(),
            now: issuedAt,
          });
        return pdf;
      },
    });
    await expect(racing.replace(actor, f.command)).rejects.toMatchObject({
      status: 409,
    });
    expect((await service().adminCurrent(actor, f.first.requestId))!.id).toBe(
      f.first.id,
    );
  }
});

it("recovers an uncertain R2 upload without overwriting or deleting authoritative bytes", async () => {
  const f = await replacementFixture();
  let uploads = 0;
  const storage = new Proxy(bucket, {
    get(target, key) {
      if (key === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          uploads++;
          await target.put(...args);
          throw new Error("R2 upload receipt lost");
        };
      if (key === "delete")
        return () => {
          throw new Error("Must not delete uncertain bytes");
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const issued = await lifecycleService({}, db, storage).replace(
    actor,
    f.command,
  );
  expect(uploads).toBe(1);
  expect(
    (await service().adminDownload(actor, f.first.requestId, issued.id)).status,
  ).toBe(200);
  expect(
    (await lifecycleService({}, db, storage).replace(actor, f.command)).id,
  ).toBe(issued.id);
  expect(uploads).toBe(1);
});

it("issues a real new Quote Revision, delivers exact replacement PDF and requires fresh website acceptance", async () => {
  const f = await fixture();
  const first = await service().issue(actor, f.command);
  const acceptance = createPiAcceptanceService(db, bucket, {
    now: () => new Date(issuedAt),
  });
  const evidence = {
    requestId: "lifecycle-e2e",
    ipAddress: "203.0.113.8",
    userAgent: "Lifecycle test",
  };
  const target = (pi: typeof first) => ({
    piId: pi.id,
    documentVersion: pi.snapshot.documentVersion,
    snapshotHash: pi.snapshotHash,
  });
  const originalView = await acceptance.customerView(
    f.profileId,
    first.requestId,
    target(first),
    "view",
    evidence,
  );
  const acceptRequest = () =>
    new Request("https://example.test/account/quotes/pi/accept", {
      method: "POST",
      headers: { Origin: "https://example.test" },
    });
  const acceptInput = (pi: typeof first, viewId: string) => ({
    ...target(pi),
    requestId: pi.requestId,
    commandId: crypto.randomUUID(),
    viewId,
    legalName: "PI Test Buyer",
    acknowledgements: {
      general: {
        version: pi.snapshot.conditions.generalAcknowledgement.version,
        confirmed: true as const,
      },
      madeToOrder: [],
    },
  });
  const oldAcceptance = await acceptance.accept(
    f.profileId,
    acceptRequest(),
    acceptInput(first, originalView.view.id),
    evidence,
  );

  // Seed the already-issued preparation, then exercise production revision APIs.
  await db
    .prepare(
      `INSERT INTO quote_preparation_drafts(request_id,source_hash,source_snapshot_json,prices_json,terms_json,version,created_by,created_at,updated_by,updated_at)
    VALUES(?,?,?,?,?,3,?,?,?,?)`,
    )
    .bind(
      first.requestId,
      f.revision.sourceHash,
      JSON.stringify(f.revision.source),
      JSON.stringify(f.revision.prices),
      JSON.stringify(f.revision.terms),
      actor.id,
      issuedAt,
      actor.id,
      issuedAt,
    )
    .run();
  const revisions = createQuoteRevisions(db);
  const draft = await revisions.startNext(
    actor,
    first.requestId,
    first.quoteRevisionId,
    3,
  );
  const terms = {
    ...f.revision.terms,
    transportMethod: "Sea freight",
    shipmentMode: "split" as const,
    splitPlan: "Two separately quoted dispatches",
  };
  const version = await createQuotePreparation(db, actor).saveTerms(
    first.requestId,
    draft.version,
    terms,
    crypto.randomUUID(),
  );
  const next = await revisions.issueRevision(actor, {
    requestId: first.requestId,
    preparationVersion: version,
    sourceHash: f.revision.sourceHash,
    factoryReviewConfirmed: true,
    commandId: crypto.randomUUID(),
    baseRevisionId: first.quoteRevisionId,
    changeReason: "Customer requested split shipment by sea",
  });
  const serviceNow = () =>
    new Date(Math.max(Date.now(), new Date(next.snapshot.issuedAt).getTime()));
  const replacement = lifecycleService({ now: serviceNow });
  const ready = await replacement.replacementReadiness(actor, first.requestId);
  const noteId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO quote_internal_notes(id,request_id,actor_id,body,created_at) VALUES(?,?,?,'Customer shipping amendment',?)",
    )
    .bind(noteId, first.requestId, actor.id, serviceNow().toISOString())
    .run();
  const second = await replacement.replace(actor, {
    ...f.command,
    commandId: crypto.randomUUID(),
    quoteRevisionId: next.id,
    quoteRevisionHash: next.hash,
    replacement: {
      expectedPi: ready.expectedPi,
      expectedHeadVersion: ready.expectedHeadVersion,
      expectedAcceptanceId: oldAcceptance.id,
      nextQuoteRevisionId: next.id,
      reason: {
        code: "customer_requested_change",
        customerRequested: true,
        customerDataAccurate: true,
        explanation: "Customer shipping amendment",
        evidenceIds: [noteId],
      },
    },
  });
  expect(second.quoteRevisionId).toBe(next.id);
  expect(second.snapshot.documentVersion).toBe(2);
  expect((await revisions.history(first.requestId)).map((r) => r.id)).toEqual([
    next.id,
    first.quoteRevisionId,
  ]);
  const currentAcceptance = createPiAcceptanceService(db, bucket, {
    now: serviceNow,
  });
  await expect(
    currentAcceptance.accept(
      f.profileId,
      acceptRequest(),
      acceptInput(second, originalView.view.id),
      evidence,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    currentAcceptance.customerView(
      f.profileId,
      first.requestId,
      target(first),
      "view",
      evidence,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const delivered = await currentAcceptance.customerView(
    f.profileId,
    first.requestId,
    target(second),
    "download",
    evidence,
  );
  const bytes = new Uint8Array(await delivered.response.arrayBuffer());
  expect(bytes.byteLength).toBe(second.pdf.byteSize);
  expect(await piSha256(bytes)).toBe(second.pdf.sha256);
  const downloaded = new Uint8Array(
    await (
      await service().adminDownload(actor, first.requestId, second.id)
    ).arrayBuffer(),
  );
  expect(downloaded).toEqual(bytes);
  const renewed = await currentAcceptance.accept(
    f.profileId,
    acceptRequest(),
    acceptInput(second, delivered.view.id),
    evidence,
  );
  expect(renewed.id).not.toBe(oldAcceptance.id);
  const history = await replacement.customerHistory(
    f.profileId,
    first.requestId,
  );
  expect(history.map((p) => p.lifecycle.state)).toEqual([
    "accepted",
    "superseded",
  ]);
  expect(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM pi_acceptances WHERE request_id=?")
        .bind(first.requestId)
        .first()
    )?.n,
  ).toBe(2);
  expect(
    (
      await db
        .prepare("SELECT snapshot_json FROM proforma_invoices WHERE id=?")
        .bind(first.id)
        .first()
    )?.snapshot_json,
  ).toBe(JSON.stringify(first.snapshot));
});

it("never exposes historical or unused-channel instructions in history, customer records or serialized HTML", async () => {
  const settings = createD1SellerCommercialSettingsRepository(db);
  await settings.savePaymentInstructions({
    id: crypto.randomUUID(),
    actorId: actor.id,
    channel: "bank_transfer",
    instructions: "BANK-PRIVATE-HISTORY-SENTINEL",
    commandId: crypto.randomUUID(),
    now: issuedAt,
  });
  await settings.savePaymentInstructions({
    id: crypto.randomUUID(),
    actorId: actor.id,
    channel: "paypal",
    instructions: "PAYPAL-CURRENT-SENTINEL",
    commandId: crypto.randomUUID(),
    now: issuedAt,
  });
  const f = await replacementFixture(true);
  const payment = (
    await service().readiness(actor, f.first.requestId)
  ).payments.find((p) => p.channel === "paypal")!;
  f.command.paymentChannel = "paypal";
  f.command.paymentInstructionId = payment.id;
  f.command.paymentInstructionVersion = payment.version;
  const second = await lifecycleService().replace(actor, f.command);
  const guarded = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          if (/seller_payment_instruction_versions/i.test(sql))
            throw new Error(
              "History must not resolve any payment instructions",
            );
          return target.prepare(sql);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const history = await lifecycleService({}, guarded).customerHistory(
    f.profileId,
    f.first.requestId,
  );
  expect(JSON.stringify(history)).not.toMatch(
    /BANK-PRIVATE|PAYPAL-CURRENT|paymentInstructions|paymentSelection|PRIVATE-NOTE/,
  );
  const historical = await service().customerRead(
    f.profileId,
    f.first.requestId,
    f.first.id,
  );
  const current = await service().customerCurrent(
    f.profileId,
    f.first.requestId,
  );
  expect(historical.paymentInstructions).toBeNull();
  expect(current!.paymentInstructions!.instructions).toBe(
    "PAYPAL-CURRENT-SENTINEL",
  );
  expect(
    (await service().adminRead(actor, f.first.requestId, f.first.id))
      .paymentInstructions!.instructions,
  ).toBe("BANK-PRIVATE-HISTORY-SENTINEL");
  // The serialized loader payload is part of the HTML response, even for hidden UI.
  const html = renderToStaticMarkup(
    createElement("script", {
      type: "application/json",
      dangerouslySetInnerHTML: {
        __html: JSON.stringify({
          requestId: f.first.requestId,
          invoice: historical,
          history,
        }),
      },
    }),
  );
  expect(html).not.toMatch(/BANK-PRIVATE|PAYPAL-CURRENT/);
  const expired = service({ now: () => new Date(second.snapshot.validUntil) });
  expect(
    (await expired.customerRead(f.profileId, f.first.requestId, second.id))
      .paymentInstructions,
  ).toBeNull();
  expect(
    (await expired.customerCurrent(f.profileId, f.first.requestId))!
      .paymentInstructions,
  ).toBeNull();
  await acceptStored(second, f.profileId);
  expect(
    (await expired.customerRead(f.profileId, f.first.requestId, second.id))
      .paymentInstructions!.instructions,
  ).toBe("PAYPAL-CURRENT-SENTINEL");
});
