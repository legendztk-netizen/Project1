import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { createShipmentMilestoneService } from "../app/modules/shipment/application/shipment-milestone-service";
import type { AdminIdentity } from "../workers/admin-access";

const directory = mkdtempSync(join(tmpdir(), "shipment-milestone-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const clock = "2026-09-24T12:00:00.000Z";
const hash = "a".repeat(64);
const actor: AdminIdentity = {
  id: "shipment-owner",
  email: "owner@example.test",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
async function stage<T>(label: string, operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Response)
      throw new Error(`${label}: ${error.status} ${await error.text()}`);
    throw error;
  }
}

beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "wrangler.jsonc",
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  const sql = `
    INSERT INTO customer_profiles
      (id,email_normalized,email_display,email_verified_at,created_at,updated_at)
    VALUES ('buyer','buyer@example.test','buyer@example.test','${clock}','${clock}','${clock}');
    INSERT INTO customer_purchasing_contexts
      (id,kind,individual_profile_id,created_at,updated_at)
    VALUES ('buyer-context','individual','buyer','${clock}','${clock}');
    INSERT INTO seller_payment_instruction_versions
      (id,channel,version,instructions,status,command_id,created_by,created_at)
    VALUES ('milestone-payment','bank_transfer',1,'Test bank','current',
      'milestone-payment-command','test','${clock}');
    INSERT INTO customer_quote_requests
      (id,reference_number,profile_id,purchasing_context_id,source_session_id,
       source_session_version,source_address_id,purchasing_context_kind,
       fulfillment_term,currency,merchandise_subtotal,service_fee_total,
       idempotency_key,snapshot_json,submitted_at)
    VALUES ('milestone-request','QR-MILESTONE-TEST','buyer','buyer-context',
      'milestone-session','1','milestone-address','individual','DDP','USD',100,0,
      'milestone-request-key','{}','${clock}');
    INSERT INTO quote_revisions
      (id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,
       command_id,command_hash,issued_by,issued_at)
    VALUES ('milestone-revision','milestone-request',1,1,'{}','${hash}',
      'milestone-revision-command','${hash}','test','${clock}');
    INSERT INTO proforma_invoice_intents
      (id,command_id,command_hash,request_id,quote_revision_id,quote_revision_hash,
       source_revision_json,seller_identity_id,seller_version,payment_instruction_id,
       payment_instruction_version,payment_channel,snapshot_json,snapshot_hash,
       issued_by,issued_at,valid_until)
    VALUES ('milestone-pi','milestone-pi-command','${hash}','milestone-request',
      'milestone-revision','${hash}','{}','seller-identity-initial',1,
      'milestone-payment',1,'bank_transfer','{}','${hash}',
      'test','${clock}','2026-10-24T12:00:00.000Z');
    INSERT INTO proforma_invoices
      (id,request_id,quote_revision_id,document_number,document_version,
       snapshot_json,snapshot_hash,pdf_object_key,pdf_sha256,pdf_byte_size,
       pdf_page_count,pdf_renderer_version,payment_channel,issued_by,issued_at,valid_until)
    VALUES ('milestone-pi','milestone-request','milestone-revision','PI-MILESTONE-TEST',1,
      '{}','${hash}','pi/milestone-test.pdf','${hash}',1,1,'legacy',
      'bank_transfer','test','${clock}','2026-10-24T12:00:00.000Z');
    INSERT INTO pi_customer_views
      (id,pi_id,request_id,profile_id,purchasing_context_id,document_version,
       snapshot_hash,pdf_sha256,pdf_byte_size,kind,occurred_at,request_evidence_json)
    VALUES ('milestone-view','milestone-pi','milestone-request','buyer',
      'buyer-context',1,'${hash}','${hash}',1,'view','${clock}','{}');
    INSERT INTO pi_acceptances
      (id,pi_id,request_id,profile_id,purchasing_context_id,source,document_version,
       snapshot_hash,quote_revision_id,view_id,accepted_at,business_hash,evidence_json)
    VALUES ('milestone-acceptance','milestone-pi','milestone-request','buyer',
      'buyer-context','website',1,'${hash}','milestone-revision','milestone-view',
      '${clock}','${hash}','{}');
    INSERT INTO pi_payment_confirmations
      (id,command_id,command_hash,pi_id,confirmed_cents,currency,actual_channel,
       external_reference,actor_id,confirmed_at)
    VALUES ('milestone-confirmation','milestone-confirmation-command','${hash}',
      'milestone-pi',10000,'USD','bank_transfer','ref-milestone','test','${clock}');
    INSERT INTO confirmed_orders
      (id,order_number,request_id,pi_id,purchasing_context_id,acceptance_id,
       confirmation_id,snapshot_json,snapshot_hash,currency,total_cents,confirmed_at)
    VALUES ('milestone-order','ORDER-MILESTONE-TEST','milestone-request','milestone-pi',
      'buyer-context','milestone-acceptance','milestone-confirmation',
      '{}','${hash}','USD',10000,'${clock}');
    INSERT INTO confirmed_order_lines
      (order_id,line_id,line_number,line_kind,snapshot_json)
    VALUES ('milestone-order','line-1',1,'standard',
      '{"id":"line-1","quantity":2,"sku":"TEST","displayName":"Test part"}');
    INSERT INTO order_fulfillment_plans
      (order_id,status,source,source_text,version,created_at,updated_at)
    VALUES ('milestone-order','ready','accepted_together','',1,'${clock}','${clock}');
    INSERT INTO order_shipments
      (id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
    VALUES ('milestone-shipment','milestone-order','together',1,'Ship together',
      '{"id":"together","allocations":[{"lineId":"line-1","physicalQuantity":2}]}',
      '${clock}','${clock}');
    INSERT INTO order_shipment_allocations
      (shipment_id,order_id,line_id,physical_quantity)
    VALUES ('milestone-shipment','milestone-order','line-1',2);
    INSERT INTO confirmed_order_lines
      (order_id,line_id,line_number,line_kind,snapshot_json)
    VALUES ('milestone-order','line-2',2,'standard',
      '{"id":"line-2","quantity":1,"sku":"SECOND","displayName":"Second part"}');
    INSERT INTO order_shipments
      (id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
    VALUES ('milestone-held','milestone-order','second',2,'Second batch',
      '{"id":"second","allocations":[{"lineId":"line-2","physicalQuantity":1}]}',
      '${clock}','${clock}');
    INSERT INTO order_shipment_allocations
      (shipment_id,order_id,line_id,physical_quantity)
    VALUES ('milestone-held','milestone-order','line-2',1);
    INSERT INTO confirmed_order_lines
      (order_id,line_id,line_number,line_kind,snapshot_json)
    VALUES ('milestone-order','line-3',3,'standard',
      '{"id":"line-3","quantity":1,"sku":"LATE","displayName":"Late part"}');
    INSERT INTO order_shipments
      (id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
    VALUES ('milestone-late','milestone-order','late',3,'Late batch',
      '{"id":"late","allocations":[{"lineId":"line-3","physicalQuantity":1}]}',
      '${clock}','${clock}');
    INSERT INTO order_shipment_allocations
      (shipment_id,order_id,line_id,physical_quantity)
    VALUES ('milestone-late','milestone-order','line-3',1);`;
  await db.batch(
    sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement)),
  );
}, 60_000);

afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("blocks new release under holds but records actual delivery after a later hold", async () => {
  const service = createShipmentMilestoneService(db, {
    now: () => new Date(clock),
  });
  const base = { orderId: "milestone-order", shipmentId: "milestone-held" };
  const ready = {
    ...base,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    verification: {
      specificationsVerified: true,
      quantitiesVerified: true,
      offlinePreparationVerified: true,
      requiredInspectionVerified: true,
    },
  };
  await db
    .prepare(
      `INSERT INTO order_quantity_holds
       (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
       VALUES ('milestone-hold','milestone-order','line-2','milestone-held',1,
         'shipping_change','Pending delivery review',?)`,
    )
    .bind(clock)
    .run();
  await expect(service.markReady(actor, ready)).rejects.toMatchObject({
    status: 409,
  });
  await db
    .prepare(
      "UPDATE order_quantity_holds SET active=0,resolved_at=? WHERE id='milestone-hold'",
    )
    .bind(clock)
    .run();
  expect(await stage("ready", service.markReady(actor, ready))).toBe(2);
  await db
    .prepare(
      "INSERT INTO order_release_guards(order_id,held,updated_at) VALUES ('milestone-order',1,?)",
    )
    .bind(clock)
    .run();
  const shipped = {
    ...base,
    expectedVersion: 2,
    commandId: crypto.randomUUID(),
    handoffAt: clock,
    carrierName: "Other carrier",
    source: "Carrier receipt",
  };
  await expect(service.markShipped(actor, shipped)).rejects.toMatchObject({
    status: 409,
  });
  await db
    .prepare(
      "UPDATE order_release_guards SET held=0,updated_at=? WHERE order_id='milestone-order'",
    )
    .bind(clock)
    .run();
  expect(await stage("shipped", service.markShipped(actor, shipped))).toBe(3);
  const unknownTracking = {
    ...base,
    expectedVersion: 0,
    commandId: crypto.randomUUID(),
    packageLabel: "Crate 1",
    carrierName: "Other carrier",
    trackingUrl: "https://carrier.example.test/parcel/1",
    reason: "Carrier source checked",
  };
  expect(await service.saveTracking(actor, unknownTracking)).toBe(1);
  const firstTracking = (await service.adminRead(actor, base.orderId)).find(
    (item) => item.shipmentId === base.shipmentId,
  )!.tracking[0];
  expect(
    await service.saveTracking(actor, {
      ...unknownTracking,
      trackingId: firstTracking.id,
      expectedVersion: 1,
      commandId: crypto.randomUUID(),
      trackingUrl: "https://www.dhl.com/global-en/home/tracking.html",
      reason: "Carrier URL correction",
    }),
  ).toBe(2);
  expect(
    (await service.customerRead("buyer", base.orderId))[1].tracking[0]
      .trackingUrl,
  ).toContain("dhl.com");
  await db
    .prepare(
      "UPDATE order_release_guards SET held=1,updated_at=? WHERE order_id='milestone-order'",
    )
    .bind(clock)
    .run();
  expect(
    await service.markDelivered(actor, {
      ...base,
      expectedVersion: 3,
      commandId: crypto.randomUUID(),
      actualDate: "2026-09-24",
      source: "Customer signed receipt",
    }),
  ).toBe(4);
});

