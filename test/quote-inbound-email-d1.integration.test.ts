import {
  mkdtempSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { dkimSign } from "mailauth/lib/dkim/sign";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { PDFDocument } from "pdf-lib";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import type { AdminIdentity } from "../workers/admin-access";
import {
  createQuoteInboundEmail,
  type InboundEmailMessage,
  type PlatformEmailVerifier,
  type InboundQueueJob,
} from "../app/modules/quote-inbound-email";
import {
  createAesGcmNotificationProtector,
  createQuoteNotifications,
  quoteNotificationOutboxStatement,
  type NotificationProtector,
} from "../app/modules/quote-notifications";
import { createQuoteConversationService } from "../app/modules/quote-conversation/application/quote-conversation-service";
import { createInboundEmailVerifier } from "../workers/inbound-email-verifier";
import {
  quoteInboundEmail,
  receiveQuoteEmail,
} from "../workers/quote-inbound-email";
import { consumeQuoteNotifications } from "../workers/quote-notifications";
import type { ApplicationBindings } from "../workers/environment";
import { createD1InboundEmail } from "../app/modules/quote-inbound-email/infrastructure/d1-inbound-email";
import { parseInboundMime } from "../app/modules/quote-inbound-email/infrastructure/mime-parser";
import {
  INBOUND_INGRESS_MAX_BYTES,
  INBOUND_QUOTE_MAX_BYTES,
  INBOUND_QUOTE_MAX_RECEIPTS,
  INBOUND_INGRESS_MAX_RECEIPTS,
} from "../app/modules/quote-inbound-email/domain/inbound-email";

const directory = mkdtempSync(join(tmpdir(), "quote-inbound-email-"));
const configPath = join(directory, "wrangler.json");
let platform: Awaited<
  ReturnType<
    typeof getPlatformProxy<{ DB: D1Database; PRIVATE_FILES: R2Bucket }>
  >
>;
let db: D1Database;
let bucket: R2Bucket;
let protector: NotificationProtector;
let clock = Date.now();
const env = {
  APP_ENV: "local",
  EMAIL_REPLY_DOMAIN: "reply.local.invalid",
} as const;
const admin: AdminIdentity = {
  id: "inbound-admin",
  email: "admin@seller.test",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
const transportEvents = new WeakMap<InboundEmailMessage, string>();
const verify: PlatformEmailVerifier = async ({ message, rawSha256 }) => ({
  provider: "local-fixture",
  authenticatedSender: message.from,
  rawSha256,
  mechanism: "dmarc-aligned",
  eventId: transportEvents.get(message),
});
function notifications() {
  return createQuoteNotifications({
    database: db,
    env: {
      ...env,
      EMAIL_FROM: "quotes@local.invalid",
      EMAIL_DELIVERY_MODE: "stub",
    },
    protector,
    now: () => clock,
  });
}
function service(
  options: {
    database?: D1Database;
    files?: R2Bucket;
    verifier?: PlatformEmailVerifier | null;
  } = {},
) {
  return createQuoteInboundEmail({
    database: options.database ?? db,
    bucket: options.files ?? bucket,
    env,
    protector,
    now: () => clock,
    resolveReplyToken: notifications().resolveReplyToken,
    verifyPlatformEmail:
      options.verifier === null ? undefined : (options.verifier ?? verify),
  });
}
function queueMessage(id: string) {
  return {
    body: { type: "quote-inbound-email", receiptId: id },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}
async function row(id: string) {
  return (await db
    .prepare("SELECT * FROM quote_inbound_email_receipts WHERE id=?")
    .bind(id)
    .first())!;
}
function mail(input: {
  from: string;
  to: string;
  body?: string;
  event?: string;
  messageId?: string;
  headers?: string;
  mimeFrom?: string;
}) {
  const raw = new TextEncoder().encode(
    `From: ${input.mimeFrom ?? input.from}\r\nTo: ${input.to}\r\nMessage-ID: <${input.messageId ?? crypto.randomUUID()}@customer.test>\r\nMIME-Version: 1.0\r\n${input.headers ?? "Content-Type: text/plain; charset=utf-8"}\r\n\r\n${input.body ?? "Please use the revised quantity."}`,
  );
  const message: InboundEmailMessage = {
    from: input.from,
    to: input.to,
    rawSize: raw.byteLength,
    headers: new Headers(),
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(raw);
        controller.close();
      },
    }),
  };
  transportEvents.set(message, input.event ?? crypto.randomUUID());
  return message;
}

async function fixture(organization = false) {
  const id = crypto.randomUUID();
  const profile = `profile-${id}`;
  const email = `${id}@customer.test`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES(?,?,?,'2026-09-14','2026-09-14','2026-09-14')",
      )
      .bind(profile, email, email),
    ...(organization
      ? [
          db
            .prepare(
              "INSERT INTO customer_organizations(id,legal_name,country_code,created_at,updated_at) VALUES(?,'Buyer','US','2026-09-14','2026-09-14')",
            )
            .bind(id),
          db
            .prepare(
              "INSERT INTO customer_organization_memberships(id,organization_id,profile_id,role,status,created_at) VALUES(?,?,?,'primary_contact','active','2026-09-14')",
            )
            .bind(id, id, profile),
        ]
      : []),
    db
      .prepare(
        "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,organization_id,created_at,updated_at) VALUES(?,?,?,?,'2026-09-14','2026-09-14')",
      )
      .bind(
        id,
        organization ? "organization" : "individual",
        organization ? null : profile,
        organization ? id : null,
      ),
    db
      .prepare(
        "INSERT INTO customer_profile_purchasing_context_access(profile_id,context_id,created_at) VALUES(?,?,'2026-09-14')",
      )
      .bind(profile, id),
    db
      .prepare(
        `INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,
      source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at)
      VALUES(?,?,?,?,'session',1,'address',?,'DDP','USD',0,0,?,'{}','2026-09-14')`,
      )
      .bind(
        id,
        id,
        profile,
        id,
        organization ? "organization" : "individual",
        id,
      ),
    db
      .prepare(
        "INSERT INTO quote_conversations(request_id,created_at) VALUES(?,'2026-09-14')",
      )
      .bind(id),
    db
      .prepare(
        `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,source,delivery_state)
      VALUES(?,?,'admin','inbound-admin','Please reply','2026-09-14',?,'hash','website','available')`,
      )
      .bind(id, id, id),
    quoteNotificationOutboxStatement(db, {
      messageId: id,
      requestId: id,
      createdAt: new Date(clock).toISOString(),
    }),
  ]);
  await notifications().consume({
    body: { type: "quote-conversation-notification", notificationId: id },
    ack() {},
    retry() {},
  });
  const capture = await notifications().readLocalCapture(admin, id);
  return { id, profile, email, to: capture.reply_to };
}

