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
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createPiAcceptanceService,
  type AcceptWebsitePiInput,
} from "../app/modules/proforma-invoice/application/pi-acceptance-service";
import { piSha256 } from "../app/modules/proforma-invoice/domain/proforma-invoice";
import type { PiAcceptanceSnapshot } from "../app/modules/proforma-invoice/domain/pi-acceptance";
import { createD1SellerCommercialSettingsRepository } from "../app/modules/seller-settings/infrastructure/d1-seller-commercial-settings-repository";
import { createD1QuoteRequestRepository } from "../app/modules/quote-request/infrastructure/d1-quote-request-repository";
import { customerQuoteProjection } from "../app/modules/quote-request/domain/quote-request";

const directory = mkdtempSync(join(tmpdir(), "pi-acceptance-"));
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
      (name) => /^\d{4}_.*\.sql$/.test(name) && name.slice(0, 4) <= "0076",
    )
    .sort()) {
    await migrate(join("migrations", file));
  }
  expect(
    await db
      .prepare("SELECT version FROM application_schema_state WHERE singleton=1")
      .first(),
  ).toEqual({ version: 77 });
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
  const snapshot: PiAcceptanceSnapshot = {
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
  const json = JSON.stringify({
    ...snapshot,
    totals: { currency: "USD", totalCents: 25345 },
  });
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

it("requires real validated PDF retrieval, records bounded view evidence and exposes safe accepted status", async () => {
  const f = await fixture();
  expect(await service().customerStatus(f.profileId, f.id)).toMatchObject({
    canAccept: false,
    viewId: null,
    status: "PI Ready",
  });
  await expect(
    service().accept(f.profileId, mutation(), f.input, evidence),
  ).rejects.toMatchObject({ status: 400 });
  const download = await service().customerView(
    f.profileId,
    f.id,
    f.target,
    "download",
    evidence,
  );
  expect(new Uint8Array(await download.response.arrayBuffer())).toEqual(pdf);
  expect(download.response.headers.get("Cache-Control")).toBe(
    "private, no-store",
  );
  await viewed(f);
  await viewed(f);
  expect(await service().customerViews(f.profileId, f.id, f.piId)).toHaveLength(
    2,
  );
  expect(await service().customerStatus(f.profileId, f.id)).toMatchObject({
    canAccept: true,
  });
  const result = await service().accept(
    f.profileId,
    mutation(),
    f.input,
    evidence,
  );
  expect(result).toMatchObject({
    status: "PI Accepted",
    ...f.target,
    legalName: "Test Buyer LLC",
    source: "website",
  });
  const raw = await db
    .prepare("SELECT evidence_json FROM pi_acceptances WHERE pi_id=?")
    .bind(f.piId)
    .first<string>("evidence_json");
  expect(JSON.parse(raw!)).toMatchObject({
    customer: { profileId: f.profileId, purchasingContextId: f.id },
    requestEvidence: evidence,
    policySource: f.target,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /SERVER_REQUEST|SERVER_USER_AGENT|192\.0\.2|profileId|purchasingContextId/,
  );
  expect(await service().customerStatus(f.profileId, f.id)).toMatchObject({
    canAccept: false,
    status: "PI Accepted",
    acceptance: result,
  });
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 1, audits: 1 });
});

it("projects only accepted current PIs in one list query and drops status on replacement", async () => {
  for (const replace of [replacePi, replaceQuote]) {
    const f = await fixture();
    const sql: string[] = [];
    const repository = createD1QuoteRequestRepository({
      prepare(query: string) {
        sql.push(query);
        return db.prepare(query);
      },
    } as D1Database);
    expect(
      customerQuoteProjection((await repository.findOwned(f.profileId, f.id))!)
        .progress.code,
    ).toBe("PI_ISSUED");
    expect(
      (await repository.findOwned(f.profileId, f.id))
        ?.acceptedCurrentPiQuoteRevisionId,
    ).toBeNull();
    await viewed(f);
    await service().accept(f.profileId, mutation(), f.input, evidence);
    sql.length = 0;
    const records = await repository.listOwned(f.profileId);
    expect(sql).toHaveLength(1);
    const accepted = records.find((record) => record.id === f.id)!;
    expect(accepted.currentPi).toMatchObject({
      currency: "USD",
      totalCents: 25345,
    });
    expect(customerQuoteProjection(accepted).progress.code).toBe("PI_ACCEPTED");
    expect(
      customerQuoteProjection((await repository.findOwned(f.profileId, f.id))!)
        .progress.code,
    ).toBe("PI_ACCEPTED");
    expect(await repository.findOwned("wrong-owner", f.id)).toBeNull();
    expect(await repository.listOwned("wrong-owner")).toEqual([]);
    await replace(f);
    const historical = (await repository.findOwned(f.profileId, f.id))!;
    expect(historical.acceptedCurrentPiQuoteRevisionId).toBeNull();
    expect(customerQuoteProjection(historical).progress.code).toBe(
      replace === replacePi ? "PI_ISSUED" : "PI_REPLACEMENT_REQUIRED",
    );
    expect((await counts(f.piId)).accepts).toBe(1);
  }
});

