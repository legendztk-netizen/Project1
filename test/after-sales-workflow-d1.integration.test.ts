import { afterAll, beforeAll, expect, it } from "vitest";

import { createCancellationService } from "../app/modules/after-sales/application/cancellation-service";
import { createCaseService } from "../app/modules/after-sales/application/case-service";
import { createDecisionRevisionService } from "../app/modules/after-sales/application/decision-revision-service";
import { createRefundInitiationService } from "../app/modules/after-sales/application/refund-initiation-service";
import { createReturnAuthorizationService } from "../app/modules/after-sales/application/return-authorization-service";
import { createReturnInspectionService } from "../app/modules/after-sales/application/return-inspection-service";
import { createShipmentMilestoneService } from "../app/modules/shipment/application/shipment-milestone-service";
import {
  owner,
  refunder,
  reviewer,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  caseVersion,
} from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-workflow");
  db = started.db;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const at = (now: string) => ({ now: () => new Date(now) });
const uuid = () => crypto.randomUUID();
const good = {
  interfaces: "OK",
  sealingSurfaces: "OK",
  finish: "OK",
  packaging: "Original",
  installationEvidence: "None",
  fluidExposure: "None",
};

async function allocations(shipmentId: string) {
  return Object.fromEntries(
    (
      await db
        .prepare(
          "SELECT line_id,physical_quantity FROM order_shipment_allocations WHERE shipment_id=?",
        )
        .bind(shipmentId)
        .all<{ line_id: string; physical_quantity: number }>()
    ).results.map((row) => [row.line_id, row.physical_quantity]),
  );
}

