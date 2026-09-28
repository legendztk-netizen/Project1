import { afterAll, beforeAll, expect, it } from "vitest";

import { recordAfterSalesOverdueReminders } from "../app/modules/after-sales/application/after-sales-reminders";
import { createCancellationService } from "../app/modules/after-sales/application/cancellation-service";
import { createPiPaymentCorrectionService } from "../app/modules/proforma-invoice/application/pi-payment-correction-service";
import { createRefundInitiationService } from "../app/modules/after-sales/application/refund-initiation-service";
import {
  fixtureClock,
  owner,
  refunder,
  reviewer,
  seedAfterSalesOrder,
  startAfterSalesDatabase,
  type SeededOrder,
} from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-refunds");
  db = started.db;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const refunds = (now = "2026-09-28T15:00:00.000Z") =>
  createRefundInitiationService(db, { now: () => new Date(now) });

async function approvedCancellation(prefix: string) {
  const order = await seedAfterSalesOrder(db, prefix);
  const cancellations = createCancellationService(db, {
    now: () => new Date(fixtureClock),
  });
  const requestId = await cancellations.customerSubmit("buyer", {
    orderId: order.orderId,
    reason: "Not needed",
    quantities: [
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        physicalQuantity: 2,
      },
    ],
    commandId: crypto.randomUUID(),
  });
  await cancellations.adminResolve(owner, {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    decisions: [
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        approvedQuantity: 2,
      },
    ],
    customerReason: "Cancelled.",
  });
  const [request] = await cancellations.adminRead(owner, order.orderId);
  return { order, authorizationId: request.resolution!.refunds[0].id };
}

async function destination(
  order: SeededOrder,
  kind: "original_channel" | "alternative" = "original_channel",
  channel: "bank_transfer" | "paypal" = "bank_transfer",
) {
  return refunds().adminAddDestination(refunder, {
    orderId: order.orderId,
    channel,
    kind,
    label: kind === "alternative" ? "Parent company account" : "Buyer bank",
    holderName: "Test Buyer LLC",
    institution: "First Bank",
    accountLast4: "1234",
    samePurchasingContext: kind === "original_channel",
    verificationEvidence: "Matched remittance advice and signed letter",
    commandId: crypto.randomUUID(),
  });
}

async function account(piId: string) {
  return db
    .prepare(
      "SELECT refunded_cents,version FROM pi_payment_accounts WHERE pi_id=?",
    )
    .bind(piId)
    .first<{ refunded_cents: number; version: number }>();
}

