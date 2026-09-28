import { afterAll, beforeAll, expect, it } from "vitest";

import { recordAfterSalesOverdueReminders } from "../app/modules/after-sales/application/after-sales-reminders";
import { createCancellationService } from "../app/modules/after-sales/application/cancellation-service";
import { createCaseService } from "../app/modules/after-sales/application/case-service";
import { createReturnAuthorizationService } from "../app/modules/after-sales/application/return-authorization-service";
import { createReturnInspectionService } from "../app/modules/after-sales/application/return-inspection-service";
import {
  fixtureClock,
  owner,
  reviewer,
  seedAfterSalesOrder,
  shipShipment,
  startAfterSalesDatabase,
  type SeededOrder,
  caseVersion,
} from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("after-sales-guards");
  db = started.db;
  dispose = started.dispose;
  await db
    .prepare(
      `INSERT INTO seller_return_locations(id,label,address,phone,purpose,updated_at)
       VALUES ('reno-returns','Reno Return Location',
         '100 Test Way\nReno, NV 89501\nUnited States','+1 7755550100',
         'Approved returns only','2026-09-01T00:00:00.000Z')`,
    )
    .run();
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

const cancellations = () =>
  createCancellationService(db, { now: () => new Date(fixtureClock) });
const at = (now: string) => ({ now: () => new Date(now) });

async function requestAndApprove(
  order: SeededOrder,
  lineId: string,
  shipmentId: string | null,
  quantity: number,
) {
  const requestId = await cancellations().customerSubmit("buyer", {
    orderId: order.orderId,
    reason: "No longer needed",
    quantities: [{ lineId, shipmentId, physicalQuantity: quantity }],
    commandId: crypto.randomUUID(),
  });
  return cancellations().adminResolve(owner, {
    orderId: order.orderId,
    requestId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    decisions: [{ lineId, shipmentId, approvedQuantity: quantity }],
    customerReason: "Not yet packed",
    logisticsNote: "Internal freight note",
    taxNote: "Internal tax note",
  });
}

it("never offers already cancelled units again, allocated or not", async () => {
  const unallocated = await seedAfterSalesOrder(db, "g1", {
    unallocated: true,
  });
  await requestAndApprove(unallocated, unallocated.lines.standard, null, 1);
  const read = await cancellations().customerRead("buyer", unallocated.orderId);
  expect(
    read.eligible.find((item) => item.lineId === unallocated.lines.standard)
      ?.available,
  ).toBe(2);

  // Cancelling a line's whole Shipment allocation removes the allocation;
  // the line must not reappear as unallocated and cancellable.
  const allocated = await seedAfterSalesOrder(db, "g2");
  await requestAndApprove(
    allocated,
    allocated.lines.standardSecond,
    allocated.shipments.first,
    2,
  );
  const after = await cancellations().customerRead("buyer", allocated.orderId);
  expect(
    after.eligible.filter(
      (item) => item.lineId === allocated.lines.standardSecond,
    ),
  ).toEqual([]);
});

it("keeps internal logistics and tax notes out of the customer resolution", async () => {
  const order = await seedAfterSalesOrder(db, "g3");
  await requestAndApprove(
    order,
    order.lines.standard,
    order.shipments.second,
    1,
  );
  const [request] = (await cancellations().customerRead("buyer", order.orderId))
    .requests;
  expect(request.resolution?.financial).toBeDefined();
  expect(JSON.stringify(request.resolution)).not.toContain("Internal");
  const [admin] = await cancellations().adminRead(owner, order.orderId);
  expect(admin.resolution?.financial.logisticsNote).toBe(
    "Internal freight note",
  );
});

