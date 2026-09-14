import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { AdminIdentity } from "../workers/admin-access";
import {
  createQuoteConversationService,
  type QuoteConversationActor,
} from "../app/modules/quote-conversation/application/quote-conversation-service";

const directory = mkdtempSync(join(tmpdir(), "quote-conversation-"));
let platform: Awaited<
  ReturnType<
    typeof getPlatformProxy<{ DB: D1Database; PRIVATE_FILES: R2Bucket }>
  >
>;
let db: D1Database;
let bucket: R2Bucket;
const pdfFixtures = new Map<string, Uint8Array<ArrayBuffer>>();
const identity: AdminIdentity = {
  id: "conversation-admin",
  email: "admin@local.invalid",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
const admin: QuoteConversationActor = { kind: "admin", identity };
const customer: QuoteConversationActor = {
  kind: "customer",
  profileId: "conversation-owner",
};
const other: QuoteConversationActor = {
  kind: "customer",
  profileId: "conversation-other",
};
function service(actor = customer, database = db, files = bucket) {
  return createQuoteConversationService(database, files, actor);
}
function post() {
  return new Request("https://shop.example/conversation", {
    method: "POST",
    headers: { Origin: "https://shop.example" },
  });
}
function pdf(text = "customer-visible") {
  return new File([pdfFixtures.get(text)!], "drawing.pdf", {
    type: "application/pdf",
  });
}
function sendInput(requestId: string, attachment?: File) {
  return {
    request: post(),
    requestId,
    commandId: crypto.randomUUID(),
    body: "Please clarify",
    attachment,
  };
}
async function quote(contextId = "conversation-context", kind = "individual") {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO customer_quote_requests
    (id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,
     source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,
     service_fee_total,idempotency_key,snapshot_json,submitted_at)
    VALUES(?,?,'conversation-owner',?,'session',1,'address',?,'DDP','USD',0,0,?,'{"costBasis":"SECRET_COST"}','2026-09-14')`,
    )
    .bind(id, id, contextId, kind, id)
    .run();
  return id;
}
async function objectKeys() {
  return (await bucket.list({ prefix: "quote-conversation/" })).objects
    .filter((o) => o.size > 0)
    .map((o) => o.key)
    .sort();
}

async function organizationQuote() {
  const organizationId = crypto.randomUUID();
  const contextId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO customer_organizations(id,legal_name,country_code,created_at,updated_at) VALUES(?,'Test Organization','US','2026-09-14','2026-09-14')",
      )
      .bind(organizationId),
    db
      .prepare(
        "INSERT INTO customer_purchasing_contexts(id,kind,organization_id,created_at,updated_at) VALUES(?,'organization',?,'2026-09-14','2026-09-14')",
      )
      .bind(contextId, organizationId),
    ...["conversation-owner", "conversation-other"].flatMap((profileId) => [
      db
        .prepare(
          "INSERT INTO customer_organization_memberships(id,organization_id,profile_id,role,status,created_at) VALUES(?,?,?,'primary_contact',?,'2026-09-14')",
        )
        .bind(
          crypto.randomUUID(),
          organizationId,
          profileId,
          profileId === "conversation-other" ? "active" : "inactive",
        ),
      db
        .prepare(
          "INSERT INTO customer_profile_purchasing_context_access(profile_id,context_id,created_at) VALUES(?,?,'2026-09-14')",
        )
        .bind(profileId, contextId),
    ]),
  ]);
  return {
    requestId: await quote(contextId, "organization"),
    organizationId,
    contextId,
  };
}

beforeAll(async () => {
  for (const title of ["customer-visible", "different bytes"]) {
    const document = await PDFDocument.create();
    document.addPage();
    document.setTitle(title);
    pdfFixtures.set(title, new Uint8Array(await document.save()));
  }
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
  await db.batch([
    ...["conversation-owner", "conversation-other"].map((id) =>
      db
        .prepare(
          "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES(?,?,?,'2026-09-14','2026-09-14','2026-09-14')",
        )
        .bind(id, `${id}@example.com`, `${id}@example.com`),
    ),
    db.prepare(
      "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,created_at,updated_at) VALUES('conversation-context','individual','conversation-owner','2026-09-14','2026-09-14')",
    ),
  ]);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("reads empty without creating a row, exchanges both roles and retains history across revisions", async () => {
  const requestId = await quote();
  expect(await service().list(requestId)).toEqual({
    id: requestId,
    requestId,
    messages: [],
    nextCursor: null,
  });
  expect(
    await db
      .prepare("SELECT * FROM quote_conversations WHERE request_id=?")
      .bind(requestId)
      .first(),
  ).toBeNull();
  const first = await service().send(sendInput(requestId));
  for (const number of [1, 2]) {
    await db
      .prepare(
        `INSERT INTO quote_revisions
      (id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,command_id,command_hash,issued_by,issued_at)
      VALUES(?,?,?,?,'{}','hash',?,'command-hash','admin','2026-09-14')`,
      )
      .bind(crypto.randomUUID(), requestId, number, number, crypto.randomUUID())
      .run();
  }
  const reply = await service(admin).send({
    ...sendInput(requestId),
    body: "Confirmed",
  });
  expect(first).toMatchObject({
    authorRole: "customer",
    deliveryState: "available",
    attachment: null,
  });
  expect(reply).toMatchObject({
    authorRole: "admin",
    body: "Confirmed",
    source: "website",
  });
  const list = await service().list(requestId);
  expect(list.messages.map((m) => m.id)).toEqual([first.id, reply.id]);
  expect(await service(admin).list(requestId)).toEqual(list);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM quote_conversations WHERE request_id=?",
      )
      .bind(requestId)
      .first(),
  ).toEqual({ count: 1 });
  for (const message of [first, reply]) {
    expect(
      await db
        .prepare("SELECT payload_json FROM admin_audit_events WHERE id=?")
        .bind(`quote-conversation:${message.id}`)
        .first(),
    ).toEqual({
      payload_json: JSON.stringify({
        messageId: message.id,
        authorRole: message.authorRole,
      }),
    });
  }
});

it("checks ownership for reads, sends and downloads and permits operational subaccounts", async () => {
  const requestId = await quote();
  const input = sendInput(requestId, pdf());
  const message = await service().send(input);
  for (const operation of [
    service(other).list(requestId),
    service(other).send(input),
    service(other).download(requestId, message.id),
    service(other).reconcileExpired(requestId),
    service().list("missing"),
    service(admin).list("missing"),
  ])
    await expect(operation).rejects.toMatchObject({ status: 404 });
  const secondQuote = await quote();
  expect(await service(admin).reconcileExpired(requestId)).toEqual({
    released: 0,
    legacy: 0,
  });
  await expect(
    service().download(secondQuote, message.id),
  ).rejects.toMatchObject({ status: 404 });
  const subaccount: QuoteConversationActor = {
    kind: "admin",
    identity: {
      ...identity,
      accountType: "subaccount",
      canManageSubaccounts: false,
    },
  };
  expect(
    await (await service(subaccount).download(requestId, message.id)).text(),
  ).toContain("%PDF-");
  expect(
    (await service(subaccount).send(sendInput(requestId))).authorRole,
  ).toBe("admin");
});

it("fails closed on CSRF and unsafe files without storing messages or R2 objects", async () => {
  const requestId = await quote();
  const before = await objectKeys();
  for (const request of [
    new Request("https://shop.example/conversation", { method: "POST" }),
    new Request("https://shop.example/conversation", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    }),
  ])
    await expect(
      service().send({ ...sendInput(requestId), request }),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    service().send({
      ...sendInput(requestId),
      request: new Request("https://shop.example/conversation"),
    }),
  ).rejects.toMatchObject({ status: 405 });
  await expect(
    service().send(
      sendInput(
        requestId,
        new File(["javascript"], "x.pdf", { type: "application/pdf" }),
      ),
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect((await service().list(requestId)).messages).toEqual([]);
  expect(await objectKeys()).toEqual(before);
});

it("returns stable replay and rejects altered text, files, actors and cross-quote command reuse", async () => {
  const requestId = await quote();
  const input = sendInput(requestId, pdf());
  const first = await service().send(input);
  expect(await service().send(input)).toEqual(first);
  for (const changed of [
    { ...input, body: "changed" },
    { ...input, attachment: pdf("different bytes") },
    { ...input, attachment: undefined },
    { ...input, requestId: await quote() },
    {
      ...input,
      attachment: new File(
        [pdfFixtures.get("customer-visible")!],
        "renamed.pdf",
        {
          type: "application/pdf",
        },
      ),
    },
  ])
    await expect(service().send(changed)).rejects.toMatchObject({
      status: 409,
    });
  await expect(service(admin).send(input)).rejects.toMatchObject({
    status: 409,
  });
  expect((await service().list(requestId)).messages).toHaveLength(1);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM admin_audit_events WHERE entity_id=?",
      )
      .bind(requestId)
      .first(),
  ).toEqual({ count: 1 });
});

it("replays equivalent normalized text and sanitized filenames", async () => {
  const requestId = await quote();
  const input = {
    ...sendInput(requestId),
    body: "  Please clarify  ",
    attachment: new File(
      [pdfFixtures.get("customer-visible")!],
      "drawing?.PDF",
      { type: "application/pdf" },
    ),
  };
  const first = await service().send(input);
  expect(first.attachment?.filename).toBe("drawing_.pdf");
  expect(
    await service().send({
      ...input,
      body: "Please clarify",
      attachment: new File(
        [pdfFixtures.get("customer-visible")!],
        "drawing_.pdf",
        { type: "application/pdf" },
      ),
    }),
  ).toEqual(first);
});

it("uses current organization primary contact access instead of the historical submitter", async () => {
  const { requestId, organizationId, contextId } = await organizationQuote();
  const input = sendInput(requestId, pdf());
  const message = await service(other).send(input);
  expect((await service(other).list(requestId)).messages[0]).toEqual(message);
  for (const operation of [
    () => service().list(requestId),
    () => service().send(input),
    () => service().download(requestId, message.id),
  ])
    await expect(operation()).rejects.toMatchObject({ status: 404 });
  await db
    .prepare(
      "UPDATE customer_organization_memberships SET role='member' WHERE organization_id=? AND profile_id='conversation-other'",
    )
    .bind(organizationId)
    .run();
  await expect(service(other).list(requestId)).rejects.toMatchObject({
    status: 404,
  });
  await db
    .prepare(
      "UPDATE customer_organization_memberships SET role='primary_contact' WHERE organization_id=? AND profile_id='conversation-other'",
    )
    .bind(organizationId)
    .run();
  await db
    .prepare(
      "DELETE FROM customer_profile_purchasing_context_access WHERE context_id=? AND profile_id='conversation-other'",
    )
    .bind(contextId)
    .run();
  await expect(
    service(other).download(requestId, message.id),
  ).rejects.toMatchObject({ status: 404 });
});

it("rechecks organization permission inside the final append after an in-flight upload", async () => {
  const { requestId, organizationId } = await organizationQuote();
  const before = await objectKeys();
  const revokingBucket = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          const result = await target.put(...args);
          await db
            .prepare(
              "UPDATE customer_organization_memberships SET status='inactive' WHERE organization_id=?",
            )
            .bind(organizationId)
            .run();
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    service(other, db, revokingBucket).send(sendInput(requestId, pdf())),
  ).rejects.toMatchObject({ status: 404 });
  expect((await service(admin).list(requestId)).messages).toEqual([]);
  expect(await objectKeys()).toEqual(before);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM quote_conversation_reservations WHERE request_id=?",
      )
      .bind(requestId)
      .first(),
  ).toEqual({ count: 0 });
});

it("atomically limits concurrent customer sends before R2 and permits replay without more budget", async () => {
  const requestId = await quote();
  for (let i = 0; i < 19; i++) await service().send(sendInput(requestId));
  let puts = 0;
  const countingBucket = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return (...args: Parameters<R2Bucket["put"]>) => {
          puts++;
          return target.put(...args);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const inputs = [
    sendInput(requestId, pdf()),
    sendInput(requestId, pdf()),
    sendInput(requestId, pdf()),
  ];
  const results = await Promise.allSettled(
    inputs.map((input) => service(customer, db, countingBucket).send(input)),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  for (const result of results)
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({ status: 429 });
  expect(puts).toBe(1);
  const winner = results.findIndex((result) => result.status === "fulfilled");
  await service(customer, db, countingBucket).send(inputs[winner]);
  expect(puts).toBe(1);
  expect((await service().list(requestId)).messages).toHaveLength(20);
  expect((await service(admin).send(sendInput(requestId))).authorRole).toBe(
    "admin",
  );
}, 30000);

it("counts committed and reserved attachment bytes atomically before R2 storage", async () => {
  const requestId = await quote();
  const tenMiB = 10 * 1024 * 1024;
  await db.batch(
    Array.from({ length: 9 }, () =>
      db
        .prepare(
          "INSERT INTO quote_conversation_reservations(id,request_id,author_role,author_id,byte_size,created_at) VALUES(?,?,'customer','conversation-owner',?,?)",
        )
        .bind(crypto.randomUUID(), requestId, tenMiB, new Date().toISOString()),
    ),
  );
  const bytes = new Uint8Array(tenMiB).fill(32);
  bytes.set(pdfFixtures.get("customer-visible")!);
  const attachment = new File([bytes], "large.pdf", {
    type: "application/pdf",
  });
  let puts = 0;
  const countingBucket = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return (...args: Parameters<R2Bucket["put"]>) => {
          puts++;
          return target.put(...args);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const results = await Promise.allSettled([
    service(customer, db, countingBucket).send(
      sendInput(requestId, attachment),
    ),
    service(customer, db, countingBucket).send(
      sendInput(requestId, attachment),
    ),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  for (const result of results)
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({ status: 413 });
  expect(puts).toBe(1);
  await expect(
    service(admin, db, countingBucket).send(sendInput(requestId, pdf())),
  ).rejects.toMatchObject({ status: 413 });
  expect(puts).toBe(1);
}, 30000);

it("retains budget while R2 is unavailable and reconciles before retrying the same command", async () => {
  const requestId = await quote();
  const failingBucket = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return () => {
          throw new Error("R2 unavailable");
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const input = sendInput(requestId, pdf());
  await expect(
    service(customer, db, failingBucket).send(input),
  ).rejects.toThrow("R2 unavailable");
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM quote_conversation_reservations WHERE request_id=?",
      )
      .bind(requestId)
      .first(),
  ).toEqual({ count: 1 });
  expect((await service().send(input)).attachment?.filename).toBe(
    "drawing.pdf",
  );
});

it("reclaims expired send and byte budgets only after replacing abandoned bytes with tombstones", async () => {
  const requestId = await quote();
  const ids = Array.from({ length: 20 }, () => `r1-${crypto.randomUUID()}`);
  await db.batch(
    ids.map((id) =>
      db
        .prepare(
          "INSERT INTO quote_conversation_reservations(id,request_id,author_role,author_id,byte_size,created_at) VALUES(?,?,'customer','conversation-owner',5242880,'2000-01-01T00:00:00.000Z')",
        )
        .bind(id, requestId),
    ),
  );
  for (const id of ids)
    await bucket.put(`quote-conversation/${id}`, "abandoned private bytes");
  const message = await service().send(sendInput(requestId, pdf()));
  expect(message.attachment).not.toBeNull();
  for (const id of ids) {
    const object = await bucket.head(`quote-conversation/${id}`);
    expect(object?.size).toBe(0);
    expect(object?.customMetadata).toEqual({ state: "abandoned" });
  }
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM quote_conversation_reservations WHERE request_id=?",
      )
      .bind(requestId)
      .first(),
  ).toEqual({ count: 0 });
});

it("a tombstone rejects a late R2 put and a fresh attempt can reuse the command", async () => {
  const requestId = await quote();
  let abandonedKey = "";
  let latePut: R2Object | null | undefined;
  const delayedBucket = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          if (args[2]?.onlyIf) {
            abandonedKey = args[0];
            await db
              .prepare(
                "UPDATE quote_conversation_reservations SET created_at='2000-01-01T00:00:00.000Z' WHERE request_id=?",
              )
              .bind(requestId)
              .run();
            expect(await service().reconcileExpired(requestId)).toEqual({
              released: 1,
              legacy: 0,
            });
            latePut = await target.put(...args);
            return latePut;
          }
          return target.put(...args);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const input = sendInput(requestId, pdf());
  await expect(
    service(customer, db, delayedBucket).send(input),
  ).rejects.toMatchObject({ status: 409 });
  expect(latePut).toBeNull();
  expect((await bucket.head(abandonedKey))?.size).toBe(0);
  expect((await service().list(requestId)).messages).toEqual([]);
  expect((await service().send(input)).attachment?.filename).toBe(
    "drawing.pdf",
  );
});

it("rejects a late append after upload and retires its bytes", async () => {
  const requestId = await quote();
  const before = await objectKeys();
  const expiringBucket = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          const object = await target.put(...args);
          if (args[2]?.onlyIf)
            await db
              .prepare(
                "UPDATE quote_conversation_reservations SET created_at='2000-01-01T00:00:00.000Z' WHERE request_id=?",
              )
              .bind(requestId)
              .run();
          return object;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    service(customer, db, expiringBucket).send(sendInput(requestId, pdf())),
  ).rejects.toMatchObject({ status: 409 });
  expect((await service().list(requestId)).messages).toEqual([]);
  expect(await objectKeys()).toEqual(before);
});

it("reconciliation never overwrites committed attachments", async () => {
  const requestId = await quote();
  const message = await service().send(sendInput(requestId, pdf()));
  const original = await (
    await service().download(requestId, message.id)
  ).arrayBuffer();
  await db
    .prepare(
      "INSERT INTO quote_conversation_reservations(id,request_id,author_role,author_id,byte_size,created_at) VALUES(?,?,'customer','conversation-owner',?,'2000-01-01T00:00:00.000Z')",
    )
    .bind(message.id, requestId, message.attachment!.byteSize)
    .run();
  expect(await service().reconcileExpired(requestId)).toEqual({
    released: 1,
    legacy: 0,
  });
  expect(
    await (await service().download(requestId, message.id)).arrayBuffer(),
  ).toEqual(original);
});

it("retries interrupted cleanup without freeing quota while private bytes remain", async () => {
  const requestId = await quote();
  const id = `r1-${crypto.randomUUID()}`;
  const key = `quote-conversation/${id}`;
  await db
    .prepare(
      "INSERT INTO quote_conversation_reservations(id,request_id,author_role,author_id,byte_size,created_at) VALUES(?,?,'customer','conversation-owner',4,'2000-01-01T00:00:00.000Z')",
    )
    .bind(id, requestId)
    .run();
  await bucket.put(key, "file");
  const unavailableBucket = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return () => {
          throw new Error("cleanup unavailable");
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    service(customer, db, unavailableBucket).reconcileExpired(requestId),
  ).rejects.toThrow("cleanup unavailable");
  expect((await bucket.head(key))?.size).toBe(4);
  expect(
    await db
      .prepare(
        "SELECT byte_size FROM quote_conversation_reservations WHERE id=?",
      )
      .bind(id)
      .first(),
  ).toEqual({ byte_size: 4 });
  expect(await service().reconcileExpired(requestId)).toEqual({
    released: 1,
    legacy: 0,
  });
  expect((await bucket.head(key))?.size).toBe(0);
});

it("retries D1 release failure after tombstoning without permitting file resurrection", async () => {
  const requestId = await quote();
  const id = `r1-${crypto.randomUUID()}`;
  const key = `quote-conversation/${id}`;
  await db
    .prepare(
      "INSERT INTO quote_conversation_reservations(id,request_id,author_role,author_id,byte_size,created_at) VALUES(?,?,'customer','conversation-owner',4,'2000-01-01T00:00:00.000Z')",
    )
    .bind(id, requestId)
    .run();
  await bucket.put(key, "file");
  const failingDatabase = new Proxy(db, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (sql !== "DELETE FROM quote_conversation_reservations WHERE id=?")
            return statement;
          return new Proxy(statement, {
            get(statementTarget, field) {
              if (field === "bind")
                return (...args: Parameters<D1PreparedStatement["bind"]>) => {
                  const bound = statementTarget.bind(...args);
                  return new Proxy(bound, {
                    get(boundTarget, method) {
                      if (method === "run")
                        return () => {
                          throw new Error("release unavailable");
                        };
                      const value = Reflect.get(boundTarget, method);
                      return typeof value === "function"
                        ? value.bind(boundTarget)
                        : value;
                    },
                  });
                };
              const value = Reflect.get(statementTarget, field);
              return typeof value === "function"
                ? value.bind(statementTarget)
                : value;
            },
          });
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(
    service(customer, failingDatabase).reconcileExpired(requestId),
  ).rejects.toThrow("release unavailable");
  expect((await bucket.head(key))?.size).toBe(0);
  expect(
    await db
      .prepare(
        "SELECT byte_size FROM quote_conversation_reservations WHERE id=?",
      )
      .bind(id)
      .first(),
  ).toEqual({ byte_size: 4 });
  expect(
    await bucket.put(key, "late", {
      onlyIf: { etagDoesNotMatch: "*" },
    }),
  ).toBeNull();
  expect(await service().reconcileExpired(requestId)).toEqual({
    released: 1,
    legacy: 0,
  });
});

it("reports unmappable legacy reservations without pretending their random-key bytes were deleted", async () => {
  const requestId = await quote();
  await db
    .prepare(
      "INSERT INTO quote_conversation_reservations(id,request_id,author_role,author_id,byte_size,created_at) VALUES(?,?,'customer','conversation-owner',4,'2000-01-01T00:00:00.000Z')",
    )
    .bind(crypto.randomUUID(), requestId)
    .run();
  expect(await service().reconcileExpired(requestId)).toEqual({
    released: 0,
    legacy: 1,
  });
  expect(
    await db
      .prepare(
        "SELECT sum(byte_size) AS bytes FROM quote_conversation_reservations WHERE request_id=?",
      )
      .bind(requestId)
      .first(),
  ).toEqual({ bytes: 4 });
});

it("never projects internal notes, evidence, object keys, author identities or command metadata", async () => {
  const requestId = await quote();
  await db.batch([
    db
      .prepare(
        "INSERT INTO quote_internal_notes(id,request_id,actor_id,body,created_at) VALUES(?,?,'admin','SECRET_NOTE','2026-09-14')",
      )
      .bind(crypto.randomUUID(), requestId),
    db
      .prepare(
        `INSERT INTO quote_private_evidence(id,request_id,actor_id,kind,filename,content_type,byte_size,checksum,object_key,created_at)
      VALUES(?,?,'admin','tax_exemption','SECRET_TAX.pdf','application/pdf',5,'secret-checksum','SECRET_R2','2026-09-14')`,
      )
      .bind(crypto.randomUUID(), requestId),
  ]);
  const input = sendInput(requestId, pdf());
  const message = await service(admin).send(input);
  const projection = JSON.stringify(await service().list(requestId));
  for (const secret of [
    "SECRET_NOTE",
    "SECRET_TAX",
    "SECRET_R2",
    "SECRET_COST",
    "object_key",
    "objectKey",
    "payload_hash",
    input.commandId,
    identity.id,
  ])
    expect(projection).not.toContain(secret);
  expect(message.attachment).toMatchObject({
    filename: "drawing.pdf",
    contentType: "application/pdf",
  });
  const privateId = await db
    .prepare("SELECT id FROM quote_private_evidence WHERE request_id=?")
    .bind(requestId)
    .first<{ id: string }>();
  await expect(
    service().download(requestId, privateId!.id),
  ).rejects.toMatchObject({ status: 404 });
});

it("enforces append-only records and verifies bytes on each authorized download", async () => {
  const requestId = await quote();
  const message = await service().send(sendInput(requestId, pdf()));
  for (const sql of [
    "UPDATE quote_conversations SET created_at='changed' WHERE request_id=?",
    "DELETE FROM quote_conversations WHERE request_id=?",
    "UPDATE quote_conversation_messages SET body='changed' WHERE request_id=?",
    "DELETE FROM quote_conversation_messages WHERE request_id=?",
    "UPDATE quote_conversation_attachments SET filename='changed' WHERE message_id IN (SELECT id FROM quote_conversation_messages WHERE request_id=?)",
    "DELETE FROM quote_conversation_attachments WHERE message_id IN (SELECT id FROM quote_conversation_messages WHERE request_id=?)",
  ])
    await expect(db.prepare(sql).bind(requestId).run()).rejects.toThrow(
      /immutable|append only/,
    );
  const response = await service(admin).download(requestId, message.id);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  const file = await db
    .prepare(
      "SELECT object_key,byte_size FROM quote_conversation_attachments WHERE message_id=?",
    )
    .bind(message.id)
    .first<{ object_key: string; byte_size: number }>();
  await bucket.put(file!.object_key, "x".repeat(file!.byte_size));
  await expect(service().download(requestId, message.id)).rejects.toMatchObject(
    { status: 409 },
  );
  await bucket.delete(file!.object_key);
  await expect(service().download(requestId, message.id)).rejects.toMatchObject(
    { status: 404 },
  );
});

it("rolls back conversation, message, attachment and audit together and cleans failed R2 writes", async () => {
  const requestId = await quote();
  const before = await objectKeys();
  await db
    .prepare(
      "CREATE TRIGGER fail_conversation_audit BEFORE INSERT ON admin_audit_events WHEN NEW.event_type='quote_conversation.message_sent' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
    )
    .run();
  try {
    for (const attachment of [undefined, pdf()])
      await expect(
        service().send(sendInput(requestId, attachment)),
      ).rejects.toThrow(/audit unavailable/);
    expect(
      await db
        .prepare("SELECT * FROM quote_conversations WHERE request_id=?")
        .bind(requestId)
        .first(),
    ).toBeNull();
    expect((await service().list(requestId)).messages).toEqual([]);
    expect(await objectKeys()).toEqual(before);
  } finally {
    await db.prepare("DROP TRIGGER fail_conversation_audit").run();
  }
});

it("concurrent identical file submissions preserve only the winner's object and one audit", async () => {
  const requestId = await quote();
  const before = await objectKeys();
  let puts = 0;
  let release!: () => void;
  const bothUploaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gatedBucket = new Proxy(bucket, {
    get(target, property) {
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          const result = await target.put(...args);
          puts += 1;
          if (puts === 2) release();
          await bothUploaded;
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const input = sendInput(requestId, pdf());
  const [first, second] = await Promise.all([
    service(customer, db, gatedBucket).send(input),
    service(customer, db, gatedBucket).send(input),
  ]);
  expect(first).toEqual(second);
  expect((await objectKeys()).length).toBe(before.length + 1);
  expect(
    await (await service().download(requestId, first.id)).text(),
  ).toContain("%PDF-");
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM admin_audit_events WHERE entity_id=?",
      )
      .bind(requestId)
      .first(),
  ).toEqual({ count: 1 });
});

it("retains committed attachment bytes when the batch response is lost", async () => {
  const requestId = await quote();
  const uncertainDatabase = new Proxy(db, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await target.batch(statements);
          throw new Error("response lost after commit");
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const input = sendInput(requestId, pdf());
  const message = await service(customer, uncertainDatabase).send(input);
  expect(await service().send(input)).toEqual(message);
  expect(
    await (await service().download(requestId, message.id)).text(),
  ).toContain("%PDF-");
});

it("bounds pages to 50 and uses quote-scoped cursors without gaps or duplicates", async () => {
  const requestId = await quote();
  const ids: string[] = [];
  for (let index = 0; index < 55; index++)
    ids.push(
      (
        await service(admin).send({
          ...sendInput(requestId),
          body: `Message ${index}`,
        })
      ).id,
    );
  const latest = await service().list(requestId);
  expect(latest.messages).toHaveLength(50);
  expect(latest.nextCursor).toBe(latest.messages[0].id);
  const older = await service().list(requestId, { before: latest.nextCursor! });
  expect(older.messages).toHaveLength(5);
  expect(older.nextCursor).toBeNull();
  expect([...older.messages, ...latest.messages].map((m) => m.id)).toEqual(ids);
  await expect(
    service().list(await quote(), { before: latest.nextCursor! }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service().list(requestId, { before: "missing" }),
  ).rejects.toMatchObject({ status: 400 });
}, 30000);
