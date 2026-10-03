import { meterD1 } from "../workers/d1-read-metrics";
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
    INSERT INTO admin_identities(id,email,account_type,status,created_at,updated_at)
    VALUES ('owner','owner@tests.invalid','owner','active','${clock}','${clock}'),
      ('subaccount','staff@tests.invalid','subaccount','active','${clock}','${clock}');
    INSERT INTO admin_module_permissions(admin_id,module,level) VALUES
      ('subaccount','notifications','read'),('subaccount','quotes','read'),('subaccount','orders','read'),
      ('subaccount','after_sales','read'),('subaccount','messages','read');
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

it("opens a Case where it is worked and a legacy Case reply in Messages", async () => {
  await run(`
    INSERT INTO after_sales_cases (id,case_number,order_id,profile_id,reason,description,
      policy_version,status,submission_command_id,submission_hash,created_at,updated_at)
    VALUES ('notice-case','AS-NOTICE-1','notice-order','buyer','wrong_item','Wrong part',
      'return-policy-2026-09-27-v2','open','notice-case-command','${hash}',
      '2026-09-26T01:00:00.000Z','2026-09-26T01:00:00.000Z');
    INSERT INTO after_sales_case_messages (id,case_id,author_role,author_id,visibility,
      kind,body,created_at,command_id,command_hash)
    VALUES ('notice-reply','notice-case','customer','buyer','customer','message',
      'Photo attached','2026-09-26T02:00:00.000Z','notice-reply-command','${hash}')`);
  const { notifications } = await createD1AdminNotifications(db).list("owner", {
    filter: "all",
    page: 1,
  });
  expect(
    notifications.find((item) => item.id === "after-sales-case:notice-case")
      ?.target,
  ).toBe("/admin/orders/notice-order?tab=after-sales");
  expect(
    notifications.find((item) => item.id === "after-sales-reply:notice-reply")
      ?.target,
  ).toBe("/admin/messages/ordered-request");
});

it("scopes list/count/lookup/read markers to current source-module grants, including revoked accounts", async () => {
  await run(`INSERT INTO admin_identities(id,email,account_type,status,created_at,updated_at)
    VALUES ('limited','limited@tests.invalid','subaccount','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO admin_module_permissions VALUES('limited','notifications','read')`);
  const service = createD1AdminNotifications(db);
  expect(
    await service.list("limited", { filter: "all", page: 1 }),
  ).toMatchObject({ notifications: [], all: 0, unread: 0, pageCount: 1 });
  expect(await service.find("limited", "rfq:new-request")).toBeNull();
  await service.markRead(
    "limited",
    ["rfq:new-request"],
    new Date().toISOString(),
  );
  expect(
    await db
      .prepare(
        "SELECT count(*) AS n FROM admin_notification_reads WHERE admin_id='limited'",
      )
      .first("n"),
  ).toBe(0);
  await run(
    "INSERT INTO admin_module_permissions VALUES('limited','quotes','read')",
  );
  // Lots of inaccessible notifications must not consume a page or affect counts.
  await db.batch(
    Array.from({ length: 51 }, (_, n) =>
      db
        .prepare(
          "INSERT INTO admin_notifications(id,kind,source_id,created_at) VALUES(?,'shipping_change_requested',?,'2030-01-01')",
        )
        .bind(`hidden-${n}`, `hidden-source-${n}`),
    ),
  );
  const page = await service.list("limited", { filter: "all", page: 1 });
  expect(page.notifications.length).toBeGreaterThan(0);
  expect(page.notifications.every((n) => n.kind === "rfq_submitted")).toBe(
    true,
  );
  expect(page.all).toBe(page.notifications.length);
  expect(page.unread).toBe(page.all);
  expect(page.pageCount).toBe(1);
  await service.markRead(
    "limited",
    ["rfq:new-request", "shipping-change:change-1"],
    new Date().toISOString(),
  );
  expect(await service.unreadCount("limited")).toBe(page.all - 1);
  expect(await service.find("limited", "shipping-change:change-1")).toBeNull();
  expect(
    (
      await service.list("limited", { filter: "unread", page: 1 })
    ).notifications.map((n) => n.id),
  ).not.toContain("rfq:new-request");
  await run(
    "DELETE FROM admin_module_permissions WHERE admin_id='limited' AND module='quotes'",
  );
  expect(await service.unreadCount("limited")).toBe(0);
  expect(await service.find("limited", "rfq:new-request")).toBeNull();
  await run(
    "INSERT INTO admin_module_permissions VALUES('limited','orders','read')",
  );
  expect(
    (
      await service.list("limited", { filter: "all", page: 1 })
    ).notifications.every((n) => n.kind === "shipping_change_requested"),
  ).toBe(true);
  await run(
    "INSERT INTO admin_module_permissions VALUES('limited','after_sales','read')",
  );
  // Assert kind-level authorization independently of notification-id conventions.
  const caseRow = await db
    .prepare(
      "SELECT id FROM admin_notifications WHERE kind='after_sales_case_opened' LIMIT 1",
    )
    .first<{ id: string }>();
  expect(caseRow).not.toBeNull();
  expect(await service.find("limited", caseRow!.id)).not.toBeNull();
  const replyRow = await db
    .prepare(
      "SELECT id FROM admin_notifications WHERE kind='after_sales_customer_reply' LIMIT 1",
    )
    .first<{ id: string }>();
  expect(await service.find("limited", replyRow!.id)).toBeNull();
  await run(
    "INSERT INTO admin_module_permissions VALUES('limited','messages','read')",
  );
  expect(await service.find("limited", replyRow!.id)).not.toBeNull();
  await run("UPDATE admin_identities SET status='disabled' WHERE id='limited'");
  expect(
    await service.list("limited", { filter: "all", page: 1 }),
  ).toMatchObject({ notifications: [], all: 0, unread: 0 });
});