let preserved: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  const migrationDirectory = join(directory, "migrations");
  mkdirSync(migrationDirectory);
  for (const file of readdirSync("migrations")
    .filter(
      (name) => /^\d{4}_.*\.sql$/.test(name) && name.slice(0, 4) <= "0070",
    )
    .sort())
    copyFileSync(join("migrations", file), join(migrationDirectory, file));
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "quote-inbound-isolated-test",
      compatibility_date: "2026-08-20",
      queues: {
        producers: [{ binding: "ASYNC_JOBS", queue: "inbound-fixture-jobs" }],
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "quote-inbound-isolated-test",
          database_id: crypto.randomUUID(),
          migrations_dir: migrationDirectory,
        },
      ],
      r2_buckets: [
        {
          binding: "PRIVATE_FILES",
          bucket_name: "quote-inbound-isolated-files",
        },
      ],
    }),
  );
  function wrangler(args: string[]) {
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        ...args,
        "--config",
        configPath,
        "--local",
        "--persist-to",
        directory,
      ],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          CLOUDFLARE_ENV: "",
          WRANGLER_SEND_METRICS: "false",
        },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }
  wrangler(["d1", "migrations", "apply", "quote-inbound-isolated-test"]);
  platform = await getPlatformProxy<{
    DB: D1Database;
    PRIVATE_FILES: R2Bucket;
  }>({
    configPath,
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  bucket = platform.env.PRIVATE_FILES;
  protector = createAesGcmNotificationProtector(
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  );
  preserved = await fixture();
  await db
    .prepare(
      "INSERT INTO quote_conversation_attachments(message_id,filename,content_type,byte_size,checksum,object_key) VALUES(?,'old.pdf','application/pdf',1,'old-hash','old-private-key')",
    )
    .bind(preserved.id)
    .run();
  await bucket.put("old-private-key", "x");
  await platform.dispose();
  copyFileSync(
    existsSync("migrations/0071_quote_inbound_email.sql")
      ? "migrations/0071_quote_inbound_email.sql"
      : ".scratch/quote-inbound-email-migration.sql",
    join(migrationDirectory, "0071_quote_inbound_email.sql"),
  );
  wrangler(["d1", "migrations", "apply", "quote-inbound-isolated-test"]);
  wrangler([
    "d1",
    "execute",
    "quote-inbound-isolated-test",
    "--command",
    "INSERT INTO quote_inbound_email_receipts(id,event_key,receipt_hash,raw_checksum,raw_size,state,created_at,next_attempt_at,next_dispatch_at) VALUES('migration-terminal','migration-terminal','hash','hash',0,'dead_letter',0,0,0)",
  ]);
  copyFileSync(
    "migrations/0072_quote_inbound_email_recovery.sql",
    join(migrationDirectory, "0072_quote_inbound_email_recovery.sql"),
  );
  wrangler(["d1", "migrations", "apply", "quote-inbound-isolated-test"]);
  platform = await getPlatformProxy<{
    DB: D1Database;
    PRIVATE_FILES: R2Bucket;
  }>({
    configPath,
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  bucket = platform.env.PRIVATE_FILES;
}, 60_000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("migrates existing website messages and notification FKs without rewriting history or dropping append-only guards", async () => {
  expect(
    await db
      .prepare("SELECT version FROM application_schema_state WHERE singleton=1")
      .first(),
  ).toEqual({ version: 73 });
  expect(await row("migration-terminal")).toMatchObject({
    state: "dead_letter",
    cleanup_pending: 1,
    cleanup_attempts: 0,
  });
  expect(await db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({
    results: [],
  });
  expect(
    await db
      .prepare("SELECT source,body FROM quote_conversation_messages WHERE id=?")
      .bind(preserved.id)
      .first(),
  ).toEqual({ source: "website", body: "Please reply" });
  expect(
    await db
      .prepare(
        "SELECT object_key FROM quote_conversation_attachments WHERE message_id=?",
      )
      .bind(preserved.id)
      .first(),
  ).toEqual({ object_key: "old-private-key" });
  expect(
    await db
      .prepare("SELECT message_id FROM quote_notification_outbox WHERE id=?")
      .bind(preserved.id)
      .first(),
  ).toEqual({ message_id: preserved.id });
  expect(
    await notifications().resolveReplyToken(
      preserved.to.split("@")[0],
      preserved.email,
    ),
  ).toMatchObject({ requestId: preserved.id });
  expect(
    (await notifications().readLocalCapture(admin, preserved.id)).to,
  ).toEqual([preserved.email]);
  expect(await (await bucket.get("old-private-key"))!.text()).toBe("x");
  await expect(
    db
      .prepare(
        "UPDATE quote_conversation_messages SET body='changed' WHERE id=?",
      )
      .bind(preserved.id)
      .run(),
  ).rejects.toThrow(/append only/);
  await expect(
    db
      .prepare("DELETE FROM quote_conversation_messages WHERE id=?")
      .bind(preserved.id)
      .run(),
  ).rejects.toThrow(/append only/);
});

it("runs offline RSA-authenticated email through the real runtime factories, D1, R2 and local Queue", async () => {
  const quote = await fixture();
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const unsigned = Buffer.from(
    `From: ${quote.email}\r\nTo: ${quote.to}\r\nMessage-ID: <${crypto.randomUUID()}@customer.test>\r\nSubject: Signed reply\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nConfirm the signed quantity.\r\n`,
  );
  const signature = await dkimSign(unsigned, {
    algorithm: "rsa-sha256",
    signatureData: [
      {
        signingDomain: "customer.test",
        selector: "fixture",
        privateKey: pair.privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
    ],
  });
  expect(signature.errors).toEqual([]);
  const raw = Buffer.concat([Buffer.from(signature.signatures), unsigned]);
  const txt = `v=DKIM1; k=rsa; p=${pair.publicKey.export({ type: "spki", format: "der" }).toString("base64")}`;
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    expect(String(url)).toBe(
      "https://cloudflare-dns.com/dns-query?name=fixture._domainkey.customer.test&type=TXT",
    );
    return Response.json({
      Status: 0,
      Answer: [
        {
          name: "fixture._domainkey.customer.test",
          type: 16,
          data: txt
            .match(/.{1,180}/g)!
            .map((part) => JSON.stringify(part))
            .join(" "),
        },
      ],
    });
  });
  const jobs: unknown[] = [];
  const queue = (platform.env as unknown as { ASYNC_JOBS: Queue }).ASYNC_JOBS;
  const runtime = {
    ...env,
    DB: db,
    PRIVATE_FILES: bucket,
    EMAIL_FROM: "quotes@local.invalid",
    EMAIL_DELIVERY_MODE: "stub",
    ASYNC_JOBS: {
      async send(body: unknown) {
        await queue.send(body);
        jobs.push(body);
      },
    },
  } as unknown as ApplicationBindings;
  function incoming(bytes = raw): InboundEmailMessage {
    return {
      from: quote.email,
      to: quote.to,
      rawSize: bytes.length,
      headers: new Headers({
        "Authentication-Results": "attacker; dmarc=pass",
      }),
      raw: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }
  const verifier = createInboundEmailVerifier({ fetcher });
  const receipt = await receiveQuoteEmail(incoming(), runtime, verifier);
  expect(receipt.state).toBe("pending");
  expect(fetcher).toHaveBeenCalled();
  expect(jobs).toContainEqual({
    type: "quote-inbound-email",
    receiptId: receipt.receiptId,
  });
  const staged = await row(receipt.receiptId);
  expect(
    new Uint8Array(
      await (await bucket.get(String(staged.raw_key)))!.arrayBuffer(),
    ),
  ).toEqual(new Uint8Array(raw));
  // Reconstruct the consumer factory, exercising the runtime's persistent encryption key.
  const consumer = await quoteInboundEmail(runtime);
  const job = queueMessage(receipt.receiptId);
  await consumeQuoteNotifications(
    { messages: [job] } as unknown as MessageBatch<unknown>,
    runtime,
    consumer.consume,
  );
  expect(job.ack).toHaveBeenCalledOnce();
  expect(job.retry).not.toHaveBeenCalled();
  const conversation = await createQuoteConversationService(db, bucket, {
    kind: "customer",
    profileId: quote.profile,
  }).list(quote.id);
  expect(conversation.messages).toContainEqual(
    expect.objectContaining({
      source: "email",
      authorRole: "customer",
      body: "Confirm the signed quantity.",
    }),
  );
  expect(await receiveQuoteEmail(incoming(), runtime, verifier)).toMatchObject({
    receiptId: receipt.receiptId,
    state: "appended",
  });
  await consumer.consume(queueMessage(receipt.receiptId));
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_conversation_messages WHERE request_id=? AND source='email'",
      )
      .bind(quote.id)
      .first(),
  ).toEqual({ n: 1 });
  const rejected = await receiveQuoteEmail(
    incoming(
      Buffer.from(raw.toString().replace("signed quantity", "forged quantity")),
    ),
    runtime,
    verifier,
  );
  expect(rejected).toMatchObject({
    state: "quarantined",
    reason: "authentication_unverified",
  });
  expect(await row(rejected.receiptId)).toMatchObject({
    raw_key: null,
    protected_envelope: null,
    request_id: null,
  });
});

it("runs local Email Worker fixture through private staging, Queue, atomic append and the existing customer conversation", async () => {
  const quote = await fixture();
  const svc = service();
  const receipt = await svc.receive(mail({ from: quote.email, to: quote.to }));
  expect(receipt.state).toBe("pending");
  const jobs: InboundQueueJob[] = [];
  await svc.dispatch({
    send: async (job) => {
      jobs.push(job);
    },
  });
  expect(jobs).toContainEqual({
    type: "quote-inbound-email",
    receiptId: receipt.receiptId,
  });
  const message = queueMessage(receipt.receiptId);
  await svc.consume(message);
  expect(message.ack).toHaveBeenCalledOnce();
  const saved = await row(receipt.receiptId);
  expect(saved).toMatchObject({
    state: "appended",
    message_id: `r1-${receipt.receiptId}`,
  });
  const conversation = await createQuoteConversationService(db, bucket, {
    kind: "customer",
    profileId: quote.profile,
  }).list(quote.id);
  expect(conversation.messages).toContainEqual(
    expect.objectContaining({
      source: "email",
      authorRole: "customer",
      body: "Please use the revised quantity.",
    }),
  );
  expect(
    await db
      .prepare("SELECT count(*) AS n FROM admin_audit_events WHERE id=?")
      .bind(`inbound-email:${receipt.receiptId}`)
      .first(),
  ).toEqual({ n: 1 });
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_notification_outbox WHERE request_id=?",
      )
      .bind(quote.id)
      .first(),
  ).toEqual({ n: 1 });
  for (const projection of [
    JSON.stringify(await svc.listAdmin(admin)),
    JSON.stringify(conversation),
    JSON.stringify(jobs),
    JSON.stringify(saved),
  ]) {
    expect(projection).not.toContain(quote.to.split("@")[0]);
    if (projection !== JSON.stringify(saved))
      expect(projection).not.toContain("quote-inbound-email/raw/");
  }
  await expect(svc.listAdmin(null)).rejects.toMatchObject({ status: 403 });
});

