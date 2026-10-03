export type AdminNotificationKind =
  | "rfq_submitted"
  | "shipping_change_requested"
  | "cancellation_requested"
  | "after_sales_case_opened"
  | "after_sales_customer_reply"
  | "return_inspection_overdue"
  | "refund_initiation_overdue";
export type AdminNotificationFilter = "all" | "unread";

export interface AdminNotification {
  id: string;
  kind: AdminNotificationKind;
  createdAt: string;
  read: boolean;
  reference: string | null;
  customerEmail: string | null;
  changeKind: "delivery_address" | "shipping_plan" | null;
  target: string;
}

interface AdminNotificationRow {
  id: string;
  kind: AdminNotificationKind;
  source_id: string;
  created_at: string;
  read_at: string | null;
  reference: string | null;
  customer_email: string | null;
  change_kind: "delivery_address" | "shipping_plan" | null;
  order_id: string | null;
  request_id: string | null;
}

export const ADMIN_NOTIFICATION_PAGE_SIZE = 50;
const MAX_BATCH_READ = 200;

const orderTab = (tab: string) => (row: AdminNotificationRow) =>
  row.order_id
    ? `/admin/orders/${encodeURIComponent(row.order_id)}?tab=${tab}`
    : null;

// Where each notification kind is worked. Customer Case replies moved to
// Messages, so they open the conversation rather than the Order.
const targets: Record<
  AdminNotificationKind,
  (row: AdminNotificationRow) => string | null
> = {
  rfq_submitted: (row) => `/admin/quotes/${encodeURIComponent(row.source_id)}`,
  shipping_change_requested: orderTab("changes"),
  cancellation_requested: orderTab("after-sales"),
  after_sales_case_opened: orderTab("after-sales"),
  return_inspection_overdue: orderTab("after-sales"),
  refund_initiation_overdue: orderTab("after-sales"),
  after_sales_customer_reply: (row) =>
    row.request_id
      ? `/admin/messages/${encodeURIComponent(row.request_id)}`
      : null,
};

function project(row: AdminNotificationRow): AdminNotification {
  return {
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    read: row.read_at !== null,
    reference: row.reference,
    customerEmail: row.customer_email,
    changeKind: row.change_kind,
    target: targets[row.kind](row) ?? "/admin/notifications",
  };
}

const notificationSelect = `SELECT n.id, n.kind, n.source_id, n.created_at, r.read_at,
  COALESCE(q.reference_number, o.order_number) AS reference,
  COALESCE(qp.email_display, cp.email_display, xp.email_display, scp.email_display, rcp.email_display) AS customer_email,
  c.kind AS change_kind, o.request_id AS request_id, COALESCE(c.order_id, x.order_id, ra.order_id, sr.order_id, sc.order_id, rc.order_id, rr.order_id) AS order_id
  FROM admin_notifications n
  LEFT JOIN admin_notification_reads r ON r.notification_id=n.id AND r.admin_id=?1
  LEFT JOIN customer_quote_requests q ON n.kind='rfq_submitted' AND q.id=n.source_id
  LEFT JOIN customer_profiles qp ON qp.id=q.profile_id
  LEFT JOIN order_shipping_change_requests c ON n.kind='shipping_change_requested' AND c.id=n.source_id
  LEFT JOIN order_cancellation_requests x ON n.kind='cancellation_requested' AND x.id=n.source_id
  LEFT JOIN customer_profiles xp ON xp.id=x.profile_id
  LEFT JOIN after_sales_refund_authorizations ra ON n.kind='refund_initiation_overdue' AND ra.id=n.source_id
  LEFT JOIN after_sales_cases sc ON n.kind='after_sales_case_opened' AND sc.id=n.source_id
  LEFT JOIN customer_profiles scp ON scp.id=sc.profile_id
  LEFT JOIN after_sales_case_messages rm ON n.kind='after_sales_customer_reply' AND rm.id=n.source_id
  LEFT JOIN after_sales_cases rc ON rc.id=rm.case_id
  LEFT JOIN customer_profiles rcp ON rcp.id=rc.profile_id
  LEFT JOIN after_sales_return_receipts rr ON n.kind='return_inspection_overdue' AND rr.id=n.source_id
  LEFT JOIN order_shipping_change_refund_reservations sr ON n.kind='refund_initiation_overdue' AND sr.id=n.source_id
  LEFT JOIN confirmed_orders o ON o.id=COALESCE(c.order_id, x.order_id, ra.order_id, sr.order_id, sc.order_id, rc.order_id, rr.order_id)
  LEFT JOIN customer_profiles cp ON cp.id=c.profile_id`;

