import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { createD1AdminNotifications } from "../app/modules/admin/infrastructure/d1-admin-notifications";

const directory = mkdtempSync(join(tmpdir(), "admin-notifications-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const hash = "a".repeat(64);

async function run(sql: string) {
  await db.batch(
    sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement)),
  );
}

function quoteRequest(id: string, reference: string, submittedAt: string) {
  return `INSERT INTO customer_quote_requests
      (id,reference_number,profile_id,purchasing_context_id,source_session_id,
       source_session_version,source_address_id,purchasing_context_kind,
       fulfillment_term,currency,merchandise_subtotal,service_fee_total,
       idempotency_key,snapshot_json,submitted_at)
    VALUES ('${id}','${reference}','buyer','buyer-context','${id}-session','1',
      '${id}-address','individual','DDP','USD',100,0,'${id}-key','{}','${submittedAt}')`;
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
  const clock = "2026-09-20T08:00:00.000Z";
  await run(`
    INSERT INTO customer_profiles
      (id,email_normalized,email_display,email_verified_at,created_at,updated_at)
    VALUES ('buyer','buyer@example.test','Buyer@example.test','${clock}','${clock}','${clock}');
    INSERT INTO customer_purchasing_contexts
      (id,kind,individual_profile_id,created_at,updated_at)
    VALUES ('buyer-context','individual','buyer','${clock}','${clock}');
    INSERT INTO seller_payment_instruction_versions
      (id,channel,version,instructions,status,command_id,created_by,created_at)
    VALUES ('notice-payment','bank_transfer',1,'Test bank','current',
      'notice-payment-command','test','${clock}');
    ${quoteRequest("ordered-request", "QR-ORDERED", clock)};
    INSERT INTO quote_revisions
      (id,request_id,revision_number,preparation_version,snapshot_json,snapshot_hash,
       command_id,command_hash,issued_by,issued_at)
    VALUES ('notice-revision','ordered-request',1,1,'{}','${hash}',
      'notice-revision-command','${hash}','test','${clock}');
    INSERT INTO proforma_invoice_intents
      (id,command_id,command_hash,request_id,quote_revision_id,quote_revision_hash,
       source_revision_json,seller_identity_id,seller_version,payment_instruction_id,
       payment_instruction_version,payment_channel,snapshot_json,snapshot_hash,
       issued_by,issued_at,valid_until)
    VALUES ('notice-pi','notice-pi-command','${hash}','ordered-request',
      'notice-revision','${hash}','{}','seller-identity-initial',1,
      'notice-payment',1,'bank_transfer','{}','${hash}',
      'test','${clock}','2026-10-24T12:00:00.000Z');
    INSERT INTO proforma_invoices
      (id,request_id,quote_revision_id,document_number,document_version,
       snapshot_json,snapshot_hash,pdf_object_key,pdf_sha256,pdf_byte_size,
       pdf_page_count,pdf_renderer_version,payment_channel,issued_by,issued_at,valid_until)
    VALUES ('notice-pi','ordered-request','notice-revision','PI-NOTICE',1,
      '{}','${hash}','pi/notice.pdf','${hash}',1,1,'legacy',
      'bank_transfer','test','${clock}','2026-10-24T12:00:00.000Z');
    INSERT INTO pi_customer_views
      (id,pi_id,request_id,profile_id,purchasing_context_id,document_version,
       snapshot_hash,pdf_sha256,pdf_byte_size,kind,occurred_at,request_evidence_json)
    VALUES ('notice-view','notice-pi','ordered-request','buyer',
      'buyer-context',1,'${hash}','${hash}',1,'view','${clock}','{}');
    INSERT INTO pi_acceptances
      (id,pi_id,request_id,profile_id,purchasing_context_id,source,document_version,
       snapshot_hash,quote_revision_id,view_id,accepted_at,business_hash,evidence_json)
    VALUES ('notice-acceptance','notice-pi','ordered-request','buyer',
      'buyer-context','website',1,'${hash}','notice-revision','notice-view',
      '${clock}','${hash}','{}');
    INSERT INTO pi_payment_confirmations
      (id,command_id,command_hash,pi_id,confirmed_cents,currency,actual_channel,
       external_reference,actor_id,confirmed_at)
    VALUES ('notice-confirmation','notice-confirmation-command','${hash}',
      'notice-pi',10000,'USD','bank_transfer','ref-notice','test','${clock}');
    INSERT INTO confirmed_orders
      (id,order_number,request_id,pi_id,purchasing_context_id,acceptance_id,
       confirmation_id,snapshot_json,snapshot_hash,currency,total_cents,confirmed_at)
    VALUES ('notice-order','ORDER-NOTICE','ordered-request','notice-pi',
      'buyer-context','notice-acceptance','notice-confirmation',
      '{}','${hash}','USD',10000,'${clock}')`);
}, 60_000);

afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("creates unread admin notifications for new RFQs and shipping change requests", async () => {
  await run(`
    ${quoteRequest("new-request", "QR-NEW", "2026-09-25T01:00:00.000Z")};
    INSERT INTO order_shipping_change_requests
      (id,order_id,profile_id,kind,status,requested_json,
       submission_command_id,submission_hash,created_at,updated_at)
    VALUES ('change-1','notice-order','buyer','delivery_address','pending_review',
      '{"note":"New dock"}','change-1-command','${hash}',
      '2026-09-25T02:00:00.000Z','2026-09-25T02:00:00.000Z')`);

  const notifications = createD1AdminNotifications(db);
  const owner = await notifications.list("owner", { filter: "all", page: 1 });
  const ids = owner.notifications.map((item) => item.id);
  expect(ids.slice(0, 2)).toEqual([
    "shipping-change:change-1",
    "rfq:new-request",
  ]);
  expect(owner.notifications[0]).toMatchObject({
    kind: "shipping_change_requested",
    changeKind: "delivery_address",
    reference: "ORDER-NOTICE",
    customerEmail: "Buyer@example.test",
    read: false,
    target: "/admin/orders/notice-order?tab=changes",
  });
  expect(owner.notifications[1]).toMatchObject({
    kind: "rfq_submitted",
    reference: "QR-NEW",
    read: false,
    target: "/admin/quotes/new-request",
  });
  expect(owner.unread).toBe(owner.all);
});

it("tracks read state per admin and ignores unknown or repeated ids", async () => {
  const notifications = createD1AdminNotifications(db);
  const before = await notifications.unreadCount("owner");
  await notifications.markRead(
    "owner",
    ["rfq:new-request", "rfq:new-request", "missing"],
    "2026-09-25T03:00:00.000Z",
  );
  expect(await notifications.unreadCount("owner")).toBe(before - 1);
  expect(await notifications.unreadCount("subaccount")).toBe(before);

  const unread = await notifications.list("owner", {
    filter: "unread",
    page: 1,
  });
  expect(unread.notifications.map((item) => item.id)).not.toContain(
    "rfq:new-request",
  );
  expect((await notifications.find("owner", "rfq:new-request"))?.read).toBe(
    true,
  );

  await notifications.markRead(
    "owner",
    unread.notifications.map((item) => item.id),
    "2026-09-25T03:05:00.000Z",
  );
  expect(await notifications.unreadCount("owner")).toBe(0);
});
