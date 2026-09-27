import { afterAll, beforeAll, expect, it } from "vitest";

import { createCancellationService } from "../app/modules/after-sales/application/cancellation-service";
import { recordAfterSalesOverdueReminders } from "../app/modules/after-sales/application/after-sales-reminders";
import { cumulativeLineAmount } from "../app/modules/after-sales/domain/refund-calculation";
import { createShipmentMilestoneService } from "../app/modules/shipment/application/shipment-milestone-service";
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
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-resolve");
  db = started.db;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const service = (now = fixtureClock) =>
  createCancellationService(db, { now: () => new Date(now) });

async function request(
  order: SeededOrder,
  quantities: Array<[string, string | null, number]>,
) {
  return service().customerSubmit("buyer", {
    orderId: order.orderId,
    reason: "No longer needed",
    quantities: quantities.map(([lineId, shipmentId, physicalQuantity]) => ({
      lineId,
      shipmentId,
      physicalQuantity,
    })),
    commandId: crypto.randomUUID(),
  });
}

async function allocations(shipmentId: string) {
  return (
    await db
      .prepare(
        `SELECT line_id,physical_quantity FROM order_shipment_allocations
         WHERE shipment_id=? ORDER BY line_id`,
      )
      .bind(shipmentId)
      .all<{ line_id: string; physical_quantity: number }>()
  ).results;
}

async function contract(orderId: string) {
  return db
    .prepare(
      `SELECT authorized_credit_cents,uninitiated_refund_cents
       FROM order_change_financial_contract WHERE order_id=?`,
    )
    .bind(orderId)
    .first<{
      authorized_credit_cents: number;
      uninitiated_refund_cents: number;
    }>();
}

it("allocates cumulative merchandise cents without over-crediting", () => {
  expect(
    [0, 1, 2].map((prior) => cumulativeLineAmount(1000, 3, prior, 1)),
  ).toEqual([333, 333, 334]);
  expect(cumulativeLineAmount(2700, 3, 0, 2)).toBe(1800);
  expect(() => cumulativeLineAmount(1000, 3, 2, 2)).toThrow();
});

