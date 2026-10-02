// Frozen pre-optimization admin inbox query, for result and scanned-row comparisons.
import {
  orderStageSql,
  type CustomerOrderStage,
} from "../../app/modules/proforma-invoice/application/confirmed-order-service";
const lastMessage = (scope = "") => `last AS (
  SELECT m.request_id,m.body,m.author_role,m.created_at,
    (SELECT 1 FROM quote_conversation_attachments a WHERE a.message_id=m.id) AS has_attachment,
    row_number() OVER (PARTITION BY m.request_id ORDER BY m.created_at DESC,m.id DESC) AS rn
  FROM quote_conversation_messages m ${scope})`;

function unreadSql(role: "customer" | "admin") {
  // Only messages actually returned to this reader count as read.
  const from = role === "customer" ? "admin" : "customer";
  return `(SELECT count(*) FROM quote_conversation_messages unread
    WHERE unread.request_id=request.id AND unread.author_role='${from}'
      AND NOT EXISTS(SELECT 1 FROM message_reads r
        WHERE r.message_id=unread.id AND r.reader_role='${role}' AND r.reader_id=?))`;
}

interface ThreadRow {
  request_id: string;
  reference_number: string;
  submitted_at: string;
  customer_email: string | null;
  order_id: string | null;
  order_number: string | null;
  order_stage: CustomerOrderStage | null;
  last_body: string | null;
  last_role: "customer" | "admin" | null;
  last_at: string | null;
  last_has_attachment: number | null;
  unread: number;
  open_cases: number;
}

function projectThread(row: ThreadRow) {
  return {
    requestId: row.request_id,
    referenceNumber: row.reference_number,
    submittedAt: row.submitted_at,
    customerEmail: row.customer_email,
    order: row.order_id
      ? {
          id: row.order_id,
          orderNumber: row.order_number!,
          stage: row.order_stage,
        }
      : null,
    lastMessage: row.last_at
      ? {
          body: row.last_body ?? "",
          authorRole: row.last_role!,
          createdAt: row.last_at,
          hasAttachment: row.last_has_attachment === 1,
        }
      : null,
    unread: row.unread,
    openCases: row.open_cases,
  };
}

const threadColumns = (role: "customer" | "admin") => `
  request.id AS request_id,request.reference_number,request.submitted_at,
  profile.email_display AS customer_email,
  o.id AS order_id,o.order_number,
  CASE WHEN o.id IS NULL THEN NULL ELSE ${orderStageSql} END AS order_stage,
  last.body AS last_body,last.author_role AS last_role,last.created_at AS last_at,
  last.has_attachment AS last_has_attachment,
  ${unreadSql(role)} AS unread,
  (SELECT count(*) FROM after_sales_cases c WHERE c.order_id=o.id AND c.status='open') AS open_cases`;

export async function legacyAdminThreads(
  database: D1Database,
  adminId: string,
  options: {
    filter: "all" | "unread" | "awaiting";
    query: string;
    page: number;
  },
) {
  const query = options.query.trim().slice(0, 100);
  const like = `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
  const rows = await database
    .prepare(
      `WITH ${lastMessage()},
           threads AS (
             SELECT request_id FROM quote_conversation_messages
             UNION SELECT request_id FROM message_internal_notes)
           SELECT * FROM (
             SELECT ${threadColumns("admin")},
               coalesce(last.created_at,(SELECT max(n.created_at) FROM message_internal_notes n
                 WHERE n.request_id=request.id)) AS activity_at
             FROM threads
             JOIN customer_quote_requests request ON request.id=threads.request_id
             LEFT JOIN last ON last.request_id=request.id AND last.rn=1
             LEFT JOIN customer_profiles profile ON profile.id=request.profile_id
             LEFT JOIN confirmed_orders o ON o.request_id=request.id
             WHERE (?='' OR request.reference_number LIKE ? ESCAPE '\\'
               OR o.order_number LIKE ? ESCAPE '\\'
               OR profile.email_display LIKE ? ESCAPE '\\'))
           WHERE ?='all' OR (?='unread' AND unread>0)
             OR (?='awaiting' AND last_role='customer')
           ORDER BY activity_at DESC,request_id DESC
           LIMIT ? OFFSET ?`,
    )
    .bind(
      adminId,
      query,
      like,
      like,
      like,
      options.filter,
      options.filter,
      options.filter,
      31,
      (options.page - 1) * 30,
    )
    .all<ThreadRow>();
  return {
    threads: rows.results.slice(0, 30).map(projectThread),
    hasMore: rows.results.length > 30,
  };
}
