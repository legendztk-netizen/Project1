import { afterAll, beforeAll, expect, it } from "vitest";
import { createCaseService } from "../app/modules/after-sales/application/case-service";
import { createDecisionRevisionService } from "../app/modules/after-sales/application/decision-revision-service";
import { createReturnAuthorizationService } from "../app/modules/after-sales/application/return-authorization-service";
import { createReturnInspectionService } from "../app/modules/after-sales/application/return-inspection-service";
import { createRefundResponseService } from "../app/modules/after-sales/application/refund-response-service";
import { createCancellationService } from "../app/modules/after-sales/application/cancellation-service";
import {
  owner,
  fixtureClock,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  caseVersion,
} from "./fixtures/after-sales-order";
let db: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  const s = await startAfterSalesDatabase("review-spec7");
  db = s.db;
  dispose = s.dispose;
}, 90000);
afterAll(async () => {
  await dispose?.();
});
const clock = { now: () => new Date("2026-09-24T12:00:00.000Z") };
const good = {
  interfaces: "OK",
  sealingSurfaces: "OK",
  finish: "OK",
  packaging: "OK",
  installationEvidence: "None",
  fluidExposure: "None",
};
it("revises an inspection covering the same Order line from two shipments", async () => {
  const order = await seedAfterSalesOrder(db, "review-split");
  for (const shipment of Object.values(order.shipments))
    await shipShipment(db, order.orderId, shipment, {
      handoffAt: "2026-09-05T02:00:00.000Z",
      deliveredDate: "2026-09-10",
    });
  const lines = Object.values(order.shipments).map((shipmentId) => ({
    lineId: order.lines.standard,
    shipmentId,
    physicalQuantity: 1,
  }));
  const caseId = await createCaseService(db, clock).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "nonconforming",
    description: "Both leak",
    lines,
    commandId: crypto.randomUUID(),
  });
  const raId = await createReturnAuthorizationService(db, clock).adminIssue(
    owner,
    {
      orderId: order.orderId,
      caseId,
      expectedVersion: await caseVersion(db, caseId),
      locationId: "plano-returns",
      instructions: "Return fittings",
      lines,
      commandId: crypto.randomUUID(),
    },
  );
  const inspection = createReturnInspectionService(db, clock);
  const receiptId = await inspection.adminRecordReceipt(owner, {
    orderId: order.orderId,
    raId,
    receivedAt: "2026-09-24T12:00:00.000Z",
    source: "Intake",
    lines,
    commandId: crypto.randomUUID(),
  });
  const decisionId = await inspection.adminDecide(owner, {
    orderId: order.orderId,
    receiptId,
    responsibility: "seller",
    remedy: "refund",
    items: lines.map((l) => ({ ...l, approvedQuantity: 0, conditions: good })),
    customerReason: "No defect found",
    commandId: crypto.randomUUID(),
  });
  await createDecisionRevisionService(db, clock)
    .adminRevise(owner, {
      orderId: order.orderId,
      decisionId,
      expectedRevision: 0,
      items: lines.map((l) => ({ ...l, approvedQuantity: 1 })),
      customerReason: "Further testing found defects",
      commandId: crypto.randomUUID(),
    })
    .catch(async (error) => {
      throw new Error(
        error instanceof Response ? await error.text() : String(error),
      );
    });
  const credits = (
    await db
      .prepare(
        `SELECT physical_quantity,merchandise_cents FROM after_sales_refund_line_credits WHERE order_id=?`,
      )
      .bind(order.orderId)
      .all<{ physical_quantity: number; merchandise_cents: number }>()
  ).results;
  expect(credits).toEqual([{ physical_quantity: 2, merchandise_cents: 1800 }]);
  const readDeadline = () =>
    db
      .prepare(
        `SELECT deadline_at FROM after_sales_refund_authorizations
    WHERE order_id=? AND status='approved'`,
      )
      .bind(order.orderId)
      .first<string>("deadline_at");
  const originalDeadline = await readDeadline();
  const later = createDecisionRevisionService(db, {
    now: () => new Date("2026-09-28T12:00:00.000Z"),
  });
  await later.adminRevise(owner, {
    orderId: order.orderId,
    decisionId,
    expectedRevision: 1,
    items: lines.map((line) => ({ ...line, approvedQuantity: 0 })),
    customerReason: "Reassessing the findings",
    commandId: crypto.randomUUID(),
  });
  expect(await readDeadline()).toBeNull();
  await later.adminRevise(owner, {
    orderId: order.orderId,
    decisionId,
    expectedRevision: 2,
    items: lines.map((line) => ({ ...line, approvedQuantity: 1 })),
    customerReason: "Original findings confirmed",
    commandId: crypto.randomUUID(),
  });
  expect(await readDeadline()).toBe(originalDeadline);
});
it("rejects logistics already refunded by Spec 6", async () => {
  const order = await seedAfterSalesOrder(db, "review-ship");
  await db.batch([
    db
      .prepare(
        `INSERT INTO order_shipping_change_requests
         (id,order_id,profile_id,kind,status,requested_json,submission_command_id,
          submission_hash,created_at,updated_at,current_proposal_id)
         VALUES ('review-ship-change',?,'buyer','shipping_plan','proposed','{}','review-ship-cmd','x',?,?,'review-ship-proposal')`,
      )
      .bind(order.orderId, fixtureClock, fixtureClock),
    db
      .prepare(
        `INSERT INTO order_shipping_change_proposals
         (id,request_id,version,before_json,after_json,adjustment_cents,reason,
          expires_at,proposal_hash,command_id,command_hash,actor_id,published_at)
         VALUES ('review-ship-proposal','review-ship-change',1,'{}','{"shipments":[]}',-700,'Cheaper',
           '2026-10-30T00:00:00Z','h','review-ship-p','h','owner',?)`,
      )
      .bind(fixtureClock),
    db.prepare(
      "UPDATE order_shipping_change_requests SET status='accepted',version=2 WHERE id='review-ship-change'",
    ),
    db
      .prepare(
        `INSERT INTO order_shipping_change_acceptances
         (id,request_id,proposal_id,profile_id,proposal_hash,command_id,command_hash,accepted_at)
         VALUES ('review-ship-accept','review-ship-change','review-ship-proposal','buyer','h','review-ship-a','h',?)`,
      )
      .bind(fixtureClock),
    db
      .prepare(
        `INSERT INTO order_shipping_change_effective
         (id,order_id,request_id,proposal_id,proposal_hash,before_json,after_json,
          adjustment_cents,effective_at,command_id)
         VALUES ('review-ship-effective',?,'review-ship-change','review-ship-proposal','h','{}','{"shipments":[]}',-700,?,'review-ship-e')`,
      )
      .bind(order.orderId, "2026-09-01T12:00:00.000Z"),
    db
      .prepare(
        `INSERT INTO order_shipping_change_refund_reservations
         (id,effective_change_id,order_id,due_cents,reserved_at)
         VALUES ('review-ship-reservation','review-ship-effective',?,700,?)`,
      )
      .bind(order.orderId, "2026-09-01T12:00:00.000Z"),
  ]);

  const cancellations = createCancellationService(db, clock);
  const requestId = await cancellations.customerSubmit("buyer", {
    orderId: order.orderId,
    reason: "No longer needed",
    quantities: [
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        physicalQuantity: 1,
      },
    ],
    commandId: crypto.randomUUID(),
  });
  await expect(
    cancellations.adminResolve(owner, {
      orderId: order.orderId,
      requestId,
      expectedVersion: 1,
      decisions: [
        {
          lineId: order.lines.standardSecond,
          shipmentId: order.shipments.first,
          approvedQuantity: 1,
        },
      ],
      customerReason: "Not packed",
      logisticsCents: 4500,
      logisticsNote: "All original freight and duty refunded",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  // The failed decision rolls back; the remaining original logistics is valid.
  await cancellations.adminResolve(owner, {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    decisions: [
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        approvedQuantity: 1,
      },
    ],
    customerReason: "Not packed",
    logisticsCents: 3800,
    logisticsNote: "Remaining original charges after the shipping credit",
    commandId: crypto.randomUUID(),
  });
  expect(
    await db
      .prepare(
        `SELECT logistics_cents FROM after_sales_refund_authorizations WHERE order_id=?`,
      )
      .bind(order.orderId)
      .first("logistics_cents"),
  ).toBe(3800);
});

it("keeps the existing deadline when revising a customer-confirmed cost deduction", async () => {
  const order = await seedAfterSalesOrder(db, "review-deadline");
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  const line = {
    lineId: order.lines.standard,
    shipmentId: order.shipments.first,
    physicalQuantity: 2,
  };
  const caseId = await createCaseService(db, clock).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "convenience_return",
    description: "Not needed",
    lines: [line],
    commandId: crypto.randomUUID(),
  });
  const raId = await createReturnAuthorizationService(db, clock).adminIssue(
    owner,
    {
      orderId: order.orderId,
      caseId,
      expectedVersion: await caseVersion(db, caseId),
      locationId: "plano-returns",
      instructions: "Return fittings",
      lines: [line],
      commandId: crypto.randomUUID(),
    },
  );
  const inspection = createReturnInspectionService(db, clock);
  const receiptId = await inspection.adminRecordReceipt(owner, {
    orderId: order.orderId,
    raId,
    receivedAt: "2026-09-24T12:00:00.000Z",
    source: "Intake",
    lines: [line],
    commandId: crypto.randomUUID(),
  });
  const decisionId = await inspection.adminDecide(owner, {
    orderId: order.orderId,
    receiptId,
    responsibility: "customer",
    remedy: "refund",
    items: [{ ...line, approvedQuantity: 1, conditions: good }],
    customerReason: "One unused fitting",
    thirdPartyCostCents: 100,
    thirdPartyCostEvidence: "Documented charge",
    commandId: crypto.randomUUID(),
  });
  const refunds = async () =>
    (await inspection.customerRead("buyer", order.orderId))[0].decision!
      .refunds;
  const first = (await refunds())[0];
  await createRefundResponseService(db, clock).customerRespond("buyer", {
    orderId: order.orderId,
    authorizationId: first.id,
    expectedVersion: first.version,
    response: "confirm",
    commandId: crypto.randomUUID(),
  });
  const original = (await refunds())[0];
  const later = { now: () => new Date("2026-09-28T12:00:00.000Z") };
  await createDecisionRevisionService(db, later).adminRevise(owner, {
    orderId: order.orderId,
    decisionId,
    expectedRevision: 0,
    items: [{ ...line, approvedQuantity: 2 }],
    customerReason: "Both fittings unused",
    commandId: crypto.randomUUID(),
  });
  const awaiting = (await refunds())[1];
  await createRefundResponseService(db, later).customerRespond("buyer", {
    orderId: order.orderId,
    authorizationId: awaiting.id,
    expectedVersion: awaiting.version,
    response: "dispute",
    note: "Please explain the fee",
    commandId: crypto.randomUUID(),
  });
  const replacement = (await refunds())[1];
  await createRefundResponseService(db, later).customerRespond("buyer", {
    orderId: order.orderId,
    authorizationId: replacement.id,
    expectedVersion: replacement.version,
    response: "confirm",
    commandId: crypto.randomUUID(),
  });
  expect((await refunds())[1].deadlineAt).toBe(original.deadlineAt);
});
