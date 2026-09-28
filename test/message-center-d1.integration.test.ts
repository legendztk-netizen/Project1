import { afterAll, beforeAll, expect, it } from "vitest";

import { createAfterSalesFiles } from "../app/modules/after-sales/application/after-sales-files";
import { createCaseService } from "../app/modules/after-sales/application/case-service";
import { createReturnAuthorizationService } from "../app/modules/after-sales/application/return-authorization-service";
import { createMessageCenter } from "../app/modules/message-center/application/message-center-service";
import { inboundCaseTopicStatement } from "../app/modules/quote-inbound-email/infrastructure/d1-inbound-email";
import {
  owner,
  reviewer,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  type SeededOrder,
  caseVersion,
} from "./fixtures/after-sales-order";

let db: D1Database;
let bucket: R2Bucket;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("message-center");
  db = started.db;
  bucket = started.bucket;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const post = () =>
  new Request("https://shop.test/account/messages/x", {
    method: "POST",
    headers: { Origin: "https://shop.test" },
  });

async function orderWithCase(prefix: string) {
  const order = await seedAfterSalesOrder(db, prefix);
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  const caseId = await createCaseService(db, {
    now: () => new Date("2026-09-21T12:00:00.000Z"),
  }).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "wrong_item",
    description: "Wrong fitting in the box",
    lines: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        physicalQuantity: 1,
      },
    ],
    commandId: crypto.randomUUID(),
  });
  return { order, caseId };
}

const send = (
  center: ReturnType<typeof createMessageCenter>,
  who: "buyer" | "admin",
  order: SeededOrder,
  body: string,
  caseId?: string,
) =>
  (who === "buyer" ? center.customer("buyer") : center.admin(owner)).send({
    request: post(),
    requestId: order.requestId,
    commandId: crypto.randomUUID(),
    body,
    caseId,
  });

it("keeps one conversation per Order with Case topics, owner-only access and read state", async () => {
  const { order, caseId } = await orderWithCase("m1");
  const other = await orderWithCase("m2");
  const center = createMessageCenter(db, bucket);
  await send(center, "buyer", order, "Which carrier should I use?", caseId);
  await send(center, "buyer", order, "Also, is the invoice final?");
  // A Case from another Order can never label this conversation.
  await expect(
    send(center, "buyer", order, "Wrong case", other.caseId),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    center.customer("other").thread(order.requestId),
  ).rejects.toMatchObject({ status: 404 });

  const inbox = await center
    .admin(owner)
    .threads({ filter: "unread", query: "" });
  const summary = inbox.threads.find(
    (thread) => thread.requestId === order.requestId,
  )!;
  expect(summary).toMatchObject({
    unread: 2,
    openCases: 1,
    order: { orderNumber: expect.any(String) },
    lastMessage: {
      authorRole: "customer",
      body: "Also, is the invoice final?",
    },
  });
  const byOrder = await center.admin(owner).threads({
    filter: "all",
    query: summary.order!.orderNumber,
  });
  expect(byOrder.threads.map((thread) => thread.requestId)).toEqual([
    order.requestId,
  ]);

  const adminThread = await center.admin(owner).thread(order.requestId);
  expect(adminThread.context).toMatchObject({
    order: { id: order.orderId, shipmentCount: expect.any(Number) },
    cases: [{ id: caseId, status: "open" }],
    customerEmail: "buyer@example.test",
  });
  expect(
    adminThread.messages.messages.slice(-2).map((message) => message.topic),
  ).toEqual([{ caseId, caseNumber: expect.stringMatching(/^AS-/) }, null]);
  // Viewing the latest page marks what the Admin actually saw as read.
  expect(
    (
      await center.admin(owner).threads({ filter: "unread", query: "" })
    ).threads.some((thread) => thread.requestId === order.requestId),
  ).toBe(false);
  expect(
    (
      await center.admin(owner).threads({ filter: "awaiting", query: "" })
    ).threads.some((thread) => thread.requestId === order.requestId),
  ).toBe(true);
  // Read state is per Admin.
  expect(await center.admin(reviewer).unreadThreads()).toBeGreaterThan(0);

  await center.admin(owner).addNote({
    request: post(),
    requestId: order.requestId,
    caseId,
    body: "Supplier lot 44 may be mislabeled",
    commandId: crypto.randomUUID(),
  });
  // Other Orders of this buyer keep their own unread messages.
  await center.customer("buyer").thread(order.requestId);
  const baseline = await center.customer("buyer").unread();
  await send(center, "admin", order, "Any tracked carrier works.", caseId);
  expect(await center.customer("buyer").unread()).toBe(baseline + 1);
  const customerThread = await center.customer("buyer").thread(order.requestId);
  expect(JSON.stringify(customerThread)).not.toContain("Supplier lot 44");
  expect(customerThread).not.toHaveProperty("notes");
  expect(customerThread.context.customerEmail).toBeNull();
  expect(await center.customer("buyer").unread()).toBe(baseline);
  expect(
    (await center.admin(owner).thread(order.requestId)).notes,
  ).toMatchObject([
    { body: "Supplier lot 44 may be mislabeled", topic: { caseId } },
  ]);
  // The Admin reply notifies the customer once, through the email outbox.
  expect(
    await db
      .prepare(
        `SELECT count(*) AS count FROM quote_notification_outbox o
         JOIN quote_conversation_messages m ON m.id=o.message_id
         WHERE m.request_id=? AND m.body='Any tracked carrier works.'`,
      )
      .bind(order.requestId)
      .first("count"),
  ).toBe(1);
});

