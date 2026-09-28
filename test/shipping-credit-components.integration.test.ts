import { afterAll, beforeAll, expect, it } from "vitest";
import { createCancellationService } from "../app/modules/after-sales/application/cancellation-service";
import {
  fixtureClock,
  owner,
  seedAfterSalesOrder,
  startAfterSalesDatabase,
  type SeededOrder,
} from "./fixtures/after-sales-order";
let fixture: Awaited<ReturnType<typeof startAfterSalesDatabase>>;
beforeAll(async () => {
  fixture = await startAfterSalesDatabase("shipping-credit-components");
}, 90000);
afterAll(async () => {
  await fixture?.dispose();
});

async function applyTaxCredit(order: SeededOrder, taxCents: number) {
  const db = fixture.db;
  const id = crypto.randomUUID();
  const after = JSON.stringify({
    shipments: [],
    creditAllocation: { logisticsCents: 0, taxCents },
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO order_shipping_change_requests
      (id,order_id,profile_id,kind,status,requested_json,submission_command_id,submission_hash,created_at,updated_at,current_proposal_id)
      VALUES (?,?,'buyer','delivery_address','proposed','{}',?,'h',?,?,?)`,
      )
      .bind(
        id,
        order.orderId,
        `${id}-request`,
        fixtureClock,
        fixtureClock,
        `${id}-proposal`,
      ),
    db
      .prepare(
        `INSERT INTO order_shipping_change_proposals
      (id,request_id,version,before_json,after_json,adjustment_cents,reason,expires_at,proposal_hash,command_id,command_hash,actor_id,published_at)
      VALUES (?,?,1,'{}',?,?,'Lower destination Sales Tax','2026-10-30T00:00:00Z','h',?,'h','owner',?)`,
      )
      .bind(
        `${id}-proposal`,
        id,
        after,
        -taxCents,
        `${id}-propose`,
        fixtureClock,
      ),
    db
      .prepare(
        `UPDATE order_shipping_change_requests SET status='accepted',version=2 WHERE id=?`,
      )
      .bind(id),
    db
      .prepare(
        `INSERT INTO order_shipping_change_acceptances
      (id,request_id,proposal_id,profile_id,proposal_hash,command_id,command_hash,accepted_at)
      VALUES (?,?,?,'buyer','h',?,'h',?)`,
      )
      .bind(
        `${id}-accept`,
        id,
        `${id}-proposal`,
        `${id}-accept-command`,
        fixtureClock,
      ),
    db
      .prepare(
        `INSERT INTO order_shipping_change_effective
      (id,order_id,request_id,proposal_id,proposal_hash,before_json,after_json,adjustment_cents,effective_at,command_id)
      VALUES (?,?,?,?,'h','{}',?,?,?,?)`,
      )
      .bind(
        `${id}-effective`,
        order.orderId,
        id,
        `${id}-proposal`,
        after,
        -taxCents,
        fixtureClock,
        `${id}-apply`,
      ),
    db
      .prepare(
        `INSERT INTO order_shipping_change_refund_reservations
      (id,effective_change_id,order_id,due_cents,reserved_at) VALUES (?,?,?,?,?)`,
      )
      .bind(
        `${id}-reserve`,
        `${id}-effective`,
        order.orderId,
        taxCents,
        fixtureClock,
      ),
  ]);
}

async function cancellation(order: SeededOrder) {
  const service = createCancellationService(fixture.db, {
    now: () => new Date("2026-09-24T12:00:00.000Z"),
  });
  const requestId = await service.customerSubmit("buyer", {
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
  return (taxCents: number) =>
    service.adminResolve(owner, {
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
      customerReason: "Unshipped item cancelled",
      taxCents,
      taxNote: "Original Sales Tax credited",
      commandId: crypto.randomUUID(),
    });
}

it("allows an address-change tax credit with no logistics charge and prevents duplicate tax refunds", async () => {
  const order = await seedAfterSalesOrder(fixture.db, "tax-credit-first", {
    charges: { freight: 0, dutiesImport: 0, salesTax: 1000 },
  });
  await applyTaxCredit(order, 600);
  const refund = await cancellation(order);
  await expect(refund(500)).rejects.toMatchObject({ status: 409 });
  await refund(400);
  expect(
    await fixture.db
      .prepare(
        `SELECT logistics_cents,tax_cents FROM order_shipping_change_credit_components WHERE order_id=?`,
      )
      .bind(order.orderId)
      .first(),
  ).toEqual({ logistics_cents: 0, tax_cents: 600 });
});

it("enforces the same Sales Tax entitlement when after-sales authorizes its refund first", async () => {
  const order = await seedAfterSalesOrder(fixture.db, "tax-refund-first", {
    charges: { freight: 0, dutiesImport: 0, salesTax: 1000 },
  });
  await (
    await cancellation(order)
  )(600);
  await expect(applyTaxCredit(order, 500)).rejects.toThrow(
    /Tax credits exceed/,
  );
  await applyTaxCredit(order, 400);
});