// Apply the same scope before pagination, counts, lookup and read-state writes.
// The actor and grants are checked in D1 so a revoked/disabled account fails closed.
const granted = (module: string) =>
  `EXISTS(SELECT 1 FROM admin_module_permissions p WHERE p.admin_id=i.id AND p.module='${module}' AND p.level IN ('read','write'))`;
const visibleToAdmin = `EXISTS(SELECT 1 FROM admin_identities i
  WHERE i.id=?1 AND i.status='active' AND i.deleted_at IS NULL AND (
    i.account_type='owner' OR (i.account_type='subaccount' AND ${granted("notifications")} AND (
      (n.kind='rfq_submitted' AND ${granted("quotes")}) OR
      (n.kind='shipping_change_requested' AND ${granted("orders")}) OR
      (n.kind IN ('cancellation_requested','after_sales_case_opened','return_inspection_overdue','refund_initiation_overdue') AND ${granted("orders")} AND ${granted("after_sales")}) OR
      (n.kind='after_sales_customer_reply' AND ${granted("messages")} AND ${granted("after_sales")})
    ))
  ))`;

export function createD1AdminNotifications(database: D1Database) {
  async function unreadCount(adminId: string) {
    const row = await database
      .prepare(
        `SELECT COUNT(*) AS count FROM admin_notifications n
         WHERE ${visibleToAdmin} AND NOT EXISTS(SELECT 1 FROM admin_notification_reads r
           WHERE r.notification_id=n.id AND r.admin_id=?1)`,
      )
      .bind(adminId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  return {
    unreadCount,

    async list(
      adminId: string,
      options: { filter: AdminNotificationFilter; page: number },
    ) {
      const where = `WHERE ${visibleToAdmin}${options.filter === "unread" ? " AND r.read_at IS NULL" : ""}`;
      const offset = (options.page - 1) * ADMIN_NOTIFICATION_PAGE_SIZE;
      const [rows, counts] = await Promise.all([
        database
          .prepare(
            `${notificationSelect} ${where}
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT ?2 OFFSET ?3`,
          )
          .bind(adminId, ADMIN_NOTIFICATION_PAGE_SIZE, offset)
          .all<AdminNotificationRow>(),
        database
          .prepare(
            `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM admin_notification_reads r
                WHERE r.notification_id=n.id AND r.admin_id=?1) THEN 1 ELSE 0 END),0) AS unread
             FROM admin_notifications n WHERE ${visibleToAdmin}`,
          )
          .bind(adminId)
          .first<{ total: number; unread: number }>(),
      ]);
      const all = counts?.total ?? 0;
      const unread = counts?.unread ?? 0;
      return {
        notifications: rows.results.map(project),
        all,
        unread,
        pageCount: Math.max(
          1,
          Math.ceil(
            (options.filter === "unread" ? unread : all) /
              ADMIN_NOTIFICATION_PAGE_SIZE,
          ),
        ),
      };
    },

    async find(adminId: string, notificationId: string) {
      const row = await database
        .prepare(`${notificationSelect} WHERE n.id=?2 AND ${visibleToAdmin}`)
        .bind(adminId, notificationId)
        .first<AdminNotificationRow>();
      return row ? project(row) : null;
    },

    async markRead(adminId: string, notificationIds: string[], readAt: string) {
      const ids = [...new Set(notificationIds)].slice(0, MAX_BATCH_READ);
      if (!ids.length) return;
      await database.batch(
        ids.map((id) =>
          database
            .prepare(
              `INSERT OR IGNORE INTO admin_notification_reads
               (notification_id,admin_id,read_at)
               SELECT n.id,?1,?2 FROM admin_notifications n WHERE n.id=?3 AND ${visibleToAdmin}`,
            )
            .bind(adminId, readAt, id),
        ),
      );
    },
  };
}
