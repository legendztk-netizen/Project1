import { afterAll, beforeAll, expect, it } from "vitest";

import { createAfterSalesFiles } from "../app/modules/after-sales/application/after-sales-files";
import { createCaseService } from "../app/modules/after-sales/application/case-service";
import {
  owner,
  reviewer,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  unprivileged,
  type SeededOrder,
} from "./fixtures/after-sales-order";

let db: D1Database;
let bucket: R2Bucket;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-cases");
  db = started.db;
  bucket = started.bucket;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const at = (now: string) => createCaseService(db, { now: () => new Date(now) });

async function delivered(prefix: string) {
  const order = await seedAfterSalesOrder(db, prefix);
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  await shipShipment(db, order.orderId, order.shipments.second, {
    handoffAt: "2026-09-12T02:00:00.000Z",
    deliveredDate: "2026-09-20",
  });
  return order;
}

const open = (
  order: SeededOrder,
  now: string,
  reason: string,
  lines: Array<[string, string, number]>,
  commandId: string = crypto.randomUUID(),
) =>
  at(now).customerOpen("buyer", {
    orderId: order.orderId,
    reason,
    description: "Details of the issue",
    lines: lines.map(([lineId, shipmentId, physicalQuantity]) => ({
      lineId,
      shipmentId,
      physicalQuantity,
    })),
    commandId,
  });

it("uses each Shipment's ET delivery date with an inclusive day +14 cutoff", async () => {
  const order = await delivered("k1");
  const read = await at("2026-09-24T12:00:00.000Z").customerRead(
    "buyer",
    order.orderId,
  );
  const first = read.claimable.find(
    (item) =>
      item.lineId === order.lines.standard &&
      item.shipmentId === order.shipments.first,
  )!;
  expect(first).toMatchObject({
    deliveredDateEt: "2026-09-10",
    convenienceCutoffDateEt: "2026-09-24",
    convenienceCutoffAt: "2026-09-25T03:59:00.000Z",
    convenienceOpen: true,
    available: 2,
  });
  const second = read.claimable.find(
    (item) =>
      item.lineId === order.lines.standard &&
      item.shipmentId === order.shipments.second,
  )!;
  expect(second.convenienceCutoffDateEt).toBe("2026-10-04");
  // One millisecond after the first Shipment's cutoff it is closed; the second is open.
  await expect(
    open(order, "2026-09-25T03:59:00.001Z", "convenience_return", [
      [order.lines.standard, order.shipments.first, 1],
    ]),
  ).rejects.toMatchObject({ status: 400 });
  const exactly = await open(
    order,
    "2026-09-25T03:59:00.000Z",
    "convenience_return",
    [[order.lines.standard, order.shipments.first, 1]],
  );
  expect(exactly).toBeTruthy();
  await open(order, "2026-09-26T12:00:00.000Z", "convenience_return", [
    [order.lines.standard, order.shipments.second, 1],
  ]);
});

it("keeps defect reports open for made-to-order goods and rejects convenience returns for them", async () => {
  const order = await delivered("k2");
  for (const [lineId, shipmentId] of [
    [order.lines.madeToOrderStandard, order.shipments.first],
    [order.lines.cutHose, order.shipments.second],
    [order.lines.assembly, order.shipments.second],
  ])
    await expect(
      open(order, "2026-09-21T12:00:00.000Z", "convenience_return", [
        [lineId, shipmentId, 1],
      ]),
    ).rejects.toMatchObject({ status: 400 });
  const caseId = await open(
    order,
    "2026-12-01T12:00:00.000Z",
    "nonconforming",
    [
      [order.lines.cutHose, order.shipments.second, 2],
      [order.lines.assembly, order.shipments.second, 1],
    ],
  );
  const [view] = await at("2026-12-01T12:00:00.000Z").adminRead(
    reviewer,
    order.orderId,
  );
  expect(view).toMatchObject({
    id: caseId,
    caseNumber: `AS-ORDER-k2-1`,
    reason: "nonconforming",
    lines: [
      {
        lineId: order.lines.cutHose,
        physicalQuantity: 2,
        pieceLengthFt: 10,
        productClass: "cut_hose",
        convenienceCutoffAt: null,
      },
      { lineId: order.lines.assembly, productClass: "made_to_order" },
    ],
  });
  expect(
    await db
      .prepare("SELECT kind FROM admin_notifications WHERE id=?")
      .bind(`after-sales-case:${caseId}`)
      .first("kind"),
  ).toBe("after_sales_case_opened");
});