it("partially approves, removes approved quantities, reserves the refund and lets remaining work ship", async () => {
  const order = await seedAfterSalesOrder(db, "r1");
  const requestId = await request(order, [
    [order.lines.standard, order.shipments.first, 2],
    [order.lines.standardSecond, order.shipments.first, 2],
  ]);
  const before = await db
    .prepare(
      "SELECT snapshot_hash,total_cents FROM confirmed_orders WHERE id=?",
    )
    .bind(order.orderId)
    .first();
  const decision = {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    decisions: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        approvedQuantity: 2,
      },
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        approvedQuantity: 1,
      },
    ],
    customerReason:
      "Two fittings and one adapter were cancelled before packing.",
    internalNote: "Factory confirmed not packed",
    logisticsCents: 500,
    logisticsNote: "Lighter remaining carton requoted",
  };
  await expect(
    service().adminResolve(unprivileged, decision),
  ).rejects.toMatchObject({ status: 403 });
  const resolutionId = await service().adminResolve(reviewer, decision);
  expect(await service().adminResolve(reviewer, decision)).toBe(resolutionId);
  await expect(
    service().adminResolve(reviewer, {
      ...decision,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await allocations(order.shipments.first)).toEqual([
    { line_id: order.lines.madeToOrderStandard, physical_quantity: 1 },
    { line_id: order.lines.standardSecond, physical_quantity: 1 },
  ]);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS count FROM order_quantity_holds WHERE order_id=? AND active=1",
      )
      .bind(order.orderId)
      .first("count"),
  ).toBe(0);
  const [view] = (await service().customerRead("buyer", order.orderId))
    .requests;
  expect(view.resolution).toMatchObject({
    outcome: "partially_approved",
    financial: {
      merchandiseCents: 4300,
      logisticsCents: 500,
      refundCents: 4800,
    },
  });
  expect(JSON.stringify(view.resolution)).not.toContain("Factory confirmed");
  expect(view.resolution!.refunds[0]).toMatchObject({
    status: "approved",
    refundCents: 4800,
    initiatedCents: 0,
    deadlineDateEt: "2026-10-08",
  });
  expect(await contract(order.orderId)).toEqual({
    authorized_credit_cents: 4800,
    uninitiated_refund_cents: 4800,
  });
  expect(
    await db
      .prepare(
        "SELECT snapshot_hash,total_cents FROM confirmed_orders WHERE id=?",
      )
      .bind(order.orderId)
      .first(),
  ).toEqual(before);
  expect(
    await db
      .prepare(
        `SELECT count(*) AS count FROM quote_notification_outbox o
         JOIN quote_conversation_messages m ON m.id=o.message_id
         WHERE m.request_id=? AND m.body LIKE '%partially approved%'`,
      )
      .bind(order.requestId)
      .first("count"),
  ).toBe(1);
  // Resolutions and cancelled quantities are immutable.
  await expect(
    db
      .prepare(
        "UPDATE order_cancellation_resolutions SET customer_reason='x' WHERE id=?",
      )
      .bind(resolutionId)
      .run(),
  ).rejects.toThrow(/immutable/);
  // The reduced batch now passes readiness and dispatches only remaining units.
  const milestones = createShipmentMilestoneService(db, {
    now: () => new Date("2026-09-25T12:00:00.000Z"),
  });
  const version = await db
    .prepare("SELECT version FROM order_shipments WHERE id=?")
    .bind(order.shipments.first)
    .first<number>("version");
  const readyVersion = await milestones.markReady(owner, {
    orderId: order.orderId,
    shipmentId: order.shipments.first,
    expectedVersion: version!,
    commandId: crypto.randomUUID(),
    verification: {
      specificationsVerified: true,
      quantitiesVerified: true,
      offlinePreparationVerified: true,
      requiredInspectionVerified: true,
    },
  });
  await createShipmentMilestoneService(db, {
    now: () => new Date("2026-09-25T14:00:00.000Z"),
  }).markShipped(owner, {
    orderId: order.orderId,
    shipmentId: order.shipments.first,
    expectedVersion: readyVersion,
    commandId: crypto.randomUUID(),
    handoffAt: "2026-09-25T13:00:00.000Z",
    carrierName: "Carrier",
    source: "Receipt",
  });
  expect(
    (
      await db
        .prepare(
          `SELECT line_id,physical_quantity FROM shipment_dispatch_quantities
           WHERE shipment_id=? ORDER BY line_id`,
        )
        .bind(order.shipments.first)
        .all()
    ).results,
  ).toEqual([
    { line_id: order.lines.madeToOrderStandard, physical_quantity: 1 },
    { line_id: order.lines.standardSecond, physical_quantity: 1 },
  ]);
});

it("declines by releasing only the request hold without financial effects", async () => {
  const order = await seedAfterSalesOrder(db, "r2");
  const requestId = await request(order, [
    [order.lines.standard, order.shipments.second, 1],
  ]);
  await service().adminResolve(owner, {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    decisions: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.second,
        approvedQuantity: 0,
      },
    ],
    customerReason: "The item was already packed for export.",
  });
  expect(await allocations(order.shipments.second)).toHaveLength(3);
  expect(await contract(order.orderId)).toEqual({
    authorized_credit_cents: 0,
    uninitiated_refund_cents: 0,
  });
  const [view] = (await service().customerRead("buyer", order.orderId))
    .requests;
  expect(view.resolution).toMatchObject({ outcome: "declined", refunds: [] });
  expect(view.lines[0].holdActive).toBe(false);
});

