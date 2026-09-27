import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";

import { piSha256 } from "../../app/modules/proforma-invoice/domain/proforma-invoice";
import { createShipmentMilestoneService } from "../../app/modules/shipment/application/shipment-milestone-service";
import type { AdminIdentity } from "../../workers/admin-access";

export const fixtureClock = "2026-09-24T12:00:00.000Z";
const hash = "a".repeat(64);

export const owner: AdminIdentity = {
  id: "after-sales-owner",
  email: "owner@example.test",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
export const reviewer: AdminIdentity = {
  id: "after-sales-reviewer",
  email: "reviewer@example.test",
  accountType: "subaccount",
  canManageSubaccounts: false,
  permissions: ["after_sales.review"],
  source: "local-development",
};
export const refunder: AdminIdentity = {
  id: "after-sales-refunder",
  email: "refunder@example.test",
  accountType: "subaccount",
  canManageSubaccounts: false,
  permissions: ["after_sales.review", "after_sales.refund"],
  source: "local-development",
};
export const unprivileged: AdminIdentity = {
  id: "after-sales-plain",
  email: "plain@example.test",
  accountType: "subaccount",
  canManageSubaccounts: false,
  source: "local-development",
};

export async function startAfterSalesDatabase(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `${label}-`));
  const migration = spawnSync("pnpm", ["migrate"], {
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  if (migration.status !== 0)
    throw new Error(migration.stdout + migration.stderr);
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "wrangler.jsonc",
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  const db = platform.env.DB;
  await run(
    db,
    `INSERT INTO customer_profiles
       (id,email_normalized,email_display,email_verified_at,created_at,updated_at)
     VALUES ('buyer','buyer@example.test','buyer@example.test','${fixtureClock}','${fixtureClock}','${fixtureClock}'),
       ('other','other@example.test','other@example.test','${fixtureClock}','${fixtureClock}','${fixtureClock}');
     INSERT INTO customer_purchasing_contexts
       (id,kind,individual_profile_id,created_at,updated_at)
     VALUES ('buyer-context','individual','buyer','${fixtureClock}','${fixtureClock}'),
       ('other-context','individual','other','${fixtureClock}','${fixtureClock}');
     INSERT INTO seller_payment_instruction_versions
       (id,channel,version,instructions,status,command_id,created_by,created_at)
     VALUES ('after-sales-payment','bank_transfer',1,'Test bank','current',
       'after-sales-payment-command','test','${fixtureClock}')`,
  );
  return {
    db,
    async dispose() {
      await platform.dispose();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function run(db: D1Database, sql: string) {
  await db.batch(
    sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement)),
  );
}

export interface SeededOrder {
  orderId: string;
  requestId: string;
  piId: string;
  shipments: { first: string; second: string };
  lines: {
    standard: string;
    standardSecond: string;
    madeToOrderStandard: string;
    cutHose: string;
    assembly: string;
  };
  totalCents: number;
}

/**
 * Seeds a paid, confirmed mixed Order:
 * - Shipment first: standard x2, standard-second x2, made-to-order standard x1
 * - Shipment second: standard x1, cut hose 4 pieces @ 10 ft, assembly x1
 */
export async function seedAfterSalesOrder(
  db: D1Database,
  prefix: string,
  options: { receivedCents?: number } = {},
): Promise<SeededOrder> {
  const p = prefix;
  const lines = [
    {
      id: `${p}-std`,
      kind: "standard",
      snapshot: {
        id: `${p}-std`,
        sku: "STD-A",
        displayName: "Straight fitting",
        lineKind: "standard",
        quantity: 3,
        madeToOrder: false,
        price: { unitPriceCents: 1000, discountBasisPoints: 1000 },
        totals: {
          quantity: 3,
          undiscountedCents: 3000,
          discountCents: 300,
          totalCents: 2700,
        },
      },
    },
    {
      id: `${p}-std2`,
      kind: "standard",
      snapshot: {
        id: `${p}-std2`,
        sku: "STD-B",
        displayName: "Adapter",
        lineKind: "standard",
        quantity: 2,
        madeToOrder: false,
        price: { unitPriceCents: 2500, discountBasisPoints: 0 },
        totals: {
          quantity: 2,
          undiscountedCents: 5000,
          discountCents: 0,
          totalCents: 5000,
        },
      },
    },
    {
      id: `${p}-mto`,
      kind: "standard",
      snapshot: {
        id: `${p}-mto`,
        sku: "STD-MTO",
        displayName: "Special order valve",
        lineKind: "standard",
        quantity: 1,
        madeToOrder: true,
        price: { unitPriceCents: 4000, discountBasisPoints: 0 },
        totals: {
          quantity: 1,
          undiscountedCents: 4000,
          discountCents: 0,
          totalCents: 4000,
        },
      },
    },
    {
      id: `${p}-cut`,
      kind: "length_based_hose",
      snapshot: {
        id: `${p}-cut`,
        sku: "HOSE-CUT",
        displayName: "Cut hose",
        lineKind: "length_based_hose",
        quantity: 40,
        madeToOrder: true,
        lengthOrder: {
          normalizedLengthFt: 10,
          originalLengthUnit: "ft",
          originalLengthValue: 10,
          pieceCount: 4,
          totalFootage: 40,
        },
        price: { unitPriceCents: 200, discountBasisPoints: 0 },
        totals: {
          quantity: 40,
          undiscountedCents: 8000,
          discountCents: 0,
          totalCents: 8000,
        },
      },
    },
    {
      id: `${p}-asm`,
      kind: "configured_assembly",
      snapshot: {
        id: `${p}-asm`,
        sku: "ASM-1",
        displayName: "Hose assembly",
        lineKind: "configured_assembly",
        quantity: 1,
        madeToOrder: true,
        price: { unitPriceCents: 6000, discountBasisPoints: 0 },
        totals: {
          quantity: 1,
          undiscountedCents: 6000,
          discountCents: 0,
          totalCents: 6000,
        },
      },
    },
  ];
  const charges = {
    freight: 3000,
    insurance: 0,
    dutiesImport: 1500,
    salesTax: 0,
    cuttingLabeling: 800,
    assemblyService: 0,
    protectionService: 0,
  };
  const totalCents = 25700 + 3000 + 1500 + 800;
  const orderSnapshot = JSON.stringify({
    destination: {
      recipientName: "Test Buyer",
      addressLine1: "1 Test Street",
      city: "Portland",
      stateProvince: "OR",
      postalCode: "97201",
      countryCode: "US",
    },
    lines: lines.map((line) => line.snapshot),
    terms: {
      transportMethod: "Sea",
      incoterm: "DDP",
      namedPlace: "Portland",
      taxTreatment: "Not Collected",
      charges,
    },
    totals: {
      currency: "USD",
      merchandiseCents: 26000,
      discountCents: 300,
      totalCents,
    },
    conditions: {
      madeToOrderAcknowledgements: [
        { lineId: `${p}-mto` },
        { lineId: `${p}-cut` },
        { lineId: `${p}-asm` },
      ],
    },
  });
  const orderHash = await piSha256(new TextEncoder().encode(orderSnapshot));
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO customer_quote_requests
         (id,reference_number,profile_id,purchasing_context_id,source_session_id,
          source_session_version,source_address_id,purchasing_context_kind,
          fulfillment_term,currency,merchandise_subtotal,service_fee_total,
          idempotency_key,snapshot_json,submitted_at)
         VALUES (?,?,'buyer','buyer-context',?,'1',?,'individual','DDP','USD',100,0,?,'{}',?)`,
      )
      .bind(
        `${p}-request`,
        `QR-${p}`,
        `${p}-session`,
        `${p}-address`,
        `${p}-key`,
        fixtureClock,
      ),
    db
      .prepare(
        `INSERT INTO quote_revisions
         (id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,
          command_id,command_hash,issued_by,issued_at)
         VALUES (?,?,1,1,'{}',?,?,?,'test',?)`,
      )
      .bind(
        `${p}-revision`,
        `${p}-request`,
        hash,
        `${p}-revision-command`,
        hash,
        fixtureClock,
      ),
    db
      .prepare(
        `INSERT INTO proforma_invoice_intents
         (id,command_id,command_hash,request_id,quote_revision_id,quote_revision_hash,
          source_revision_json,seller_identity_id,seller_version,payment_instruction_id,
          payment_instruction_version,payment_channel,snapshot_json,snapshot_hash,
          issued_by,issued_at,valid_until)
         VALUES (?,?,?,?,?,?,'{}','seller-identity-initial',1,'after-sales-payment',1,
           'bank_transfer','{}',?,'test',?,'2026-10-24T12:00:00.000Z')`,
      )
      .bind(
        `${p}-pi`,
        `${p}-pi-command`,
        hash,
        `${p}-request`,
        `${p}-revision`,
        hash,
        hash,
        fixtureClock,
      ),
    db
      .prepare(
        `INSERT INTO proforma_invoices
         (id,request_id,quote_revision_id,document_number,document_version,
          snapshot_json,snapshot_hash,pdf_object_key,pdf_sha256,pdf_byte_size,
          pdf_page_count,pdf_renderer_version,payment_channel,issued_by,issued_at,valid_until)
         VALUES (?,?,?,?,1,'{}',?,?,?,1,1,'legacy','bank_transfer','test',?,
           '2026-10-24T12:00:00.000Z')`,
      )
      .bind(
        `${p}-pi`,
        `${p}-request`,
        `${p}-revision`,
        `PI-${p}`,
        hash,
        `pi/${p}.pdf`,
        hash,
        fixtureClock,
      ),
    db
      .prepare(
        `INSERT INTO pi_customer_views
         (id,pi_id,request_id,profile_id,purchasing_context_id,document_version,
          snapshot_hash,pdf_sha256,pdf_byte_size,kind,occurred_at,request_evidence_json)
         VALUES (?,?,?,'buyer','buyer-context',1,?,?,1,'view',?,'{}')`,
      )
      .bind(`${p}-view`, `${p}-pi`, `${p}-request`, hash, hash, fixtureClock),
    db
      .prepare(
        `INSERT INTO pi_acceptances
         (id,pi_id,request_id,profile_id,purchasing_context_id,source,document_version,
          snapshot_hash,quote_revision_id,view_id,accepted_at,business_hash,evidence_json)
         VALUES (?,?,?,'buyer','buyer-context','website',1,?,?,?,?,?,'{}')`,
      )
      .bind(
        `${p}-acceptance`,
        `${p}-pi`,
        `${p}-request`,
        hash,
        `${p}-revision`,
        `${p}-view`,
        fixtureClock,
        hash,
      ),
    db
      .prepare(
        `INSERT INTO pi_payment_confirmations
         (id,command_id,command_hash,pi_id,confirmed_cents,currency,actual_channel,
          external_reference,actor_id,confirmed_at)
         VALUES (?,?,?,?,?,'USD','bank_transfer',?,'test',?)`,
      )
      .bind(
        `${p}-confirmation`,
        `${p}-confirmation-command`,
        hash,
        `${p}-pi`,
        totalCents,
        `ref-${p}`,
        fixtureClock,
      ),
    db
      .prepare(
        `INSERT INTO pi_payment_accounts
         (pi_id,request_id,purchasing_context_id,currency,total_due_cents,
          term_kind,amount_received_cents,actual_channel,ever_received,
          instruction_channel,instruction_id,instruction_version,created_at,updated_at)
         VALUES (?,?,'buyer-context','USD',?,'legacy_review',?,'bank_transfer',1,
           'bank_transfer','after-sales-payment',1,?,?)`,
      )
      .bind(
        `${p}-pi`,
        `${p}-request`,
        totalCents,
        options.receivedCents ?? totalCents,
        fixtureClock,
        fixtureClock,
      ),
    db
      .prepare(
        `INSERT INTO confirmed_orders
         (id,order_number,request_id,pi_id,purchasing_context_id,acceptance_id,
          confirmation_id,snapshot_json,snapshot_hash,currency,total_cents,confirmed_at)
         VALUES (?,?,?,?,'buyer-context',?,?,?,?,'USD',?,?)`,
      )
      .bind(
        `${p}-order`,
        `ORDER-${p}`,
        `${p}-request`,
        `${p}-pi`,
        `${p}-acceptance`,
        `${p}-confirmation`,
        orderSnapshot,
        orderHash,
        totalCents,
        fixtureClock,
      ),
    ...lines.map((line, index) =>
      db
        .prepare(
          `INSERT INTO confirmed_order_lines
           (order_id,line_id,line_number,line_kind,snapshot_json)
           VALUES (?,?,?,?,?)`,
        )
        .bind(
          `${p}-order`,
          line.id,
          index + 1,
          line.kind,
          JSON.stringify(line.snapshot),
        ),
    ),
    db
      .prepare(
        `INSERT INTO order_fulfillment_plans
         (order_id,status,source,source_text,version,created_at,updated_at)
         VALUES (?,'ready','accepted_structured','',1,?,?)`,
      )
      .bind(`${p}-order`, fixtureClock, fixtureClock),
  ];
  const shipments = [
    {
      id: `${p}-s1`,
      key: "first",
      sequence: 1,
      name: "Shipment 1",
      allocations: [
        [`${p}-std`, 2],
        [`${p}-std2`, 2],
        [`${p}-mto`, 1],
      ],
    },
    {
      id: `${p}-s2`,
      key: "second",
      sequence: 2,
      name: "Shipment 2",
      allocations: [
        [`${p}-std`, 1],
        [`${p}-cut`, 4],
        [`${p}-asm`, 1],
      ],
    },
  ] as const;
  for (const shipment of shipments) {
    statements.push(
      db
        .prepare(
          `INSERT INTO order_shipments
           (id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          shipment.id,
          `${p}-order`,
          shipment.key,
          shipment.sequence,
          shipment.name,
          JSON.stringify({
            id: shipment.key,
            allocations: shipment.allocations.map(([lineId, quantity]) => ({
              lineId,
              physicalQuantity: quantity,
            })),
          }),
          fixtureClock,
          fixtureClock,
        ),
      ...shipment.allocations.map(([lineId, quantity]) =>
        db
          .prepare(
            `INSERT INTO order_shipment_allocations
             (shipment_id,order_id,line_id,physical_quantity) VALUES (?,?,?,?)`,
          )
          .bind(shipment.id, `${p}-order`, lineId, quantity),
      ),
    );
  }
  await db.batch(statements);
  return {
    orderId: `${p}-order`,
    requestId: `${p}-request`,
    piId: `${p}-pi`,
    shipments: { first: `${p}-s1`, second: `${p}-s2` },
    lines: {
      standard: `${p}-std`,
      standardSecond: `${p}-std2`,
      madeToOrderStandard: `${p}-mto`,
      cutHose: `${p}-cut`,
      assembly: `${p}-asm`,
    },
    totalCents,
  };
}

