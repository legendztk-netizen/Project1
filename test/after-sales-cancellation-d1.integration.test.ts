import { afterAll, beforeAll, expect, it } from "vitest";

import { createCancellationService } from "../app/modules/after-sales/application/cancellation-service";
import { createShipmentMilestoneService } from "../app/modules/shipment/application/shipment-milestone-service";
import {
  fixtureClock,
  owner,
  reviewer,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  unprivileged,
} from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-cancel");
  db = started.db;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const service = () =>
  createCancellationService(db, { now: () => new Date(fixtureClock) });

async function activeHolds(orderId: string) {
  return (
    await db
      .prepare(
        `SELECT line_id,shipment_id,physical_quantity,kind FROM order_quantity_holds
         WHERE order_id=? AND active=1 ORDER BY line_id,shipment_id`,
      )
      .bind(orderId)
      .all<{
        line_id: string;
        shipment_id: string | null;
        physical_quantity: number;
        kind: string;
      }>()
  ).results;
}

it("holds exactly the requested unshipped standard quantities and withdraws only its own hold", async () => {
  const order = await seedAfterSalesOrder(db, "c1");
  const cancellations = service();
  const read = await cancellations.customerRead("buyer", order.orderId);
  expect(
    read.eligible.map((item) => [item.lineId, item.shipmentId, item.available]),
  ).toEqual([
    [order.lines.standard, order.shipments.first, 2],
    [order.lines.standard, order.shipments.second, 1],
    [order.lines.standardSecond, order.shipments.first, 2],
  ]);
  const before = await db
    .prepare(
      "SELECT snapshot_hash,total_cents FROM confirmed_orders WHERE id=?",
    )
    .bind(order.orderId)
    .first();
  // An independent shipping-change hold on another quantity must survive.
  await db
    .prepare(
      `INSERT INTO order_quantity_holds
       (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
       VALUES ('c1-change-hold',?,?,?,1,'shipping_change','Independent change',?)`,
    )
    .bind(
      order.orderId,
      order.lines.standardSecond,
      order.shipments.first,
      fixtureClock,
    )
    .run();
  const command = {
    orderId: order.orderId,
    reason: "Ordered too many",
    quantities: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        physicalQuantity: 1,
      },
    ],
    commandId: crypto.randomUUID(),
  };
  const requestId = await cancellations.customerSubmit("buyer", command);
  expect(await cancellations.customerSubmit("buyer", command)).toBe(requestId);
  await expect(
    cancellations.customerSubmit("buyer", { ...command, reason: "Other" }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await activeHolds(order.orderId)).toEqual([
    {
      line_id: order.lines.standard,
      shipment_id: order.shipments.first,
      physical_quantity: 1,
      kind: "cancellation",
    },
    {
      line_id: order.lines.standardSecond,
      shipment_id: order.shipments.first,
      physical_quantity: 1,
      kind: "shipping_change",
    },
  ]);
  const customer = await cancellations.customerRead("buyer", order.orderId);
  expect(customer.requests).toHaveLength(1);
  expect(customer.requests[0]).toMatchObject({
    status: "pending_review",
    version: 1,
    lines: [{ lineId: order.lines.standard, physicalQuantity: 1 }],
  });
  expect(JSON.stringify(customer.requests)).not.toContain("actorId");
  expect(
    customer.eligible.find(
      (item) =>
        item.lineId === order.lines.standard &&
        item.shipmentId === order.shipments.first,
    )?.available,
  ).toBe(1);
  // Admin sees it in the paginated list and Order detail; a notification exists.
  const list = await cancellations.adminList(reviewer, {
    status: "pending_review",
    page: 1,
  });
  expect(list.records.map((record) => record.id)).toContain(requestId);
  expect((await cancellations.adminRead(owner, order.orderId))[0].id).toBe(
    requestId,
  );
  await expect(
    cancellations.adminRead(unprivileged, order.orderId),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    await db
      .prepare("SELECT kind FROM admin_notifications WHERE id=?")
      .bind(`cancellation:${requestId}`)
      .first("kind"),
  ).toBe("cancellation_requested");
  // Cross-context access is not found.
  await expect(
    cancellations.customerRead("other", order.orderId),
  ).rejects.toMatchObject({ status: 404 });
  const withdraw = {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
  };
  await expect(
    cancellations.customerWithdraw("other", withdraw),
  ).rejects.toMatchObject({ status: 404 });
  await cancellations.customerWithdraw("buyer", withdraw);
  await cancellations.customerWithdraw("buyer", withdraw);
  await expect(
    cancellations.customerWithdraw("buyer", {
      ...withdraw,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await activeHolds(order.orderId)).toEqual([
    expect.objectContaining({ kind: "shipping_change" }),
  ]);
  const after = await cancellations.customerRead("buyer", order.orderId);
  expect(after.requests[0]).toMatchObject({ status: "withdrawn", version: 2 });
  expect(after.requests[0].events.map((event) => event.kind)).toEqual([
    "submitted",
    "withdrawn",
  ]);
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
        "SELECT count(*) AS count FROM admin_audit_events WHERE entity_id=? AND event_type LIKE 'order.cancellation_%'",
      )
      .bind(order.orderId)
      .first("count"),
  ).toBe(2);
});

