import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, expect, it } from "vitest";

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const wranglerBin = join(projectRoot, "node_modules", ".bin", "wrangler");
const contract = JSON.parse(
  readFileSync(
    join(projectRoot, "config", "database-schema-contract.json"),
    "utf8",
  ),
) as { migrations: string[]; schemaVersion: number };
const directory = mkdtempSync(join(tmpdir(), "after-sales-upgrade-"));
const migrations = join(directory, "migrations");
const state = join(directory, "state");
const configPath = join(directory, "wrangler.jsonc");

afterAll(() => rmSync(directory, { recursive: true, force: true }));

function wrangler(args: string[]) {
  const result = spawnSync(
    wranglerBin,
    [...args, "--config", configPath, "--local", "--persist-to", state],
    {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CI: "1" },
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

function query<T>(sql: string) {
  const output = wrangler(["d1", "execute", "DB", "--command", sql, "--json"]);
  return (JSON.parse(output) as Array<{ results: T[] }>).at(-1)!.results;
}

function copy(filter: (name: string) => boolean) {
  for (const name of contract.migrations.filter(filter))
    copyFileSync(join(projectRoot, "migrations", name), join(migrations, name));
}

it("upgrades a Spec 6 database without losing notifications or double-counting shipping refunds", () => {
  mkdirSync(migrations);
  writeFileSync(
    configPath,
    JSON.stringify({
      compatibility_date: "2026-08-15",
      d1_databases: [
        {
          binding: "DB",
          database_name: "after-sales-upgrade",
          migrations_dir: migrations,
        },
      ],
      name: "after-sales-upgrade",
    }),
  );
  copy((name) => name < "0115");
  wrangler(["d1", "migrations", "apply", "DB"]);
  const now = "2026-09-01T12:00:00.000Z";
  const hash = "a".repeat(64);
  const seed = `
      INSERT INTO customer_profiles (id,email_normalized,email_display,email_verified_at,created_at,updated_at)
        VALUES ('up-buyer','up@example.test','up@example.test','${now}','${now}','${now}');
      INSERT INTO customer_purchasing_contexts (id,kind,individual_profile_id,created_at,updated_at)
        VALUES ('up-context','individual','up-buyer','${now}','${now}');
      INSERT INTO seller_payment_instruction_versions (id,channel,version,instructions,status,command_id,created_by,created_at)
        VALUES ('up-pay','bank_transfer',1,'Bank','current','up-pay-cmd','test','${now}');
      INSERT INTO customer_quote_requests (id,reference_number,profile_id,purchasing_context_id,source_session_id,
        source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,
        merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at)
        VALUES ('up-request','QR-UP','up-buyer','up-context','s','1','a','individual','DDP','USD',100,0,'up-key','{}','${now}');
      INSERT INTO quote_revisions (id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,
        command_id,command_hash,issued_by,issued_at)
        VALUES ('up-rev','up-request',1,1,'{}','${hash}','up-rev-cmd','${hash}','test','${now}');
      INSERT INTO proforma_invoice_intents (id,command_id,command_hash,request_id,quote_revision_id,quote_revision_hash,
        source_revision_json,seller_identity_id,seller_version,payment_instruction_id,payment_instruction_version,
        payment_channel,snapshot_json,snapshot_hash,issued_by,issued_at,valid_until)
        VALUES ('up-pi','up-pi-cmd','${hash}','up-request','up-rev','${hash}','{}','seller-identity-initial',1,
        'up-pay',1,'bank_transfer','{}','${hash}','test','${now}','2026-10-01T00:00:00.000Z');
      INSERT INTO proforma_invoices (id,request_id,quote_revision_id,document_number,document_version,snapshot_json,
        snapshot_hash,pdf_object_key,pdf_sha256,pdf_byte_size,pdf_page_count,pdf_renderer_version,payment_channel,
        issued_by,issued_at,valid_until)
        VALUES ('up-pi','up-request','up-rev','PI-UP',1,'{}','${hash}','pi/up.pdf','${hash}',1,1,'legacy',
        'bank_transfer','test','${now}','2026-10-01T00:00:00.000Z');
      INSERT INTO pi_customer_views (id,pi_id,request_id,profile_id,purchasing_context_id,document_version,snapshot_hash,
        pdf_sha256,pdf_byte_size,kind,occurred_at,request_evidence_json)
        VALUES ('up-view','up-pi','up-request','up-buyer','up-context',1,'${hash}','${hash}',1,'view','${now}','{}');
      INSERT INTO pi_acceptances (id,pi_id,request_id,profile_id,purchasing_context_id,source,document_version,
        snapshot_hash,quote_revision_id,view_id,accepted_at,business_hash,evidence_json)
        VALUES ('up-acc','up-pi','up-request','up-buyer','up-context','website',1,'${hash}','up-rev','up-view',
        '${now}','${hash}','{}');
      INSERT INTO pi_payment_confirmations (id,command_id,command_hash,pi_id,confirmed_cents,currency,actual_channel,
        external_reference,actor_id,confirmed_at)
        VALUES ('up-conf','up-conf-cmd','${hash}','up-pi',10000,'USD','bank_transfer','ref','test','${now}');
      INSERT INTO pi_payment_accounts (pi_id,request_id,purchasing_context_id,currency,total_due_cents,term_kind,
        amount_received_cents,actual_channel,ever_received,instruction_channel,instruction_id,instruction_version,
        created_at,updated_at)
        VALUES ('up-pi','up-request','up-context','USD',10000,'legacy_review',10000,'bank_transfer',1,
        'bank_transfer','up-pay',1,'${now}','${now}');
      INSERT INTO confirmed_orders (id,order_number,request_id,pi_id,purchasing_context_id,acceptance_id,
        confirmation_id,snapshot_json,snapshot_hash,currency,total_cents,confirmed_at)
        VALUES ('up-order','ORDER-UP','up-request','up-pi','up-context','up-acc','up-conf','{}','${hash}',
        'USD',10000,'${now}');
      INSERT INTO confirmed_order_lines (order_id,line_id,line_number,line_kind,snapshot_json)
        VALUES ('up-order','up-line',1,'standard','{"quantity":2,"totals":{"totalCents":9000}}');
      INSERT INTO order_shipping_change_requests (id,order_id,profile_id,kind,status,requested_json,
        submission_command_id,submission_hash,created_at,updated_at,current_proposal_id)
        VALUES ('up-change','up-order','up-buyer','shipping_plan','proposed','{}','up-change-cmd','x',
        '${now}','${now}','up-proposal');
      INSERT INTO order_shipping_change_proposals (id,request_id,version,before_json,after_json,adjustment_cents,
        reason,expires_at,proposal_hash,command_id,command_hash,actor_id,published_at)
        VALUES ('up-proposal','up-change',1,'{}','{"shipments":[]}',-700,'Cheaper','2026-10-01T00:00:00Z',
        'h','up-p','h','owner','${now}');
      UPDATE order_shipping_change_requests SET status='accepted',version=2 WHERE id='up-change';
      INSERT INTO order_shipping_change_acceptances (id,request_id,proposal_id,profile_id,proposal_hash,
        command_id,command_hash,accepted_at)
        VALUES ('up-accept','up-change','up-proposal','up-buyer','h','up-a','h','${now}');
      INSERT INTO order_shipping_change_effective (id,order_id,request_id,proposal_id,proposal_hash,before_json,
        after_json,adjustment_cents,effective_at,command_id)
        VALUES ('up-effective','up-order','up-change','up-proposal','h','{}','{"shipments":[]}',-700,'${now}','up-e');
      INSERT INTO order_shipping_change_refund_reservations (id,effective_change_id,order_id,due_cents,reserved_at)
        VALUES ('up-reservation','up-effective','up-order',700,'${now}');
      INSERT INTO admin_notification_reads (notification_id,admin_id,read_at)
        VALUES ('shipping-change:up-change','owner','${now}');`;
  writeFileSync(join(directory, "seed.sql"), seed);
  wrangler(["d1", "execute", "DB", "--file", join(directory, "seed.sql")]);
  const beforeContract = query(
    "SELECT authorized_credit_cents,uninitiated_refund_cents FROM order_change_financial_contract WHERE order_id='up-order'",
  );
  const beforeNotifications = query(
    "SELECT id,kind,source_id FROM admin_notifications ORDER BY id",
  );
  expect(beforeContract).toEqual([
    { authorized_credit_cents: 700, uninitiated_refund_cents: 700 },
  ]);

  copy((name) => name >= "0115");
  wrangler(["d1", "migrations", "apply", "DB"]);
  expect(
    query<{ version: number }>(
      "SELECT version FROM application_schema_state WHERE singleton=1",
    )[0].version,
  ).toBe(contract.schemaVersion);
  expect(query("SELECT count(*) AS count FROM d1_migrations")[0]).toEqual({
    count: contract.migrations.length,
  });
  // Existing notifications and read receipts survive the table rebuild.
  expect(
    query("SELECT id,kind,source_id FROM admin_notifications ORDER BY id"),
  ).toEqual(beforeNotifications);
  expect(query("SELECT notification_id FROM admin_notification_reads")).toEqual(
    [{ notification_id: "shipping-change:up-change" }],
  );
  // The shipping credit is still counted exactly once.
  expect(
    query(
      "SELECT authorized_credit_cents,uninitiated_refund_cents FROM order_change_financial_contract WHERE order_id='up-order'",
    ),
  ).toEqual(beforeContract);
  // No after-sales records are fabricated by the upgrade.
  expect(
    query(`SELECT
        (SELECT count(*) FROM order_cancellation_requests) +
        (SELECT count(*) FROM after_sales_cases) +
        (SELECT count(*) FROM after_sales_refund_authorizations) +
        (SELECT count(*) FROM after_sales_refund_destinations) AS count`)[0],
  ).toEqual({ count: 0 });
  expect(
    query("SELECT count(*) AS count FROM pragma_foreign_key_check")[0],
  ).toEqual({ count: 0 });
}, 240_000);
