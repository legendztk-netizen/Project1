import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { createShipmentMilestoneService } from "../app/modules/shipment/application/shipment-milestone-service";
import { recordOverdueReadyScheduleReminders } from "../app/modules/shipment/application/shipment-overdue-reminders";
import { createOrderShippingChangeService } from "../app/modules/shipment/application/order-shipping-change-service";
import { piSha256 } from "../app/modules/proforma-invoice/domain/proforma-invoice";
import { createPiFundResolutionService } from "../app/modules/proforma-invoice/application/pi-fund-resolution-service";
import { createPiPaymentCorrectionService } from "../app/modules/proforma-invoice/application/pi-payment-correction-service";
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
  const orderSnapshot = JSON.stringify({
    destination: {
      recipientName: "Test Buyer",
      addressLine1: "1 Old Street",
      city: "Portland",
      stateProvince: "OR",
      postalCode: "97201",
      countryCode: "US",
    },
    terms: {
      transportMethod: "Sea",
      incoterm: "DDP",
      namedPlace: "Portland",
      salesTaxTreatment: "Not Collected",
    },
  });
  const orderHash = await piSha256(new TextEncoder().encode(orderSnapshot));
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
    INSERT INTO pi_payment_accounts
      (pi_id,request_id,purchasing_context_id,currency,total_due_cents,
       term_kind,amount_received_cents,actual_channel,ever_received,
       instruction_channel,instruction_id,instruction_version,created_at,updated_at)
    VALUES ('milestone-pi','milestone-request','buyer-context','USD',10000,
      'legacy_review',10250,'bank_transfer',1,'bank_transfer',
      'milestone-payment',1,'${clock}','${clock}');
    INSERT INTO confirmed_orders
      (id,order_number,request_id,pi_id,purchasing_context_id,acceptance_id,
       confirmation_id,snapshot_json,snapshot_hash,currency,total_cents,confirmed_at)
    VALUES ('milestone-order','ORDER-MILESTONE-TEST','milestone-request','milestone-pi',
      'buyer-context','milestone-acceptance','milestone-confirmation',
      '${orderSnapshot}','${orderHash}','USD',10000,'${clock}');
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

