import { afterAll, beforeAll, expect, it } from "vitest";

import { createAfterSalesFiles } from "../app/modules/after-sales/application/after-sales-files";
import { createCancellationService } from "../app/modules/after-sales/application/cancellation-service";
import {
  fixtureClock,
  owner,
  reviewer,
  seedAfterSalesOrder,
  startAfterSalesDatabase,
  unprivileged,
  type SeededOrder,
} from "./fixtures/after-sales-order";

let db: D1Database;
let bucket: R2Bucket;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-exceptional");
  db = started.db;
  bucket = started.bucket;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const service = () =>
  createCancellationService(db, { now: () => new Date(fixtureClock) });
const pdf = (name = "factory.pdf") =>
  new File([new TextEncoder().encode("%PDF-1.4 factory note")], name, {
    type: "application/pdf",
  });

async function open(
  order: SeededOrder,
  quantities: Array<[string, string, number]>,
) {
  return service().adminOpenExceptional(reviewer, {
    orderId: order.orderId,
    reason: "Customer reports a wrong length on the approved assembly",
    supportReference: "SUPPORT-42",
    quantities: quantities.map(([lineId, shipmentId, physicalQuantity]) => ({
      lineId,
      shipmentId,
      physicalQuantity,
    })),
    commandId: crypto.randomUUID(),
  });
}

const evidence = {
  status: "Hose not yet cut; assembly crimped",
  source: "Factory supervisor Wang via WeChat",
  reviewedAt: "2026-09-24T08:00:00.000Z",
  supportReference: "SUPPORT-42",
  attachmentIds: [] as string[],
  externalIdentifiers: "WO-7781",
  precut: null as boolean | null,
};

