import { afterAll, beforeAll, expect, it } from "vitest";

import { createCaseService } from "../app/modules/after-sales/application/case-service";
import { createDecisionRevisionService } from "../app/modules/after-sales/application/decision-revision-service";
import { createRefundInitiationService } from "../app/modules/after-sales/application/refund-initiation-service";
import { createReturnAuthorizationService } from "../app/modules/after-sales/application/return-authorization-service";
import { createReturnInspectionService } from "../app/modules/after-sales/application/return-inspection-service";
import {
  owner,
  refunder,
  reviewer,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  unprivileged,
} from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-revisions");
  db = started.db;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const clock = (now: string) => ({ now: () => new Date(now) });
const good = {
  interfaces: "OK",
  sealingSurfaces: "OK",
  finish: "OK",
  packaging: "OK",
  installationEvidence: "None",
  fluidExposure: "None",
};

/** Seller-responsible nonconforming return of 2 x STD-B (USD 25.00 each). */
async function decided(prefix: string, approvedQuantity: number) {
  const order = await seedAfterSalesOrder(db, prefix);
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  const line = {
    lineId: order.lines.standardSecond,
    shipmentId: order.shipments.first,
    physicalQuantity: 2,
  };
  const caseId = await createCaseService(
    db,
    clock("2026-09-12T12:00:00.000Z"),
  ).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "nonconforming",
    description: "Leaking adapters",
    lines: [line],
    commandId: crypto.randomUUID(),
  });
  const raId = await createReturnAuthorizationService(
    db,
    clock("2026-09-13T12:00:00.000Z"),
  ).adminIssue(owner, {
    orderId: order.orderId,
    caseId,
    locationId: "plano-returns",
    instructions: "Return both adapters.",
    lines: [line],
    commandId: crypto.randomUUID(),
  });
  const inspection = createReturnInspectionService(
    db,
    clock("2026-09-18T12:00:00.000Z"),
  );
  const receiptId = await inspection.adminRecordReceipt(owner, {
    orderId: order.orderId,
    raId,
    receivedAt: "2026-09-17T12:00:00.000Z",
    source: "Intake",
    lines: [line],
    commandId: crypto.randomUUID(),
  });
  const decisionId = await inspection.adminDecide(owner, {
    orderId: order.orderId,
    receiptId,
    responsibility: "seller",
    remedy: "refund",
    items: [
      {
        lineId: line.lineId,
        shipmentId: line.shipmentId,
        approvedQuantity,
        conditions: good,
      },
    ],
    customerReason:
      approvedQuantity === 2 ? undefined : "One adapter shows no defect.",
    commandId: crypto.randomUUID(),
  });
  return { order, line, decisionId };
}

const revise = (
  input: {
    orderId: string;
    decisionId: string;
    expectedRevision: number;
    lineId: string;
    shipmentId: string;
    approvedQuantity: number;
  },
  commandId = crypto.randomUUID(),
  actor = reviewer,
) =>
  createDecisionRevisionService(
    db,
    clock("2026-09-25T12:00:00.000Z"),
  ).adminRevise(actor, {
    orderId: input.orderId,
    decisionId: input.decisionId,
    expectedRevision: input.expectedRevision,
    items: [
      {
        lineId: input.lineId,
        shipmentId: input.shipmentId,
        approvedQuantity: input.approvedQuantity,
      },
    ],
    customerReason: "Further testing confirmed the defect.",
    commandId,
  });

async function receipt(orderId: string) {
  const [view] = await createReturnInspectionService(
    db,
    clock("2026-09-25T12:00:00.000Z"),
  ).customerRead("buyer", orderId);
  return view;
}