it("prevents duplicate claims and ignores undelivered quantities", async () => {
  const order = await seedAfterSalesOrder(db, "k3");
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  await shipShipment(db, order.orderId, order.shipments.second, {
    handoffAt: "2026-09-12T02:00:00.000Z",
  });
  const read = await at("2026-09-15T12:00:00.000Z").customerRead(
    "buyer",
    order.orderId,
  );
  expect(read.undeliveredShipments).toEqual(["Shipment 2"]);
  expect(
    read.claimable.some((item) => item.shipmentId === order.shipments.second),
  ).toBe(false);
  await expect(
    open(order, "2026-09-15T12:00:00.000Z", "damaged", [
      [order.lines.standard, order.shipments.second, 1],
    ]),
  ).rejects.toMatchObject({ status: 400 });
  const command = crypto.randomUUID();
  const caseId = await open(
    order,
    "2026-09-15T12:00:00.000Z",
    "damaged",
    [[order.lines.standardSecond, order.shipments.first, 2]],
    command,
  );
  expect(
    await open(
      order,
      "2026-09-15T12:00:00.000Z",
      "damaged",
      [[order.lines.standardSecond, order.shipments.first, 2]],
      command,
    ),
  ).toBe(caseId);
  await expect(
    open(order, "2026-09-15T12:00:00.000Z", "wrong_item", [
      [order.lines.standardSecond, order.shipments.first, 1],
    ]),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    at("2026-09-15T12:00:00.000Z").customerRead("other", order.orderId),
  ).rejects.toMatchObject({ status: 404 });
});

it("keeps the conversation in the Case, hides internal notes and notifies once", async () => {
  const order = await delivered("k4");
  const now = "2026-09-21T12:00:00.000Z";
  const service = at(now);
  const caseId = await open(order, now, "wrong_item", [
    [order.lines.standard, order.shipments.first, 1],
  ]);
  await expect(
    service.customerReply("other", {
      orderId: order.orderId,
      caseId,
      body: "Not mine",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 404 });
  const replyId = await service.customerReply("buyer", {
    orderId: order.orderId,
    caseId,
    body: "Photos attached",
    commandId: crypto.randomUUID(),
  });
  expect(
    await db
      .prepare("SELECT kind FROM admin_notifications WHERE source_id=?")
      .bind(replyId)
      .first("kind"),
  ).toBe("after_sales_customer_reply");
  await service.adminReply(reviewer, {
    orderId: order.orderId,
    caseId,
    body: "Supplier batch 44 may be mislabeled",
    visibility: "internal",
    commandId: crypto.randomUUID(),
  });
  const visible = {
    orderId: order.orderId,
    caseId,
    body: "Thanks, we are reviewing the label photos.",
    visibility: "customer" as const,
    commandId: crypto.randomUUID(),
  };
  await service.adminReply(reviewer, visible);
  await service.adminReply(reviewer, visible);
  await expect(
    service.adminReply(unprivileged, {
      ...visible,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  const customer = await service.customerRead("buyer", order.orderId);
  const bodies = customer.cases[0].messages.map((message) => message.body);
  expect(bodies).toEqual([
    "Photos attached",
    "Thanks, we are reviewing the label photos.",
  ]);
  expect(JSON.stringify(customer)).not.toContain("Supplier batch");
  const admin = await service.adminRead(owner, order.orderId);
  expect(admin[0].messages).toHaveLength(3);
  expect(
    await db
      .prepare(
        `SELECT count(*) AS count FROM quote_notification_outbox o
         JOIN quote_conversation_messages m ON m.id=o.message_id
         WHERE m.request_id=? AND m.body LIKE '%reviewing the label photos%'`,
      )
      .bind(order.requestId)
      .first("count"),
  ).toBe(1);
  // No RA, refund or return address is created by the Case.
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM after_sales_refund_authorizations WHERE order_id=?",
      )
      .bind(order.orderId)
      .first("count"),
  ).toBe(0);
  expect(JSON.stringify(customer)).not.toMatch(/Return Location|Plano/);
});

it("stores Case files privately with customer-owned and explicitly shared visibility", async () => {
  const order = await delivered("k5");
  const now = "2026-09-21T12:00:00.000Z";
  const caseId = await open(order, now, "damaged", [
    [order.lines.standard, order.shipments.first, 1],
  ]);
  const files = createAfterSalesFiles(db, bucket);
  const png = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    "box.png",
    { type: "image/png" },
  );
  const customerFile = await files.customerUpload("buyer", {
    orderId: order.orderId,
    scopeKind: "case",
    scopeId: caseId,
    file: png,
    commandId: crypto.randomUUID(),
  });
  await expect(
    files.customerUpload("other", {
      orderId: order.orderId,
      scopeKind: "case",
      scopeId: caseId,
      file: png,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 404 });
  const internal = await files.adminUpload(owner, {
    orderId: order.orderId,
    scopeKind: "case",
    scopeId: caseId,
    file: png,
    commandId: crypto.randomUUID(),
  });
  let customer = await at(now).customerRead("buyer", order.orderId);
  expect(customer.cases[0].files.map((file) => file.id)).toEqual([
    customerFile,
  ]);
  await expect(
    files.customerDownload("buyer", order.orderId, internal),
  ).rejects.toMatchObject({ status: 404 });
  await files.adminShare(owner, {
    orderId: order.orderId,
    fileId: internal,
    reason: "Shows the crushed carton corner",
  });
  customer = await at(now).customerRead("buyer", order.orderId);
  expect(customer.cases[0].files.map((file) => file.id)).toEqual([
    customerFile,
    internal,
  ]);
  const download = await files.customerDownload(
    "buyer",
    order.orderId,
    internal,
  );
  expect(download.status).toBe(200);
  await download.arrayBuffer();
});