it("opens a Support review for made-to-order quantities only and exposes no customer cancel action", async () => {
  const order = await seedAfterSalesOrder(db, "e1");
  const customer = await service().customerRead("buyer", order.orderId);
  expect(customer.supportOnlyLines.map((line) => line.lineId)).toEqual([
    order.lines.madeToOrderStandard,
    order.lines.cutHose,
    order.lines.assembly,
  ]);
  expect(
    customer.eligible.some((item) => item.lineId === order.lines.assembly),
  ).toBe(false);
  await expect(
    open(order, [[order.lines.standard, order.shipments.first, 1]]),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service().adminOpenExceptional(unprivileged, {
      orderId: order.orderId,
      reason: "x",
      supportReference: "y",
      quantities: [
        {
          lineId: order.lines.assembly,
          shipmentId: order.shipments.second,
          physicalQuantity: 1,
        },
      ],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  // Cut hose is held by physical pieces, not footage.
  await expect(
    open(order, [[order.lines.cutHose, order.shipments.second, 40]]),
  ).rejects.toMatchObject({ status: 409 });
  const requestId = await open(order, [
    [order.lines.cutHose, order.shipments.second, 4],
  ]);
  const [request] = await service().adminRead(owner, order.orderId);
  expect(request).toMatchObject({
    id: requestId,
    kind: "exceptional",
    origin: "support",
    lines: [
      { physicalQuantity: 4, pieceLengthFt: 10, productClass: "cut_hose" },
    ],
  });
  // No customer withdrawal of a Support review.
  await expect(
    service().customerWithdraw("buyer", {
      orderId: order.orderId,
      requestId,
      expectedVersion: 1,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 404 });
});

it("requires documented factory facts and pre-cut evidence, then reverses the full cutting fee", async () => {
  const order = await seedAfterSalesOrder(db, "e2");
  const requestId = await open(order, [
    [order.lines.cutHose, order.shipments.second, 4],
  ]);
  const base = {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    decisions: [
      {
        lineId: order.lines.cutHose,
        shipmentId: order.shipments.second,
        approvedQuantity: 4,
      },
    ],
    customerReason:
      "Your hose had not been cut, so the order line is cancelled.",
  };
  await expect(
    service().adminResolve(owner, { ...base, commandId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service().adminResolve(owner, {
      ...base,
      commandId: crypto.randomUUID(),
      factoryEvidence: { ...evidence, reviewedAt: "2027-01-01T00:00:00Z" },
    }),
  ).rejects.toMatchObject({ status: 400 });
  // Missing pre-cut confirmation never implies the hose is uncut.
  await expect(
    service().adminResolve(owner, {
      ...base,
      commandId: crypto.randomUUID(),
      factoryEvidence: evidence,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const files = createAfterSalesFiles(db, bucket, {
    now: () => new Date(fixtureClock),
  });
  const fileId = await files.adminUpload(reviewer, {
    orderId: order.orderId,
    scopeKind: "cancellation",
    scopeId: requestId,
    file: pdf(),
    commandId: crypto.randomUUID(),
  });
  await service().adminResolve(owner, {
    ...base,
    commandId: crypto.randomUUID(),
    factoryEvidence: { ...evidence, precut: true, attachmentIds: [fileId] },
  });
  const [admin] = await service().adminRead(owner, order.orderId);
  expect(admin.resolution).toMatchObject({
    outcome: "approved",
    financial: {
      merchandiseCents: 8000,
      serviceFeeCents: 800,
      refundCents: 8800,
    },
    factoryEvidence: {
      source: "Factory supervisor Wang via WeChat",
      precut: true,
      attachmentIds: [fileId],
    },
  });
  const [customer] = (await service().customerRead("buyer", order.orderId))
    .requests;
  const customerJson = JSON.stringify(customer);
  expect(customerJson).not.toContain("Wang");
  expect(customerJson).not.toContain("WO-7781");
  expect(customer.resolution!.refunds[0]).toMatchObject({
    serviceFeeCents: 800,
    refundCents: 8800,
    status: "approved",
  });
  expect(
    (await files.customerList("buyer", order.orderId)).map((file) => file.id),
  ).toEqual([]);
  await expect(
    files.customerDownload("buyer", order.orderId, fileId),
  ).rejects.toMatchObject({ status: 404 });
  const download = await files.adminDownload(owner, order.orderId, fileId);
  expect(download.headers.get("Cache-Control")).toContain("no-store");
  expect(await download.text()).toContain("%PDF");
  await expect(
    files.adminDownload(unprivileged, order.orderId, fileId),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    await db
      .prepare(
        `SELECT message.body FROM quote_conversation_messages message
         WHERE message.request_id=? AND message.body LIKE '%Follow-on Quote%'`,
      )
      .bind(order.requestId)
      .first("body"),
  ).toContain("approved specification is not edited");
});

it("approves an assembly cancellation at Admin discretion without a threshold and keeps other holds", async () => {
  const order = await seedAfterSalesOrder(db, "e3");
  await db
    .prepare(
      `INSERT INTO order_quantity_holds
       (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
       VALUES ('e3-other',?,?,?,1,'shipping_change','Independent change',?)`,
    )
    .bind(
      order.orderId,
      order.lines.standard,
      order.shipments.second,
      fixtureClock,
    )
    .run();
  const requestId = await open(order, [
    [order.lines.assembly, order.shipments.second, 1],
  ]);
  await service().adminResolve(owner, {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    decisions: [
      {
        lineId: order.lines.assembly,
        shipmentId: order.shipments.second,
        approvedQuantity: 1,
      },
    ],
    customerReason: "Approved after factory review.",
    factoryEvidence: evidence,
  });
  expect(
    await db
      .prepare("SELECT active FROM order_quantity_holds WHERE id='e3-other'")
      .first("active"),
  ).toBe(1);
  expect(
    await db
      .prepare(
        `SELECT count(*) AS count FROM order_shipment_allocations
         WHERE shipment_id=? AND line_id=?`,
      )
      .bind(order.shipments.second, order.lines.assembly)
      .first("count"),
  ).toBe(0);
  // The approved configuration record itself is never edited.
  await expect(
    db
      .prepare(
        "UPDATE confirmed_order_lines SET snapshot_json='{}' WHERE line_id=?",
      )
      .bind(order.lines.assembly)
      .run(),
  ).rejects.toThrow(/immutable/);
});

it("scopes evidence files to their review and Order", async () => {
  const order = await seedAfterSalesOrder(db, "e4");
  const other = await seedAfterSalesOrder(db, "e5");
  const requestId = await open(order, [
    [order.lines.assembly, order.shipments.second, 1],
  ]);
  const files = createAfterSalesFiles(db, bucket);
  await expect(
    files.adminUpload(owner, {
      orderId: other.orderId,
      scopeKind: "cancellation",
      scopeId: requestId,
      file: pdf(),
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    files.adminUpload(owner, {
      orderId: order.orderId,
      scopeKind: "cancellation",
      scopeId: requestId,
      file: new File(["<html>"], "x.html", { type: "text/html" }),
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  const command = crypto.randomUUID();
  const fileId = await files.adminUpload(owner, {
    orderId: order.orderId,
    scopeKind: "cancellation",
    scopeId: requestId,
    file: pdf(),
    commandId: command,
  });
  expect(
    await files.adminUpload(owner, {
      orderId: order.orderId,
      scopeKind: "cancellation",
      scopeId: requestId,
      file: pdf(),
      commandId: command,
    }),
  ).toBe(fileId);
  await expect(
    files.adminDownload(owner, other.orderId, fileId),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service().adminResolve(owner, {
      orderId: other.orderId,
      requestId,
      expectedVersion: 1,
      commandId: crypto.randomUUID(),
      decisions: [],
      customerReason: "x",
    }),
  ).rejects.toMatchObject({ status: 400 });
});

it("records a seller-caused assembly cancellation with no deductions", async () => {
  const order = await seedAfterSalesOrder(db, "e9");
  const requestId = await open(order, [
    [order.lines.assembly, order.shipments.second, 1],
  ]);
  const decision = {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    decisions: [
      {
        lineId: order.lines.assembly,
        shipmentId: order.shipments.second,
        approvedQuantity: 1,
      },
    ],
    customerReason: "Our configuration check missed the wrong port size.",
    factoryEvidence: evidence,
    responsibility: "seller" as const,
  };
  await expect(
    service().adminResolve(owner, {
      ...decision,
      thirdPartyCostCents: 200,
      thirdPartyCostEvidence: "Bank fee",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await service().adminResolve(owner, {
    ...decision,
    commandId: crypto.randomUUID(),
  });
  const [request] = await service().adminRead(owner, order.orderId);
  expect(request.resolution?.financial).toMatchObject({
    responsibility: "seller",
    thirdPartyCostCents: 0,
  });
  expect(request.resolution?.refunds[0]).toMatchObject({
    responsibility: "seller",
    status: "approved",
  });
  // A standard cancellation is always the customer's request.
  const standard = await seedAfterSalesOrder(db, "e8");
  const standardRequest = await service().customerSubmit("buyer", {
    orderId: standard.orderId,
    reason: "Changed plan",
    quantities: [
      {
        lineId: standard.lines.standard,
        shipmentId: standard.shipments.first,
        physicalQuantity: 1,
      },
    ],
    commandId: crypto.randomUUID(),
  });
  await expect(
    service().adminResolve(owner, {
      orderId: standard.orderId,
      requestId: standardRequest,
      expectedVersion: 1,
      decisions: [
        {
          lineId: standard.lines.standard,
          shipmentId: standard.shipments.first,
          approvedQuantity: 1,
        },
      ],
      customerReason: "Approved",
      responsibility: "seller",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
});
