import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { AdminIdentity } from "../workers/admin-access";
import {
  createAesGcmNotificationProtector,
  createQuoteNotifications,
  quoteNotificationOutboxStatement,
  type NotificationEnvironment,
  type NotificationProtector,
  type NotificationEmail,
  type QuoteNotificationAdapter,
  type QuoteNotificationJob,
} from "../app/modules/quote-notifications";
import {
  REPLY_TOKEN_LIFETIME_MS,
  SAFE_PROVIDER_RETRY_MS,
  notificationAdminCursor,
} from "../app/modules/quote-notifications/domain/quote-notification";

const directory = mkdtempSync(join(tmpdir(), "quote-notifications-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
let protector: NotificationProtector;
let clock = Date.parse("2026-09-14T00:00:00Z");
const local: NotificationEnvironment = {
  APP_ENV: "local",
  EMAIL_DELIVERY_MODE: "stub",
  EMAIL_FROM: "quotes@local.invalid",
  EMAIL_REPLY_DOMAIN: "reply.local.invalid",
};
const production: NotificationEnvironment = {
  APP_ENV: "production",
  EMAIL_DELIVERY_MODE: "resend",
  EMAIL_FROM: "quotes@seller.test",
  EMAIL_REPLY_DOMAIN: "reply.seller.test",
};
const admin: AdminIdentity = {
  id: "notification-admin",
  email: "admin@seller.test",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};

function service(
  adapter?: QuoteNotificationAdapter,
  database = db,
  env = adapter ? production : local,
) {
  return createQuoteNotifications({
    database,
    env,
    protector,
    adapter,
    now: () => clock,
  });
}

function delivery(id: string) {
  return {
    body: { type: "quote-conversation-notification", notificationId: id },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

async function row(id: string) {
  return (await db
    .prepare("SELECT * FROM quote_notification_outbox WHERE id=?")
    .bind(id)
    .first())!;
}

async function fixture(organization = false) {
  const id = crypto.randomUUID();
  const profile = `profile-${id}`;
  const email = `${id}@buyer.test`;
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
        "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,organization_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        id,
        organization ? "organization" : "individual",
        organization ? null : profile,
        organization ? id : null,
        "2026-09-14",
        "2026-09-14",
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
      VALUES(?,?,?,?,'session',1,'address',?,'DDP','USD',0,0,?,'{"costBasis":"PRIVATE_COST"}','2026-09-14')`,
      )
      .bind(
        id,
        id,
        profile,
        id,
        organization ? "organization" : "individual",
        id,
      ),
  ]);
  return { id, profile, email };
}

function messageStatements(
  requestId: string,
  id: string,
  role = "admin",
  body = "Customer visible clarification",
) {
  return [
    db
      .prepare(
        "INSERT INTO quote_conversations(request_id,created_at) VALUES(?,?) ON CONFLICT DO NOTHING",
      )
      .bind(requestId, new Date(clock).toISOString()),
    db
      .prepare(
        `INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,source,delivery_state)
      VALUES(?,?,?,'author',?,?,?,'hash','website','available')`,
      )
      .bind(id, requestId, role, body, new Date(clock).toISOString(), id),
    quoteNotificationOutboxStatement(db, {
      messageId: id,
      requestId,
      createdAt: new Date(clock).toISOString(),
    }),
  ];
}

async function append(requestId: string, role = "admin") {
  const id = crypto.randomUUID();
  await db.batch(messageStatements(requestId, id, role));
  return id;
}

beforeAll(async () => {
  platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "wrangler.jsonc",
    persist: { path: directory },
    remoteBindings: false,
  });
  db = platform.env.DB;
  // This isolated DB deliberately bypasses the schema manifest awaiting main's integration.
  for (const file of readdirSync("migrations")
    .filter(
      (name) => /^\d{4}_.*\.sql$/.test(name) && name.slice(0, 4) <= "0070",
    )
    .sort()) {
    const statements = readFileSync(join("migrations", file), "utf8")
      .split("--> statement-breakpoint")
      .map((sql) => sql.trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  protector = createAesGcmNotificationProtector(
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  );
}, 60_000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("keeps older failures accessible with bounded, filter-scoped keyset pagination", async () => {
  const quote = await fixture();
  clock += 1_000_000;
  const createdAt = clock;
  const prefix = `pages-${crypto.randomUUID()}-`;
  const ids = Array.from(
    { length: 65 },
    (_, index) => `${prefix}${String(index).padStart(3, "0")}`,
  );
  for (const [index, id] of ids.entries()) {
    await db.batch([
      ...messageStatements(quote.id, id),
      db
        .prepare(
          "UPDATE quote_notification_outbox SET state=?,failure_code=? WHERE id=?",
        )
        .bind(
          index === 0 ? "dead_letter" : index === 1 ? "review" : "sent",
          index < 2 ? "provider_rejected" : null,
          id,
        ),
    ]);
  }
  const svc = service();
  const first = await svc.listAdmin(admin);
  expect(first.rows.map((entry) => entry.id)).toEqual(ids.slice(15).reverse());
  expect(first.nextCursor).not.toBeNull();
  clock++;
  const newId = await append(quote.id);
  await db
    .prepare("UPDATE quote_notification_outbox SET state='sent' WHERE id=?")
    .bind(newId)
    .run();
  const older = await svc.listAdmin(admin, { before: first.nextCursor! });
  expect(older.rows.slice(0, 15).map((entry) => entry.id)).toEqual(
    ids.slice(0, 15).reverse(),
  );
  expect(older.rows.find((entry) => entry.id === ids[0])?.state).toBe(
    "dead_letter",
  );
  expect(older.rows.some((entry) => entry.id === newId)).toBe(false);
  expect(
    new Set([...first.rows, ...older.rows].map((entry) => entry.id)).size,
  ).toBe(first.rows.length + older.rows.length);

  const unresolved = await svc.listAdmin(admin, {
    filter: "unresolved",
    limit: 1,
  });
  expect(unresolved.rows[0].id).toBe(ids[1]);
  expect(unresolved.nextCursor).not.toBeNull();
  const unresolvedOlder = await svc.listAdmin(admin, {
    filter: "unresolved",
    before: unresolved.nextCursor!,
  });
  expect(unresolvedOlder.rows[0].id).toBe(ids[0]);
  expect(
    unresolvedOlder.rows.every((entry) =>
      ["review", "dead_letter"].includes(entry.state),
    ),
  ).toBe(true);
  expect((await svc.listAdmin(admin, 1)).rows).toHaveLength(1);
  expect(
    (await svc.listAdmin(admin, { limit: 10000 })).rows.length,
  ).toBeLessThanOrEqual(100);
  expect((await svc.listAdmin(admin, { limit: -10 })).rows).toHaveLength(1);

  for (const options of [
    { before: first.nextCursor!, filter: "unresolved" as const },
    { before: "not-a-cursor" },
    { before: "a".repeat(2049) },
    {
      before: notificationAdminCursor({
        version: 1,
        filter: "all",
        createdAt,
        id: "missing-notification",
      }),
    },
    {
      before: notificationAdminCursor({
        version: 1,
        filter: "all",
        createdAt: createdAt + 10,
        id: ids[14],
      }),
    },
  ])
    await expect(svc.listAdmin(admin, options)).rejects.toMatchObject({
      status: 400,
    });
  await expect(
    svc.listAdmin(null, { filter: "unresolved" }),
  ).rejects.toMatchObject({ status: 403 });
  const last = await svc.listAdmin(admin, {
    before: notificationAdminCursor({
      version: 1,
      filter: "all",
      createdAt,
      id: ids[0],
    }),
  });
  expect(last).toEqual({ rows: [], nextCursor: null });
});

it("appends one outbox atomically, rolls back both on failure and excludes customer messages", async () => {
  const quote = await fixture();
  const id = await append(quote.id);
  await quoteNotificationOutboxStatement(db, {
    messageId: id,
    requestId: quote.id,
    createdAt: new Date(clock).toISOString(),
  }).run();
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM quote_notification_outbox WHERE message_id=?",
      )
      .bind(id)
      .first(),
  ).toEqual({ count: 1 });
  expect(await row(id)).toMatchObject({
    protected_payload: null,
    idempotency_key: `quote-conversation/${id}`,
  });
  const customerId = await append(quote.id, "customer");
  expect(await row(customerId)).toBeNull();
  await db
    .prepare(
      "CREATE TRIGGER fail_notification BEFORE INSERT ON quote_notification_outbox BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END",
    )
    .run();
  const failed = crypto.randomUUID();
  try {
    await expect(db.batch(messageStatements(quote.id, failed))).rejects.toThrow(
      /outbox unavailable/,
    );
    expect(
      await db
        .prepare("SELECT id FROM quote_conversation_messages WHERE id=?")
        .bind(failed)
        .first(),
    ).toBeNull();
  } finally {
    await db.prepare("DROP TRIGGER fail_notification").run();
  }
  const rollback = crypto.randomUUID();
  await expect(
    db.batch([
      ...messageStatements(quote.id, rollback),
      db.prepare("INSERT INTO missing_audit_table VALUES(1)"),
    ]),
  ).rejects.toThrow();
  expect(await row(rollback)).toBeNull();
});

it("dispatches to a fake ASYNC_JOBS queue and durably captures local output once, without leaking tokens", async () => {
  const quote = await fixture();
  const id = await append(quote.id);
  await db
    .prepare(
      "INSERT INTO quote_internal_notes(id,request_id,actor_id,body,created_at) VALUES(?,?,'admin','PRIVATE_NOTE','2026-09-14')",
    )
    .bind(crypto.randomUUID(), quote.id)
    .run();
  await db
    .prepare(
      "INSERT INTO quote_private_evidence(id,request_id,actor_id,kind,filename,content_type,byte_size,checksum,object_key,created_at) VALUES(?,?,'admin','tax_exemption','PRIVATE_TAX','application/pdf',1,'checksum','PRIVATE_R2','2026-09-14')",
    )
    .bind(crypto.randomUUID(), quote.id)
    .run();
  const svc = service();
  const queued: QuoteNotificationJob[] = [];
  await svc.dispatch({
    send: async (job) => {
      queued.push(job);
    },
  });
  const job = queued.find((item) => item.notificationId === id)!;
  expect(Object.keys(job).sort()).toEqual(["notificationId", "type"]);
  const message = delivery(id);
  await svc.consume(message);
  expect(message.ack).toHaveBeenCalledOnce();
  expect(await row(id)).toMatchObject({ state: "sent", attempts: 1 });
  await service().consume(delivery(id));
  const capture = await service().readLocalCapture(admin, id);
  expect(capture.to).toEqual([quote.email]);
  expect(capture.text).toContain("Customer visible clarification");
  expect(JSON.stringify(capture)).not.toMatch(
    /PRIVATE_NOTE|PRIVATE_COST|PRIVATE_TAX|PRIVATE_R2|object_key|tax_exemption/,
  );
  const token = capture.reply_to.split("@")[0];
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect(capture.reply_to).not.toContain(quote.id);
  const tables = await db.batch(
    [
      "quote_notification_outbox",
      "quote_notification_reply_tokens",
      "quote_notification_local_captures",
    ].map((table) => db.prepare(`SELECT * FROM ${table}`)),
  );
  expect(JSON.stringify(tables)).not.toContain(token);
  expect(JSON.stringify(await svc.listAdmin(admin))).not.toContain(token);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM quote_notification_local_captures WHERE notification_id=?",
      )
      .bind(id)
      .first(),
  ).toEqual({ count: 1 });
  await expect(svc.readLocalCapture(null, id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    service(undefined, db, production).readLocalCapture(admin, id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(svc.listAdmin(null)).rejects.toMatchObject({ status: 403 });
  expect(await svc.resolveReplyToken(token, quote.email)).toMatchObject({
    requestId: quote.id,
    profileId: quote.profile,
  });
  expect(await svc.resolveReplyToken(token, "other@buyer.test")).toBeNull();
  expect(await svc.resolveReplyToken("bad", quote.email)).toBeNull();
  expect(await svc.resolveReplyToken("f".repeat(64), quote.email)).toBeNull();
  const otherQuote = await fixture();
  const otherId = await append(otherQuote.id);
  await svc.consume(delivery(otherId));
  expect((await svc.resolveReplyToken(token, quote.email))?.requestId).not.toBe(
    otherQuote.id,
  );
  const later = createQuoteNotifications({
    database: db,
    env: local,
    protector,
    now: () => clock + REPLY_TOKEN_LIFETIME_MS,
  });
  expect(await later.resolveReplyToken(token, quote.email)).toBeNull();
});

it("retries uncertain provider acceptance using identical payload/key and never duplicates a conversation message", async () => {
  const quote = await fixture();
  const id = await append(quote.id);
  const accepted = new Map<string, string>();
  const calls: string[] = [];
  const adapter: QuoteNotificationAdapter = {
    send: async (email, key) => {
      calls.push(key);
      if (!accepted.has(key)) {
        accepted.set(key, JSON.stringify(email));
        throw new Error("response lost");
      }
      expect(JSON.stringify(email)).toBe(accepted.get(key));
      return { kind: "sent", providerId: "one-email" };
    },
  };
  const first = delivery(id);
  await service(adapter).consume(first);
  expect(first.ack).not.toHaveBeenCalled();
  expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
  await service(adapter).consume(delivery(id));
  expect(calls).toHaveLength(1);
  clock += 30_000;
  await service(adapter, db, {
    ...production,
    EMAIL_FROM: "changed@seller.test",
    EMAIL_REPLY_DOMAIN: "changed.seller.test",
  }).consume(delivery(id));
  await service(adapter).consume(delivery(id));
  expect(calls).toEqual([
    `quote-conversation/${id}`,
    `quote-conversation/${id}`,
  ]);
  expect(accepted.size).toBe(1);
  expect(await row(id)).toMatchObject({ state: "sent", attempts: 2 });
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM quote_conversation_messages WHERE id=?",
      )
      .bind(id)
      .first(),
  ).toEqual({ count: 1 });
});

it("uses a durable lease against concurrent consumers and recovers a crashed lease", async () => {
  const id = await append((await fixture()).id);
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = vi.fn<QuoteNotificationAdapter["send"]>(async () => {
    started();
    await gate;
    return { kind: "sent", providerId: "leased" };
  });
  const svc = service({ send });
  const first = svc.consume(delivery(id));
  await began;
  const duplicate = delivery(id);
  await svc.consume(duplicate);
  expect(duplicate.retry).toHaveBeenCalled();
  expect(send).toHaveBeenCalledOnce();
  release();
  await first;
  const crashed = await append((await fixture()).id);
  await db
    .prepare(
      "UPDATE quote_notification_outbox SET state='sending',lease_id='crashed',lease_until=? WHERE id=?",
    )
    .bind(clock - 1, crashed)
    .run();
  await service().consume(delivery(crashed));
  expect(await row(crashed)).toMatchObject({ state: "sent" });
});

it("does not acknowledge a lost completion response and deduplicates redelivery from durable sent state", async () => {
  const id = await append((await fixture()).id);
  const send = vi
    .fn<QuoteNotificationAdapter["send"]>()
    .mockResolvedValue({ kind: "sent", providerId: "accepted" });
  const uncertain = new Proxy(db, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes("SET state=?,failure_code=?")) return statement;
          return {
            bind(...values: unknown[]) {
              const bound = statement.bind(...values);
              return {
                async run() {
                  await bound.run();
                  throw new Error("lost committed response");
                },
              };
            },
          };
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const message = delivery(id);
  await service({ send }, uncertain).consume(message);
  expect(message.ack).not.toHaveBeenCalled();
  expect(message.retry).toHaveBeenCalled();
  const next = delivery(id);
  await service({ send }).consume(next);
  expect(next.ack).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledOnce();
});

it("stops uncertain retries before provider retention expires and preserves the original message", async () => {
  const id = await append((await fixture()).id);
  const send = vi
    .fn<QuoteNotificationAdapter["send"]>()
    .mockResolvedValue({ kind: "retry", code: "transport_uncertain" });
  await service({ send }).consume(delivery(id));
  clock += SAFE_PROVIDER_RETRY_MS;
  const message = delivery(id);
  await service({ send }).consume(message);
  expect(await row(id)).toMatchObject({
    state: "review",
    failure_code: "idempotency_window_elapsed",
  });
  expect(message.ack).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledOnce();
  clock += 24 * 60 * 60 * 1000;
  await service({ send }).consume(delivery(id));
  expect(send).toHaveBeenCalledOnce();
});

it("records permanent provider failure in a reviewable dead letter without rolling back or retrying source messages", async () => {
  const quote = await fixture();
  const id = await append(quote.id);
  const send = vi
    .fn<QuoteNotificationAdapter["send"]>()
    .mockResolvedValue({ kind: "permanent", code: "provider_rejected" });
  const svc = service({ send });
  await svc.consume(delivery(id));
  await svc.consume(delivery(id));
  expect(await row(id)).toMatchObject({
    state: "dead_letter",
    failure_code: "provider_rejected",
  });
  expect(
    (await svc.listAdmin(admin)).rows.find((entry) => entry.id === id),
  ).toMatchObject({ state: "dead_letter" });
  expect(
    await db
      .prepare("SELECT body FROM quote_conversation_messages WHERE id=?")
      .bind(id)
      .first(),
  ).toEqual({ body: "Customer visible clarification" });
  expect(send).toHaveBeenCalledOnce();
});

it("revalidates organization ownership before first send, retry and inbound-token resolution", async () => {
  const quote = await fixture(true);
  const id = await append(quote.id);
  const replacement = `new-${quote.profile}`;
  const replacementEmail = `new-${quote.email}`;
  await db.batch([
    db
      .prepare(
        "UPDATE customer_organization_memberships SET status='inactive' WHERE organization_id=?",
      )
      .bind(quote.id),
    db
      .prepare(
        "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES(?,?,?,'2026-09-14','2026-09-14','2026-09-14')",
      )
      .bind(replacement, replacementEmail, replacementEmail),
    db
      .prepare(
        "INSERT INTO customer_organization_memberships(id,organization_id,profile_id,role,status,created_at) VALUES(?,?,?,'primary_contact','active','2026-09-14')",
      )
      .bind(replacement, quote.id, replacement),
    db
      .prepare(
        "INSERT INTO customer_profile_purchasing_context_access(profile_id,context_id,created_at) VALUES(?,?,'2026-09-14')",
      )
      .bind(replacement, quote.id),
  ]);
  let payload!: NotificationEmail;
  const send = vi.fn<QuoteNotificationAdapter["send"]>(async (email) => {
    payload = email;
    return { kind: "retry", code: "transport_uncertain" };
  });
  const svc = service({ send });
  await svc.consume(delivery(id));
  expect(payload.to).toEqual([replacementEmail]);
  const token = payload.reply_to.split("@")[0];
  expect(await svc.resolveReplyToken(token, replacementEmail)).toMatchObject({
    profileId: replacement,
  });
  expect(await svc.resolveReplyToken(token, quote.email)).toBeNull();
  await db
    .prepare(
      "UPDATE customer_organization_memberships SET status='inactive' WHERE organization_id=?",
    )
    .bind(quote.id)
    .run();
  expect(await svc.resolveReplyToken(token, replacementEmail)).toBeNull();
  clock += 30_000;
  await svc.consume(delivery(id));
  expect(send).toHaveBeenCalledOnce();
  expect(await row(id)).toMatchObject({
    state: "review",
    failure_code: "recipient_no_longer_authorized",
  });
  const unavailable = await append(quote.id);
  await svc.consume(delivery(unavailable));
  expect(await row(unavailable)).toMatchObject({
    state: "review",
    failure_code: "recipient_unavailable",
  });
});

it("uses durable dispatch backoff and recovers a queue-send outage", async () => {
  const id = await append((await fixture()).id);
  const queue = {
    send: vi.fn().mockRejectedValue(new Error("queue unavailable")),
  };
  const svc = service();
  await svc.dispatch(queue, 100);
  expect(await row(id)).toMatchObject({
    dispatch_attempts: 1,
    failure_code: "queue_unavailable",
  });
  const count = queue.send.mock.calls.length;
  await svc.dispatch(queue, 100);
  expect(queue.send.mock.calls.length).toBe(count);
  clock += 30_000;
  queue.send.mockResolvedValue(undefined);
  await svc.dispatch(queue, 100);
  expect(queue.send).toHaveBeenCalledWith({
    type: "quote-conversation-notification",
    notificationId: id,
  });
  await svc.consume(delivery(id));
  expect(await row(id)).toMatchObject({ state: "sent", dispatch_attempts: 0 });
});

it("bounds repeated delivery and dispatch failures in durable terminal states", async () => {
  const id = await append((await fixture()).id);
  const send = vi
    .fn<QuoteNotificationAdapter["send"]>()
    .mockResolvedValue({ kind: "retry", code: "provider_unavailable" });
  for (let attempt = 0; attempt < 10; attempt++) {
    await service({ send }).consume(delivery(id));
    const current = await row(id);
    clock = Math.max(clock, Number(current.next_attempt_at));
  }
  expect(await row(id)).toMatchObject({ state: "review", attempts: 10 });
  const dispatchId = await append((await fixture()).id);
  for (let attempt = 0; attempt < 10; attempt++) {
    await service().dispatch(
      {
        send: async () => {
          throw new Error("outage");
        },
      },
      100,
    );
    clock = Math.max(clock, Number((await row(dispatchId)).next_dispatch_at));
  }
  expect(await row(dispatchId)).toMatchObject({
    state: "dead_letter",
    dispatch_attempts: 10,
  });
});

it("rejects missing production configuration durably without contacting a provider", async () => {
  const id = await append((await fixture()).id);
  await service(undefined, db, production).consume(delivery(id));
  expect(await row(id)).toMatchObject({
    state: "review",
    failure_code: "configuration_unavailable",
    first_attempt_at: null,
  });
  const message = { body: { type: "other-job" }, ack: vi.fn(), retry: vi.fn() };
  expect(await service().consume(message)).toBe(false);
  expect(message.ack).not.toHaveBeenCalled();
});

it("sends an attachment-only message using generic plaintext, never private paths or attachment bytes", async () => {
  const quote = await fixture();
  const id = crypto.randomUUID();
  await db.batch([
    ...messageStatements(quote.id, id, "admin", ""),
    db
      .prepare(
        `INSERT INTO quote_conversation_attachments(message_id,filename,content_type,byte_size,checksum,object_key)
      VALUES(?,'visible.pdf','application/pdf',1,'checksum',?)`,
      )
      .bind(id, `PRIVATE_PATH/${id}`),
  ]);
  await service().consume(delivery(id));
  const capture = await service().readLocalCapture(admin, id);
  expect(capture.text).toContain(
    "You have a new quote message with an attachment.",
  );
  expect(JSON.stringify(capture)).not.toMatch(
    /PRIVATE_PATH|checksum|"attachments"|PRIVATE_COST/,
  );
});

it("does not consult marketing settings or create subscriptions for required transactional messages", async () => {
  const id = await append((await fixture()).id);
  const guarded = new Proxy(db, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          if (/marketing|subscription|opt_in|consent/i.test(sql))
            throw new Error("marketing boundary crossed");
          return target.prepare(sql);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await service(undefined, guarded).consume(delivery(id));
  expect(await row(id)).toMatchObject({ state: "sent" });
});

it("fails closed when a frozen recipient email changes and never sends the payload to a replacement address", async () => {
  const quote = await fixture();
  const id = await append(quote.id);
  const send = vi
    .fn<QuoteNotificationAdapter["send"]>()
    .mockResolvedValue({ kind: "retry", code: "transport_uncertain" });
  await service({ send }).consume(delivery(id));
  await db
    .prepare("UPDATE customer_profiles SET email_normalized=? WHERE id=?")
    .bind(`changed-${quote.email}`, quote.profile)
    .run();
  clock += 30_000;
  await service({ send }).consume(delivery(id));
  expect(send).toHaveBeenCalledOnce();
  expect(await row(id)).toMatchObject({
    state: "review",
    failure_code: "recipient_no_longer_authorized",
  });
});

it("retains immutable deduplication identity and token scope in D1", async () => {
  const id = await append((await fixture()).id);
  await service().consume(delivery(id));
  for (const sql of [
    "UPDATE quote_notification_outbox SET idempotency_key='new-key' WHERE id=?",
    "UPDATE quote_notification_outbox SET protected_payload='replacement' WHERE id=?",
    "UPDATE quote_notification_outbox SET first_attempt_at=0 WHERE id=?",
    "DELETE FROM quote_notification_outbox WHERE id=?",
    "UPDATE quote_notification_reply_tokens SET recipient_email='attacker@buyer.test' WHERE notification_id=?",
    "DELETE FROM quote_notification_local_captures WHERE notification_id=?",
  ])
    await expect(db.prepare(sql).bind(id).run()).rejects.toThrow(
      /immutable|retained/,
    );
});

it("keeps failed local capture and sent-state writes atomic, then retries with one durable capture", async () => {
  const id = await append((await fixture()).id);
  await db
    .prepare(
      "CREATE TRIGGER fail_local_capture BEFORE INSERT ON quote_notification_local_captures BEGIN SELECT RAISE(ABORT,'capture unavailable'); END",
    )
    .run();
  const message = delivery(id);
  try {
    await service().consume(message);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ state: "sending" });
    expect(
      await db
        .prepare(
          "SELECT * FROM quote_notification_local_captures WHERE notification_id=?",
        )
        .bind(id)
        .first(),
    ).toBeNull();
  } finally {
    await db.prepare("DROP TRIGGER fail_local_capture").run();
  }
  clock += 120_000;
  await service().consume(delivery(id));
  expect(await row(id)).toMatchObject({ state: "sent" });
});

it("does not acknowledge a provider success whose completion could not commit; retries remain idempotent", async () => {
  const id = await append((await fixture()).id);
  const accepted = new Set<string>();
  const send = vi.fn<QuoteNotificationAdapter["send"]>(async (_email, key) => {
    accepted.add(key);
    return { kind: "sent", providerId: "accepted-once" };
  });
  await db
    .prepare(
      "CREATE TRIGGER fail_notification_completion BEFORE UPDATE ON quote_notification_outbox WHEN NEW.state='sent' BEGIN SELECT RAISE(ABORT,'completion unavailable'); END",
    )
    .run();
  const message = delivery(id);
  try {
    await service({ send }).consume(message);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ state: "sending", attempts: 1 });
  } finally {
    await db.prepare("DROP TRIGGER fail_notification_completion").run();
  }
  clock += 120_000;
  await service({ send }).consume(delivery(id));
  expect(await row(id)).toMatchObject({ state: "sent", attempts: 2 });
  expect(accepted.size).toBe(1);
});

it("does not acknowledge a stale lease holder until terminal completion is durable", async () => {
  const id = await append((await fixture()).id);
  const send = vi.fn<QuoteNotificationAdapter["send"]>(async () => {
    await db
      .prepare(
        "UPDATE quote_notification_outbox SET lease_id='replacement',lease_until=? WHERE id=?",
      )
      .bind(clock + 120_000, id)
      .run();
    return { kind: "sent", providerId: "accepted" };
  });
  const message = delivery(id);
  await service({ send }).consume(message);
  expect(message.ack).not.toHaveBeenCalled();
  expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  expect(await row(id)).toMatchObject({
    state: "sending",
    lease_id: "replacement",
  });
});

it("will not retry a frozen payload with a revoked reply token", async () => {
  const quote = await fixture();
  const id = await append(quote.id);
  const send = vi
    .fn<QuoteNotificationAdapter["send"]>()
    .mockResolvedValue({ kind: "retry", code: "transport_uncertain" });
  await service({ send }).consume(delivery(id));
  await db
    .prepare(
      "UPDATE quote_notification_reply_tokens SET revoked_at=? WHERE notification_id=?",
    )
    .bind(clock, id)
    .run();
  clock += 30_000;
  await service({ send }).consume(delivery(id));
  expect(send).toHaveBeenCalledOnce();
  expect(await row(id)).toMatchObject({
    state: "review",
    failure_code: "reply_token_expired_or_revoked",
  });
});
