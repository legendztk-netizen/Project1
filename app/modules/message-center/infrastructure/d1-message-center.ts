import {
  orderStageSql,
  shipmentCountSql,
  type CustomerOrderStage,
} from "../../proforma-invoice/application/confirmed-order-service";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";

export const MESSAGE_THREAD_PAGE_SIZE = 30;

export type AdminThreadFilter = "all" | "unread" | "awaiting";

// Latest message per conversation. Window functions keep one pass over the
// append-only message table instead of a correlated lookup per column.
const lastMessage = `last AS (
  SELECT m.request_id,m.body,m.author_role,m.created_at,
    (SELECT 1 FROM quote_conversation_attachments a WHERE a.message_id=m.id) AS has_attachment,
    row_number() OVER (PARTITION BY m.request_id ORDER BY m.created_at DESC,m.id DESC) AS rn
  FROM quote_conversation_messages m)`;

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

export type MessageThreadSummary = ReturnType<typeof projectThread>;

const threadColumns = (role: "customer" | "admin") => `
  request.id AS request_id,request.reference_number,request.submitted_at,
  profile.email_display AS customer_email,
  o.id AS order_id,o.order_number,
  CASE WHEN o.id IS NULL THEN NULL ELSE ${orderStageSql} END AS order_stage,
  last.body AS last_body,last.author_role AS last_role,last.created_at AS last_at,
  last.has_attachment AS last_has_attachment,
  ${unreadSql(role)} AS unread,
  (SELECT count(*) FROM after_sales_cases c WHERE c.order_id=o.id AND c.status='open') AS open_cases`;