const verification = {
  specificationsVerified: true,
  quantitiesVerified: true,
  offlinePreparationVerified: true,
  requiredInspectionVerified: true,
};

/** Drives a Shipment through the real Spec 6 milestone commands. */
export async function shipShipment(
  db: D1Database,
  orderId: string,
  shipmentId: string,
  input: { handoffAt: string; deliveredDate?: string; now?: string },
) {
  const at = (instant: string) =>
    createShipmentMilestoneService(db, { now: () => new Date(instant) });
  const current = await db
    .prepare("SELECT version FROM order_shipments WHERE id=?")
    .bind(shipmentId)
    .first<{ version: number }>();
  let version = current!.version;
  const readyAt = new Date(Date.parse(input.handoffAt) - 3_600_000);
  version = await at(readyAt.toISOString()).markReady(owner, {
    orderId,
    shipmentId,
    expectedVersion: version,
    commandId: crypto.randomUUID(),
    verification,
  });
  version = await at(input.handoffAt).markShipped(owner, {
    orderId,
    shipmentId,
    expectedVersion: version,
    commandId: crypto.randomUUID(),
    handoffAt: input.handoffAt,
    carrierName: "Test carrier",
    source: "Carrier receipt",
  });
  if (input.deliveredDate)
    version = await at(
      input.now ?? `${input.deliveredDate}T20:00:00.000Z`,
    ).markDelivered(owner, {
      orderId,
      shipmentId,
      expectedVersion: version,
      commandId: crypto.randomUUID(),
      actualDate: input.deliveredDate,
      source: "Carrier proof of delivery",
    });
  return version;
}