it("resolves concurrent requests on one Shipment line without losing an allocation change", async () => {
  const order = await seedAfterSalesOrder(db, "g4");
  const submit = () =>
    cancellations().customerSubmit("buyer", {
      orderId: order.orderId,
      reason: "Too many",
      quantities: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          physicalQuantity: 1,
        },
      ],
      commandId: crypto.randomUUID(),
    });
  const first = await submit();
  const second = await submit();
  const resolve = (requestId: string) =>
    cancellations().adminResolve(owner, {
      orderId: order.orderId,
      requestId,
      expectedVersion: 1,
      commandId: crypto.randomUUID(),
      decisions: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          approvedQuantity: 1,
        },
      ],
      customerReason: "Not yet packed",
    });
  const results = await Promise.allSettled([resolve(first), resolve(second)]);
  const cancelled =
    (await db
      .prepare(
        `SELECT sum(physical_quantity) AS quantity FROM order_cancelled_quantities
         WHERE order_id=? AND line_id=? AND shipment_id=?`,
      )
      .bind(order.orderId, order.lines.standard, order.shipments.first)
      .first<number>("quantity")) ?? 0;
  const allocated =
    (await db
      .prepare(
        `SELECT physical_quantity FROM order_shipment_allocations
         WHERE shipment_id=? AND line_id=?`,
      )
      .bind(order.shipments.first, order.lines.standard)
      .first<number>("physical_quantity")) ?? 0;
  // Whatever interleaving happened, allocation + cancelled stays at 2.
  expect(allocated + cancelled).toBe(2);
  expect(cancelled).toBe(
    results.filter((result) => result.status === "fulfilled").length,
  );
  for (const result of results)
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({ status: 409 });
});

it("rejects a standard cancellation line the PI acknowledged as made to order, even written directly", async () => {
  const order = await seedAfterSalesOrder(db, "g5", {
    acknowledgeStandardSecond: true,
  });
  await expect(
    db.batch([
      db
        .prepare(
          `INSERT INTO order_cancellation_requests
           (id,order_id,kind,origin,status,profile_id,actor_id,reason,
            submission_command_id,submission_hash,created_at,updated_at)
           VALUES ('g5-request',?,'standard','customer','pending_review','buyer',
             'buyer','Direct write','g5-command','x',?,?)`,
        )
        .bind(order.orderId, fixtureClock, fixtureClock),
      db
        .prepare(
          `INSERT INTO order_quantity_holds
           (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
           VALUES ('g5-hold',?,?,?,1,'cancellation','Direct write',?)`,
        )
        .bind(
          order.orderId,
          order.lines.standardSecond,
          order.shipments.first,
          fixtureClock,
        ),
      db
        .prepare(
          `INSERT INTO order_cancellation_request_lines
           (request_id,order_id,line_id,shipment_id,physical_quantity,hold_id)
           VALUES ('g5-request',?,?,?,1,'g5-hold')`,
        )
        .bind(order.orderId, order.lines.standardSecond, order.shipments.first),
    ]),
  ).rejects.toThrow(/made-to-order/);
});

async function deliveredCase(prefix: string, quantity = 2) {
  const order = await seedAfterSalesOrder(db, prefix);
  await shipShipment(db, order.orderId, order.shipments.first, {
    handoffAt: "2026-09-05T02:00:00.000Z",
    deliveredDate: "2026-09-10",
  });
  const caseId = await createCaseService(
    db,
    at("2026-09-12T12:00:00.000Z"),
  ).customerOpen("buyer", {
    orderId: order.orderId,
    reason: "wrong_item",
    description: "Wrong fitting",
    lines: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        physicalQuantity: quantity,
      },
    ],
    commandId: crypto.randomUUID(),
  });
  return { order, caseId };
}

const issueRa = (
  order: SeededOrder,
  caseId: string,
  now: string,
  quantity: number,
  previous?: string,
) =>
  caseVersion(db, caseId).then((expectedVersion) =>
    createReturnAuthorizationService(db, at(now)).adminIssue(reviewer, {
      orderId: order.orderId,
      caseId,
      expectedVersion,
      locationId: "reno-returns",
      instructions: "Write the RA number on the box.",
      lines: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          physicalQuantity: quantity,
        },
      ],
      ...(previous
        ? { previousRaId: previous, reviewNote: "Customer asked again" }
        : {}),
      commandId: crypto.randomUUID(),
    }),
  );

const receive = (
  order: SeededOrder,
  raId: string,
  now: string,
  receivedAt: string,
  quantity: number,
) =>
  createReturnInspectionService(db, at(now)).adminRecordReceipt(reviewer, {
    orderId: order.orderId,
    raId,
    receivedAt,
    source: "Warehouse log",
    lines: [
      {
        lineId: order.lines.standard,
        shipmentId: order.shipments.first,
        physicalQuantity: quantity,
      },
    ],
    commandId: crypto.randomUUID(),
  });