it("runs a mixed Order from cancellation through supplemental refund while conserving money and quantities", async () => {
  // Paid in full plus USD 10.00 of unallocated excess funds.
  const order = await seedAfterSalesOrder(db, "w1", {
    receivedCents: 31000 + 1000,
  });
  const before = await db
    .prepare(
      "SELECT snapshot_hash,total_cents FROM confirmed_orders WHERE id=?",
    )
    .bind(order.orderId)
    .first();
  const cancellations = createCancellationService(
    db,
    at("2026-09-02T12:00:00.000Z"),
  );

  // 1. Standard cancellation: withdraw once, then approve a partial request.
  const withdrawn = await cancellations.customerSubmit("buyer", {
    orderId: order.orderId,
    reason: "Maybe not",
    quantities: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        physicalQuantity: 1,
      },
    ],
    commandId: uuid(),
  });
  await cancellations.customerWithdraw("buyer", {
    orderId: order.orderId,
    requestId: withdrawn,
    expectedVersion: 1,
    commandId: uuid(),
  });
  const cancelRequest = await cancellations.customerSubmit("buyer", {
    orderId: order.orderId,
    reason: "One adapter is enough",
    quantities: [
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        physicalQuantity: 1,
      },
    ],
    commandId: uuid(),
  });
  // Concurrent dispatch is blocked while the cancellation is pending.
  await expect(
    createShipmentMilestoneService(
      db,
      at("2026-09-02T12:00:00.000Z"),
    ).markReady(owner, {
      orderId: order.orderId,
      shipmentId: order.shipments.first,
      expectedVersion: 1,
      commandId: uuid(),
      verification: {
        specificationsVerified: true,
        quantitiesVerified: true,
        offlinePreparationVerified: true,
        requiredInspectionVerified: true,
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  await cancellations.adminResolve(reviewer, {
    orderId: order.orderId,
    requestId: cancelRequest,
    expectedVersion: 1,
    commandId: uuid(),
    decisions: [
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        approvedQuantity: 1,
      },
    ],
    customerReason: "Cancelled before packing.",
    logisticsCents: 300,
    logisticsNote: "Smaller carton requoted",
  });

  // 2. Support-initiated pre-cut hose cancellation with factory facts.
  const exceptional = await cancellations.adminOpenExceptional(reviewer, {
    orderId: order.orderId,
    reason: "Customer ordered the wrong hose size",
    supportReference: "SUP-9",
    quantities: [
      {
        lineId: order.lines.cutHose,
        shipmentId: order.shipments.second,
        physicalQuantity: 4,
      },
    ],
    commandId: uuid(),
  });
  await cancellations.adminResolve(owner, {
    orderId: order.orderId,
    requestId: exceptional,
    expectedVersion: 1,
    commandId: uuid(),
    decisions: [
      {
        lineId: order.lines.cutHose,
        shipmentId: order.shipments.second,
        approvedQuantity: 4,
      },
    ],
    customerReason: "The hose had not been cut.",
    factoryEvidence: {
      status: "Hose stock not cut",
      source: "Factory supervisor",
      reviewedAt: "2026-09-02T08:00:00.000Z",
      supportReference: "SUP-9",
      attachmentIds: [],
      externalIdentifiers: "",
      precut: true,
    },
  });
  expect(await allocations(order.shipments.first)).toEqual({
    [order.lines.standard]: 2,
    [order.lines.standardSecond]: 1,
    [order.lines.madeToOrderStandard]: 1,
  });
  expect(await allocations(order.shipments.second)).toEqual({
    [order.lines.standard]: 1,
    [order.lines.assembly]: 1,
  });

  // 3. Split deliveries on different dates.
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  await shipShipment(db, order.orderId, order.shipments.second, {
    handoffAt: "2026-09-06T02:00:00.000Z",
    deliveredDate: "2026-09-20",
  });
  expect(
    (
      await db
        .prepare(
          `SELECT line_id,physical_quantity FROM shipment_dispatch_quantities
           WHERE shipment_id=? ORDER BY line_id`,
        )
        .bind(order.shipments.second)
        .all()
    ).results,
  ).toEqual([
    { line_id: order.lines.assembly, physical_quantity: 1 },
    { line_id: order.lines.standard, physical_quantity: 1 },
  ]);

  // 4. Convenience return across both Shipments with partial receipts.
  const returnLines = [
    {
      lineId: order.lines.standard,
      shipmentId: order.shipments.first,
      physicalQuantity: 1,
    },
    {
      lineId: order.lines.standard,
      shipmentId: order.shipments.second,
      physicalQuantity: 1,
    },
  ];
  const convenience = await createCaseService(
    db,
    at("2026-09-22T12:00:00.000Z"),
  ).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "convenience_return",
    description: "Ordered extra fittings",
    lines: returnLines,
    commandId: uuid(),
  });
  const ras = createReturnAuthorizationService(
    db,
    at("2026-09-23T12:00:00.000Z"),
  );
  const raA = await ras.adminIssue(reviewer, {
    orderId: order.orderId,
    caseId: convenience,
    expectedVersion: await caseVersion(db, convenience),
    locationId: "plano-returns",
    instructions: "Original bags.",
    lines: returnLines,
    commandId: uuid(),
  });
  const inspections = createReturnInspectionService(
    db,
    at("2026-09-30T12:00:00.000Z"),
  );
  const firstPackage = await inspections.adminRecordReceipt(reviewer, {
    orderId: order.orderId,
    raId: raA,
    receivedAt: "2026-09-28T12:00:00.000Z",
    source: "Intake A",
    lines: [returnLines[0]],
    commandId: uuid(),
  });
  const secondPackage = await inspections.adminRecordReceipt(reviewer, {
    orderId: order.orderId,
    raId: raA,
    receivedAt: "2026-09-29T12:00:00.000Z",
    source: "Intake B",
    lines: [returnLines[1]],
    commandId: uuid(),
  });
  await inspections.adminDecide(reviewer, {
    orderId: order.orderId,
    receiptId: firstPackage,
    responsibility: "customer",
    remedy: "refund",
    items: [{ ...returnLines[0], approvedQuantity: 1, conditions: good }],
    customerReason: "Inspection confirms the reported issue.",
    commandId: uuid(),
  });
  const declined = await inspections.adminDecide(reviewer, {
    orderId: order.orderId,
    receiptId: secondPackage,
    responsibility: "customer",
    remedy: "refund",
    items: [
      {
        ...returnLines[1],
        approvedQuantity: 0,
        conditions: { ...good, installationEvidence: "Thread sealant" },
      },
    ],
    customerReason: "The fitting shows installation residue.",
    commandId: uuid(),
  });

  // 5. Nonconforming assembly: seller-funded refund.
  const defect = await createCaseService(
    db,
    at("2026-10-15T12:00:00.000Z"),
  ).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "nonconforming",
    description: "Assembly leaks at crimp",
    lines: [
      {
        lineId: order.lines.assembly,
        shipmentId: order.shipments.second,
        physicalQuantity: 1,
      },
    ],
    commandId: uuid(),
  });
  const raB = await createReturnAuthorizationService(
    db,
    at("2026-10-15T13:00:00.000Z"),
  ).adminIssue(reviewer, {
    orderId: order.orderId,
    caseId: defect,
    expectedVersion: await caseVersion(db, defect),
    locationId: "plano-returns",
    instructions: "Cap both ends.",
    lines: [
      {
        lineId: order.lines.assembly,
        shipmentId: order.shipments.second,
        physicalQuantity: 1,
      },
    ],
    commandId: uuid(),
  });
  const defectInspection = createReturnInspectionService(
    db,
    at("2026-10-20T12:00:00.000Z"),
  );
  const defectReceipt = await defectInspection.adminRecordReceipt(reviewer, {
    orderId: order.orderId,
    raId: raB,
    receivedAt: "2026-10-19T12:00:00.000Z",
    source: "Intake C",
    lines: [
      {
        lineId: order.lines.assembly,
        shipmentId: order.shipments.second,
        physicalQuantity: 1,
      },
    ],
    commandId: uuid(),
  });
  const defectDecision = await defectInspection.adminDecide(owner, {
    orderId: order.orderId,
    receiptId: defectReceipt,
    responsibility: "seller",
    remedy: "refund",
    items: [
      {
        lineId: order.lines.assembly,
        shipmentId: order.shipments.second,
        approvedQuantity: 1,
        conditions: { ...good, finish: "Crimp leak confirmed" },
      },
    ],
    sellerLogisticsCents: 1200,
    sellerLogisticsNote: "Customer's return label",
    customerReason: "Inspection confirms the reported issue.",
    commandId: uuid(),
  });

  // 6. Initiate refunds externally, then revise with a supplemental amount.
  const refunds = createRefundInitiationService(
    db,
    at("2026-10-21T12:00:00.000Z"),
  );
  const destinationId = await refunds.adminAddDestination(refunder, {
    orderId: order.orderId,
    channel: "bank_transfer",
    kind: "original_channel",
    label: "Buyer bank",
    holderName: "Test Buyer",
    institution: "First Bank",
    accountLast4: "4321",
    samePurchasingContext: true,
    verificationEvidence: "Matched original remittance",
    commandId: uuid(),
  });
  const orderRefunds = await refunds.adminOrder(owner, order.orderId);
  const bySource = (kind: string) =>
    orderRefunds.afterSales.filter(
      (refund) => refund.sourceKind === kind && refund.status === "approved",
    );
  expect(bySource("cancellation").map((refund) => refund.refundCents)).toEqual([
    2800, 8800,
  ]);
  expect(bySource("return").map((refund) => refund.refundCents)).toEqual([
    810, 7200,
  ]);
  for (const refund of [...bySource("cancellation"), ...bySource("return")])
    await refunds.adminRecordInitiation(refunder, {
      orderId: order.orderId,
      refundKind: "after_sales",
      refundId: refund.id,
      destinationId,
      amountCents: refund.refundCents,
      initiatedDateEt: "2026-10-21",
      externalReference: `WIRE-${refund.id.slice(0, 6)}`,
      commandId: uuid(),
    });
  const revisions = createDecisionRevisionService(
    db,
    at("2026-10-22T12:00:00.000Z"),
  );
  await revisions.adminRevise(reviewer, {
    orderId: order.orderId,
    decisionId: defectDecision,
    expectedRevision: 0,
    items: [
      {
        lineId: order.lines.assembly,
        shipmentId: order.shipments.second,
        approvedQuantity: 1,
      },
    ],
    customerReason: "Return label receipt showed a higher cost.",
    sellerLogisticsCents: 1500,
    sellerLogisticsNote: "Updated label receipt",
    commandId: uuid(),
  });
  // The declined convenience unit is approved on further discussion.
  await revisions.adminRevise(reviewer, {
    orderId: order.orderId,
    decisionId: declined,
    expectedRevision: 0,
    items: [{ ...returnLines[1], approvedQuantity: 1 }],
    customerReason: "The residue cleaned off; the fitting is resalable.",
    commandId: uuid(),
  });
  const finalRefunds = (
    await createRefundInitiationService(
      db,
      at("2026-10-22T12:00:00.000Z"),
    ).adminOrder(owner, order.orderId)
  ).afterSales.filter((refund) => refund.status !== "superseded");
  expect(
    finalRefunds.map((refund) => [
      refund.sourceKind,
      refund.refundCents,
      refund.initiatedCents,
    ]),
  ).toEqual([
    ["cancellation", 2800, 2800],
    ["cancellation", 8800, 8800],
    ["return", 810, 810],
    ["return", 7200, 7200],
    ["supplemental", 300, 0],
    ["return", 810, 0],
  ]);

  // 7. Conservation: money, quantities and immutable originals.
  const authorized = finalRefunds.reduce(
    (sum, refund) => sum + refund.refundCents,
    0,
  );
  const initiated = finalRefunds.reduce(
    (sum, refund) => sum + refund.initiatedCents,
    0,
  );
  expect(authorized).toBeLessThanOrEqual(order.totalCents);
  const ledger = await db
    .prepare(
      `SELECT pay.amount_received_cents AS received,pay.allocated_in_cents AS allocated_in,
         pay.allocated_out_cents AS allocated_out,pay.refunded_cents AS refunded,
         pay.total_due_cents AS due,pay.version,
         contract.authorized_credit_cents AS credits,
         contract.uninitiated_refund_cents AS uninitiated
       FROM confirmed_orders o
       JOIN pi_payment_accounts pay ON pay.pi_id=o.pi_id
       JOIN order_change_financial_contract contract ON contract.order_id=o.id
       WHERE o.id=?`,
    )
    .bind(order.orderId)
    .first<{
      received: number;
      allocated_in: number;
      allocated_out: number;
      refunded: number;
      due: number;
      version: number;
      credits: number;
      uninitiated: number;
    }>();
  expect(ledger).toMatchObject({
    refunded: initiated,
    credits: authorized,
    uninitiated: authorized - initiated,
  });
  const excess =
    ledger!.received +
    ledger!.allocated_in -
    ledger!.allocated_out -
    ledger!.refunded -
    (ledger!.due - ledger!.credits) -
    ledger!.uninitiated;
  expect(excess).toBe(1000);
  // Authorized refunds never create a false shortfall on the funded Order.
  const shortfall =
    ledger!.due -
    ledger!.credits -
    ledger!.received -
    ledger!.allocated_in +
    ledger!.allocated_out +
    ledger!.refunded +
    ledger!.uninitiated;
  expect(shortfall).toBeLessThanOrEqual(0);
  // Reserved refunds cannot be released as excess funds.
  const fundResolution = (amount: number) =>
    db
      .prepare(
        `INSERT INTO pi_fund_resolutions
         (id,command_id,command_hash,kind,source_pi_id,amount_cents,currency,
          source_version,customer_authorization,external_reference,original_channel,
          actor_id,resolved_at)
         VALUES (?,?,'h','external_refund',?,?,'USD',?,'Customer email','REF',
           'bank_transfer','owner','2026-10-22T12:00:00.000Z')`,
      )
      .bind(uuid(), uuid(), order.piId, amount, ledger!.version)
      .run();
  await expect(fundResolution(1001)).rejects.toThrow();
  const lineTotals = (
    await db
      .prepare(
        `SELECT c.line_id,sum(c.physical_quantity) AS quantity,sum(c.merchandise_cents) AS cents
         FROM after_sales_refund_line_credits c
         JOIN after_sales_refund_authorizations a ON a.id=c.authorization_id
         WHERE c.order_id=? AND a.status!='superseded' GROUP BY c.line_id`,
      )
      .bind(order.orderId)
      .all<{ line_id: string; quantity: number; cents: number }>()
  ).results;
  expect(
    Object.fromEntries(
      lineTotals.map((row) => [row.line_id, [row.quantity, row.cents]]),
    ),
  ).toEqual({
    [order.lines.standard]: [2, 1800],
    [order.lines.standardSecond]: [1, 2500],
    [order.lines.cutHose]: [4, 8000],
    [order.lines.assembly]: [1, 6000],
  });
  expect(
    await db
      .prepare(
        "SELECT snapshot_hash,total_cents FROM confirmed_orders WHERE id=?",
      )
      .bind(order.orderId)
      .first(),
  ).toEqual(before);
  // Each customer notification exists once.
  const messages = (
    await db
      .prepare(
        `SELECT o.message_id FROM quote_notification_outbox o
         JOIN quote_conversation_messages m ON m.id=o.message_id
         WHERE m.request_id=?`,
      )
      .bind(order.requestId)
      .all<{ message_id: string }>()
  ).results.map((row) => row.message_id);
  expect(new Set(messages).size).toBe(messages.length);
  expect(messages.length).toBeGreaterThanOrEqual(10);
});