it("files after-sales notifications under their Case and attaches shared files to the decision", async () => {
  const { order, caseId } = await orderWithCase("m3");
  const commandId = crypto.randomUUID();
  await createReturnAuthorizationService(db, {
    now: () => new Date("2026-09-22T12:00:00.000Z"),
  }).adminDeclineReturn(reviewer, {
    orderId: order.orderId,
    caseId,
    expectedVersion: await caseVersion(db, caseId),
    reason: "The photos show the correct part number.",
    commandId,
  });
  const thread = await createMessageCenter(db, bucket)
    .customer("buyer")
    .thread(order.requestId);
  expect(thread.messages.messages.at(-1)).toMatchObject({
    authorRole: "admin",
    topic: { caseId },
    body: expect.stringContaining("Reply to this message if you disagree."),
  });

  const files = createAfterSalesFiles(db, bucket);
  const png = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    "part-number.png",
    { type: "image/png" },
  );
  const attach = {
    orderId: order.orderId,
    caseId,
    eventId: `case-event:${commandId}`,
    file: png,
    commandId: crypto.randomUUID(),
    label: "随不予授权说明附给客户",
  };
  const fileId = await files.adminAttachToEvent(reviewer, attach);
  expect(await files.adminAttachToEvent(reviewer, attach)).toBe(fileId);
  const [customerCase] = (
    await createCaseService(db).customerRead("buyer", order.orderId)
  ).cases;
  expect(customerCase.events.at(-1)).toMatchObject({ fileIds: [fileId] });
  expect(customerCase.files).toContainEqual(
    expect.objectContaining({ id: fileId, visibility: "shared" }),
  );
  // A file can only be attached to an event of its own Case.
  const other = await orderWithCase("m4");
  await expect(
    files.adminAttachToEvent(reviewer, {
      ...attach,
      orderId: other.order.orderId,
      caseId: other.caseId,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toThrow(/same Case/);
});

it("files a customer's email reply to a Case notification under the same Case", async () => {
  const { order, caseId } = await orderWithCase("m9");
  const commandId = crypto.randomUUID();
  await createReturnAuthorizationService(db, {
    now: () => new Date("2026-09-22T12:00:00.000Z"),
  }).adminDeclineReturn(reviewer, {
    orderId: order.orderId,
    caseId,
    expectedVersion: await caseVersion(db, caseId),
    reason: "The photos show the correct part number.",
    commandId,
  });
  const notification = await db
    .prepare(
      `SELECT o.id FROM quote_notification_outbox o WHERE o.message_id=?`,
    )
    .bind(`case-event-email:${commandId}`)
    .first<{ id: string }>("id");
  const tokenHash = "b".repeat(64);
  await db.batch([
    db
      .prepare(
        `INSERT INTO quote_notification_reply_tokens
         (token_hash,notification_id,request_id,profile_id,recipient_email,created_at,expires_at)
         VALUES (?,?,?,'buyer','buyer@example.test',0,9999999999999)`,
      )
      .bind(tokenHash, notification, order.requestId),
    db
      .prepare(
        `INSERT INTO quote_conversation_messages
         (id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,source,delivery_state)
         VALUES ('m9-email',?,'customer','buyer','It is the wrong part','2026-09-23T12:00:00.000Z',
           'inbound-email/m9','h','email','available')`,
      )
      .bind(order.requestId),
    inboundCaseTopicStatement(db, { messageId: "m9-email", tokenHash }),
  ]);
  const thread = await createMessageCenter(db, bucket)
    .admin(owner)
    .thread(order.requestId);
  expect(
    thread.messages.messages.find((message) => message.id === "m9-email"),
  ).toMatchObject({ topic: { caseId } });
});

it("audits internal notes with the request command and IP without exposing note contents", async () => {
  const { order } = await orderWithCase("note-audit");
  const center = createMessageCenter(db, bucket);
  const commandId = crypto.randomUUID();
  const request = post();
  request.headers.set("cf-connecting-ip", "192.0.2.15");
  const input = {
    request,
    requestId: order.requestId,
    body: "Private factory details",
    commandId,
  };
  const id = await center.admin(owner).addNote(input);
  expect(await center.admin(owner).addNote(input)).toBe(id);
  const audit = await db
    .prepare("SELECT payload_json FROM admin_audit_events WHERE id=?")
    .bind(`message-note:${id}`)
    .first<string>("payload_json");
  expect(JSON.parse(audit!)).toEqual({
    noteId: id,
    caseId: null,
    commandId,
    ipAddress: "192.0.2.15",
  });
  expect(
    JSON.stringify(await center.customer("buyer").thread(order.requestId)),
  ).not.toContain(input.body);
});