it("replaces an uninitiated authorization with the revised amount and preserves history", async () => {
  const { order, line, decisionId } = await decided("v1", 1);
  expect((await receipt(order.orderId)).decision!.refunds[0].refundCents).toBe(
    2500,
  );
  const input = {
    ...line,
    orderId: order.orderId,
    decisionId,
    approvedQuantity: 2,
  };
  await expect(
    revise(
      { ...input, expectedRevision: 0 },
      crypto.randomUUID(),
      unprivileged,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    revise({ ...input, expectedRevision: 0, approvedQuantity: 3 }),
  ).rejects.toMatchObject({ status: 400 });
  const command = crypto.randomUUID();
  const revisionId = await revise({ ...input, expectedRevision: 0 }, command);
  expect(await revise({ ...input, expectedRevision: 0 }, command)).toBe(
    revisionId,
  );
  // A parallel command with the same expected revision loses.
  await expect(revise({ ...input, expectedRevision: 0 })).rejects.toMatchObject(
    { status: 409 },
  );
  const view = await receipt(order.orderId);
  expect(view.decision!.outcome).toBe("partially_approved");
  expect(view.decision!.revisions).toHaveLength(1);
  expect(view.decision!.revisions[0]).toMatchObject({
    revisionNumber: 1,
    outcome: "approved",
    financialEffect: "replaced",
  });
  expect(
    view.decision!.refunds.map((refund) => [refund.status, refund.refundCents]),
  ).toEqual([
    ["superseded", 2500],
    ["approved", 5000],
  ]);
  const contract = await db
    .prepare(
      `SELECT authorized_credit_cents,uninitiated_refund_cents
       FROM order_change_financial_contract WHERE order_id=?`,
    )
    .bind(order.orderId)
    .first();
  expect(contract).toEqual({
    authorized_credit_cents: 5000,
    uninitiated_refund_cents: 5000,
  });
  expect(
    await db
      .prepare(
        `SELECT count(*) AS count FROM quote_conversation_messages m
         JOIN quote_notification_outbox o ON o.message_id=m.id
         WHERE m.request_id=? AND m.body LIKE '%Revised inspection decision #1%'`,
      )
      .bind(order.requestId)
      .first("count"),
  ).toBe(1);
});

it("creates only the unrefunded difference as a Supplemental Refund after initiation", async () => {
  const { order, line, decisionId } = await decided("v2", 1);
  const refunds = createRefundInitiationService(
    db,
    clock("2026-09-22T12:00:00.000Z"),
  );
  const destinationId = await refunds.adminAddDestination(refunder, {
    orderId: order.orderId,
    channel: "bank_transfer",
    kind: "original_channel",
    label: "Buyer bank",
    holderName: "Buyer",
    institution: "Bank",
    samePurchasingContext: true,
    verificationEvidence: "Remittance advice",
    commandId: crypto.randomUUID(),
  });
  const original = (await receipt(order.orderId)).decision!.refunds[0];
  await refunds.adminRecordInitiation(refunder, {
    orderId: order.orderId,
    refundKind: "after_sales",
    refundId: original.id,
    destinationId,
    amountCents: 1000,
    initiatedDateEt: "2026-09-22",
    externalReference: "WIRE-A",
    commandId: crypto.randomUUID(),
  });
  await revise({
    ...line,
    orderId: order.orderId,
    decisionId,
    expectedRevision: 0,
    approvedQuantity: 2,
  });
  const view = await receipt(order.orderId);
  const [first, supplemental] = view.decision!.refunds;
  expect(first).toMatchObject({
    id: original.id,
    status: "approved",
    refundCents: 2500,
    initiatedCents: 1000,
    deadlineDateEt: original.deadlineDateEt,
  });
  expect(supplemental).toMatchObject({
    sourceKind: "supplemental",
    status: "approved",
    refundCents: 2500,
    merchandiseCents: 2500,
    previousAuthorizationId: original.id,
    deadlineDateEt: "2026-10-09",
  });
  expect(view.decision!.revisions[0].financialEffect).toBe("supplemental");
  // A second identical revision creates no further difference.
  await revise({
    ...line,
    orderId: order.orderId,
    decisionId,
    expectedRevision: 1,
    approvedQuantity: 2,
  });
  const again = await receipt(order.orderId);
  expect(again.decision!.refunds).toHaveLength(2);
  expect(again.decision!.revisions[1].financialEffect).toBe("none");
  // The supplemental refund is initiated through the same verified flow.
  await expect(
    refunds.adminRecordInitiation(refunder, {
      orderId: order.orderId,
      refundKind: "after_sales",
      refundId: supplemental.id,
      destinationId,
      amountCents: 2500,
      initiatedDateEt: "2026-09-22",
      externalReference: "WIRE-EARLY",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await createRefundInitiationService(
    db,
    clock("2026-09-26T12:00:00.000Z"),
  ).adminRecordInitiation(refunder, {
    orderId: order.orderId,
    refundKind: "after_sales",
    refundId: supplemental.id,
    destinationId,
    amountCents: 2500,
    initiatedDateEt: "2026-09-26",
    externalReference: "WIRE-B",
    commandId: crypto.randomUUID(),
  });
  const final = await receipt(order.orderId);
  expect(
    final.decision!.refunds.map((refund) => refund.initiatedCents),
  ).toEqual([1000, 2500]);
});

it("flags a reduction after initiation instead of inventing a clawback", async () => {
  const { order, line, decisionId } = await decided("v3", 2);
  const refunds = createRefundInitiationService(
    db,
    clock("2026-09-22T12:00:00.000Z"),
  );
  const destinationId = await refunds.adminAddDestination(refunder, {
    orderId: order.orderId,
    channel: "bank_transfer",
    kind: "original_channel",
    label: "Buyer bank",
    holderName: "Buyer",
    institution: "Bank",
    samePurchasingContext: true,
    verificationEvidence: "Remittance advice",
    commandId: crypto.randomUUID(),
  });
  const original = (await receipt(order.orderId)).decision!.refunds[0];
  await refunds.adminRecordInitiation(refunder, {
    orderId: order.orderId,
    refundKind: "after_sales",
    refundId: original.id,
    destinationId,
    amountCents: 5000,
    initiatedDateEt: "2026-09-22",
    externalReference: "WIRE-FULL",
    commandId: crypto.randomUUID(),
  });
  await revise({
    ...line,
    orderId: order.orderId,
    decisionId,
    expectedRevision: 0,
    approvedQuantity: 1,
  });
  const view = await receipt(order.orderId);
  expect(view.decision!.revisions[0].financialEffect).toBe("flagged");
  expect(view.decision!.refunds).toHaveLength(1);
  expect(view.decision!.refunds[0]).toMatchObject({
    status: "approved",
    refundCents: 5000,
    initiatedCents: 5000,
  });
});

it("turns a declined decision into an approved refund only through an inspected revision", async () => {
  const { order, line, decisionId } = await decided("v4", 0);
  expect((await receipt(order.orderId)).decision!.refunds).toEqual([]);
  await revise({
    ...line,
    orderId: order.orderId,
    decisionId,
    expectedRevision: 0,
    approvedQuantity: 2,
  });
  const view = await receipt(order.orderId);
  expect(view.decision!.outcome).toBe("declined");
  expect(view.decision!.refunds).toHaveLength(1);
  expect(view.decision!.refunds[0]).toMatchObject({
    status: "approved",
    refundCents: 5000,
  });
  await expect(
    db
      .prepare(
        "UPDATE after_sales_decision_revisions SET customer_reason='x' WHERE decision_id=?",
      )
      .bind(decisionId)
      .run(),
  ).rejects.toThrow(/append-only/);
});