it("deduplicates provider events, distinct provider events with the same content, and Queue redelivery", async () => {
  const quote = await fixture();
  const svc = service();
  const input = {
    from: quote.email,
    to: quote.to,
    event: "event-one",
    messageId: "one-mail",
  };
  const first = await svc.receive(mail(input));
  const replay = await svc.receive(mail(input));
  expect(replay.receiptId).toBe(first.receiptId);
  await svc.consume(queueMessage(first.receiptId));
  await svc.consume(queueMessage(first.receiptId));
  const second = await svc.receive(mail({ ...input, event: "event-two" }));
  await svc.consume(queueMessage(second.receiptId));
  expect(await row(second.receiptId)).toMatchObject({
    state: "duplicate",
    message_id: `r1-${first.receiptId}`,
  });
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_conversation_messages WHERE request_id=? AND source='email'",
      )
      .bind(quote.id)
      .first(),
  ).toEqual({ n: 1 });
  const conflict = await svc.receive(
    mail({ ...input, body: "Different content" }),
  );
  expect(conflict).toMatchObject({
    state: "quarantined",
    reason: "provider_event_conflict",
  });
  const conflict2 = await svc.receive(
    mail({ ...input, event: "event-three", body: "Different content" }),
  );
  await svc.consume(queueMessage(conflict2.receiptId));
  expect(await row(conflict2.receiptId)).toMatchObject({
    state: "quarantined",
    reason: "message_id_conflict",
  });
});