export function createD1MessageCenter(database: D1Database) {
  return {
    async customerThreads(profileId: string, page: number) {
      const rows = await database
        .prepare(
          `WITH ${lastMessage}
           SELECT ${threadColumns("customer")}
           FROM customer_quote_requests request
           JOIN last ON last.request_id=request.id AND last.rn=1
           LEFT JOIN customer_profiles profile ON profile.id=request.profile_id
           LEFT JOIN confirmed_orders o ON o.request_id=request.id
           ${ownedQuoteRequestWhere}
           ORDER BY last.created_at DESC,request.id DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(
          profileId,
          profileId,
          profileId,
          profileId,
          MESSAGE_THREAD_PAGE_SIZE + 1,
          (page - 1) * MESSAGE_THREAD_PAGE_SIZE,
        )
        .all<ThreadRow>();
      return {
        threads: rows.results
          .slice(0, MESSAGE_THREAD_PAGE_SIZE)
          .map(projectThread),
        hasMore: rows.results.length > MESSAGE_THREAD_PAGE_SIZE,
      };
    },

    async customerUnread(profileId: string) {
      const row = await database
        .prepare(
          `SELECT count(*) AS count FROM quote_conversation_messages m
           JOIN customer_quote_requests request ON request.id=m.request_id
           ${ownedQuoteRequestWhere}
             AND m.author_role='admin'
             AND NOT EXISTS(SELECT 1 FROM message_reads r
               WHERE r.message_id=m.id AND r.reader_role='customer' AND r.reader_id=?)`,
        )
        .bind(profileId, profileId, profileId, profileId)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },

    async adminThreads(
      adminId: string,
      options: { filter: AdminThreadFilter; query: string; page: number },
    ) {
      const query = options.query.trim().slice(0, 100);
      const like = `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
      const rows = await database
        .prepare(
          `WITH ${lastMessage},
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
          MESSAGE_THREAD_PAGE_SIZE + 1,
          (options.page - 1) * MESSAGE_THREAD_PAGE_SIZE,
        )
        .all<ThreadRow>();
      return {
        threads: rows.results
          .slice(0, MESSAGE_THREAD_PAGE_SIZE)
          .map(projectThread),
        hasMore: rows.results.length > MESSAGE_THREAD_PAGE_SIZE,
      };
    },

    async adminUnreadThreads(adminId: string) {
      const row = await database
        .prepare(
          `SELECT count(DISTINCT m.request_id) AS count FROM quote_conversation_messages m
           WHERE m.author_role='customer'
             AND NOT EXISTS(SELECT 1 FROM message_reads r
               WHERE r.message_id=m.id AND r.reader_role='admin' AND r.reader_id=?)`,
        )
        .bind(adminId)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },

    async context(requestId: string) {
      const row = await database
        .prepare(
          `SELECT request.id AS request_id,request.reference_number,request.submitted_at,
             request.currency,request.merchandise_subtotal,
             profile.email_display AS customer_email,
             o.id AS order_id,o.order_number,o.total_cents,o.currency AS order_currency,
             o.confirmed_at,
             CASE WHEN o.id IS NULL THEN NULL ELSE ${orderStageSql} END AS order_stage,
             ${shipmentCountSql()} AS shipment_count,
             ${shipmentCountSql("shipment.status='delivered'")} AS delivered_count,
             (SELECT count(*) FROM confirmed_order_lines line WHERE line.order_id=o.id) AS line_count
           FROM customer_quote_requests request
           LEFT JOIN customer_profiles profile ON profile.id=request.profile_id
           LEFT JOIN confirmed_orders o ON o.request_id=request.id
           WHERE request.id=?`,
        )
        .bind(requestId)
        .first<{
          request_id: string;
          reference_number: string;
          submitted_at: string;
          currency: string | null;
          merchandise_subtotal: number | null;
          customer_email: string | null;
          order_id: string | null;
          order_number: string | null;
          total_cents: number | null;
          order_currency: string | null;
          confirmed_at: string | null;
          order_stage: CustomerOrderStage | null;
          shipment_count: number;
          delivered_count: number;
          line_count: number;
        }>();
      if (!row) throw new Response("Not found", { status: 404 });
      const cases = row.order_id
        ? (
            await database
              .prepare(
                `SELECT id,case_number,reason,status,created_at FROM after_sales_cases
                 WHERE order_id=? ORDER BY created_at,id`,
              )
              .bind(row.order_id)
              .all<{
                id: string;
                case_number: string;
                reason: string;
                status: "open" | "closed";
                created_at: string;
              }>()
          ).results
        : [];
      return {
        requestId: row.request_id,
        referenceNumber: row.reference_number,
        submittedAt: row.submitted_at,
        currency: row.currency,
        merchandiseSubtotal: row.merchandise_subtotal,
        customerEmail: row.customer_email,
        order: row.order_id
          ? {
              id: row.order_id,
              orderNumber: row.order_number!,
              totalCents: row.total_cents!,
              currency: row.order_currency ?? "USD",
              confirmedAt: row.confirmed_at!,
              stage: row.order_stage,
              lineCount: row.line_count,
              shipmentCount: row.shipment_count,
              deliveredCount: row.delivered_count,
            }
          : null,
        cases: cases.map((item) => ({
          id: item.id,
          caseNumber: item.case_number,
          reason: item.reason,
          status: item.status,
          createdAt: item.created_at,
        })),
      };
    },

    async notes(requestId: string) {
      return (
        await database
          .prepare(
            `SELECT n.id,n.body,n.admin_id,n.created_at,n.case_id,c.case_number,
               a.email AS admin_email
             FROM message_internal_notes n
             LEFT JOIN after_sales_cases c ON c.id=n.case_id
             LEFT JOIN admin_identities a ON a.id=n.admin_id
             WHERE n.request_id=? ORDER BY n.created_at,n.id`,
          )
          .bind(requestId)
          .all<{
            id: string;
            body: string;
            admin_id: string;
            created_at: string;
            case_id: string | null;
            case_number: string | null;
            admin_email: string | null;
          }>()
      ).results.map((row) => ({
        id: row.id,
        body: row.body,
        adminId: row.admin_id,
        adminEmail: row.admin_email,
        createdAt: row.created_at,
        topic: row.case_id
          ? { caseId: row.case_id, caseNumber: row.case_number! }
          : null,
      }));
    },

    async appendNote(input: {
      id: string;
      requestId: string;
      caseId: string | null;
      adminId: string;
      body: string;
      createdAt: string;
      commandId: string;
      commandHash: string;
      auditIp: string | null;
    }) {
      await database.batch([
        database
          .prepare(
            `INSERT INTO message_internal_notes
             (id,request_id,case_id,admin_id,body,created_at,command_id,command_hash)
             VALUES(?,?,?,?,?,?,?,?)`,
          )
          .bind(
            input.id,
            input.requestId,
            input.caseId,
            input.adminId,
            input.body,
            input.createdAt,
            input.commandId,
            input.commandHash,
          ),
        database
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES(?,'message_center.internal_note_added','quote_conversation',?,?,?,?)`,
          )
          .bind(
            `message-note:${input.id}`,
            input.requestId,
            input.adminId,
            JSON.stringify({
              noteId: input.id,
              caseId: input.caseId,
              commandId: input.commandId,
              ipAddress: input.auditIp,
            }),
            input.createdAt,
          ),
      ]);
    },

    findNoteCommand(commandId: string) {
      return database
        .prepare(
          `SELECT id,request_id,command_hash FROM message_internal_notes WHERE command_id=?`,
        )
        .bind(commandId)
        .first<{ id: string; request_id: string; command_hash: string }>();
    },

    async markRead(input: {
      requestId: string;
      role: "customer" | "admin";
      readerId: string;
      messageIds: string[];
    }) {
      // Each page is bounded by the conversation service. A late insertion,
      // even with an older timestamp, is absent from this observed ID set.
      if (!input.messageIds.length) return;
      await database.batch(
        input.messageIds.map((id) =>
          database
            .prepare(
              `INSERT OR IGNORE INTO message_reads(message_id,reader_role,reader_id)
         SELECT id,?,? FROM quote_conversation_messages WHERE id=? AND request_id=?`,
            )
            .bind(input.role, input.readerId, id, input.requestId),
        ),
      );
    },
  };
}
