import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  createPiAcceptanceService,
  type AcceptWebsitePiInput,
} from "../app/modules/proforma-invoice/application/pi-acceptance-service";
import {
  formatPiDate,
  piSha256,
} from "../app/modules/proforma-invoice/domain/proforma-invoice";
import type { PiAcceptanceSnapshot } from "../app/modules/proforma-invoice/domain/pi-acceptance";
import { createD1SellerCommercialSettingsRepository } from "../app/modules/seller-settings/infrastructure/d1-seller-commercial-settings-repository";
import { piAcceptanceCopies as workerCopies } from "../workers/pi-email-acceptance";
import type { ApplicationBindings } from "../workers/environment";

const directory = mkdtempSync(join(tmpdir(), "pi-email-acceptance-61-"));
let platform: Awaited<
  ReturnType<
    typeof getPlatformProxy<{ DB: D1Database; PRIVATE_FILES: R2Bucket }>
  >
>;
let db: D1Database;
let bucket: R2Bucket;
let pdf: Uint8Array<ArrayBuffer>;
const evidence = {
  requestId: "SERVER_REQUEST",
  ipAddress: "192.0.2.50",
  userAgent: "SERVER_USER_AGENT",
};
const mutation = () =>
  new Request("https://shop.test/account/quotes/accept", {
    method: "POST",
    headers: { Origin: "https://shop.test" },
  });
const service = (database = db, storage = bucket, now?: () => Date) =>
  createPiAcceptanceService(database, storage, { now });

