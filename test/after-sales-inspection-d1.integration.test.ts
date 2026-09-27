import { afterAll, beforeAll, expect, it } from "vitest";

import { recordAfterSalesOverdueReminders } from "../app/modules/after-sales/application/after-sales-reminders";
import { createCaseService } from "../app/modules/after-sales/application/case-service";
import { createReturnAuthorizationService } from "../app/modules/after-sales/application/return-authorization-service";
import { createReturnInspectionService } from "../app/modules/after-sales/application/return-inspection-service";
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
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-inspection");
  db = started.db;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const good = {
  interfaces: "Threads clean, no wrench marks",
  sealingSurfaces: "Seats undamaged",
  finish: "Plating intact",
  packaging: "Original bag and caps present",
  installationEvidence: "None",
  fluidExposure: "None",
};

const inspection = (now: string) =>
  createReturnInspectionService(db, { now: () => new Date(now) });

async function authorized(
  prefix: string,
  reason: string,
  lines: Array<[keyof SeededOrder["lines"], "first" | "second", number]>,
  refundTermsVersion?: string,
) {
  const order = await seedAfterSalesOrder(db, prefix, { refundTermsVersion });
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  await shipShipment(db, order.orderId, order.shipments.second, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  const selected = lines.map(([line, shipment, quantity]) => ({
    lineId: order.lines[line],
    shipmentId: order.shipments[shipment],
    physicalQuantity: quantity,
  }));
  const caseId = await createCaseService(db, {
    now: () => new Date("2026-09-12T12:00:00.000Z"),
  }).customerOpen("buyer", {
    orderId: order.orderId,
    reason,
    description: "Return request",
    lines: selected,
    commandId: crypto.randomUUID(),
  });
  const raId = await createReturnAuthorizationService(db, {
    now: () => new Date("2026-09-14T15:00:00.000Z"),
  }).adminIssue(owner, {
    orderId: order.orderId,
    caseId,
    locationId: "plano-returns",
    instructions: "Original packaging; RA number on label.",
    lines: selected,
    commandId: crypto.randomUUID(),
  });
  return { order, caseId, raId, selected };
}

it("gates refunds on receipt and complete inspection, then applies the 10% convenience fee", async () => {
  const { order, raId, selected } = await authorized(
    "i1",
    "convenience_return",
    [["standard", "first", 2]],
  );
  // The gate is enforced in D1, not only in the service.
  await expect(
    db
      .prepare(
        `INSERT INTO after_sales_refund_authorizations
         (id,order_id,source_kind,source_id,responsibility,merchandise_cents,
          refund_cents,status,approved_at,deadline_at,actor_id,created_at,command_id)
         VALUES ('i1-bypass',?,'return',?,'customer',100,100,'approved',
           '2026-09-15T00:00:00Z','2026-09-30T00:00:00Z','x','2026-09-15T00:00:00Z','i1-bypass')`,
      )
      .bind(order.orderId, raId)
      .run(),
  ).rejects.toThrow(/Return Inspection Gate/);
  // Partial receipt: only one unit arrives in the first package.
  const receiptId = await inspection(
    "2026-09-20T15:00:00.000Z",
  ).adminRecordReceipt(reviewer, {
    orderId: order.orderId,
    raId,
    receivedAt: "2026-09-18T14:00:00.000Z",
    source: "Return Location intake log #55",
    packageReference: "1Z999",
    lines: [{ ...selected[0], physicalQuantity: 1 }],
    commandId: crypto.randomUUID(),
  });
  await expect(
    inspection("2026-09-20T15:00:00.000Z").adminRecordReceipt(reviewer, {
      orderId: order.orderId,
      raId,
      receivedAt: "2026-09-19T14:00:00.000Z",
      source: "Duplicate",
      lines: [{ ...selected[0], physicalQuantity: 2 }],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  const [receipt] = await inspection("2026-09-20T15:00:00.000Z").adminRead(
    owner,
    order.orderId,
  );
  expect(receipt).toMatchObject({
    id: receiptId,
    timeliness: "timely",
    inspectionDeadlineDateEt: "2026-09-25",
    decision: null,
  });
  await expect(
    inspection("2026-09-21T15:00:00.000Z").adminDecide(unprivileged, {
      orderId: order.orderId,
      receiptId,
      responsibility: "customer",
      remedy: "refund",
      items: [{ ...selected[0], approvedQuantity: 1, conditions: good }],
      customerReason: "Inspection confirms the reported issue.",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    inspection("2026-09-21T15:00:00.000Z").adminDecide(owner, {
      orderId: order.orderId,
      receiptId,
      responsibility: "customer",
      remedy: "refund",
      items: [{ ...selected[0], approvedQuantity: 1, conditions: good }],
      logisticsCents: 500,
      logisticsNote: "Try to refund DDP",
      customerReason: "Inspection confirms the reported issue.",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await inspection("2026-09-21T15:00:00.000Z").adminDecide(owner, {
    orderId: order.orderId,
    receiptId,
    responsibility: "customer",
    remedy: "refund",
    items: [{ ...selected[0], approvedQuantity: 1, conditions: good }],
    customerReason: "Inspection confirms the reported issue.",
    commandId: crypto.randomUUID(),
  });
  const [customer] = await inspection("2026-09-21T15:00:00.000Z").customerRead(
    "buyer",
    order.orderId,
  );
  expect(customer.decision).toMatchObject({
    outcome: "approved",
    financial: {
      merchandiseCents: 900,
      restockingFeeCents: 90,
      refundCents: 810,
      outboundDdpRefunded: false,
    },
  });
  expect(customer.decision!.refunds[0]).toMatchObject({
    status: "approved",
    refundCents: 810,
  });
  expect(JSON.stringify(customer)).not.toContain("intake log");
  expect(JSON.stringify(customer)).not.toContain("Threads clean");
  expect(
    await db
      .prepare(
        `SELECT count(*) AS count FROM quote_conversation_messages m
         JOIN quote_notification_outbox o ON o.message_id=m.id
         WHERE m.request_id=? AND m.body LIKE '%Inspection decision%'`,
      )
      .bind(order.requestId)
      .first("count"),
  ).toBe(1);
});

it("requires a reason for every decision and keeps cumulative fees exact across batches", async () => {
  const { order, raId, selected } = await authorized(
    "i2",
    "convenience_return",
    [["standardSecond", "first", 2]],
  );
  const service = inspection("2026-09-22T15:00:00.000Z");
  const first = await service.adminRecordReceipt(owner, {
    orderId: order.orderId,
    raId,
    receivedAt: "2026-09-18T14:00:00.000Z",
    source: "Intake",
    lines: [{ ...selected[0], physicalQuantity: 1 }],
    commandId: crypto.randomUUID(),
  });
  const second = await service.adminRecordReceipt(owner, {
    orderId: order.orderId,
    raId,
    receivedAt: "2026-09-21T14:00:00.000Z",
    source: "Intake",
    lines: [{ ...selected[0], physicalQuantity: 1 }],
    commandId: crypto.randomUUID(),
  });
  // Full approval also tells the customer why.
  await expect(
    service.adminDecide(owner, {
      orderId: order.orderId,
      receiptId: first,
      responsibility: "customer",
      remedy: "refund",
      items: [{ ...selected[0], approvedQuantity: 1, conditions: good }],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await service.adminDecide(owner, {
    orderId: order.orderId,
    receiptId: first,
    responsibility: "customer",
    remedy: "refund",
    items: [{ ...selected[0], approvedQuantity: 1, conditions: good }],
    customerReason: "Inspection confirms the reported issue.",
    commandId: crypto.randomUUID(),
  });
  await expect(
    service.adminDecide(owner, {
      orderId: order.orderId,
      receiptId: second,
      responsibility: "customer",
      remedy: "refund",
      items: [
        {
          ...selected[0],
          approvedQuantity: 0,
          conditions: { ...good, installationEvidence: "Wrench marks" },
        },
      ],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await service.adminDecide(owner, {
    orderId: order.orderId,
    receiptId: second,
    responsibility: "customer",
    remedy: "refund",
    items: [
      {
        ...selected[0],
        approvedQuantity: 0,
        conditions: { ...good, installationEvidence: "Wrench marks" },
      },
    ],
    customerReason: "The adapter shows installation marks.",
    commandId: crypto.randomUUID(),
  });
  const receipts = await service.adminRead(owner, order.orderId);
  expect(receipts.map((receipt) => receipt.decision?.outcome)).toEqual([
    "approved",
    "declined",
  ]);
  expect(receipts[0].decision!.financial).toMatchObject({
    merchandiseCents: 2500,
    restockingFeeCents: 250,
    refundCents: 2250,
  });
  expect(receipts[1].decision!.refunds).toEqual([]);
  expect(receipts[1].inspection![0].conditions.installationEvidence).toBe(
    "Wrench marks",
  );
  // Each receipt keeps its own deadline.
  expect(receipts.map((receipt) => receipt.inspectionDeadlineDateEt)).toEqual([
    "2026-09-25",
    "2026-09-28",
  ]);
});

it("lets Admin apply customer terms to a buyer-caused Other problem only under v2 refund terms", async () => {
  const decide = async (
    prefix: string,
    refundTermsVersion: string,
    responsibility: "customer" | "seller",
    extra: { logisticsCents?: number; logisticsNote?: string } = {},
  ) => {
    const { order, raId, selected } = await authorized(
      prefix,
      "other",
      [["standard", "first", 1]],
      refundTermsVersion,
    );
    const service = inspection("2026-09-22T15:00:00.000Z");
    const receiptId = await service.adminRecordReceipt(owner, {
      orderId: order.orderId,
      raId,
      receivedAt: "2026-09-18T14:00:00.000Z",
      source: "Intake",
      lines: selected,
      commandId: crypto.randomUUID(),
    });
    const decisionId = await service.adminDecide(owner, {
      orderId: order.orderId,
      receiptId,
      responsibility,
      remedy: "refund",
      items: selected.map((line) => ({
        ...line,
        approvedQuantity: 1,
        conditions: { ...good, installationEvidence: "Wrench marks" },
      })),
      customerReason:
        "The fitting was installed; the thread damage is from use.",
      commandId: crypto.randomUUID(),
      ...extra,
    });
    const [receipt] = await service.adminRead(owner, order.orderId);
    return { decisionId, receipt, order };
  };
  const customer = await decide(
    "i-other-2",
    "pi-refund-2026-09-27-v2",
    "customer",
  );
  const [refund] = customer.receipt.decision!.refunds;
  expect(refund).toMatchObject({ responsibility: "customer" });
  expect(refund.restockingFeeCents).toBe(
    Math.round(refund.merchandiseCents / 10),
  );
  // Customer terms never refund performed outbound DDP charges.
  await expect(
    decide("i-other-3", "pi-refund-2026-09-27-v2", "customer", {
      logisticsCents: 500,
      logisticsNote: "Outbound DDP",
    }),
  ).rejects.toMatchObject({ status: 400 });
  // Orders that accepted the earlier terms keep seller terms.
  await expect(
    decide("i-other-4", "pi-refund-2026-09-27-v1", "customer"),
  ).rejects.toMatchObject({ status: 400 });
  const seller = await decide("i-other-5", "pi-refund-2026-09-27-v1", "seller");
  expect(seller.receipt.decision!.refunds[0]).toMatchObject({
    responsibility: "seller",
    restockingFeeCents: 0,
  });
  // The decision dialog offers customer terms only where they were accepted.
  const [v1Case] = await createCaseService(db).adminRead(
    owner,
    seller.order.orderId,
  );
  const [v2Case] = await createCaseService(db).adminRead(
    owner,
    customer.order.orderId,
  );
  expect([v1Case.customerTermsAllowed, v2Case.customerTermsAllowed]).toEqual([
    false,
    true,
  ]);
});

it("uses seller-funded remedies without deductions and records replacements without a payout", async () => {
  const { order, raId, selected } = await authorized("i3", "nonconforming", [
    ["cutHose", "second", 2],
    ["assembly", "second", 1],
  ]);
  const service = inspection("2026-09-22T15:00:00.000Z");
  const receiptId = await service.adminRecordReceipt(owner, {
    orderId: order.orderId,
    raId,
    receivedAt: "2026-09-18T14:00:00.000Z",
    source: "Intake",
    lines: selected,
    commandId: crypto.randomUUID(),
  });
  await expect(
    service.adminDecide(owner, {
      orderId: order.orderId,
      receiptId,
      responsibility: "customer",
      remedy: "refund",
      items: selected.map((line) => ({
        ...line,
        approvedQuantity: line.physicalQuantity,
        conditions: good,
      })),
      customerReason: "Inspection confirms the reported issue.",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.adminDecide(owner, {
      orderId: order.orderId,
      receiptId,
      responsibility: "seller",
      remedy: "refund",
      items: selected.map((line) => ({
        ...line,
        approvedQuantity: line.physicalQuantity,
        conditions: good,
      })),
      thirdPartyCostCents: 100,
      thirdPartyCostEvidence: "Bank fee",
      customerReason: "Inspection confirms the reported issue.",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await service.adminDecide(owner, {
    orderId: order.orderId,
    receiptId,
    responsibility: "seller",
    remedy: "refund",
    items: selected.map((line) => ({
      ...line,
      approvedQuantity: line.physicalQuantity,
      conditions: { ...good, finish: "Hose cover split at ferrule" },
    })),
    sellerLogisticsCents: 1200,
    sellerLogisticsNote: "Customer's prepaid return label",
    logisticsCents: 1500,
    logisticsNote: "Original freight share refunded for defective goods",
    customerReason: "Inspection confirms the reported issue.",
    commandId: crypto.randomUUID(),
  });
  const [receipt] = await service.adminRead(owner, order.orderId);
  expect(receipt.decision!.financial).toMatchObject({
    merchandiseCents: 4000 + 6000,
    restockingFeeCents: 0,
    serviceFeeCents: 400,
    sellerLogisticsCents: 1200,
    logisticsCents: 1500,
    thirdPartyCostCents: 0,
    refundCents: 10000 + 400 + 1200 + 1500,
  });

  const replacementCase = await authorized("i4", "wrong_item", [
    ["standard", "first", 1],
  ]);
  const replacementReceipt = await service.adminRecordReceipt(owner, {
    orderId: replacementCase.order.orderId,
    raId: replacementCase.raId,
    receivedAt: "2026-09-18T14:00:00.000Z",
    source: "Intake",
    lines: replacementCase.selected,
    commandId: crypto.randomUUID(),
  });
  await service.adminDecide(owner, {
    orderId: replacementCase.order.orderId,
    receiptId: replacementReceipt,
    responsibility: "seller",
    remedy: "replacement",
    items: replacementCase.selected.map((line) => ({
      ...line,
      approvedQuantity: 1,
      conditions: good,
    })),
    replacement: {
      scope: "Ship the correct STD-A fitting",
      costs: "Seller pays product and DHL",
      fulfillmentEvidence: "DHL 123 booked 2026-09-22",
    },
    customerReason: "Inspection confirms the reported issue.",
    commandId: crypto.randomUUID(),
  });
  const [replaced] = await service.adminRead(
    owner,
    replacementCase.order.orderId,
  );
  expect(replaced.decision).toMatchObject({
    remedy: "replacement",
    refunds: [],
    replacement: { scope: "Ship the correct STD-A fitting" },
  });
});

it("keeps late arrivals in review and reminds once when inspection is overdue", async () => {
  const { order, raId, selected } = await authorized("i5", "damaged", [
    ["standard", "first", 1],
  ]);
  // RA issued 2026-09-14 ET expires 2026-10-14 23:59 ET.
  const service = inspection("2026-10-20T15:00:00.000Z");
  const late = await service.adminRecordReceipt(owner, {
    orderId: order.orderId,
    raId,
    receivedAt: "2026-10-15T14:00:00.000Z",
    source: "Intake",
    lines: selected,
    commandId: crypto.randomUUID(),
  });
  const [receipt] = await service.adminRead(owner, order.orderId);
  expect(receipt).toMatchObject({
    id: late,
    timeliness: "late",
    lateReviewed: false,
  });
  await expect(
    service.adminDecide(owner, {
      orderId: order.orderId,
      receiptId: late,
      responsibility: "seller",
      remedy: "refund",
      items: selected.map((line) => ({
        ...line,
        approvedQuantity: 1,
        conditions: good,
      })),
      customerReason: "Inspection confirms the reported issue.",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-10-23T12:00:00.000Z"),
  );
  await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-10-24T12:00:00.000Z"),
  );
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM admin_notifications WHERE kind='return_inspection_overdue' AND source_id=?",
      )
      .bind(late)
      .first("count"),
  ).toBe(1);
  await service.adminReviewLateArrival(owner, {
    orderId: order.orderId,
    receiptId: late,
    note: "Carrier delay documented; accept for inspection",
  });
  await service.adminDecide(owner, {
    orderId: order.orderId,
    receiptId: late,
    responsibility: "seller",
    remedy: "refund",
    items: selected.map((line) => ({
      ...line,
      approvedQuantity: 1,
      conditions: good,
    })),
    customerReason: "Inspection confirms the reported issue.",
    commandId: crypto.randomUUID(),
  });
  const [decided] = await service.adminRead(owner, order.orderId);
  expect(decided.decision?.outcome).toBe("approved");
  // A receipt cannot claim to have arrived in the future or before its RA.
  await expect(
    service.adminRecordReceipt(owner, {
      orderId: order.orderId,
      raId,
      receivedAt: "2026-12-01T00:00:00.000Z",
      source: "Future",
      lines: selected,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
});