it("records a private overdue reminder once per shipment estimate", async () => {
  await db
    .prepare(
      `INSERT INTO order_shipment_ready_schedules
       (shipment_id,order_id,current_estimate_date,current_estimate_source,
        created_at,updated_at)
       VALUES ('milestone-shipment','milestone-order','2026-09-23','operational',?,?)`,
    )
    .bind(clock, clock)
    .run();
  const scheduledAt = new Date(clock);
  expect(await recordOverdueReadyScheduleReminders(db, scheduledAt)).toBe(1);
  expect(await recordOverdueReadyScheduleReminders(db, scheduledAt)).toBe(0);
  const reminder = await db
    .prepare(
      `SELECT entity_id,payload_json FROM admin_audit_events
       WHERE event_type='shipment.ready_date_overdue'`,
    )
    .first<{ entity_id: string; payload_json: string }>();
  expect(reminder?.entity_id).toBe("milestone-order");
  expect(JSON.parse(reminder!.payload_json)).toMatchObject({
    shipmentId: "milestone-shipment",
    estimateDate: "2026-09-23",
  });
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

it("records a late carrier handoff during a hold without releasing remaining work", async () => {
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
  expect(await service.applyLateHandoff(actor, apply)).toBe(2);
  expect(await service.applyLateHandoff(actor, apply)).toBe(2);
  const after = (await service.customerRead("buyer", base.orderId))[2];
  expect(after.status).toBe("shipped");
  expect(after.events.map((event) => event.kind)).toEqual(["shipped"]);
  expect(
    await db
      .prepare("SELECT active FROM order_quantity_holds WHERE id='late-hold'")
      .first("active"),
  ).toBe(1);
  expect(
    await db
      .prepare(
        "SELECT physical_quantity FROM shipment_dispatch_quantities WHERE shipment_id='milestone-late'",
      )
      .first("physical_quantity"),
  ).toBe(1);
});

it("locks only the requested unshipped shipment for an owned change request", async () => {
  await db.batch([
    db.prepare(
      `INSERT INTO confirmed_order_lines
       (order_id,line_id,line_number,line_kind,snapshot_json)
       VALUES ('milestone-order','line-change',4,'standard',
         '{"id":"line-change","quantity":2,"sku":"CHANGE","displayName":"Change part"}')`,
    ),
    db
      .prepare(
        `INSERT INTO order_shipments
       (id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
       VALUES ('milestone-change','milestone-order','change',4,'Change batch',
         '{"id":"change","allocations":[{"lineId":"line-change","physicalQuantity":2}]}',?,?)`,
      )
      .bind(clock, clock),
    db.prepare(
      `INSERT INTO order_shipment_allocations
       (shipment_id,order_id,line_id,physical_quantity)
       VALUES ('milestone-change','milestone-order','line-change',2)`,
    ),
  ]);
  await stage(
    "ready before change",
    createShipmentMilestoneService(db, {
      now: () => new Date(clock),
    }).markReady(actor, {
      orderId: "milestone-order",
      shipmentId: "milestone-change",
      expectedVersion: 1,
      commandId: crypto.randomUUID(),
      verification: {
        specificationsVerified: true,
        quantitiesVerified: true,
        offlinePreparationVerified: true,
        requiredInspectionVerified: true,
      },
    }),
  );
  let changeTime = clock;
  const changes = createOrderShippingChangeService(db, {
    now: () => new Date(changeTime),
  });
  const input = {
    orderId: "milestone-order",
    kind: "delivery_address" as const,
    requested: {
      note: "Please deliver to the updated receiving office",
      destination: {
        recipientName: "Test Buyer",
        addressLine1: "123 New Street",
        city: "Portland",
        stateProvince: "OR",
        postalCode: "97201",
        countryCode: "US",
      },
    },
    shipments: [{ shipmentId: "milestone-change", expectedVersion: 2 }],
    commandId: crypto.randomUUID(),
  };
  const id = await stage("submit", changes.customerSubmit("buyer", input));
  expect(await changes.customerSubmit("buyer", input)).toBe(id);
  expect((await changes.customerRead("buyer", input.orderId))[0]).toMatchObject(
    {
      id,
      status: "pending_review",
      shipments: [
        {
          shipmentId: "milestone-change",
          quantities: [{ lineId: "line-change", physicalQuantity: 2 }],
        },
      ],
    },
  );
  await expect(
    changes.customerRead("other", input.orderId),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    changes.customerSubmit("buyer", {
      ...input,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await db
      .prepare(
        `SELECT sum(physical_quantity) AS n FROM order_quantity_holds
     WHERE shipment_id='milestone-change' AND active=1`,
      )
      .first("n"),
  ).toBe(2);
  await expect(
    createShipmentMilestoneService(db, {
      now: () => new Date(clock),
    }).markReady(actor, {
      orderId: input.orderId,
      shipmentId: "milestone-change",
      expectedVersion: 2,
      commandId: crypto.randomUUID(),
      verification: {
        specificationsVerified: true,
        quantitiesVerified: true,
        offlinePreparationVerified: true,
        requiredInspectionVerified: true,
      },
    }),
  ).rejects.toMatchObject({ status: 409 });

  const proposalId = await stage(
    "propose",
    changes.adminPropose(actor, {
      orderId: input.orderId,
      requestId: id,
      expectedVersion: 1,
      shipments: [
        {
          shipmentId: "milestone-change",
          destination: input.requested.destination,
          carrierName: "DHL",
          serviceName: "Express",
          transportMethod: "Air",
          incoterm: "DAP",
          namedPlace: "Portland",
          destinationTaxTreatment: "Buyer pays import taxes",
          readyDate: "2026-09-26",
          allocations: [{ lineId: "line-change", physicalQuantity: 2 }],
        },
      ],
      adjustmentCents: 1200,
      reason: "Reviewed express service and tax responsibility",
      expiresAt: "2026-10-01T12:00:00.000Z",
      commandId: crypto.randomUUID(),
    }),
  );
  const proposed = (await changes.customerRead("buyer", input.orderId))[0];
  expect(proposed).toMatchObject({
    status: "proposed",
    currentProposalId: proposalId,
    proposals: [{ id: proposalId, adjustmentCents: 1200 }],
  });
  const proposalHash = proposed.proposals[0].proposalHash;
  await expect(
    changes.customerAccept("buyer", {
      orderId: input.orderId,
      requestId: id,
      proposalId,
      proposalHash,
      expectedVersion: 1,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  const acceptance = {
    orderId: input.orderId,
    requestId: id,
    proposalId,
    proposalHash,
    expectedVersion: 2,
    commandId: crypto.randomUUID(),
  };
  const acceptanceId = await stage(
    "accept",
    changes.customerAccept("buyer", acceptance),
  );
  expect(await changes.customerAccept("buyer", acceptance)).toBe(acceptanceId);
  expect((await changes.adminRead(actor, input.orderId))[0].status).toBe(
    "accepted",
  );
  expect(
    await db
      .prepare(
        `SELECT count(*) AS n FROM order_shipping_change_effective WHERE request_id=?`,
      )
      .bind(id)
      .first("n"),
  ).toBe(0);
  await expect(
    changes.adminApply(actor, {
      orderId: input.orderId,
      requestId: id,
      proposalId,
      expectedVersion: 2,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  const apply = {
    orderId: input.orderId,
    requestId: id,
    proposalId,
    expectedVersion: 3,
    commandId: crypto.randomUUID(),
  };
  changeTime = "2026-10-02T12:00:00.000Z";
  const effectId = await stage("apply", changes.adminApply(actor, apply));
  expect(await changes.adminApply(actor, apply)).toBe(effectId);
  expect((await changes.customerRead("buyer", input.orderId))[0].status).toBe(
    "effective",
  );
  expect(
    await db
      .prepare(
        `SELECT sum(physical_quantity) AS n FROM order_quantity_holds
     WHERE shipment_id='milestone-change' AND active=1`,
      )
      .first("n"),
  ).toBe(null);
  expect(
    await db
      .prepare(
        `SELECT current_estimate_date FROM order_shipment_ready_schedules
     WHERE shipment_id='milestone-change'`,
      )
      .first("current_estimate_date"),
  ).toBe("2026-09-26");
  expect(
    await db
      .prepare(
        `SELECT adjustment_cents FROM order_shipping_change_effective WHERE id=?`,
      )
      .bind(effectId)
      .first("adjustment_cents"),
  ).toBe(1200);
  const milestone = createShipmentMilestoneService(db, {
    now: () => new Date(clock),
  });
  const handoff = {
    orderId: input.orderId,
    shipmentId: "milestone-change",
    expectedVersion: 3,
    commandId: crypto.randomUUID(),
    handoffAt: clock,
    carrierName: "DHL",
    source: "Carrier receipt",
  };
  await expect(milestone.markShipped(actor, handoff)).rejects.toMatchObject({
    status: 409,
  });
  const revisedReady = (await milestone.adminRead(actor, input.orderId))[3];
  expect(
    "revisedReadyReview" in revisedReady &&
      revisedReady.revisedReadyReview?.verifiedAt,
  ).toBe(null);
  await changes.adminVerifyRevisedReady(actor, {
    orderId: input.orderId,
    shipmentId: "milestone-change",
    effectiveChangeId: effectId,
    expectedShipmentVersion: 3,
    commandId: crypto.randomUUID(),
    verification: {
      specificationsVerified: true,
      quantitiesVerified: true,
      offlinePreparationVerified: true,
      requiredInspectionVerified: true,
    },
  });
  expect(
    await stage(
      "ship after re-verification",
      milestone.markShipped(actor, handoff),
    ),
  ).toBe(4);
  const unchangedOrder = await db
    .prepare(
      `SELECT snapshot_json,snapshot_hash FROM confirmed_orders WHERE id='milestone-order'`,
    )
    .first<{ snapshot_json: string; snapshot_hash: string }>();
  expect(unchangedOrder?.snapshot_hash).toBe(
    await piSha256(new TextEncoder().encode(unchangedOrder!.snapshot_json)),
  );
});

it("reallocates only affected batches and reserves a credit without a payment receipt", async () => {
  await db.batch([
    db.prepare(
      `INSERT INTO confirmed_order_lines
       (order_id,line_id,line_number,line_kind,snapshot_json)
       VALUES ('milestone-order','line-reallocate',5,'standard',
         '{"id":"line-reallocate","quantity":3,"sku":"MOVE","displayName":"Move part"}')`,
    ),
    ...(["change-a", "change-b"] as const).map((id, index) =>
      db
        .prepare(
          `INSERT INTO order_shipments
       (id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
       VALUES (?,'milestone-order',?,?,?, ?,?,?)`,
        )
        .bind(
          id,
          id,
          index + 5,
          `Batch ${index + 1}`,
          JSON.stringify({
            id,
            allocations: [
              {
                lineId: "line-reallocate",
                physicalQuantity: index + 1,
              },
            ],
          }),
          clock,
          clock,
        ),
    ),
    ...(["change-a", "change-b"] as const).map((id, index) =>
      db
        .prepare(
          `INSERT INTO order_shipment_allocations
       (shipment_id,order_id,line_id,physical_quantity)
       VALUES (?,'milestone-order','line-reallocate',?)`,
        )
        .bind(id, index + 1),
    ),
  ]);
  const changes = createOrderShippingChangeService(db, {
    now: () => new Date(clock),
  });
  const requestId = await changes.customerSubmit("buyer", {
    orderId: "milestone-order",
    kind: "shipping_plan",
    requested: { note: "Move one unit to the first batch" },
    shipments: ["change-a", "change-b"].map((shipmentId) => ({
      shipmentId,
      expectedVersion: 1,
    })),
    commandId: crypto.randomUUID(),
  });
  const destination = {
    recipientName: "Test Buyer",
    addressLine1: "1 Old Street",
    city: "Portland",
    stateProvince: "OR",
    postalCode: "97201",
    countryCode: "US",
  };
  const proposedShipments = ["change-a", "change-b"].map(
    (shipmentId, index) => ({
      shipmentId,
      destination,
      carrierName: "UPS",
      serviceName: "Ground",
      transportMethod: "Sea",
      incoterm: "DDP",
      namedPlace: "Portland",
      destinationTaxTreatment: "Not Collected",
      readyDate: null,
      allocations: [{ lineId: "line-reallocate", physicalQuantity: 2 - index }],
    }),
  );
  const firstProposalId = await stage(
    "credit proposal",
    changes.adminPropose(actor, {
      orderId: "milestone-order",
      requestId,
      expectedVersion: 1,
      shipments: proposedShipments,
      adjustmentCents: -250,
      reason: "Move one unit; refund unused freight",
      expiresAt: "2026-10-01T12:00:00.000Z",
      commandId: crypto.randomUUID(),
    }),
  );
  const firstProposal = (
    await changes.customerRead("buyer", "milestone-order")
  ).find((item) => item.id === requestId)!.proposals[0];
  const proposalId = await changes.adminPropose(actor, {
    orderId: "milestone-order",
    requestId,
    expectedVersion: 2,
    shipments: proposedShipments.map((item) => ({
      ...item,
      serviceName: "Ground Plus",
    })),
    adjustmentCents: -250,
    reason: "Move one unit; updated carrier service and refund",
    expiresAt: "2026-10-01T12:00:00.000Z",
    commandId: crypto.randomUUID(),
  });
  await expect(
    changes.customerAccept("buyer", {
      orderId: "milestone-order",
      requestId,
      proposalId: firstProposalId,
      proposalHash: firstProposal.proposalHash,
      expectedVersion: 3,
      commandId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  const proposed = (
    await changes.customerRead("buyer", "milestone-order")
  ).find((item) => item.id === requestId)!;
  await changes.customerAccept("buyer", {
    orderId: "milestone-order",
    requestId,
    proposalId,
    proposalHash: proposed.proposals[1].proposalHash,
    expectedVersion: 3,
    commandId: crypto.randomUUID(),
  });
  const effectId = await stage(
    "credit apply",
    changes.adminApply(actor, {
      orderId: "milestone-order",
      requestId,
      proposalId,
      expectedVersion: 4,
      commandId: crypto.randomUUID(),
    }),
  );
  const allocations = (
    await db
      .prepare(
        `SELECT shipment_id,physical_quantity FROM order_shipment_allocations
     WHERE line_id='line-reallocate' ORDER BY shipment_id`,
      )
      .all<{ shipment_id: string; physical_quantity: number }>()
  ).results;
  expect(allocations).toEqual([
    { shipment_id: "change-a", physical_quantity: 2 },
    { shipment_id: "change-b", physical_quantity: 1 },
  ]);
  const reservation = await db
    .prepare(
      "SELECT id,due_cents FROM order_shipping_change_refund_reservations WHERE effective_change_id=?",
    )
    .bind(effectId)
    .first<{ id: string; due_cents: number }>();
  expect(reservation?.due_cents).toBe(250);
  expect(
    await db
      .prepare(
        "SELECT uninitiated_refund_cents FROM order_change_financial_contract WHERE order_id='milestone-order'",
      )
      .first("uninitiated_refund_cents"),
  ).toBe(250);
  const finances = createPiFundResolutionService(db);
  expect((await finances.read(actor, "milestone-pi")).availableCents).toBe(0);
  await expect(
    db
      .prepare(
        `INSERT INTO pi_fund_resolutions
     (id,command_id,command_hash,kind,source_pi_id,amount_cents,currency,
      source_version,customer_authorization,external_reference,original_channel,
      actor_id,resolved_at)
     VALUES (?,?,?,'external_refund','milestone-pi',250,'USD',1,
       'Buyer authorized','wrong-surplus','bank_transfer',?,?)`,
      )
      .bind(crypto.randomUUID(), crypto.randomUUID(), hash, actor.id, clock)
      .run(),
  ).rejects.toThrow(/Shipping refund reservation/);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'order_shipping_change_funding%'",
      )
      .first("n"),
  ).toBe(0);
  expect(
    await db
      .prepare(
        "SELECT sum(physical_quantity) AS n FROM order_quantity_holds WHERE order_id='milestone-order' AND active=1 AND line_id='line-reallocate'",
      )
      .first("n"),
  ).toBe(null);

  const withdrawId = await changes.customerSubmit("buyer", {
    orderId: "milestone-order",
    kind: "shipping_plan",
    requested: { note: "Reconsider first batch" },
    shipments: [{ shipmentId: "change-a", expectedVersion: 2 }],
    commandId: crypto.randomUUID(),
  });
  await changes.customerWithdraw("buyer", {
    orderId: "milestone-order",
    requestId: withdrawId,
    expectedVersion: 1,
    reason: "No longer needed",
    commandId: crypto.randomUUID(),
  });
  expect(
    (await changes.customerRead("buyer", "milestone-order")).find(
      (item) => item.id === withdrawId,
    )?.status,
  ).toBe("withdrawn");
  const declineId = await changes.customerSubmit("buyer", {
    orderId: "milestone-order",
    kind: "shipping_plan",
    requested: { note: "Reconsider second batch" },
    shipments: [{ shipmentId: "change-b", expectedVersion: 2 }],
    commandId: crypto.randomUUID(),
  });
  const decline = {
    orderId: "milestone-order",
    requestId: declineId,
    expectedVersion: 1,
    reason: "Carrier has no alternate service",
    commandId: crypto.randomUUID(),
  };
  await changes.adminDecline(actor, decline);
  await changes.adminDecline(actor, decline);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM order_shipping_change_active_shipments WHERE request_id IN (?,?)",
      )
      .bind(withdrawId, declineId)
      .first("n"),
  ).toBe(0);
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM quote_conversation_messages WHERE command_id=?",
      )
      .bind(`shipping-change-declined:${decline.commandId}`)
      .first("n"),
  ).toBe(1);

  await db
    .prepare(
      `INSERT INTO order_shipping_change_refund_initiations
     (id,reservation_id,amount_cents,external_reference,actor_id,initiated_at,command_id)
     VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      reservation!.id,
      250,
      "bank-refund-1",
      actor.id,
      clock,
      crypto.randomUUID(),
    )
    .run();
  expect(
    await db
      .prepare(
        "SELECT refunded_cents FROM pi_payment_accounts WHERE pi_id='milestone-pi'",
      )
      .first("refunded_cents"),
  ).toBe(250);
  expect(
    (await changes.customerRead("buyer", "milestone-order")).find(
      (item) => item.id === requestId,
    )?.proposals[1].refundInitiatedCents,
  ).toBe(250);
  const afterRefund = await finances.read(actor, "milestone-pi");
  expect(afterRefund.shortfallCents).toBe(0);
  expect(afterRefund.availableCents).toBe(0);
  await expect(
    db
      .prepare(
        `INSERT INTO order_shipping_change_refund_initiations
     (id,reservation_id,amount_cents,external_reference,actor_id,initiated_at,command_id)
     VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        reservation!.id,
        1,
        "duplicate-refund",
        actor.id,
        clock,
        crypto.randomUUID(),
      )
      .run(),
  ).rejects.toThrow();
  const correction = createPiPaymentCorrectionService(db, {
    now: () => new Date(clock),
  });
  const version = await db
    .prepare(
      "SELECT version FROM pi_payment_accounts WHERE pi_id='milestone-pi'",
    )
    .first<number>("version");
  await correction.correct(actor, {
    piId: "milestone-pi",
    commandId: crypto.randomUUID(),
    expectedVersion: version!,
    correctedAmount: "102.50",
    reason: "Reconcile original receipt after authorized shipping credit",
  });
  const review = await correction.read(actor, "milestone-pi");
  const dispute = review.disputes.find(
    (item) => (item as { active: number }).active === 1,
  ) as
    | {
        correction_id: string;
      }
    | undefined;
  expect(dispute).toBeDefined();
  await stage(
    "resolve after lawful refund",
    correction.resolve(actor, {
      piId: "milestone-pi",
      correctionId: dispute!.correction_id,
      commandId: crypto.randomUUID(),
      expectedVersion: version! + 1,
      reason: "Original receipt remains fully verified after authorized credit",
      verificationReference: "bank-review-1",
    }),
  );
  expect((await correction.read(actor, "milestone-pi")).confirmationValid).toBe(
    true,
  );
});

it("keeps cancellation and shipping-change holds scoped to their own physical lines", async () => {
  await db
    .prepare(
      "UPDATE order_release_guards SET held=0,updated_at=? WHERE order_id='milestone-order'",
    )
    .bind(clock)
    .run();
  await db.batch([
    db.prepare(
      `INSERT INTO confirmed_order_lines
       (order_id,line_id,line_number,line_kind,snapshot_json)
       VALUES ('milestone-order','spec7-assembly-line',6,'hose_assembly',
         '{"id":"spec7-assembly-line","quantity":2,"sku":"ASSEMBLY","displayName":"Assembly"}')`,
    ),
    db.prepare(
      `INSERT INTO confirmed_order_lines
       (order_id,line_id,line_number,line_kind,snapshot_json)
       VALUES ('milestone-order','spec7-cut-line',7,'length_based_hose',
         '{"id":"spec7-cut-line","quantity":50,"sku":"CUT","displayName":"Cut hose","lengthOrder":{"pieceCount":3,"pieceLengthFeet":10}}')`,
    ),
    ...(["spec7-assembly", "spec7-cut"] as const).map((shipmentId, index) =>
      db
        .prepare(
          `INSERT INTO order_shipments
       (id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
       VALUES (?,'milestone-order',?,?,?, ?,?,?)`,
        )
        .bind(
          shipmentId,
          shipmentId,
          index + 7,
          index === 0 ? "Assembly batch" : "Cut-hose batch",
          JSON.stringify({
            id: shipmentId,
            allocations: [
              {
                lineId: index === 0 ? "spec7-assembly-line" : "spec7-cut-line",
                physicalQuantity: index === 0 ? 2 : 3,
              },
            ],
          }),
          clock,
          clock,
        ),
    ),
    db.prepare(
      `INSERT INTO order_shipment_allocations
       (shipment_id,order_id,line_id,physical_quantity)
       VALUES ('spec7-assembly','milestone-order','spec7-assembly-line',2)`,
    ),
    db.prepare(
      `INSERT INTO order_shipment_allocations
       (shipment_id,order_id,line_id,physical_quantity)
       VALUES ('spec7-cut','milestone-order','spec7-cut-line',3)`,
    ),
  ]);
  const milestones = createShipmentMilestoneService(db, {
    now: () => new Date(clock),
  });
  const verification = {
    specificationsVerified: true,
    quantitiesVerified: true,
    offlinePreparationVerified: true,
    requiredInspectionVerified: true,
  };
  for (const shipmentId of ["spec7-assembly", "spec7-cut"])
    await stage(
      `ready ${shipmentId}`,
      milestones.markReady(actor, {
        orderId: "milestone-order",
        shipmentId,
        expectedVersion: 1,
        commandId: crypto.randomUUID(),
        verification,
      }),
    );

  const changes = createOrderShippingChangeService(db, {
    now: () => new Date(clock),
  });
  const requestId = await stage(
    "spec7 submit",
    changes.customerSubmit("buyer", {
      orderId: "milestone-order",
      kind: "shipping_plan",
      requested: { note: "Review the assembly batch carrier" },
      shipments: [{ shipmentId: "spec7-assembly", expectedVersion: 2 }],
      commandId: crypto.randomUUID(),
    }),
  );
  await db
    .prepare(
      `INSERT INTO order_quantity_holds
       (id,order_id,line_id,shipment_id,physical_quantity,kind,reason,created_at)
       VALUES ('spec7-cancellation-hold','milestone-order','spec7-cut-line',
         'spec7-cut',1,'cancellation','Spec 7 consumer fixture',?)`,
    )
    .bind(clock)
    .run();
  await expect(
    milestones.markShipped(actor, {
      orderId: "milestone-order",
      shipmentId: "spec7-cut",
      expectedVersion: 2,
      commandId: crypto.randomUUID(),
      handoffAt: clock,
      carrierName: "DHL",
      source: "Carrier receipt",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await db
    .prepare(
      `UPDATE order_quantity_holds SET active=0,resolved_at=?
       WHERE id='spec7-cancellation-hold'`,
    )
    .bind(clock)
    .run();
  expect(
    await db
      .prepare(
        `SELECT count(*) AS n FROM order_quantity_holds
         WHERE shipment_id='spec7-assembly' AND active=1`,
      )
      .first("n"),
  ).toBe(1);
  await stage(
    "spec7 dispatch",
    milestones.markShipped(actor, {
      orderId: "milestone-order",
      shipmentId: "spec7-cut",
      expectedVersion: 2,
      commandId: crypto.randomUUID(),
      handoffAt: clock,
      carrierName: "DHL",
      source: "Carrier receipt",
    }),
  );
  await stage(
    "spec7 delivery",
    milestones.markDelivered(actor, {
      orderId: "milestone-order",
      shipmentId: "spec7-cut",
      expectedVersion: 3,
      commandId: crypto.randomUUID(),
      actualDate: "2026-09-24",
      source: "Customer receipt",
    }),
  );
  expect(
    await db
      .prepare(
        `SELECT count(*) AS n FROM shipment_milestone_events
         WHERE shipment_id='spec7-assembly' AND kind='delivered'`,
      )
      .first("n"),
  ).toBe(0);
  expect(
    await db
      .prepare(
        `SELECT json_extract(snapshot_json,'$.lengthOrder.pieceCount') AS pieces
         FROM confirmed_order_lines WHERE line_id='spec7-cut-line'`,
      )
      .first("pieces"),
  ).toBe(3);
  await stage(
    "spec7 withdraw",
    changes.customerWithdraw("buyer", {
      orderId: "milestone-order",
      requestId,
      expectedVersion: 1,
      reason: "Fixture resolved",
      commandId: crypto.randomUUID(),
    }),
  );
});