it("records readiness, exact dispatch and delivery once with customer-safe history", async () => {
  await db
    .prepare(
      "UPDATE order_release_guards SET held=0,updated_at=? WHERE order_id='milestone-order'",
    )
    .bind(clock)
    .run();
  const initialNotifications = Number(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_notification_outbox WHERE message_id LIKE 'shipment-progress:%'",
      )
      .first("n"),
  );
  const service = createShipmentMilestoneService(db, {
    now: () => new Date(clock),
  });
  const base = {
    orderId: "milestone-order",
    shipmentId: "milestone-shipment",
  };
  const ready = {
    ...base,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    verification: {
      specificationsVerified: true,
      quantitiesVerified: true,
      offlinePreparationVerified: true,
      requiredInspectionVerified: true,
    },
  };
  expect(await service.markReady(actor, ready)).toBe(2);
  expect(await service.markReady(actor, ready)).toBe(2);
  const shipped = {
    ...base,
    expectedVersion: 2,
    commandId: crypto.randomUUID(),
    handoffAt: clock,
    carrierName: "UPS",
    source: "Carrier receipt",
  };
  expect(await service.markShipped(actor, shipped)).toBe(3);
  expect(await service.markShipped(actor, shipped)).toBe(3);
  const tracking = {
    ...base,
    expectedVersion: 0,
    commandId: crypto.randomUUID(),
    packageLabel: "Carton 1",
    carrierName: "UPS",
    trackingNumber: "TRACK-1",
    trackingUrl: "https://www.ups.com/track?loc=en_US&tracknum=TRACK-1",
    reason: "Carrier label confirmed",
  };
  expect(await stage("tracking", service.saveTracking(actor, tracking))).toBe(
    1,
  );
  expect(await service.saveTracking(actor, tracking)).toBe(1);
  expect(
    await stage(
      "delivered",
      service.markDelivered(actor, {
        ...base,
        expectedVersion: 3,
        commandId: crypto.randomUUID(),
        actualDate: "2026-09-24",
        source: "Carrier delivery scan",
      }),
    ),
  ).toBe(4);
  const customer = await service.customerRead("buyer", base.orderId);
  expect(customer[0].status).toBe("delivered");
  expect(customer[0].events.map((event) => event.kind)).toEqual([
    "ready_to_ship",
    "shipped",
    "delivered",
  ]);
  expect(customer[0].tracking[0].trackingUrl).toContain("ups.com");
  expect(JSON.stringify(customer)).not.toContain(actor.id);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM shipment_dispatch_quantities WHERE shipment_id='milestone-shipment'",
      )
      .first("n"),
  ).toBe(1);
  expect(
    await db
      .prepare(
        "SELECT physical_quantity FROM shipment_dispatch_quantities WHERE shipment_id='milestone-shipment'",
      )
      .first("physical_quantity"),
  ).toBe(2);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_notification_outbox WHERE message_id LIKE 'shipment-progress:%'",
      )
      .first("n"),
  ).toBe(initialNotifications + 3);
  await expect(
    service.customerRead("other", base.orderId),
  ).rejects.toMatchObject({
    status: 404,
  });
});