it("requires customer confirmation before a deduction becomes an approved refund", async () => {
  const order = await seedAfterSalesOrder(db, "r3");
  const requestId = await request(order, [
    [order.lines.standardSecond, order.shipments.first, 2],
  ]);
  await service().adminResolve(owner, {
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
    customerReason: "Cancelled as requested.",
    thirdPartyCostCents: 150,
    thirdPartyCostEvidence: "Bank return fee notice #123",
  });
  let [view] = (await service().customerRead("buyer", order.orderId)).requests;
  const refund = view.resolution!.refunds[0];
  expect(refund).toMatchObject({
    status: "awaiting_customer_confirmation",
    grossCents: 5000,
    thirdPartyCostCents: 150,
    refundCents: 4850,
    deadlineDateEt: null,
  });
  // Reserved while awaiting, so the funds cannot be allocated elsewhere.
  expect((await contract(order.orderId))?.uninitiated_refund_cents).toBe(4850);
  const confirm = {
    orderId: order.orderId,
    authorizationId: refund.id,
    expectedVersion: 1,
    response: "confirm" as const,
    commandId: crypto.randomUUID(),
  };
  await expect(
    service().customerRespondToRefund("other", confirm),
  ).rejects.toMatchObject({ status: 404 });
  await service("2026-09-28T15:00:00.000Z").customerRespondToRefund(
    "buyer",
    confirm,
  );
  await service().customerRespondToRefund("buyer", confirm);
  [view] = (await service().customerRead("buyer", order.orderId)).requests;
  expect(view.resolution!.refunds[0]).toMatchObject({
    status: "approved",
    version: 2,
    deadlineDateEt: "2026-10-13",
  });
  await expect(
    service().customerRespondToRefund("buyer", {
      ...confirm,
      response: "dispute",
      note: "Too high",
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it("keeps a disputed deduction visibly unresolved", async () => {
  const order = await seedAfterSalesOrder(db, "r4");
  const requestId = await request(order, [
    [order.lines.standard, order.shipments.second, 1],
  ]);
  await service().adminResolve(owner, {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    decisions: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.second,
        approvedQuantity: 1,
      },
    ],
    customerReason: "Approved.",
    thirdPartyCostCents: 100,
    thirdPartyCostEvidence: "Carrier booking fee invoice",
  });
  const [view] = (await service().customerRead("buyer", order.orderId))
    .requests;
  await service().customerRespondToRefund("buyer", {
    orderId: order.orderId,
    authorizationId: view.resolution!.refunds[0].id,
    expectedVersion: 1,
    response: "dispute",
    note: "The booking was never used",
    commandId: crypto.randomUUID(),
  });
  const [admin] = await service().adminRead(owner, order.orderId);
  expect(admin.resolution!.refunds[0]).toMatchObject({
    status: "disputed",
    deadlineDateEt: null,
  });
});

it("rejects refund authorization without verified funds or beyond component ceilings", async () => {
  const order = await seedAfterSalesOrder(db, "r5");
  const requestId = await request(order, [
    [order.lines.standard, order.shipments.first, 1],
  ]);
  const base = {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    decisions: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        approvedQuantity: 1,
      },
    ],
    customerReason: "Approved.",
  };
  await expect(
    service().adminResolve(owner, {
      ...base,
      commandId: crypto.randomUUID(),
      logisticsCents: 4501,
      logisticsNote: "Too much",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    service().adminResolve(owner, {
      ...base,
      commandId: crypto.randomUUID(),
      taxCents: 1,
      taxNote: "No tax was collected",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await db
    .prepare(
      "INSERT INTO order_release_guards(order_id,held,updated_at) VALUES (?,1,?)",
    )
    .bind(order.orderId, fixtureClock)
    .run();
  await expect(
    service().adminResolve(owner, { ...base, commandId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
  const [view] = await service().adminRead(owner, order.orderId);
  expect(view.status).toBe("pending_review");
  expect(await allocations(order.shipments.first)).toHaveLength(3);
});

it("records one internal reminder when an approved refund is not initiated in time", async () => {
  const order = await seedAfterSalesOrder(db, "r6");
  const requestId = await request(order, [
    [order.lines.standardSecond, order.shipments.first, 1],
  ]);
  await service().adminResolve(owner, {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    decisions: [
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        approvedQuantity: 1,
      },
    ],
    customerReason: "Approved.",
  });
  const beforeDeadline = await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-10-08T12:00:00.000Z"),
  );
  expect(beforeDeadline.refunds).toBe(0);
  await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-10-09T12:00:00.000Z"),
  );
  await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-10-10T12:00:00.000Z"),
  );
  expect(
    await db
      .prepare(
        `SELECT count(*) AS count FROM admin_notifications n
         JOIN after_sales_refund_authorizations a ON a.id=n.source_id
         WHERE n.kind='refund_initiation_overdue' AND a.order_id=?`,
      )
      .bind(order.orderId)
      .first("count"),
  ).toBe(1);
});