beforeAll(async () => {
  platform = await getPlatformProxy<{
    DB: D1Database;
    PRIVATE_FILES: R2Bucket;
  }>({
    configPath: "wrangler.jsonc",
    persist: { path: directory },
    remoteBindings: false,
  });
  db = platform.env.DB;
  bucket = platform.env.PRIVATE_FILES;
  // Exercise the real migration chain in an isolated local database.
  for (const file of readdirSync("migrations")
    .filter(
      (name) => /^\d{4}_.*\.sql$/.test(name) && name.slice(0, 4) <= "0077",
    )
    .sort()) {
    await migrate(join("migrations", file));
  }
  expect(
    await db
      .prepare("SELECT version FROM application_schema_state WHERE singleton=1")
      .first(),
  ).toEqual({ version: 78 });
  protector = createAesGcmNotificationProtector(
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  );
  const now = new Date().toISOString();
  const settings = createD1SellerCommercialSettingsRepository(db);
  await settings.saveSellerIdentity({
    id: "acceptance-seller",
    actorId: "test-admin",
    address: "1 Testing Road\nHangzhou, Zhejiang, China",
    commandId: crypto.randomUUID(),
    now,
  });
  await settings.savePaymentInstructions({
    id: "acceptance-payment",
    actorId: "test-admin",
    channel: "bank_transfer",
    instructions: "TEST ONLY bank transfer instructions.",
    commandId: crypto.randomUUID(),
    now,
  });
  const document = await PDFDocument.create();
  document.addPage().drawText("Test PI acceptance PDF");
  pdf = new Uint8Array(await document.save());
}, 60000);
async function migrate(path: string) {
  if (!existsSync(path)) throw new Error(`Missing migration draft: ${path}`);
  await db.batch(
    readFileSync(path, "utf8")
      .split("--> statement-breakpoint")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
}
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

async function profile(id: string) {
  await db
    .prepare(
      "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES(?,?,?,datetime('now'),datetime('now'),datetime('now'))",
    )
    .bind(id, `${id}@test.example`, `${id}@test.example`)
    .run();
}
async function fixture(organization = false, validUntil?: string) {
  const id = crypto.randomUUID();
  const profileId = `profile-${id}`;
  const piId = `pi-${id}`;
  const quoteId = `quote-${id}`;
  await profile(profileId);
  if (organization) {
    await db
      .prepare(
        "INSERT INTO customer_organizations(id,legal_name,country_code,created_at,updated_at) VALUES(?,'Test Buyer','US',datetime('now'),datetime('now'))",
      )
      .bind(id)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,organization_id,created_at,updated_at) VALUES(?,?,?,?,datetime('now'),datetime('now'))",
    )
    .bind(
      id,
      organization ? "organization" : "individual",
      organization ? null : profileId,
      organization ? id : null,
    )
    .run();
  if (organization) await grant(id, profileId);
  await db
    .prepare(
      `INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,
    source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,
    merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at)
    VALUES(?,?,?,?,'session',1,'address',?,'DDP','USD',0,0,?,'{}',datetime('now'))`,
    )
    .bind(
      id,
      id,
      profileId,
      id,
      organization ? "organization" : "individual",
      id,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at)
    VALUES(?,?,1,1,'{}',?,?,?,'test-admin',datetime('now'))`,
    )
    .bind(quoteId, id, "a".repeat(64), crypto.randomUUID(), "b".repeat(64))
    .run();
  const snapshot: PiAcceptanceSnapshot & { documentNumber: string } = {
    documentNumber: `PI-${id}`,
    schemaVersion: 1,
    documentVersion: 1,
    issuedAt: new Date(Date.now() - 3600000).toISOString(),
    validUntil: validUntil ?? new Date(Date.now() + 86400000).toISOString(),
    quoteRevision: { id: quoteId, requestId: id },
    lines: [
      { id: "custom-a", madeToOrder: true },
      { id: "custom-b", madeToOrder: true },
    ],
    conditions: {
      generalAcknowledgement: {
        version: "general-v1",
        text: "TEST general acknowledgement text.",
      },
      cancellation: { version: "cancel-v1", text: "TEST cancellation text." },
      refund: { version: "refund-v1", text: "TEST refund text." },
      madeToOrderAcknowledgements: [
        {
          lineId: "custom-a",
          version: "custom-v1",
          text: "TEST acknowledgement A.",
        },
        {
          lineId: "custom-b",
          version: "custom-v1",
          text: "TEST acknowledgement B.",
        },
      ],
    },
  };
  const json = JSON.stringify(snapshot);
  const hash = await piSha256(new TextEncoder().encode(json));
  const pdfHash = await piSha256(pdf);
  await db
    .prepare(
      `INSERT INTO proforma_invoice_intents(id,command_id,command_hash,request_id,quote_revision_id,quote_revision_hash,source_revision_json,
    seller_identity_id,seller_version,payment_instruction_id,payment_instruction_version,payment_channel,snapshot_json,snapshot_hash,issued_by,issued_at,valid_until)
    VALUES(?,?,?,?,?,?,'{}','acceptance-seller',1,'acceptance-payment',1,'bank_transfer',?,?,'test-admin',?,?)`,
    )
    .bind(
      piId,
      crypto.randomUUID(),
      "b".repeat(64),
      id,
      quoteId,
      "a".repeat(64),
      json,
      hash,
      snapshot.issuedAt,
      snapshot.validUntil,
    )
    .run();
  const objectKey = `test-acceptance/${piId}.pdf`;
  await bucket.put(objectKey, pdf);
  await db
    .prepare(
      `INSERT INTO proforma_invoices(id,request_id,quote_revision_id,document_number,document_version,
    snapshot_json,snapshot_hash,pdf_object_key,pdf_sha256,pdf_byte_size,pdf_page_count,pdf_renderer_version,payment_channel,issued_by,issued_at,valid_until)
    VALUES(?,?,?,?,1,?,?,?,?,?,1,'test-renderer','bank_transfer','test-admin',?,?)`,
    )
    .bind(
      piId,
      id,
      quoteId,
      `PI-${id}`,
      json,
      hash,
      objectKey,
      pdfHash,
      pdf.byteLength,
      snapshot.issuedAt,
      snapshot.validUntil,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO proforma_invoice_heads(request_id,pi_id,version) VALUES(?,?,1)",
    )
    .bind(id, piId)
    .run();
  const target = { piId, snapshotHash: hash, documentVersion: 1 };
  const input: AcceptWebsitePiInput = {
    ...target,
    requestId: id,
    commandId: crypto.randomUUID(),
    viewId: "missing",
    legalName: " Test Buyer LLC ",
    acknowledgements: {
      general: { version: "general-v1", confirmed: true },
      madeToOrder: [
        {
          lineIds: ["custom-b", "custom-a"],
          version: "custom-v1",
          cancellationVersion: "cancel-v1",
          specificationsConfirmed: true,
          cancellationConfirmed: true,
        },
      ],
    },
  };
  return { id, profileId, piId, quoteId, snapshot, target, input, objectKey };
}
async function grant(organizationId: string, profileId: string) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO customer_profile_purchasing_context_access(profile_id,context_id,created_at) VALUES(?,?,datetime('now'))",
      )
      .bind(profileId, organizationId),
    db
      .prepare(
        "INSERT INTO customer_organization_memberships(id,organization_id,profile_id,role,status,created_at) VALUES(?,?,?,'primary_contact','active',datetime('now'))",
      )
      .bind(crypto.randomUUID(), organizationId, profileId),
  ]);
}
async function viewed(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await service().customerView(
    f.profileId,
    f.id,
    f.target,
    "view",
    evidence,
  );
  f.input.viewId = result.view.id;
  return result;
}
async function counts(piId: string) {
  return {
    accepts: await db
      .prepare("SELECT count(*) AS n FROM pi_acceptances WHERE pi_id=?")
      .bind(piId)
      .first("n"),
    commands: await db
      .prepare("SELECT count(*) AS n FROM pi_acceptance_commands WHERE pi_id=?")
      .bind(piId)
      .first("n"),
    audits: await db
      .prepare(
        "SELECT count(*) AS n FROM admin_audit_events WHERE entity_id=? AND event_type='pi.accepted'",
      )
      .bind(piId)
      .first("n"),
  };
}
function interceptBatch(effect: () => Promise<void>) {
  let used = false;
  return new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (!used) {
            used = true;
            await effect();
          }
          return target.batch(statements);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
async function replaceQuote(f: Awaited<ReturnType<typeof fixture>>) {
  await db
    .prepare(
      `INSERT INTO quote_revisions(id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at)
    VALUES(?,?,2,2,'{}',?,?,?,'test-admin',datetime('now'))`,
    )
    .bind(
      crypto.randomUUID(),
      f.id,
      "c".repeat(64),
      crypto.randomUUID(),
      "d".repeat(64),
    )
    .run();
}

async function replacePi(f: Awaited<ReturnType<typeof fixture>>) {
  const id = `pi-${crypto.randomUUID()}`;
  const json = JSON.stringify({ ...f.snapshot, documentVersion: 2 });
  const hash = await piSha256(new TextEncoder().encode(json));
  await db.batch([
    db
      .prepare(
        `INSERT INTO proforma_invoice_intents(id,command_id,command_hash,request_id,quote_revision_id,
      quote_revision_hash,source_revision_json,seller_identity_id,seller_version,payment_instruction_id,
      payment_instruction_version,payment_channel,snapshot_json,snapshot_hash,issued_by,issued_at,valid_until)
      SELECT ?,?,command_hash,request_id,quote_revision_id,quote_revision_hash,source_revision_json,
        seller_identity_id,seller_version,payment_instruction_id,payment_instruction_version,payment_channel,
        ?,?,issued_by,issued_at,valid_until FROM proforma_invoice_intents WHERE id=?`,
      )
      .bind(id, crypto.randomUUID(), json, hash, f.piId),
    db
      .prepare(
        `INSERT INTO proforma_invoices(id,request_id,quote_revision_id,document_number,document_version,
      previous_pi_id,snapshot_json,snapshot_hash,pdf_object_key,pdf_sha256,pdf_byte_size,pdf_page_count,
      pdf_renderer_version,payment_channel,issued_by,issued_at,valid_until)
      SELECT ?,request_id,quote_revision_id,?,2,id,?,?,?,pdf_sha256,pdf_byte_size,pdf_page_count,
        pdf_renderer_version,payment_channel,issued_by,issued_at,valid_until FROM proforma_invoices WHERE id=?`,
      )
      .bind(id, `PI-${id}`, json, hash, `replacement/${id}.pdf`, f.piId),
    db
      .prepare(
        "UPDATE proforma_invoice_heads SET pi_id=?,version=version+1 WHERE request_id=?",
      )
      .bind(id, f.id),
  ]);
  return id;
}

import type { AdminIdentity } from "../workers/admin-access";
import {
  createPiEmailAcceptanceService,
  type AcceptPiFromEmailInput,
} from "../app/modules/proforma-invoice/application/pi-email-acceptance-service";
import { createPiAcceptanceCopies } from "../app/modules/proforma-invoice/application/pi-acceptance-copies";
import { createD1PiAcceptanceCopies } from "../app/modules/proforma-invoice/infrastructure/d1-pi-acceptance-copies";
import {
  createAesGcmNotificationProtector,
  type NotificationProtector,
  type NotificationEnvironment,
  type QuoteNotificationAdapter,
} from "../app/modules/quote-notifications";
let protector: NotificationProtector;
const actor: AdminIdentity = {
  id: "test-admin",
  email: "admin@local.invalid",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
const localEnv: NotificationEnvironment = {
  APP_ENV: "local",
  EMAIL_DELIVERY_MODE: "stub",
  EMAIL_FROM: "seller@local.invalid",
  EMAIL_REPLY_DOMAIN: "reply.local.invalid",
};
const emailService = (database = db, storage = bucket, now?: () => Date) =>
  createPiEmailAcceptanceService(database, storage, {
    inboundProtector: protector,
    appEnvironment: "local",
    now,
  });
async function emailFixture(
  organization = false,
  validUntil?: string,
  bodyOverride?: string,
) {
  const f = await fixture(organization, validUntil);
  const sender = await db
    .prepare("SELECT email_normalized FROM customer_profiles WHERE id=?")
    .bind(f.profileId)
    .first<string>("email_normalized");
  const sourceMessageId = crypto.randomUUID();
  const receiptId = crypto.randomUUID();
  const body = `I accept ${f.snapshot.documentNumber}. I acknowledge the commercial terms.
I confirm specifications for custom-a and custom-b.
I accept the cancellation conditions for custom-a and custom-b.`;
  const raw = new TextEncoder().encode(
    `From: ${sender}\r\nTo: seller@local.invalid\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${bodyOverride ?? body}`,
  );
  const rawHash = await piSha256(raw);
  const key = `inbound-61/${receiptId}`;
  await bucket.put(key, raw);
  const envelope = await protector.seal(
    JSON.stringify({
      sender,
      profileId: f.profileId,
      requestId: f.id,
      rawChecksum: rawHash,
      provider: "local-fixture",
    }),
    `inbound:${receiptId}`,
  );
  await db.batch([
    db
      .prepare(
        "INSERT INTO quote_conversations(request_id,created_at) VALUES(?,?)",
      )
      .bind(f.id, new Date().toISOString()),
    db
      .prepare(
        `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,source,delivery_state)
      VALUES(?,?,'customer',?,?,?,?,?,'email','available')`,
      )
      .bind(
        sourceMessageId,
        f.id,
        f.profileId,
        body,
        new Date().toISOString(),
        crypto.randomUUID(),
        rawHash,
      ),
    db
      .prepare(
        `INSERT INTO quote_inbound_email_receipts(id,event_key,receipt_hash,raw_checksum,raw_size,raw_key,protected_envelope,state,created_at,next_attempt_at,next_dispatch_at,request_id,message_id)
      VALUES(?,?,?,?,?,?,?,'appended',?,?,?,?,?)`,
      )
      .bind(
        receiptId,
        receiptId,
        rawHash,
        rawHash,
        raw.byteLength,
        key,
        envelope,
        Date.now() - 1000,
        0,
        0,
        f.id,
        sourceMessageId,
      ),
    db
      .prepare(
        "INSERT INTO quote_inbound_email_content(content_key,content_hash,receipt_id,request_id,profile_id,message_id,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        receiptId,
        rawHash,
        receiptId,
        f.id,
        f.profileId,
        sourceMessageId,
        Date.now() - 1000,
      ),
  ]);
  const input: AcceptPiFromEmailInput & { viewId: string } = {
    ...f.input,
    sourceMessageId,
    explicitlyConfirmed: true,
    review: {
      piReferenceExcerpt: `I accept ${f.snapshot.documentNumber}.`,
      generalExcerpt: "I acknowledge the commercial terms.",
      madeToOrder: [
        {
          lineIds: ["custom-a", "custom-b"],
          specificationExcerpt:
            "I confirm specifications for custom-a and custom-b.",
          cancellationExcerpt:
            "I accept the cancellation conditions for custom-a and custom-b.",
        },
      ],
    },
  };
  return { ...f, input, key, raw, receiptId, sender };
}
const accept = (f: Awaited<ReturnType<typeof emailFixture>>, database = db) =>
  emailService(database).accept(actor, mutation(), f.input, evidence);
function copies(
  options: {
    env?: NotificationEnvironment;
    adapter?: QuoteNotificationAdapter;
    now?: () => number;
    protector?: NotificationProtector;
  } = {},
) {
  return createPiAcceptanceCopies({
    database: db,
    env: options.env ?? localEnv,
    protector: options.protector ?? protector,
    adapter: options.adapter,
    now: options.now,
  });
}
function message(id: string) {
  return {
    body: { type: "pi-acceptance-copy", acceptanceId: id },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

it("atomically records email evidence, one copy intent and the shared private-safe My Quotes projection", async () => {
  const f = await emailFixture();
  const result = await accept(f);
  expect(result).toMatchObject({
    source: "email",
    status: "PI Accepted",
    piId: f.piId,
    snapshotHash: f.target.snapshotHash,
  });
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 1, audits: 1 });
  expect(
    (await service().customerStatus(f.profileId, f.id)).acceptance,
  ).toEqual(result);
  expect(JSON.stringify(result)).not.toMatch(
    /raw_object_key|actingAdminId|sourceMessageId|SERVER_REQUEST|192\.0\.2/,
  );
  const saved = await db
    .prepare("SELECT evidence_json FROM pi_acceptances WHERE id=?")
    .bind(result.id)
    .first<string>("evidence_json");
  expect(JSON.parse(saved!)).toMatchObject({
    evidence: {
      source: "email",
      actingAdminId: actor.id,
      explicitlyConfirmed: true,
    },
    requestEvidence: evidence,
  });
  expect(
    await db
      .prepare("SELECT count(*) n FROM pi_acceptance_copy_outbox WHERE id=?")
      .bind(result.id)
      .first("n"),
  ).toBe(1);
  for (const table of [
    "pi_acceptances",
    "pi_email_acceptance_evidence",
    "pi_acceptance_commands",
  ]) {
    await expect(db.prepare(`UPDATE ${table} SET id=id`).run()).rejects.toThrow(
      /immutable/,
    );
    await expect(db.prepare(`DELETE FROM ${table}`).run()).rejects.toThrow(
      /immutable/,
    );
  }
  const mail = message(result.id);
  await copies().consume(mail);
  expect(mail.ack).toHaveBeenCalledOnce();
  const capture = await copies().readLocalCapture(actor, result.id);
  expect(capture.to).toEqual([f.sender]);
  expect(capture.text).toContain(f.target.snapshotHash);
  expect(capture.text).toContain("custom-a");
  expect(capture.text).toContain("TEST cancellation text.");
  expect(capture.text).toContain(
    `Recorded at: ${formatPiDate(result.acceptedAt, "customer")}`,
  );
  expect(capture.text).toMatch(
    /Recorded at: [A-Z][a-z]{2} \d{1,2}, \d{4}, .* ET/,
  );
  expect(capture.text).not.toContain(result.acceptedAt);
  expect(JSON.parse(saved!).acceptedAt).toBe(result.acceptedAt);
  expect(result.acceptedAt).toMatch(/Z$/);
  expect(capture.text).not.toMatch(
    /raw_object_key|SERVER_REQUEST|192\.0\.2|actingAdminId/,
  );
  await copies().consume(message(result.id));
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM pi_acceptance_copy_captures WHERE acceptance_id=?",
      )
      .bind(result.id)
      .first("n"),
  ).toBe(1);
});

it("rejects unauthorized Admin identities and cross-origin mutations before acceptance", async () => {
  const f = await emailFixture();
  for (const invalid of [
    null,
    {},
    { ...actor, id: "" },
    { ...actor, accountType: "customer" },
  ]) {
    await expect(
      emailService().accept(
        invalid as AdminIdentity,
        mutation(),
        f.input,
        evidence,
      ),
    ).rejects.toMatchObject({ status: 403 });
  }
  await expect(
    emailService().accept(
      actor,
      new Request("https://shop.test/accept", {
        method: "POST",
        headers: { Origin: "https://evil.test" },
      }),
      f.input,
      evidence,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    createPiEmailAcceptanceService(db, bucket, {
      inboundProtector: protector,
      appEnvironment: "preview",
    }).accept(actor, mutation(), f.input, evidence),
  ).rejects.toMatchObject({ status: 403 });
  expect((await counts(f.piId)).accepts).toBe(0);
});

it("fails closed for incomplete, stale, wrong-customer and conflicting evidence", async () => {
  const f = await emailFixture();
  const other = await emailFixture();
  const changes: Array<(i: AcceptPiFromEmailInput) => void> = [
    (i) => {
      i.commandId = "bad";
    },
    (i) => {
      i.explicitlyConfirmed = false;
    },
    (i) => {
      i.legalName = "";
    },
    (i) => {
      i.legalName = "Name\nInjected";
    },
    (i) => {
      i.snapshotHash = "f".repeat(64);
    },
    (i) => {
      i.documentVersion = 2;
    },
    (i) => {
      i.sourceMessageId = other.input.sourceMessageId;
    },
    (i) => {
      i.piId = other.piId;
    },
    (i) => {
      i.review.piReferenceExcerpt = "I acknowledge the commercial terms.";
    },
    (i) => {
      i.review.generalExcerpt = "Invented consent";
    },
    (i) => {
      i.review.madeToOrder = [];
    },
    (i) => {
      i.review.madeToOrder[0].lineIds = ["custom-a", "custom-a"];
    },
    (i) => {
      i.review.madeToOrder[0].specificationExcerpt = "Invented";
    },
    (i) => {
      i.review.madeToOrder[0].cancellationExcerpt = "";
    },
    (i) => {
      i.acknowledgements.general.confirmed = false;
    },
    (i) => {
      i.acknowledgements.general.version = "old";
    },
    (i) => {
      i.acknowledgements.madeToOrder = [];
    },
    (i) => {
      i.acknowledgements.madeToOrder[0].specificationsConfirmed = false;
    },
    (i) => {
      i.acknowledgements.madeToOrder[0].cancellationConfirmed = false;
    },
    (i) => {
      i.acknowledgements.madeToOrder[0].cancellationVersion = "old";
    },
  ];
  for (const change of changes) {
    const input = structuredClone(f.input);
    change(input);
    await expect(
      emailService().accept(actor, mutation(), input, evidence),
    ).rejects.toBeInstanceOf(Response);
  }
  expect(await counts(f.piId)).toEqual({ accepts: 0, commands: 0, audits: 0 });
});

it("verifies private envelope, raw bytes and parsed message on first acceptance and replay", async () => {
  const mismatch = await emailFixture(
    false,
    undefined,
    "Unrelated raw message",
  );
  await expect(accept(mismatch)).rejects.toMatchObject({ status: 409 });
  const f = await emailFixture();
  const badProtector = {
    ...protector,
    open: async () => JSON.stringify({ sender: "attacker@local.invalid" }),
  };
  await expect(
    createPiEmailAcceptanceService(db, bucket, {
      inboundProtector: badProtector,
      appEnvironment: "local",
    }).accept(actor, mutation(), f.input, evidence),
  ).rejects.toMatchObject({ status: 409 });
  const badStorage = await emailFixture();
  await bucket.put(badStorage.key, new Uint8Array(badStorage.raw.length));
  await expect(accept(badStorage)).rejects.toMatchObject({ status: 409 });
  await accept(f);
  await bucket.delete(f.key);
  await expect(accept(f)).rejects.toMatchObject({ status: 409 });
  expect((await counts(f.piId)).accepts).toBe(1);
});

it("deduplicates concurrent retries, rejects competing commands and preserves exact replay after replacement/expiry", async () => {
  const f = await emailFixture();
  const results = await Promise.all([accept(f), accept(f)]);
  expect(results[0]).toEqual(results[1]);
  const changed = { ...f.input, commandId: crypto.randomUUID() };
  expect(
    await emailService().accept(actor, mutation(), changed, evidence),
  ).toEqual(results[0]);
  for (const input of [
    { ...changed, legalName: "Other" },
    { ...changed, explicitlyConfirmed: false },
  ])
    await expect(
      emailService().accept(actor, mutation(), input, evidence),
    ).rejects.toBeInstanceOf(Response);
  await replaceQuote(f);
  expect(
    await emailService(
      db,
      bucket,
      () => new Date(Date.now() + 7 * 86400000),
    ).accept(actor, mutation(), changed, evidence),
  ).toEqual(results[0]);
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 2, audits: 1 });
  const other = await emailFixture();
  await expect(
    emailService().accept(
      actor,
      mutation(),
      { ...other.input, commandId: f.input.commandId },
      evidence,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect((await counts(other.piId)).accepts).toBe(0);
});

it("website and email sources cannot replace each other, but both enqueue the same copy type", async () => {
  const f = await emailFixture();
  await viewed(f);
  const website = await service().accept(
    f.profileId,
    mutation(),
    f.input,
    evidence,
  );
  expect(website.source).toBe("website");
  await expect(accept(f)).rejects.toMatchObject({ status: 409 });
  await copies().consume(message(website.id));
  expect((await copies().readLocalCapture(actor, website.id)).text).toContain(
    "Customer website confirmation",
  );
  const other = await emailFixture();
  const email = await accept(other);
  await viewed(other);
  await expect(
    service().accept(other.profileId, mutation(), other.input, evidence),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await service().customerStatus(other.profileId, other.id)).acceptance,
  ).toEqual(email);
});

it("rejects expired/superseded targets and transaction-time authorization or source changes", async () => {
  const expired = await emailFixture(
    false,
    new Date(Date.now() - 1000).toISOString(),
  );
  await expect(accept(expired)).rejects.toBeInstanceOf(Response);
  const superseded = await emailFixture();
  await replacePi(superseded);
  await expect(accept(superseded)).rejects.toBeInstanceOf(Response);
  for (const race of ["owner", "quote", "head", "source"] as const) {
    const f = await emailFixture(true);
    const database = interceptBatch(async () => {
      if (race === "owner")
        await db
          .prepare(
            "UPDATE customer_organization_memberships SET status='inactive' WHERE profile_id=?",
          )
          .bind(f.profileId)
          .run();
      if (race === "quote") await replaceQuote(f);
      if (race === "head")
        await db
          .prepare(
            "UPDATE proforma_invoice_heads SET version=version+1 WHERE request_id=?",
          )
          .bind(f.id)
          .run();
      if (race === "source")
        await db
          .prepare(
            "UPDATE quote_inbound_email_receipts SET state='quarantined' WHERE id=?",
          )
          .bind(f.receiptId)
          .run();
    });
    await expect(accept(f, database)).rejects.toBeInstanceOf(Response);
    expect(await counts(f.piId)).toEqual({
      accepts: 0,
      commands: 0,
      audits: 0,
    });
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM pi_email_acceptance_evidence WHERE pi_id=?",
        )
        .bind(f.piId)
        .first("n"),
    ).toBe(0);
  }
});

it("rolls back the whole primary command on audit failure and recovers lost commit responses", async () => {
  const f = await emailFixture();
  await db
    .prepare(
      "CREATE TRIGGER test_61_audit_failure BEFORE INSERT ON admin_audit_events WHEN NEW.event_type='pi.accepted' BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    )
    .run();
  try {
    await expect(accept(f)).rejects.toThrow();
    expect((await counts(f.piId)).accepts).toBe(0);
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM pi_email_acceptance_evidence WHERE pi_id=?",
        )
        .bind(f.piId)
        .first("n"),
    ).toBe(0);
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM pi_acceptance_copy_outbox o JOIN pi_acceptances a ON a.id=o.id WHERE a.pi_id=?",
        )
        .bind(f.piId)
        .first("n"),
    ).toBe(0);
  } finally {
    await db.prepare("DROP TRIGGER test_61_audit_failure").run();
  }
  const uncertain = new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await target.batch(statements);
          throw new Error("lost commit response");
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  expect((await accept(f, uncertain)).status).toBe("PI Accepted");
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 1, audits: 1 });
});

it("queue and payload failures remain reviewable/retryable without rolling back acceptance", async () => {
  const f = await emailFixture();
  const result = await accept(f);
  let time = Date.now();
  const svc = copies({ now: () => time });
  const queue = { send: vi.fn().mockRejectedValue(new Error("offline")) };
  expect((await svc.dispatch(queue)).failed).toBeGreaterThan(0);
  expect((await counts(f.piId)).accepts).toBe(1);
  const broken = copies({
    protector: {
      ...protector,
      seal: async () => {
        throw new Error("private key unavailable");
      },
    },
  });
  await broken.consume(message(result.id));
  expect((await svc.listAdmin(actor, { unresolved: true })).rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: result.id,
        state: "review",
        failure_code: "protected_payload_unavailable",
      }),
    ]),
  );
  await expect(
    svc.retryAdmin(actor, mutation(), result.id, ""),
  ).rejects.toMatchObject({ status: 400 });
  await svc.retryAdmin(actor, mutation(), result.id, "Encryption restored");
  time += 1000;
  await svc.consume(message(result.id));
  expect((await createD1PiAcceptanceCopies(db).read(result.id))?.state).toBe(
    "sent",
  );
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 1, audits: 1 });
});

it("retries uncertain delivery with identical payload/key, then stops outside the deduplication window", async () => {
  const f = await emailFixture();
  const result = await accept(f);
  let time = Date.now();
  const adapter: QuoteNotificationAdapter = {
    send: vi
      .fn()
      .mockRejectedValueOnce(new Error("uncertain"))
      .mockResolvedValue({ kind: "sent", providerId: "fake-only" }),
  };
  // No real transport: preview exercises provider behavior with a fully fake adapter.
  const env: NotificationEnvironment = {
    ...localEnv,
    APP_ENV: "preview",
    EMAIL_DELIVERY_MODE: "resend",
    EMAIL_FROM: "seller@seller.test",
    EMAIL_REPLY_DOMAIN: "reply.seller.test",
  };
  const svc = copies({ env, adapter, now: () => time });
  const first = message(result.id);
  await svc.consume(first);
  expect(first.retry).toHaveBeenCalled();
  time += 60000;
  await svc.consume(message(result.id));
  const calls = vi.mocked(adapter.send).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0][1]).toBe(`pi-acceptance-copy/${result.id}`);
  const second = await emailFixture();
  const accepted = await accept(second);
  vi.mocked(adapter.send).mockRejectedValue(new Error("uncertain"));
  await svc.consume(message(accepted.id));
  const before = vi.mocked(adapter.send).mock.calls.length;
  time += 24 * 3600000;
  await svc.consume(message(accepted.id));
  expect(vi.mocked(adapter.send).mock.calls).toHaveLength(before);
  await expect(
    svc.retryAdmin(actor, mutation(), accepted.id, "Retry"),
  ).rejects.toMatchObject({ status: 409 });
  expect((await counts(second.piId)).accepts).toBe(1);
});

it("rechecks recipient authority, restricts private capture access and rejects unknown jobs", async () => {
  const f = await emailFixture(true);
  const result = await accept(f);
  await db
    .prepare(
      "UPDATE customer_organization_memberships SET status='inactive' WHERE profile_id=?",
    )
    .bind(f.profileId)
    .run();
  await expect(accept(f)).rejects.toMatchObject({ status: 403 });
  await copies().consume(message(result.id));
  expect((await createD1PiAcceptanceCopies(db).read(result.id))?.state).toBe(
    "review",
  );
  await expect(
    copies().listAdmin(null as unknown as AdminIdentity),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    copies().readLocalCapture(null as unknown as AdminIdentity, result.id),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    await copies().consume({
      ...message(result.id),
      body: { type: "unrelated" },
    }),
  ).toBe(false);
});

it("leases copy processing so concurrent duplicate jobs capture exactly once", async () => {
  const f = await emailFixture();
  const accepted = await accept(f);
  const svc = copies();
  await Promise.all([
    svc.consume(message(accepted.id)),
    svc.consume(message(accepted.id)),
  ]);
  await svc.consume(message(accepted.id));
  const row = await createD1PiAcceptanceCopies(db).read(accepted.id);
  expect(row).toMatchObject({ state: "sent", attempts: 1 });
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM pi_acceptance_copy_captures WHERE acceptance_id=?",
      )
      .bind(accepted.id)
      .first("n"),
  ).toBe(1);
  await expect(
    svc.retryAdmin(actor, mutation(), accepted.id, "Duplicate retry"),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    db
      .prepare(
        "UPDATE pi_acceptance_copy_outbox SET recipient_email='other@local.invalid' WHERE id=?",
      )
      .bind(accepted.id)
      .run(),
  ).rejects.toThrow(/immutable/);
  await expect(
    db
      .prepare("DELETE FROM pi_acceptance_copy_outbox WHERE id=?")
      .bind(accepted.id)
      .run(),
  ).rejects.toThrow(/retained/);
  await expect(
    db
      .prepare("DELETE FROM pi_acceptance_copy_captures WHERE acceptance_id=?")
      .bind(accepted.id)
      .run(),
  ).rejects.toThrow(/immutable/);
});

it("keeps permanent delivery failure reviewable and manually retries the same intent", async () => {
  const f = await emailFixture();
  const accepted = await accept(f);
  const env: NotificationEnvironment = {
    ...localEnv,
    APP_ENV: "preview",
    EMAIL_DELIVERY_MODE: "resend",
    EMAIL_FROM: "seller@seller.test",
    EMAIL_REPLY_DOMAIN: "reply.seller.test",
  };
  const send = vi
    .fn()
    .mockResolvedValueOnce({ kind: "permanent", code: "provider_auth" })
    .mockResolvedValue({ kind: "sent", providerId: "fake-only" });
  const svc = copies({ env, adapter: { send } });
  await svc.consume(message(accepted.id));
  expect(await createD1PiAcceptanceCopies(db).read(accepted.id)).toMatchObject({
    state: "dead_letter",
  });
  await svc.retryAdmin(
    actor,
    mutation(),
    accepted.id,
    "Fake provider restored",
  );
  await svc.consume(message(accepted.id));
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  expect(await createD1PiAcceptanceCopies(db).read(accepted.id)).toMatchObject({
    state: "sent",
  });
  expect((await counts(f.piId)).accepts).toBe(1);
  await expect(svc.readLocalCapture(actor, accepted.id)).rejects.toMatchObject({
    status: 404,
  });
});

it("never sends real mail in local mode and quarantines a corrupt protected copy", async () => {
  const f = await emailFixture();
  const accepted = await accept(f);
  const send = vi.fn();
  await copies({
    env: { ...localEnv, EMAIL_DELIVERY_MODE: "resend" },
    adapter: { send },
  }).consume(message(accepted.id));
  expect(send).not.toHaveBeenCalled();
  expect(await createD1PiAcceptanceCopies(db).read(accepted.id)).toMatchObject({
    state: "review",
  });
  await copies().retryAdmin(
    actor,
    mutation(),
    accepted.id,
    "Restore local stub",
  );
  const corrupt = { ...protector, seal: async () => "corrupt-not-ciphertext" };
  await copies({ protector: corrupt }).consume(message(accepted.id));
  expect(await createD1PiAcceptanceCopies(db).read(accepted.id)).toMatchObject({
    state: "review",
    attempts: 0,
  });
  expect((await counts(f.piId)).accepts).toBe(1);
});

it("has no payment, Order or production writes in acceptance or copy processing", async () => {
  const f = await emailFixture();
  const guarded = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          if (
            /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:orders?\b|payments?\b|production\w*\b|seller_payment\w*\b)/i.test(
              sql,
            )
          )
            throw new Error("Downstream write forbidden");
          return target.prepare(sql);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const accepted = await accept(f, guarded);
  await createPiAcceptanceCopies({
    database: guarded,
    env: localEnv,
    protector,
  }).consume(message(accepted.id));
  const capture = await copies().readLocalCapture(actor, accepted.id);
  expect(capture.text).toContain(
    "not confirmation of payment, an Order, or authorization to start production",
  );
});

it("rejects a generic email status insert without its immutable source evidence", async () => {
  const f = await emailFixture();
  await expect(
    db
      .prepare(
        `INSERT INTO pi_acceptances(id,pi_id,request_id,profile_id,purchasing_context_id,source,document_version,snapshot_hash,quote_revision_id,accepted_at,business_hash,evidence_json)
    VALUES(?,?,?,?,?,'email',1,?,?,datetime('now'),?,'{}')`,
      )
      .bind(
        crypto.randomUUID(),
        f.piId,
        f.id,
        f.profileId,
        f.id,
        f.target.snapshotHash,
        f.quoteId,
        "a".repeat(64),
      )
      .run(),
  ).rejects.toThrow(/Verified email acceptance evidence required/);
  expect((await counts(f.piId)).accepts).toBe(0);
});

it("the real worker factory lists, dispatches and retries without a key; missing/invalid keys produce durable review", async () => {
  for (const key of [undefined, "invalid-short-key"]) {
    const f = await emailFixture();
    const accepted = await accept(f);
    const env = {
      ...localEnv,
      APP_ENV: "preview",
      EMAIL_DELIVERY_MODE: "resend",
      EMAIL_FROM: "seller@seller.test",
      EMAIL_REPLY_DOMAIN: "reply.seller.test",
      PREVIEW_NOTIFICATION_ENCRYPTION_KEY: key,
      DB: db,
    } as unknown as ApplicationBindings;
    const factory = await workerCopies(env);
    expect(
      (await factory.listAdmin(actor)).rows.some(
        (row) => row.id === accepted.id,
      ),
    ).toBe(true);
    const queue = { send: vi.fn().mockResolvedValue(undefined) };
    await factory.dispatch(queue);
    expect(queue.send).toHaveBeenCalled();
    await factory.consume(message(accepted.id));
    expect(
      await createD1PiAcceptanceCopies(db).read(accepted.id),
    ).toMatchObject({ state: "review", attempts: 0 });
    await factory.retryAdmin(
      actor,
      mutation(),
      accepted.id,
      "Restore the persistent encryption key",
    );
    expect(
      await createD1PiAcceptanceCopies(db).read(accepted.id),
    ).toMatchObject({ state: "retry" });
    expect((await counts(f.piId)).accepts).toBe(1);
  }
});

it("reconciles a failed attempt tomorrow into a fresh bounded generation with identical content and a new key", async () => {
  const f = await emailFixture();
  const accepted = await accept(f);
  let time = Date.now();
  const firstTime = time;
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("uncertain failure"))
    .mockResolvedValue({ kind: "sent", providerId: "new-delivery" });
  const env: NotificationEnvironment = {
    ...localEnv,
    APP_ENV: "preview",
    EMAIL_DELIVERY_MODE: "resend",
    EMAIL_FROM: "seller@seller.test",
    EMAIL_REPLY_DOMAIN: "reply.seller.test",
  };
  const svc = copies({ env, adapter: { send }, now: () => time });
  await svc.consume(message(accepted.id));
  const original = await createD1PiAcceptanceCopies(db).read(accepted.id);
  time += 24 * 3600000;
  await svc.consume(message(accepted.id));
  await expect(
    svc.retryAdmin(actor, mutation(), accepted.id, "Blind retry tomorrow"),
  ).rejects.toMatchObject({ status: 409 });
  const command = {
    commandId: crypto.randomUUID(),
    acceptanceId: accepted.id,
    generation: 1,
    outcome: "confirmed_not_delivered" as const,
    reference: "provider-ticket-61-no-delivery",
    reason: "Provider confirmed previous key produced no delivery",
    explicitlyConfirmed: true,
  };
  await expect(
    svc.reconcileAdmin(actor, mutation(), {
      ...command,
      explicitlyConfirmed: false,
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    svc.reconcileAdmin(actor, mutation(), { ...command, reference: "" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    svc.reconcileAdmin(null as unknown as AdminIdentity, mutation(), command),
  ).rejects.toMatchObject({ status: 403 });
  await svc.reconcileAdmin(actor, mutation(), command);
  await svc.reconcileAdmin(actor, mutation(), command);
  expect(await createD1PiAcceptanceCopies(db).read(accepted.id)).toMatchObject({
    generation: 2,
    state: "retry",
    attempts: 0,
    first_attempt_at: null,
    protected_payload: original!.protected_payload,
  });
  await expect(
    svc.reconcileAdmin(actor, mutation(), {
      ...command,
      reason: "Different evidence",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await svc.consume(message(accepted.id));
  expect(send.mock.calls).toHaveLength(2);
  expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
  expect(send.mock.calls[0][1]).toBe(`pi-acceptance-copy/${accepted.id}`);
  expect(send.mock.calls[1][1]).toBe(
    `pi-acceptance-copy/${accepted.id}/generation/2`,
  );
  expect(
    await db
      .prepare(
        "SELECT prior_attempts,prior_first_attempt_at FROM pi_acceptance_copy_reconciliations WHERE id=?",
      )
      .bind(command.commandId)
      .first(),
  ).toEqual({ prior_attempts: 1, prior_first_attempt_at: firstTime });
  expect(
    await db
      .prepare("SELECT count(*) n FROM admin_audit_events WHERE id=?")
      .bind(`pi-copy-reconciled:${command.commandId}`)
      .first("n"),
  ).toBe(1);
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 1, audits: 1 });
  await expect(
    db
      .prepare(
        "UPDATE pi_acceptance_copy_reconciliations SET reason='overwrite' WHERE id=?",
      )
      .bind(command.commandId)
      .run(),
  ).rejects.toThrow(/immutable/);
});

it("audits provider-confirmed delivery without resending and atomically rolls back failed reconciliation audit", async () => {
  const f = await emailFixture();
  const accepted = await accept(f);
  await db
    .prepare("UPDATE pi_acceptance_copy_outbox SET state='review' WHERE id=?")
    .bind(accepted.id)
    .run();
  const svc = copies();
  const command = {
    commandId: crypto.randomUUID(),
    acceptanceId: accepted.id,
    generation: 1,
    outcome: "delivered" as const,
    providerId: "provider-message-id",
    reference: "delivery-log-61",
    reason: "Provider confirmed delivery",
    explicitlyConfirmed: true,
  };
  await expect(
    svc.reconcileAdmin(actor, mutation(), { ...command, providerId: "" }),
  ).rejects.toMatchObject({ status: 400 });
  await db
    .prepare(
      "CREATE TRIGGER test_61_reconcile_audit BEFORE INSERT ON admin_audit_events WHEN NEW.event_type='pi.acceptance_copy_reconciled' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    )
    .run();
  try {
    await expect(
      svc.reconcileAdmin(actor, mutation(), command),
    ).rejects.toThrow();
    expect(
      await createD1PiAcceptanceCopies(db).read(accepted.id),
    ).toMatchObject({ state: "review", generation: 1 });
    expect(
      await createD1PiAcceptanceCopies(db).reconciliation(command.commandId),
    ).toBeNull();
  } finally {
    await db.prepare("DROP TRIGGER test_61_reconcile_audit").run();
  }
  await svc.reconcileAdmin(actor, mutation(), command);
  await svc.consume(message(accepted.id));
  expect(await createD1PiAcceptanceCopies(db).read(accepted.id)).toMatchObject({
    state: "sent",
    provider_id: "provider-message-id",
    generation: 1,
    attempts: 0,
  });
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM pi_acceptance_copy_captures WHERE acceptance_id=?",
      )
      .bind(accepted.id)
      .first("n"),
  ).toBe(0);
});

it("Admin UI data exposes only authorized candidates and verifies selected private evidence before enabling acceptance", async () => {
  const f = await emailFixture(true);
  const page = await emailService().adminPage(actor, f.id, f.piId);
  expect(page.emails).toHaveLength(1);
  expect(page.canAccept).toBe(false);
  const selected = await emailService().adminPage(actor, f.id, f.piId, {
    sourceMessageId: f.input.sourceMessageId,
  });
  expect(selected.canAccept).toBe(true);
  expect(selected.selected?.body).toContain(f.snapshot.documentNumber);
  expect(JSON.stringify(selected)).not.toMatch(
    /raw_key|protected_envelope|raw_checksum|pdf_object_key/,
  );
  await bucket.delete(f.key);
  const missing = await emailService().adminPage(actor, f.id, f.piId, {
    sourceMessageId: f.input.sourceMessageId,
  });
  expect(missing.canAccept).toBe(false);
  expect(missing.selected).toBeNull();
  expect(missing.sourceError).toBeTruthy();
  await db
    .prepare(
      "UPDATE customer_organization_memberships SET status='inactive' WHERE profile_id=?",
    )
    .bind(f.profileId)
    .run();
  expect(
    (await emailService().adminPage(actor, f.id, f.piId)).emails,
  ).toHaveLength(0);
});

it("retains the ten-attempt cap and requires audited reconciliation before resetting that generation budget", async () => {
  const f = await emailFixture();
  const accepted = await accept(f);
  let time = Date.now();
  const send = vi
    .fn()
    .mockResolvedValue({ kind: "retry", code: "provider_unavailable" });
  const env: NotificationEnvironment = {
    ...localEnv,
    APP_ENV: "preview",
    EMAIL_DELIVERY_MODE: "resend",
    EMAIL_FROM: "seller@seller.test",
    EMAIL_REPLY_DOMAIN: "reply.seller.test",
  };
  const svc = copies({ env, adapter: { send }, now: () => time });
  for (let attempt = 0; attempt < 11; attempt++) {
    await svc.consume(message(accepted.id));
    time += 3600000;
  }
  expect(send).toHaveBeenCalledTimes(10);
  expect(await createD1PiAcceptanceCopies(db).read(accepted.id)).toMatchObject({
    attempts: 10,
    state: "review",
    generation: 1,
  });
  await expect(
    svc.retryAdmin(actor, mutation(), accepted.id, "Blind budget reset"),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    db
      .prepare(
        "UPDATE pi_acceptance_copy_outbox SET generation=2,attempts=0,first_attempt_at=NULL,state='retry' WHERE id=?",
      )
      .bind(accepted.id)
      .run(),
  ).rejects.toThrow(/immutable/);
  await svc.reconcileAdmin(actor, mutation(), {
    commandId: crypto.randomUUID(),
    acceptanceId: accepted.id,
    generation: 1,
    outcome: "confirmed_not_delivered",
    reference: "all-ten-attempts-confirmed-not-delivered",
    reason: "Provider investigated every attempt",
    explicitlyConfirmed: true,
  });
  await svc.consume(message(accepted.id));
  expect(send).toHaveBeenCalledTimes(11);
  expect(await createD1PiAcceptanceCopies(db).read(accepted.id)).toMatchObject({
    generation: 2,
    attempts: 1,
  });
});