it("quarantines unknown, malformed, expired, revoked and unauthorized tokens without conversation attachment", async () => {
  const quote = await fixture();
  const svc = service();
  for (const [from, to, reason] of [
    [quote.email, `bad@${env.EMAIL_REPLY_DOMAIN}`, "invalid_reply_address"],
    [
      quote.email,
      `${"f".repeat(64)}@${env.EMAIL_REPLY_DOMAIN}`,
      "reply_not_authorized",
    ],
    ["forwarder@customer.test", quote.to, "reply_not_authorized"],
    [
      quote.email,
      `${quote.to.split("@")[0]}@other.test`,
      "invalid_reply_address",
    ],
  ])
    expect(await svc.receive(mail({ from, to }))).toMatchObject({
      state: "quarantined",
      reason,
    });
  await db
    .prepare(
      "UPDATE quote_notification_reply_tokens SET expires_at=? WHERE request_id=?",
    )
    .bind(clock, quote.id)
    .run();
  expect(
    await svc.receive(mail({ from: quote.email, to: quote.to })),
  ).toMatchObject({ reason: "reply_not_authorized" });
  const revoked = await fixture();
  await db
    .prepare(
      "UPDATE quote_notification_reply_tokens SET revoked_at=? WHERE request_id=?",
    )
    .bind(clock, revoked.id)
    .run();
  expect(
    await svc.receive(mail({ from: revoked.email, to: revoked.to })),
  ).toMatchObject({ reason: "reply_not_authorized" });
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_conversation_messages WHERE request_id=? AND source='email'",
      )
      .bind(quote.id)
      .first(),
  ).toEqual({ n: 0 });
});

it("preserves temporary verifier exceptions without storage or poisoned dedup keys, then accepts redelivery", async () => {
  const quote = await fixture();
  class TemporaryVerificationError extends Error {}
  const failure = new TemporaryVerificationError(
    "Verification temporarily unavailable",
  );
  const verifier = vi
    .fn<PlatformEmailVerifier>()
    .mockRejectedValueOnce(failure)
    .mockImplementation(verify);
  const svc = service({ verifier });
  const input = {
    from: quote.email,
    to: quote.to,
    messageId: "temporary-verifier-redelivery",
    event: "temporary-verifier-redelivery",
  };
  const before = await db
    .prepare("SELECT count(*) AS n FROM quote_inbound_email_receipts")
    .first();
  const objects = await bucket.list({ prefix: "quote-inbound-email/raw/" });
  await expect(svc.receive(mail(input))).rejects.toBe(failure);
  expect(
    await db
      .prepare("SELECT count(*) AS n FROM quote_inbound_email_receipts")
      .first(),
  ).toEqual(before);
  expect(await bucket.list({ prefix: "quote-inbound-email/raw/" })).toEqual(
    objects,
  );
  const receipt = await svc.receive(mail(input));
  expect(receipt.state).toBe("pending");
  const message = queueMessage(receipt.receiptId);
  await svc.consume(message);
  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
  expect(await row(receipt.receiptId)).toMatchObject({
    state: "appended",
    reason: null,
  });
  expect(verifier).toHaveBeenCalledTimes(2);
});

it("does not accept forged From or authentication headers as platform identity", async () => {
  const quote = await fixture();
  expect(
    await service({ verifier: null }).receive(
      mail({
        from: quote.email,
        to: quote.to,
        headers: `Content-Type: text/plain\r\nAuthentication-Results: mx.cloudflare.net; dmarc=pass header.from=customer.test\r\nX-Verified: true`,
      }),
    ),
  ).toMatchObject({
    state: "quarantined",
    reason: "authentication_unverified",
  });
  const mismatched = await service().receive(
    mail({
      from: quote.email,
      to: quote.to,
      mimeFrom: "attacker@customer.test",
    }),
  );
  await service().consume(queueMessage(mismatched.receiptId));
  expect(await row(mismatched.receiptId)).toMatchObject({
    state: "quarantined",
    reason: "sender_mismatch",
  });
  const wrongHash: PlatformEmailVerifier = async ({ message }) => ({
    provider: "local-fixture",
    authenticatedSender: message.from,
    rawSha256: "wrong",
    mechanism: "dmarc-aligned",
  });
  expect(
    await service({ verifier: wrongHash }).receive(
      mail({ from: quote.email, to: quote.to }),
    ),
  ).toMatchObject({ reason: "authentication_unverified" });
});