it("never counts more received units than the Case claimed across an expired RA and its reauthorization", async () => {
  const { order, caseId } = await deliveredCase("g6");
  const first = await issueRa(order, caseId, "2026-09-12T13:00:00.000Z", 2);
  // RA1 expires unreceived; RA2 reauthorizes the same two units.
  const second = await issueRa(
    order,
    caseId,
    "2026-10-20T13:00:00.000Z",
    2,
    first,
  );
  await receive(
    order,
    second,
    "2026-10-25T13:00:00.000Z",
    "2026-10-25T12:00:00.000Z",
    2,
  );
  // A timely RA1 arrival recorded late cannot add two more units.
  await expect(
    receive(
      order,
      first,
      "2026-10-26T13:00:00.000Z",
      "2026-10-01T12:00:00.000Z",
      2,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const received = await db
    .prepare(
      `SELECT sum(physical_quantity) AS quantity FROM after_sales_receipt_lines
       WHERE case_id=?`,
    )
    .bind(caseId)
    .first<number>("quantity");
  expect(received).toBe(2);
});

it("releases a closed Case's unreceived quantities for a later report", async () => {
  const { order, caseId } = await deliveredCase("g7");
  const cases = createCaseService(db, at("2026-09-13T12:00:00.000Z"));
  const [open] = await cases.adminRead(owner, order.orderId);
  await createReturnAuthorizationService(
    db,
    at("2026-09-13T12:00:00.000Z"),
  ).adminCloseCase(owner, {
    orderId: order.orderId,
    caseId,
    expectedVersion: open.version,
    reason: "Customer found the right fitting in the box",
    commandId: crypto.randomUUID(),
  });
  const read = await cases.customerRead("buyer", order.orderId);
  expect(
    read.claimable.find(
      (item) =>
        item.lineId === order.lines.standard &&
        item.shipmentId === order.shipments.first,
    )?.available,
  ).toBe(2);
  await expect(
    cases.customerOpen("buyer", {
      orderId: order.orderId,
      reason: "nonconforming",
      description: "Thread is damaged after all",
      lines: [
        {
          lineId: order.lines.standard,
          shipmentId: order.shipments.first,
          physicalQuantity: 2,
        },
      ],
      commandId: crypto.randomUUID(),
    }),
  ).resolves.toBeTypeOf("string");
});

it("keeps received units of a closed Case claimed", async () => {
  const { order, caseId } = await deliveredCase("g8");
  const raId = await issueRa(order, caseId, "2026-09-12T13:00:00.000Z", 2);
  await receive(
    order,
    raId,
    "2026-09-20T13:00:00.000Z",
    "2026-09-20T12:00:00.000Z",
    1,
  );
  const cases = createCaseService(db, at("2026-09-21T12:00:00.000Z"));
  const [open] = await cases.adminRead(owner, order.orderId);
  await createReturnAuthorizationService(
    db,
    at("2026-09-21T12:00:00.000Z"),
  ).adminCloseCase(owner, {
    orderId: order.orderId,
    caseId,
    expectedVersion: open.version,
    reason: "Only one unit came back",
    commandId: crypto.randomUUID(),
  });
  const read = await cases.customerRead("buyer", order.orderId);
  expect(
    read.claimable.find(
      (item) =>
        item.lineId === order.lines.standard &&
        item.shipmentId === order.shipments.first,
    )?.available,
  ).toBe(1);
});

it("reminds every overdue refund even when the backlog exceeds one batch", async () => {
  const overdue = async () =>
    (
      await db
        .prepare(
          `SELECT a.id,EXISTS(SELECT 1 FROM admin_notifications n
             WHERE n.id='refund-overdue:'||a.id) AS reminded
           FROM after_sales_refund_authorizations a WHERE a.status='approved'`,
        )
        .all<{ id: string; reminded: number }>()
    ).results;
  expect((await overdue()).length).toBeGreaterThan(2);
  const first = await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-12-01T12:00:00.000Z"),
    { batchSize: 1 },
  );
  expect((await overdue()).every((row) => row.reminded === 1)).toBe(true);
  expect(first.refunds).toBe((await overdue()).length);
  const again = await recordAfterSalesOverdueReminders(
    db,
    new Date("2026-12-02T12:00:00.000Z"),
    { batchSize: 1 },
  );
  expect(again.refunds).toBe(0);
});