it("retains a late carrier handoff fact during a hold and applies it only after review", async () => {
  const service = createShipmentMilestoneService(db, {
    now: () => new Date(clock),
  });
  const base = { orderId: "milestone-order", shipmentId: "milestone-late" };
  await db
    .prepare(
      `INSERT INTO order_quantity_holds
       (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
       VALUES ('late-hold','milestone-order','line-3','milestone-late',1,
         'shipping_change','Change review after carrier pickup',?)`,
    )
    .bind(clock)
    .run();
  const report = {
    ...base,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
    handoffAt: "2026-09-23T12:00:00Z",
    carrierName: "DHL",
    source: "Carrier receipt dated before hold",
    reason: "Carrier picked up before website handoff was recorded",
  };
  const reportId = await service.reportLateHandoff(actor, report);
  expect(await service.reportLateHandoff(actor, report)).toBe(reportId);
  const before = (await service.customerRead("buyer", base.orderId))[2];
  expect(before.status).toBe("planned");
  expect(JSON.stringify(before)).not.toContain(reportId);
  const apply = {
    ...base,
    reportId,
    expectedVersion: 1,
    commandId: crypto.randomUUID(),
  };
  await expect(service.applyLateHandoff(actor, apply)).rejects.toMatchObject({
    status: 409,
  });
  await db
    .prepare(
      "UPDATE order_quantity_holds SET active=0,resolved_at=? WHERE id='late-hold'",
    )
    .bind(clock)
    .run();
  expect(await service.applyLateHandoff(actor, apply)).toBe(2);
  expect(await service.applyLateHandoff(actor, apply)).toBe(2);
  const after = (await service.customerRead("buyer", base.orderId))[2];
  expect(after.status).toBe("shipped");
  expect(after.events.map((event) => event.kind)).toEqual(["shipped"]);
  expect(
    await db
      .prepare(
        "SELECT physical_quantity FROM shipment_dispatch_quantities WHERE shipment_id='milestone-late'",
      )
      .first("physical_quantity"),
  ).toBe(1);
});