async function pdfBody(count = 1) {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const content = Buffer.from(await pdf.save()).toString("base64");
  return `--part\r\nContent-Type: text/plain\r\n\r\nSee the drawing.\r\n${Array.from({ length: count }, () => `--part\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="drawing.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${content}\r\n`).join("")}--part--`;
}

it("stores validated files privately and serves them only through existing authorized conversation downloads", async () => {
  const quote = await fixture();
  const other = await fixture();
  const svc = service();
  const receipt = await svc.receive(
    mail({
      from: quote.email,
      to: quote.to,
      body: await pdfBody(),
      headers: 'Content-Type: multipart/mixed; boundary="part"',
    }),
  );
  await svc.consume(queueMessage(receipt.receiptId));
  expect(await row(receipt.receiptId)).toMatchObject({ state: "appended" });
  const conversation = createQuoteConversationService(db, bucket, {
    kind: "customer",
    profileId: quote.profile,
  });
  const response = await conversation.download(
    quote.id,
    `r1-${receipt.receiptId}`,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect((await response.text()).startsWith("%PDF")).toBe(true);
  await expect(
    createQuoteConversationService(db, bucket, {
      kind: "customer",
      profileId: other.profile,
    }).download(quote.id, `r1-${receipt.receiptId}`),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    conversation.download(other.id, `r1-${receipt.receiptId}`),
  ).rejects.toMatchObject({ status: 404 });
  const rejected = await svc.receive(
    mail({
      from: quote.email,
      to: quote.to,
      body: await pdfBody(2),
      headers: 'Content-Type: multipart/mixed; boundary="part"',
    }),
  );
  await svc.consume(queueMessage(rejected.receiptId));
  expect(await row(rejected.receiptId)).toMatchObject({
    state: "quarantined",
    reason: "too_many_attachments",
  });
  expect(
    await db
      .prepare(
        "SELECT * FROM quote_conversation_attachments WHERE message_id=?",
      )
      .bind(`r1-${rejected.receiptId}`)
      .first(),
  ).toBeNull();
  await expect(
    conversation.download(quote.id, `r1-${rejected.receiptId}`),
  ).rejects.toMatchObject({ status: 404 });
});

it("rechecks membership after receipt and in the append transaction after R2 upload", async () => {
  const quote = await fixture(true);
  const svc = service();
  const receipt = await svc.receive(mail({ from: quote.email, to: quote.to }));
  await db
    .prepare(
      "UPDATE customer_organization_memberships SET status='inactive' WHERE organization_id=?",
    )
    .bind(quote.id)
    .run();
  await svc.consume(queueMessage(receipt.receiptId));
  expect(await row(receipt.receiptId)).toMatchObject({
    reason: "reply_not_authorized",
  });
  const racing = await fixture(true);
  const files = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          const result = await target.put(...args);
          if (args[0].startsWith("quote-conversation/"))
            await db
              .prepare(
                "UPDATE customer_organization_memberships SET status='inactive' WHERE organization_id=?",
              )
              .bind(racing.id)
              .run();
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const staged = await service({ files }).receive(
    mail({
      from: racing.email,
      to: racing.to,
      body: await pdfBody(),
      headers: 'Content-Type: multipart/mixed; boundary="part"',
    }),
  );
  await service({ files }).consume(queueMessage(staged.receiptId));
  expect(await row(staged.receiptId)).toMatchObject({
    state: "quarantined",
    reason: "reply_not_authorized",
  });
  expect(
    await db
      .prepare("SELECT id FROM quote_conversation_messages WHERE id=?")
      .bind(`r1-${staged.receiptId}`)
      .first(),
  ).toBeNull();
  expect(
    (await bucket.get(`quote-conversation/r1-${staged.receiptId}`))?.size,
  ).toBe(0);
});

it("rolls back message, file metadata, content dedup and completion when audit fails, then retries once", async () => {
  const quote = await fixture();
  const svc = service();
  const receipt = await svc.receive(
    mail({
      from: quote.email,
      to: quote.to,
      body: await pdfBody(),
      headers: 'Content-Type: multipart/mixed; boundary="part"',
    }),
  );
  await db
    .prepare(
      "CREATE TRIGGER fail_inbound_audit BEFORE INSERT ON admin_audit_events WHEN NEW.event_type='quote_conversation.email_received' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    )
    .run();
  const message = queueMessage(receipt.receiptId);
  try {
    await svc.consume(message);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(await row(receipt.receiptId)).toMatchObject({ state: "retry" });
    for (const [table, column, value] of [
      ["quote_conversation_messages", "id", `r1-${receipt.receiptId}`],
      [
        "quote_conversation_attachments",
        "message_id",
        `r1-${receipt.receiptId}`,
      ],
      ["quote_inbound_email_content", "receipt_id", receipt.receiptId],
    ])
      expect(
        await db
          .prepare(`SELECT * FROM ${table} WHERE ${column}=?`)
          .bind(value)
          .first(),
      ).toBeNull();
  } finally {
    await db.prepare("DROP TRIGGER fail_inbound_audit").run();
  }
  clock += 30_000;
  await svc.consume(queueMessage(receipt.receiptId));
  expect(await row(receipt.receiptId)).toMatchObject({ state: "appended" });
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_inbound_email_content WHERE receipt_id=?",
      )
      .bind(receipt.receiptId)
      .first(),
  ).toEqual({ n: 1 });
});