it("rejects made-to-order, cut hose, over-quantity and duplicate claims on the server", async () => {
  const order = await seedAfterSalesOrder(db, "c2");
  const cancellations = service();
  const submit = (
    quantities: Array<{
      lineId: string;
      shipmentId: string | null;
      physicalQuantity: number;
    }>,
  ) =>
    cancellations.customerSubmit("buyer", {
      orderId: order.orderId,
      reason: "Change of plans",
      quantities,
      commandId: crypto.randomUUID(),
    });
  for (const lineId of [
    order.lines.madeToOrderStandard,
    order.lines.cutHose,
    order.lines.assembly,
  ])
    await expect(
      submit([
        {
          lineId,
          shipmentId:
            lineId === order.lines.madeToOrderStandard
              ? order.shipments.first
              : order.shipments.second,
          physicalQuantity: 1,
        },
      ]),
    ).rejects.toMatchObject({ status: 400 });
  await expect(
    submit([
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        physicalQuantity: 3,
      },
    ]),
  ).rejects.toMatchObject({ status: 409 });
  await submit([
    {
      lineId: order.lines.standard,
      shipmentId: order.shipments.first,
      physicalQuantity: 2,
    },
  ]);
  // A second overlapping claim cannot exceed the eligible quantity.
  await expect(
    submit([
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        physicalQuantity: 1,
      },
    ]),
  ).rejects.toMatchObject({ status: 409 });
  // The database guard rejects a direct made-to-order request line too.
  await expect(
    db.batch([
      db
        .prepare(
          `INSERT INTO order_cancellation_requests
           (id,order_id,kind,origin,status,profile_id,actor_id,reason,
            submission_command_id,submission_hash,created_at,updated_at)
           VALUES ('c2-direct',?,'standard','customer','pending_review','buyer',
             'buyer','Direct','c2-direct-command','x',?,?)`,
        )
        .bind(order.orderId, fixtureClock, fixtureClock),
      db
        .prepare(
          `INSERT INTO order_quantity_holds
           (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
           VALUES ('c2-direct-hold',?,?,?,1,'cancellation','Direct',?)`,
        )
        .bind(
          order.orderId,
          order.lines.madeToOrderStandard,
          order.shipments.first,
          fixtureClock,
        ),
      db
        .prepare(
          `INSERT INTO order_cancellation_request_lines
           (request_id,order_id,line_id,shipment_id,physical_quantity,hold_id)
           VALUES ('c2-direct',?,?,?,1,'c2-direct-hold')`,
        )
        .bind(
          order.orderId,
          order.lines.madeToOrderStandard,
          order.shipments.first,
        ),
    ]),
  ).rejects.toThrow(/made-to-order/);
});