import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import { action as notificationAction } from "../app/modules/admin/routes/notifications";
import { loader as badgeLoader } from "../app/modules/admin/routes/notifications-unread-count";
import { canAccessAdminPath } from "../app/modules/admin/domain/admin-module-access";

it("opens an authorized notification for a read-only user and rejects forged or unrelated actions", async () => {
  await run(`INSERT INTO admin_identities(id,email,account_type,status,created_at,updated_at)
    VALUES ('reader','reader@tests.invalid','subaccount','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO admin_module_permissions VALUES('reader','notifications','read'),('reader','quotes','read')`);
  const identity = {
    id: "reader",
    email: "reader@tests.invalid",
    accountType: "subaccount" as const,
    canManageSubaccounts: false,
    source: "password" as const,
    moduleAccess: { notifications: "read" as const, quotes: "read" as const },
  };
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { DB: db } as CloudflareBindings,
    adminIdentity: identity,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
  });
  const invoke = (intent: string, notificationId: string) =>
    notificationAction({
      context,
      params: {},
      url: new URL("https://admin.example.test/admin/notifications"),
      pattern: "/admin/notifications",
      request: new Request("https://admin.example.test/admin/notifications", {
        method: "POST",
        headers: { Origin: "https://admin.example.test" },
        body: new URLSearchParams({ intent, notificationId }),
      }),
    } as Parameters<typeof notificationAction>[0]);
  expect(
    canAccessAdminPath(identity, "/admin/notifications.data", "POST"),
  ).toBe(true);
  const response = (await invoke("open", "rfq:new-request")) as Response;
  expect(response.headers.get("Location")).toBe("/admin/quotes/new-request");
  expect(
    (await createD1AdminNotifications(db).find(identity.id, "rfq:new-request"))
      ?.read,
  ).toBe(true);
  await expect(
    invoke("open", "shipping-change:change-1"),
  ).rejects.toMatchObject({ status: 404 });
  await expect(invoke("edit-order", "rfq:new-request")).rejects.toMatchObject({
    status: 400,
  });
  const badge = await badgeLoader({
    context,
    params: {},
    request: new Request(
      "https://admin.example.test/admin/notifications/unread-count",
    ),
    url: new URL("https://admin.example.test/admin/notifications/unread-count"),
    pattern: "/admin/notifications/unread-count",
  });
  expect(await badge.json()).toMatchObject({ messages: 0 });
});

it("reads a notification page and both counts in two queries without losing per-admin unread state", async () => {
  const { binding, metrics } = meterD1(db);
  const result = await createD1AdminNotifications(binding).list("owner", {
    filter: "unread",
    page: 1,
  });
  expect(metrics.queries).toBe(2);
  expect(result.unread).toBe(
    await createD1AdminNotifications(db).unreadCount("owner"),
  );
  expect(result.all).toBe(
    (await db
      .prepare("SELECT COUNT(*) AS count FROM admin_notifications")
      .first<{ count: number }>())!.count,
  );
  expect(result.notifications.every((item) => !item.read)).toBe(true);
});