it("retains committed bytes and recognizes atomic completion after a lost D1 response", async () => {
  const quote = await fixture();
  const uncertain = new Proxy(db, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (statements.length === 2) return result;
          throw new Error("lost response");
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const svc = service({ database: uncertain });
  const receipt = await svc.receive(
    mail({
      from: quote.email,
      to: quote.to,
      body: await pdfBody(),
      headers: 'Content-Type: multipart/mixed; boundary="part"',
    }),
  );
  const message = queueMessage(receipt.receiptId);
  await svc.consume(message);
  expect(message.ack).toHaveBeenCalledOnce();
  expect(await row(receipt.receiptId)).toMatchObject({ state: "appended" });
  expect(
    (await bucket.get(`quote-conversation/r1-${receipt.receiptId}`))!.size,
  ).toBeGreaterThan(0);
  await service().consume(queueMessage(receipt.receiptId));
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_conversation_messages WHERE id=?",
      )
      .bind(`r1-${receipt.receiptId}`)
      .first(),
  ).toEqual({ n: 1 });
});

it("deduplicates concurrent content processing and tombstones only the losing attachment", async () => {
  const quote = await fixture();
  const svc = service();
  const input = {
    from: quote.email,
    to: quote.to,
    messageId: "concurrent-mail",
    body: await pdfBody(),
    headers: 'Content-Type: multipart/mixed; boundary="part"',
  };
  const first = await svc.receive(mail(input));
  const second = await svc.receive(mail(input));
  await Promise.all([
    svc.consume(queueMessage(first.receiptId)),
    svc.consume(queueMessage(second.receiptId)),
  ]);
  const rows = [await row(first.receiptId), await row(second.receiptId)];
  expect(rows.map((r) => r.state).sort()).toEqual(["appended", "duplicate"]);
  const winner = rows.find((r) => r.state === "appended")!;
  expect(
    (await bucket.get(`quote-conversation/${winner.message_id}`))!.size,
  ).toBeGreaterThan(0);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_conversation_messages WHERE request_id=? AND source='email'",
      )
      .bind(quote.id)
      .first(),
  ).toEqual({ n: 1 });
});

it("retries a lost R2 write response without overwriting stored attachment bytes", async () => {
  const quote = await fixture();
  let failed = false;
  const files = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          const result = await target.put(...args);
          if (!failed && args[0].startsWith("quote-conversation/")) {
            failed = true;
            throw new Error("lost R2 response");
          }
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const svc = service({ files });
  const receipt = await svc.receive(
    mail({
      from: quote.email,
      to: quote.to,
      body: await pdfBody(),
      headers: 'Content-Type: multipart/mixed; boundary="part"',
    }),
  );
  await svc.consume(queueMessage(receipt.receiptId));
  expect(await row(receipt.receiptId)).toMatchObject({ state: "retry" });
  clock += 30_000;
  await svc.consume(queueMessage(receipt.receiptId));
  expect(await row(receipt.receiptId)).toMatchObject({ state: "appended" });
});