it("races cancellation with dispatch, blocks held dispatch and keeps unrelated shipments moving", async () => {
  const order = await seedAfterSalesOrder(db, "c3");
  const cancellations = service();
  // Shipment 2 is handed off first; its quantities are no longer eligible.
  await shipShipment(db, order.orderId, order.shipments.second, {
    handoffAt: "2026-09-20T10:00:00.000Z",
  });
  const read = await cancellations.customerRead("buyer", order.orderId);
  expect(
    read.eligible.some((item) => item.shipmentId === order.shipments.second),
  ).toBe(false);
  await expect(
    cancellations.customerSubmit("buyer", {
      orderId: order.orderId,
      reason: "Too late",
      quantities: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.second,
          physicalQuantity: 1,
        },
      ],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  // A pending cancellation on Shipment 1 blocks its handoff.
  await cancellations.customerSubmit("buyer", {
    orderId: order.orderId,
    reason: "Not needed",
    quantities: [
      {
        lineId: order.lines.standardSecond,
        shipmentId: order.shipments.first,
        physicalQuantity: 1,
      },
    ],
    commandId: crypto.randomUUID(),
  });
  const milestones = createShipmentMilestoneService(db, {
    now: () => new Date(fixtureClock),
  });
  await expect(
    milestones.markReady(owner, {
      orderId: order.orderId,
      shipmentId: order.shipments.first,
      expectedVersion: 1,
      commandId: crypto.randomUUID(),
      verification: {
        specificationsVerified: true,
        quantitiesVerified: true,
        offlinePreparationVerified: true,
        requiredInspectionVerified: true,
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  // Held quantities cannot be reallocated around the hold.
  await expect(
    db
      .prepare(
        `INSERT INTO order_shipment_allocations
         (shipment_id,order_id,line_id,physical_quantity) VALUES (?,?,?,1)`,
      )
      .bind(order.shipments.first, order.orderId, order.lines.assembly)
      .run(),
  ).rejects.toThrow();
});

it("flags an audited late handoff conflict without clearing the cancellation hold", async () => {
  const order = await seedAfterSalesOrder(db, "c4");
  const cancellations = service();
  const requestId = await cancellations.customerSubmit("buyer", {
    orderId: order.orderId,
    reason: "Cancel before dispatch",
    quantities: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.second,
        physicalQuantity: 1,
      },
    ],
    commandId: crypto.randomUUID(),
  });
  const milestones = createShipmentMilestoneService(db, {
    now: () => new Date(fixtureClock),
  });
  const reportId = await milestones.reportLateHandoff(owner, {
    orderId: order.orderId,
    shipmentId: order.shipments.second,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    handoffAt: "2026-09-23T12:00:00Z",
    carrierName: "DHL",
    source: "Carrier receipt dated before the request",
    reason: "Carrier collected before the website recorded handoff",
  });
  await milestones.applyLateHandoff(owner, {
    orderId: order.orderId,
    shipmentId: order.shipments.second,
    reportId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
  });
  const [request] = await cancellations.adminRead(owner, order.orderId);
  expect(request).toMatchObject({
    id: requestId,
    status: "pending_review",
    handoffConflict: true,
  });
  expect(request.lines[0]).toMatchObject({ handedOff: true, holdActive: true });
  const list = await cancellations.adminList(owner, { status: "all", page: 1 });
  expect(
    list.records.find((record) => record.id === requestId)?.handoffConflict,
  ).toBe(true);
});

it("validates input and command identity before touching state", async () => {
  const order = await seedAfterSalesOrder(db, "c5");
  const cancellations = service();
  await expect(
    cancellations.customerSubmit("buyer", {
      orderId: order.orderId,
      reason: "",
      quantities: [],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    cancellations.customerSubmit("buyer", {
      orderId: order.orderId,
      reason: "x",
      quantities: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          physicalQuantity: 1,
        },
      ],
      commandId: "not-a-uuid",
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    cancellations.customerSubmit("other", {
      orderId: order.orderId,
      reason: "x",
      quantities: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          physicalQuantity: 1,
        },
      ],
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(await activeHolds(order.orderId)).toEqual([]);
});