it("does not record a view for missing or corrupted PDF bytes", async () => {
  const f = await fixture();
  await bucket.delete(f.objectKey);
  await expect(viewed(f)).rejects.toMatchObject({ status: 404 });
  await bucket.put(f.objectKey, new Uint8Array(pdf.length));
  await expect(viewed(f)).rejects.toMatchObject({ status: 409 });
  expect(await service().customerViews(f.profileId, f.id, f.piId)).toEqual([]);
});

it("rejects unverified and wrong profiles, foreign view IDs and forged target versions", async () => {
  const f = await fixture();
  const other = await fixture();
  await viewed(other);
  await expect(
    service().customerStatus(other.profileId, f.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service().customerView(other.profileId, f.id, f.target, "view", evidence),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service().accept(
      f.profileId,
      mutation(),
      { ...f.input, viewId: other.input.viewId },
      evidence,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await viewed(f);
  for (const change of [
    { documentVersion: 2 },
    { snapshotHash: "f".repeat(64) },
    { piId: other.piId },
  ]) {
    await expect(
      service().accept(
        f.profileId,
        mutation(),
        { ...f.input, ...change },
        evidence,
      ),
    ).rejects.toBeInstanceOf(Response);
  }
  await db
    .prepare("UPDATE customer_profiles SET email_verified_at='' WHERE id=?")
    .bind(f.profileId)
    .run();
  await expect(
    service().accept(f.profileId, mutation(), f.input, evidence),
  ).rejects.toMatchObject({ status: 404 });
  expect((await counts(f.piId)).accepts).toBe(0);
});

it("uses current organization authority, not the historical RFQ submitter, and scopes viewing to the accepting contact", async () => {
  const f = await fixture(true);
  await viewed(f);
  await db
    .prepare(
      "UPDATE customer_organization_memberships SET status='inactive' WHERE profile_id=?",
    )
    .bind(f.profileId)
    .run();
  await expect(
    service().accept(f.profileId, mutation(), f.input, evidence),
  ).rejects.toMatchObject({ status: 404 });
  const replacement = `replacement-${crypto.randomUUID()}`;
  await profile(replacement);
  await grant(f.id, replacement);
  await expect(
    service().accept(replacement, mutation(), f.input, evidence),
  ).rejects.toMatchObject({ status: 400 });
  const result = await service().customerView(
    replacement,
    f.id,
    f.target,
    "view",
    evidence,
  );
  const accepted = await service().accept(
    replacement,
    mutation(),
    { ...f.input, viewId: result.view.id },
    evidence,
  );
  expect(accepted.status).toBe("PI Accepted");
});

it("rejects all missing and stale acknowledgements without creating business state", async () => {
  const f = await fixture();
  await viewed(f);
  for (const change of [
    (i: AcceptWebsitePiInput) => {
      i.legalName = "";
    },
    (i: AcceptWebsitePiInput) => {
      i.acknowledgements.general.confirmed = false;
    },
    (i: AcceptWebsitePiInput) => {
      i.acknowledgements.general.version = "old";
    },
    (i: AcceptWebsitePiInput) => {
      i.acknowledgements.madeToOrder = [];
    },
    (i: AcceptWebsitePiInput) => {
      i.acknowledgements.madeToOrder[0].lineIds = ["custom-a"];
    },
    (i: AcceptWebsitePiInput) => {
      i.acknowledgements.madeToOrder[0].specificationsConfirmed = false;
    },
    (i: AcceptWebsitePiInput) => {
      i.acknowledgements.madeToOrder[0].cancellationConfirmed = false;
    },
    (i: AcceptWebsitePiInput) => {
      i.acknowledgements.madeToOrder[0].cancellationVersion = "old";
    },
  ]) {
    const input = structuredClone(f.input);
    change(input);
    await expect(
      service().accept(f.profileId, mutation(), input, evidence),
    ).rejects.toMatchObject({ status: 400 });
  }
  expect(await counts(f.piId)).toEqual({ accepts: 0, commands: 0, audits: 0 });
});

it("deduplicates simultaneous commands and returns the original evidence for equivalent different commands", async () => {
  const f = await fixture();
  await viewed(f);
  const [a, b] = await Promise.all([
    service().accept(f.profileId, mutation(), f.input, evidence),
    service().accept(f.profileId, mutation(), f.input, evidence),
  ]);
  expect(a).toEqual(b);
  const different = structuredClone(f.input);
  different.commandId = crypto.randomUUID();
  different.legalName = "Test Buyer LLC";
  const group = different.acknowledgements.madeToOrder[0];
  different.acknowledgements.madeToOrder = group.lineIds.map((id) => ({
    ...group,
    lineIds: [id],
  }));
  expect(
    await service().accept(f.profileId, mutation(), different, {
      requestId: "later",
      ipAddress: null,
      userAgent: null,
    }),
  ).toEqual(a);
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 2, audits: 1 });
  await expect(
    service().accept(
      f.profileId,
      mutation(),
      {
        ...different,
        commandId: crypto.randomUUID(),
        legalName: "Different Buyer",
      },
      evidence,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    service().accept(
      f.profileId,
      mutation(),
      { ...f.input, viewId: "changed" },
      evidence,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await replaceQuote(f);
  const later = () => new Date(Date.now() + 3 * 86400000);
  expect(
    await service(db, bucket, later).accept(
      f.profileId,
      mutation(),
      different,
      evidence,
    ),
  ).toEqual(a);
  expect(
    (await service(db, bucket, later).customerStatus(f.profileId, f.id))
      .current,
  ).toBe(false);
});

it("two different first commands create one acceptance and two receipts", async () => {
  const f = await fixture();
  await viewed(f);
  const results = await Promise.all([
    service().accept(f.profileId, mutation(), f.input, evidence),
    service().accept(
      f.profileId,
      mutation(),
      { ...f.input, commandId: crypto.randomUUID() },
      evidence,
    ),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 2, audits: 1 });
});

it("competing legal names cannot create conflicting acceptances", async () => {
  const f = await fixture();
  await viewed(f);
  const results = await Promise.allSettled([
    service().accept(f.profileId, mutation(), f.input, evidence),
    service().accept(
      f.profileId,
      mutation(),
      { ...f.input, commandId: crypto.randomUUID(), legalName: "Other Buyer" },
      evidence,
    ),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 1, audits: 1 });
});

it("a replaced PI cannot accept even when its view and quote revision still match", async () => {
  const f = await fixture();
  await viewed(f);
  const database = interceptBatch(async () => {
    await replacePi(f);
  });
  await expect(
    service(database).accept(f.profileId, mutation(), f.input, evidence),
  ).rejects.toMatchObject({ status: 409 });
  expect(await counts(f.piId)).toEqual({ accepts: 0, commands: 0, audits: 0 });
  expect(
    await service().customerStatus(f.profileId, f.id, f.piId),
  ).toMatchObject({ current: false, canAccept: false });
  await expect(viewed(f)).rejects.toMatchObject({ status: 409 });
});

it("a command id cannot be reused for another exact PI target", async () => {
  const first = await fixture();
  const second = await fixture();
  await viewed(first);
  await viewed(second);
  await service().accept(first.profileId, mutation(), first.input, evidence);
  await expect(
    service().accept(
      second.profileId,
      mutation(),
      {
        ...second.input,
        commandId: first.input.commandId,
      },
      evidence,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await counts(second.piId)).toEqual({
    accepts: 0,
    commands: 0,
    audits: 0,
  });
});

it("rechecks organization revocation and head/quote CAS at the acceptance INSERT", async () => {
  for (const race of ["owner", "head", "quote"] as const) {
    const f = await fixture(true);
    await viewed(f);
    const database = interceptBatch(async () => {
      if (race === "owner")
        await db
          .prepare(
            "UPDATE customer_organization_memberships SET status='inactive' WHERE profile_id=?",
          )
          .bind(f.profileId)
          .run();
      if (race === "head")
        await db
          .prepare(
            "UPDATE proforma_invoice_heads SET version=version+1 WHERE request_id=?",
          )
          .bind(f.id)
          .run();
      if (race === "quote") await replaceQuote(f);
    });
    await expect(
      service(database).accept(f.profileId, mutation(), f.input, evidence),
    ).rejects.toBeInstanceOf(Response);
    expect(await counts(f.piId)).toEqual({
      accepts: 0,
      commands: 0,
      audits: 0,
    });
  }
});

it("does not create viewing evidence if ownership or current quote changes during byte validation", async () => {
  for (const race of ["owner", "quote"] as const) {
    const f = await fixture(true);
    const storage = new Proxy(bucket, {
      get(target, key) {
        if (key === "get")
          return async (path: string) => {
            const result = await target.get(path);
            if (race === "owner")
              await db
                .prepare(
                  "UPDATE customer_organization_memberships SET status='inactive' WHERE profile_id=?",
                )
                .bind(f.profileId)
                .run();
            else await replaceQuote(f);
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      service(db, storage).customerView(
        f.profileId,
        f.id,
        f.target,
        "view",
        evidence,
      ),
    ).rejects.toBeInstanceOf(Response);
    expect(
      await db
        .prepare("SELECT count(*) n FROM pi_customer_views WHERE pi_id=?")
        .bind(f.piId)
        .first("n"),
    ).toBe(0);
  }
});

it("enforces real database expiry even when a request validated before the deadline", async () => {
  const f = await fixture(false, new Date(Date.now() + 1800).toISOString());
  await viewed(f);
  const database = interceptBatch(async () => {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, Date.parse(f.snapshot.validUntil) - Date.now() + 30),
      ),
    );
  });
  await expect(
    service(database).accept(f.profileId, mutation(), f.input, evidence),
  ).rejects.toMatchObject({ status: 409 });
  expect(await counts(f.piId)).toEqual({ accepts: 0, commands: 0, audits: 0 });
});

it("rolls back acceptance if its audit fails and recovers an uncertain committed response", async () => {
  const f = await fixture();
  await viewed(f);
  await db
    .prepare(
      "CREATE TRIGGER test_acceptance_audit_failure BEFORE INSERT ON admin_audit_events WHEN NEW.event_type='pi.accepted' BEGIN SELECT RAISE(ABORT,'test audit failed'); END",
    )
    .run();
  try {
    await expect(
      service().accept(f.profileId, mutation(), f.input, evidence),
    ).rejects.toThrow();
    expect(await counts(f.piId)).toEqual({
      accepts: 0,
      commands: 0,
      audits: 0,
    });
  } finally {
    await db.prepare("DROP TRIGGER test_acceptance_audit_failure").run();
  }
  let once = false;
  const uncertain = new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (!once) {
            once = true;
            throw new Error("lost commit response");
          }
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  expect(
    (
      await service(uncertain).accept(
        f.profileId,
        mutation(),
        f.input,
        evidence,
      )
    ).status,
  ).toBe("PI Accepted");
  expect(await counts(f.piId)).toEqual({ accepts: 1, commands: 1, audits: 1 });
});

it("rejects cross-origin mutations and keeps immutable evidence without Order/payment/notification writes", async () => {
  const f = await fixture();
  await viewed(f);
  await expect(
    service().accept(
      f.profileId,
      new Request("https://shop.test/accept", {
        method: "POST",
        headers: { Origin: "https://evil.test" },
      }),
      f.input,
      evidence,
    ),
  ).rejects.toMatchObject({ status: 403 });
  const guarded = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          if (
            /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:orders|payments|quote_notification|.*outbox)/i.test(
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
  await service(guarded).accept(f.profileId, mutation(), f.input, evidence);
  for (const table of [
    "pi_customer_views",
    "pi_acceptances",
    "pi_acceptance_commands",
  ]) {
    await expect(db.prepare(`UPDATE ${table} SET id=id`).run()).rejects.toThrow(
      /immutable/,
    );
    await expect(db.prepare(`DELETE FROM ${table}`).run()).rejects.toThrow(
      /immutable/,
    );
  }
});