it("recovers Queue dispatch failure, bounds repeated processing failures, and never acknowledges active leases", async () => {
  const quote = await fixture();
  const svc = service();
  const receipt = await svc.receive(mail({ from: quote.email, to: quote.to }));
  await svc.dispatch({
    send: async () => {
      throw new Error("queue down");
    },
  });
  expect(await row(receipt.receiptId)).toMatchObject({
    reason: "queue_unavailable",
    dispatch_attempts: 1,
  });
  clock += 30_000;
  const jobs: InboundQueueJob[] = [];
  await svc.dispatch({
    send: async (job) => {
      jobs.push(job);
    },
  });
  expect(jobs).toContainEqual({
    type: "quote-inbound-email",
    receiptId: receipt.receiptId,
  });
  await db
    .prepare(
      "UPDATE quote_inbound_email_receipts SET state='processing',lease_id='another-worker',lease_until=? WHERE id=?",
    )
    .bind(clock + 120_000, receipt.receiptId)
    .run();
  const busy = queueMessage(receipt.receiptId);
  await svc.consume(busy);
  expect(busy.ack).not.toHaveBeenCalled();
  expect(busy.retry).toHaveBeenCalled();
  clock += 120_000;
  const unavailable = new Proxy(bucket, {
    get(target, property) {
      if (property === "get")
        return async () => {
          throw new Error("private storage outage");
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    await service({ files: unavailable }).consume(
      queueMessage(receipt.receiptId),
    );
    clock = Math.max(
      clock,
      Number((await row(receipt.receiptId)).next_attempt_at),
    );
  }
  expect(await row(receipt.receiptId)).toMatchObject({
    state: "dead_letter",
    reason: "attempts_exhausted",
    attempts: 10,
  });
});

it("paginates older quarantine with tied timestamps, filters state and rejects invalid cursors", async () => {
  const svc = service();
  for (let index = 0; index < 56; index++)
    await svc.receive(
      mail({
        from: "unknown@customer.test",
        to: `bad@${env.EMAIL_REPLY_DOMAIN}`,
        messageId: `quarantine-page-${index}`,
      }),
    );
  const expected = (
    await db
      .prepare(
        "SELECT id FROM quote_inbound_email_receipts WHERE state='quarantined' ORDER BY created_at DESC,id DESC",
      )
      .all<{ id: string }>()
  ).results.map((r) => r.id);
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await svc.listAdmin(admin, {
      state: "quarantined",
      limit: 17,
      cursor,
    });
    expect(page.rows.length).toBeLessThanOrEqual(17);
    expect(page.rows.every((r) => r.state === "quarantined")).toBe(true);
    seen.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toEqual(expected);
  expect(new Set(seen).size).toBe(seen.length);
  await expect(
    svc.listAdmin(admin, { cursor: "missing" }),
  ).rejects.toMatchObject({ status: 400 });
});

it.each(["tombstone", "release"])(
  "retries terminal %s cleanup through Queue and scheduled dispatch",
  async (failure) => {
    const quote = await fixture();
    const svc = service();
    const receipt = await svc.receive(
      mail({ from: quote.email, to: quote.to }),
    );
    const id = `r1-${receipt.receiptId}`;
    await db
      .prepare(
        "INSERT INTO quote_conversation_reservations(id,request_id,author_id,author_role,byte_size,created_at) VALUES(?,?,?,'customer',3,?)",
      )
      .bind(id, quote.id, quote.profile, new Date().toISOString())
      .run();
    await bucket.put(`quote-conversation/${id}`, "old");
    await db
      .prepare(
        "UPDATE quote_notification_reply_tokens SET revoked_at=? WHERE request_id=?",
      )
      .bind(clock, quote.id)
      .run();
    let unavailable = true;
    const files = new Proxy(bucket, {
      get(target, property) {
        if (property === "put")
          return async (...args: Parameters<R2Bucket["put"]>) => {
            if (failure === "tombstone" && unavailable && args[1] === "")
              throw new Error("tombstone outage");
            return target.put(...args);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    if (failure === "release")
      await db
        .prepare(
          "CREATE TRIGGER inbound_test_release BEFORE DELETE ON quote_conversation_reservations BEGIN SELECT RAISE(ABORT,'release outage'); END",
        )
        .run();
    try {
      const message = queueMessage(receipt.receiptId);
      await service({ files }).consume(message);
      expect(message.ack).not.toHaveBeenCalled();
      expect(message.retry).toHaveBeenCalled();
      expect(await row(receipt.receiptId)).toMatchObject({
        state: "quarantined",
        cleanup_pending: 1,
        cleanup_attempts: 1,
      });
      expect(
        await db
          .prepare("SELECT id FROM quote_conversation_reservations WHERE id=?")
          .bind(id)
          .first(),
      ).not.toBeNull();
    } finally {
      unavailable = false;
      if (failure === "release")
        await db.prepare("DROP TRIGGER inbound_test_release").run();
    }
    clock += 60_000;
    if (failure === "tombstone") await svc.dispatch({ send: async () => {} });
    else {
      const replay = queueMessage(receipt.receiptId);
      await svc.consume(replay);
      expect(replay.ack).toHaveBeenCalledOnce();
    }
    expect(await row(receipt.receiptId)).toMatchObject({ cleanup_pending: 0 });
    expect(
      await db
        .prepare("SELECT id FROM quote_conversation_reservations WHERE id=?")
        .bind(id)
        .first(),
    ).toBeNull();
    expect((await bucket.get(`quote-conversation/${id}`))?.size).toBe(0);
  },
);

it("reconciles dispatch-exhausted reservations without requiring a Queue delivery", async () => {
  const quote = await fixture();
  const receipt = await service().receive(
    mail({ from: quote.email, to: quote.to }),
  );
  const id = `r1-${receipt.receiptId}`;
  await db
    .prepare(
      "INSERT INTO quote_conversation_reservations(id,request_id,author_id,author_role,byte_size,created_at) VALUES(?,?,?,'customer',3,?)",
    )
    .bind(id, quote.id, quote.profile, new Date().toISOString())
    .run();
  await bucket.put(`quote-conversation/${id}`, "old");
  await db
    .prepare(
      "UPDATE quote_inbound_email_receipts SET dispatch_attempts=9 WHERE id=?",
    )
    .bind(receipt.receiptId)
    .run();
  await service().dispatch({
    send: async () => {
      throw new Error("Queue offline");
    },
  });
  expect(await row(receipt.receiptId)).toMatchObject({
    state: "dead_letter",
    cleanup_pending: 0,
  });
  expect(
    await db
      .prepare("SELECT id FROM quote_conversation_reservations WHERE id=?")
      .bind(id)
      .first(),
  ).toBeNull();
  expect((await bucket.get(`quote-conversation/${id}`))?.size).toBe(0);
});

it.each([
  { existing: false, phase: "before" },
  { existing: true, phase: "before" },
  { existing: false, phase: "after" },
  { existing: true, phase: "after" },
])(
  "fences a stale consumer $phase reservation authorization (existing=$existing)",
  async ({ existing, phase }) => {
    const quote = await fixture();
    const receipt = await service().receive(
      mail({
        from: quote.email,
        to: quote.to,
        body: await pdfBody(),
        headers: 'Content-Type: multipart/mixed; boundary="part"',
      }),
    );
    const id = `r1-${receipt.receiptId}`;
    const key = `quote-conversation/${id}`;
    if (existing) {
      const raw = (await bucket.get(
        String((await row(receipt.receiptId)).raw_key),
      ))!;
      const parsed = await parseInboundMime(
        new Uint8Array(await raw.arrayBuffer()),
        quote.email,
      );
      await db
        .prepare(
          "INSERT INTO quote_conversation_reservations(id,request_id,author_id,author_role,byte_size,created_at) VALUES(?,?,?,'customer',?,?)",
        )
        .bind(
          id,
          quote.id,
          quote.profile,
          parsed.attachment!.bytes.byteLength,
          new Date().toISOString(),
        )
        .run();
      await bucket.put(key, parsed.attachment!.bytes);
    }
    async function expireAndComplete() {
      await db
        .prepare(
          "UPDATE quote_inbound_email_receipts SET lease_until=?,attempts=10 WHERE id=?",
        )
        .bind(clock - 1, receipt.receiptId)
        .run();
      const replacement = queueMessage(receipt.receiptId);
      await service().consume(replacement);
      expect(replacement.ack).toHaveBeenCalledOnce();
      expect(await row(receipt.receiptId)).toMatchObject({
        state: "dead_letter",
        cleanup_pending: 0,
      });
    }
    let intercepted = false;
    const racing = new Proxy(db, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (!intercepted && statements.length === 2) {
              intercepted = true;
              if (phase === "before") await expireAndComplete();
              const result = await target.batch(statements);
              if (phase === "after") await expireAndComplete();
              return result;
            }
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const puts = vi.fn();
    const files = new Proxy(bucket, {
      get(target, property) {
        if (property === "put")
          return async (...args: Parameters<R2Bucket["put"]>) => {
            puts(...args);
            return target.put(...args);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await service({ database: racing, files }).consume(
      queueMessage(receipt.receiptId),
    );
    expect(intercepted).toBe(true);
    expect(
      await db
        .prepare("SELECT id FROM quote_conversation_reservations WHERE id=?")
        .bind(id)
        .first(),
    ).toBeNull();
    expect(
      await db
        .prepare("SELECT id FROM quote_conversation_messages WHERE id=?")
        .bind(id)
        .first(),
    ).toBeNull();
    expect(await row(receipt.receiptId)).toMatchObject({
      state: "dead_letter",
      cleanup_pending: 0,
    });
    if (phase === "before") expect(puts).not.toHaveBeenCalled();
    else
      expect(puts).toHaveBeenCalledWith(
        key,
        expect.any(Uint8Array),
        expect.objectContaining({ onlyIf: { etagDoesNotMatch: "*" } }),
      );
    expect((await bucket.get(key))?.size ?? 0).toBe(0);
  },
);

async function budgetReceipt(size: number, requestId: string | null = null) {
  const id = crypto.randomUUID();
  await createD1InboundEmail(db).insert({
    id,
    eventKey: id,
    receiptHash: id,
    checksum: id,
    rawSize: size,
    rawKey: `quote-inbound-email/raw/${id}`,
    envelope: null,
    state: "quarantined",
    reason: "malformed_mime",
    now: clock,
    requestId,
  });
  return id;
}

it("atomically bounds quote ingress before R2, charging quarantine but not event replay", async () => {
  const quote = await fixture();
  const svc = service();
  const original = {
    from: quote.email,
    to: quote.to,
    messageId: "budget-original",
    event: "budget-original",
  };
  const receipt = await svc.receive(mail(original));
  for (let i = 1; i < INBOUND_QUOTE_MAX_RECEIPTS; i++)
    await budgetReceipt(0, quote.id);
  expect(await svc.receive(mail(original))).toMatchObject({
    receiptId: receipt.receiptId,
  });
  const put = vi.fn();
  const files = new Proxy(bucket, {
    get(target, property) {
      if (property === "put") return put;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    service({ files }).receive(mail({ from: quote.email, to: quote.to })),
  ).rejects.toThrow(/ingress capacity/);
  expect(put).not.toHaveBeenCalled();
  const bytesQuote = await fixture();
  await budgetReceipt(INBOUND_QUOTE_MAX_BYTES - 1, bytesQuote.id);
  await expect(
    service({ files }).receive(
      mail({ from: bytesQuote.email, to: bytesQuote.to }),
    ),
  ).rejects.toThrow(/ingress capacity/);
  expect(put).not.toHaveBeenCalled();
  const concurrent = await fixture();
  await budgetReceipt(INBOUND_QUOTE_MAX_BYTES - 1, concurrent.id);
  const attempts = await Promise.allSettled([
    budgetReceipt(1, concurrent.id),
    budgetReceipt(1, concurrent.id),
  ]);
  expect(
    attempts.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
});

it("isolates a full unverified metadata flood from authorized raw capacity", async () => {
  const quote = await fixture();
  const count = await db
    .prepare(
      "SELECT count(*) AS n FROM quote_inbound_email_receipts WHERE raw_key IS NULL",
    )
    .first<{ n: number }>();
  await db
    .prepare(
      `WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<?)
    INSERT INTO quote_inbound_email_receipts(id,event_key,receipt_hash,raw_checksum,raw_size,state,created_at,next_attempt_at,next_dispatch_at)
    SELECT 'unverified-budget-'||n,'unverified-budget-'||n,'hash','hash',15728640,'quarantined',0,0,0 FROM numbers`,
    )
    .bind(10000 - count!.n)
    .run();
  await expect(
    service().receive(
      mail({ from: "unknown@customer.test", to: "bad@reply.local.invalid" }),
    ),
  ).rejects.toThrow(/unverified metadata capacity/);
  const receipt = await service().receive(
    mail({ from: quote.email, to: quote.to }),
  );
  expect(receipt.state).toBe("pending");
  await service().consume(queueMessage(receipt.receiptId));
  expect(await row(receipt.receiptId)).toMatchObject({ state: "appended" });
});

it("bounds retained authorized/quarantined raw bytes and receipt count independently", async () => {
  const quote = await fixture();
  const total = await db
    .prepare(
      "SELECT sum(raw_size) AS bytes FROM quote_inbound_email_receipts WHERE raw_key IS NOT NULL",
    )
    .first<{ bytes: number }>();
  await budgetReceipt(INBOUND_INGRESS_MAX_BYTES - total!.bytes);
  await expect(
    service().receive(mail({ from: quote.email, to: quote.to })),
  ).rejects.toThrow(/ingress capacity/);
  const count = await db
    .prepare(
      "SELECT count(*) AS n FROM quote_inbound_email_receipts WHERE raw_key IS NOT NULL",
    )
    .first<{ n: number }>();
  await db
    .prepare(
      `WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<?)
    INSERT INTO quote_inbound_email_receipts(id,event_key,receipt_hash,raw_checksum,raw_size,raw_key,state,created_at,next_attempt_at,next_dispatch_at)
    SELECT 'budget-'||n,'budget-'||n,'hash','hash',0,'quote-inbound-email/raw/budget-'||n,'quarantined',0,0,0 FROM numbers`,
    )
    .bind(INBOUND_INGRESS_MAX_RECEIPTS - count!.n)
    .run();
  await expect(budgetReceipt(0)).rejects.toThrow(/ingress capacity/);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_inbound_email_receipts WHERE raw_key IS NOT NULL",
      )
      .first(),
  ).toEqual({ n: INBOUND_INGRESS_MAX_RECEIPTS });
});