it("records partial external initiations on the verified original channel without exceeding authorization", async () => {
  const { order, authorizationId } = await approvedCancellation("f1");
  // Only the original receipt channel qualifies as an original destination.
  await expect(
    destination(order, "original_channel", "paypal"),
  ).rejects.toMatchObject({
    status: 409,
  });
  const destinationId = await destination(order);
  const record = (amountCents: number, commandId = crypto.randomUUID()) =>
    refunds().adminRecordInitiation(refunder, {
      orderId: order.orderId,
      refundKind: "after_sales",
      refundId: authorizationId,
      destinationId,
      amountCents,
      initiatedDateEt: "2026-09-28",
      externalReference: "WIRE-001",
      commandId,
    });
  await expect(
    refunds().adminRecordInitiation(reviewer, {
      orderId: order.orderId,
      refundKind: "after_sales",
      refundId: authorizationId,
      destinationId,
      amountCents: 100,
      initiatedDateEt: "2026-09-28",
      externalReference: "x",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  const before = await account(order.piId);
  const command = crypto.randomUUID();
  const first = await record(3000, command);
  expect(await record(3000, command)).toBe(first);
  await expect(record(2001)).rejects.toMatchObject({ status: 409 });
  await record(2000);
  const after = await account(order.piId);
  expect(after!.refunded_cents - before!.refunded_cents).toBe(5000);
  const contract = await db
    .prepare(
      `SELECT authorized_credit_cents,uninitiated_refund_cents
       FROM order_change_financial_contract WHERE order_id=?`,
    )
    .bind(order.orderId)
    .first();
  expect(contract).toEqual({
    authorized_credit_cents: 5000,
    uninitiated_refund_cents: 0,
  });
  await expect(
    refunds().adminRecordInitiation(refunder, {
      orderId: order.orderId,
      refundKind: "after_sales",
      refundId: authorizationId,
      destinationId,
      amountCents: 1,
      initiatedDateEt: "2026-12-31",
      externalReference: "Future",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  const [customer] = (
    await createCancellationService(db).customerRead("buyer", order.orderId)
  ).requests;
  expect(customer.resolution!.refunds[0]).toMatchObject({
    initiatedCents: 5000,
    remainingCents: 0,
    initiations: [
      {
        amountCents: 3000,
        channel: "bank_transfer",
        initiatedDateEt: "2026-09-28",
      },
      {
        amountCents: 2000,
        channel: "bank_transfer",
        initiatedDateEt: "2026-09-28",
      },
    ],
  });
  expect(JSON.stringify(customer)).not.toContain("WIRE-001");
  expect(JSON.stringify(customer)).not.toContain("signed letter");
  expect(
    await db
      .prepare(
        `SELECT count(*) AS count FROM quote_conversation_messages m
         JOIN quote_notification_outbox o ON o.message_id=m.id
         WHERE m.request_id=? AND m.body LIKE 'Refund initiated%'`,
      )
      .bind(order.requestId)
      .first("count"),
  ).toBe(2);
  const audit = await db
    .prepare(
      "SELECT payload_json FROM admin_audit_events WHERE event_type='order.refund_destination_verified' AND entity_id=?",
    )
    .bind(order.orderId)
    .first<string>("payload_json");
  expect(audit).not.toContain("1234");
  expect(audit).not.toContain("signed letter");
  await expect(
    db
      .prepare(
        "UPDATE after_sales_refund_initiations SET amount_cents=1 WHERE id=?",
      )
      .bind(first)
      .run(),
  ).rejects.toThrow(/immutable/);
});

it("requires Owner approval bound to the exact refund for an alternative destination", async () => {
  const { order, authorizationId } = await approvedCancellation("f2");
  const alternative = await destination(order, "alternative");
  const record = (destinationId: string) =>
    refunds().adminRecordInitiation(refunder, {
      orderId: order.orderId,
      refundKind: "after_sales",
      refundId: authorizationId,
      destinationId,
      amountCents: 1000,
      initiatedDateEt: "2026-09-28",
      externalReference: "WIRE-ALT",
      commandId: crypto.randomUUID(),
    });
  await expect(record(alternative)).rejects.toMatchObject({ status: 409 });
  await expect(
    refunds().ownerApproveDestination(refunder, {
      orderId: order.orderId,
      destinationId: alternative,
      refundKind: "after_sales",
      refundId: authorizationId,
      reason: "Parent pays on behalf",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  await refunds().ownerApproveDestination(owner, {
    orderId: order.orderId,
    destinationId: alternative,
    refundKind: "after_sales",
    refundId: authorizationId,
    reason: "Customer's written instruction; parent company account verified",
    commandId: crypto.randomUUID(),
  });
  await record(alternative);
  // A changed destination is a new record that needs its own approval.
  const changed = await destination(order, "alternative");
  await expect(record(changed)).rejects.toMatchObject({ status: 409 });
  await expect(
    refunds().adminAddDestination(refunder, {
      orderId: order.orderId,
      channel: "cash" as "paypal",
      kind: "original_channel",
      label: "Cash",
      holderName: "x",
      institution: "x",
      samePurchasingContext: true,
      verificationEvidence: "x",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
});

it("consumes Spec 6 shipping refunds directly with their original deadline", async () => {
  const order = await seedAfterSalesOrder(db, "f3");
  await db.batch([
    db
      .prepare(
        `INSERT INTO order_shipping_change_requests
         (id,order_id,profile_id,kind,status,requested_json,submission_command_id,
          submission_hash,created_at,updated_at,current_proposal_id)
         VALUES ('f3-change',?,'buyer','shipping_plan','proposed','{}','f3-cmd','x',?,?,'f3-proposal')`,
      )
      .bind(order.orderId, fixtureClock, fixtureClock),
    db
      .prepare(
        `INSERT INTO order_shipping_change_proposals
         (id,request_id,version,before_json,after_json,adjustment_cents,reason,
          expires_at,proposal_hash,command_id,command_hash,actor_id,published_at)
         VALUES ('f3-proposal','f3-change',1,'{}','{"shipments":[]}',-700,'Cheaper',
           '2026-10-30T00:00:00Z','h','f3-p','h','owner',?)`,
      )
      .bind(fixtureClock),
    db.prepare(
      "UPDATE order_shipping_change_requests SET status='accepted',version=2 WHERE id='f3-change'",
    ),
    db
      .prepare(
        `INSERT INTO order_shipping_change_acceptances
         (id,request_id,proposal_id,profile_id,proposal_hash,command_id,command_hash,accepted_at)
         VALUES ('f3-accept','f3-change','f3-proposal','buyer','h','f3-a','h',?)`,
      )
      .bind(fixtureClock),
    db
      .prepare(
        `INSERT INTO order_shipping_change_effective
         (id,order_id,request_id,proposal_id,proposal_hash,before_json,after_json,
          adjustment_cents,effective_at,command_id)
         VALUES ('f3-effective',?,'f3-change','f3-proposal','h','{}','{"shipments":[]}',-700,?,'f3-e')`,
      )
      .bind(order.orderId, "2026-09-01T12:00:00.000Z"),
    db
      .prepare(
        `INSERT INTO order_shipping_change_refund_reservations
         (id,effective_change_id,order_id,due_cents,reserved_at)
         VALUES ('f3-reservation','f3-effective',?,700,?)`,
      )
      .bind(order.orderId, "2026-09-01T12:00:00.000Z"),
  ]);
  const due = await refunds().adminDue(refunder, { page: 1 });
  const shipping = due.records.find((record) => record.id === "f3-reservation");
  expect(shipping).toMatchObject({
    kind: "shipping",
    remainingCents: 700,
    deadlineDateEt: "2026-09-16",
    overdue: true,
  });
  await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-09-28T12:00:00.000Z"),
  );
  await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-09-29T12:00:00.000Z"),
  );
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM admin_notifications WHERE source_id='f3-reservation'",
      )
      .first("count"),
  ).toBe(1);
  const destinationId = await destination(order);
  const before = await account(order.piId);
  await refunds().adminRecordInitiation(refunder, {
    orderId: order.orderId,
    refundKind: "shipping",
    refundId: "f3-reservation",
    destinationId,
    amountCents: 700,
    initiatedDateEt: "2026-09-28",
    externalReference: "WIRE-SHIP",
    commandId: crypto.randomUUID(),
  });
  // Spec 6's own account trigger moves the ledger exactly once.
  expect(
    (await account(order.piId))!.refunded_cents - before!.refunded_cents,
  ).toBe(700);
  const order2 = await refunds().adminOrder(owner, order.orderId);
  expect(order2.shipping[0]).toMatchObject({
    remainingCents: 0,
    initiations: [{ amountCents: 700, channel: "bank_transfer" }],
  });
  expect(
    (await refunds().adminDue(refunder, { page: 1 })).records.some(
      (record) => record.id === "f3-reservation",
    ),
  ).toBe(false);
});

it("refuses initiation when verified original funds are not available", async () => {
  const { order, authorizationId } = await approvedCancellation("f4");
  const destinationId = await destination(order);
  await db
    .prepare(
      "UPDATE pi_payment_accounts SET confirmation_valid=0 WHERE pi_id=?",
    )
    .bind(order.piId)
    .run();
  await expect(
    refunds().adminRecordInitiation(refunder, {
      orderId: order.orderId,
      refundKind: "after_sales",
      refundId: authorizationId,
      destinationId,
      amountCents: 100,
      initiatedDateEt: "2026-09-28",
      externalReference: "WIRE-X",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it("recovers a payment review after lawful refunds without reporting a false underpayment", async () => {
  const corrections = createPiPaymentCorrectionService(db, {
    now: () => new Date("2026-09-29T12:00:00.000Z"),
  });
  const review = async (
    order: SeededOrder,
    correctedCents: number,
    label: string,
  ) => {
    const before = await corrections.read(owner, order.piId);
    await corrections.correct(owner, {
      piId: order.piId,
      commandId: crypto.randomUUID(),
      expectedVersion: before.version,
      correctedAmount: (correctedCents / 100).toFixed(2),
      reason: `Bank reversal notice ${label}`,
    });
    const during = await corrections.read(owner, order.piId);
    const correctionId = String(
      (during.disputes as Array<{ correction_id: string }>)[0].correction_id,
    );
    return () =>
      corrections.resolve(owner, {
        piId: order.piId,
        commandId: crypto.randomUUID(),
        correctionId,
        expectedVersion: during.version,
        reason: "Owner verified the funds",
        verificationReference: `BANK-${label}`,
      });
  };

  const { order, authorizationId } = await approvedCancellation("f9");
  const destinationId = await destination(order);
  const initiate = (amountCents: number) =>
    refunds().adminRecordInitiation(refunder, {
      orderId: order.orderId,
      refundKind: "after_sales",
      refundId: authorizationId,
      destinationId,
      amountCents,
      initiatedDateEt: "2026-09-28",
      externalReference: `WIRE-${crypto.randomUUID().slice(0, 6)}`,
      commandId: crypto.randomUUID(),
    });
  await initiate(1000);
  // The full payment is re-verified while part of the refund is sent.
  const resolve = await review(order, order.totalCents, "OK");
  await expect(initiate(100)).rejects.toMatchObject({ status: 409 });
  await resolve();
  expect((await corrections.read(owner, order.piId)).confirmationValid).toBe(
    true,
  );
  // The rest of the lawful refund can be sent again after recovery.
  await initiate(4000);

  // A genuine shortfall still blocks recovery.
  const short = await approvedCancellation("f10");
  const blocked = await review(
    short.order,
    short.order.totalCents - 1,
    "SHORT",
  );
  await expect(blocked()).rejects.toMatchObject({ status: 409 });
});

it("shows refund projections only to the Order's Purchasing Context", async () => {
  const { order } = await approvedCancellation("f11");
  await expect(
    refunds().customerShippingRefunds("other", order.orderId),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    createCancellationService(db).customerRead("other", order.orderId),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    await refunds().customerShippingRefunds("buyer", order.orderId),
  ).toEqual([]);
});
