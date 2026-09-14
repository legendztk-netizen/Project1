import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import {
  INBOUND_LEASE_MS,
  type InboundAdminRow,
  type InboundAdminPage,
  type InboundReason,
  type InboundState,
} from "../domain/inbound-email";

export interface InboundReceipt {
  id: string;
  event_key: string;
  receipt_hash: string;
  raw_checksum: string;
  raw_size: number;
  raw_key: string | null;
  protected_envelope: string | null;
  state: InboundState;
  reason: InboundReason | null;
  created_at: number;
  next_attempt_at: number;
  next_dispatch_at: number;
  attempts: number;
  dispatch_attempts: number;
  lease_id: string | null;
  lease_until: number | null;
  request_id: string | null;
  message_id: string | null;
  cleanup_pending: number;
  cleanup_next_at: number;
  cleanup_attempts: number;
}

export interface InboundAppendCommand {
  receiptId: string;
  leaseId: string;
  messageId: string;
  requestId: string;
  profileId: string;
  senderEmail: string;
  tokenHash: string;
  body: string;
  contentKey: string;
  contentHash: string;
  now: number;
  attachment: {
    filename: string;
    contentType: string;
    byteSize: number;
    checksum: string;
    objectKey: string;
  } | null;
}

// Owns one complete D1 transaction: do not execute these statements independently.
export function quoteInboundAppendStatements(
  database: D1Database,
  command: InboundAppendCommand,
): D1PreparedStatement[] {
  const c = command;
  const createdAt = new Date(c.now).toISOString();
  const guard = `EXISTS (SELECT request.id FROM customer_quote_requests request ${ownedQuoteRequestWhere} AND request.id=?)
    AND EXISTS (SELECT 1 FROM quote_notification_reply_tokens t JOIN quote_notification_outbox o ON o.id=t.notification_id
      WHERE t.token_hash=? AND t.request_id=? AND t.profile_id=? AND t.recipient_email=? AND t.expires_at>?
      AND t.revoked_at IS NULL AND o.first_attempt_at IS NOT NULL)
    AND EXISTS (SELECT 1 FROM customer_profiles WHERE id=? AND email_normalized=? AND length(email_verified_at)>0)
    AND EXISTS (SELECT 1 FROM quote_inbound_email_receipts WHERE id=? AND state='processing' AND lease_id=? AND lease_until>?)
    AND EXISTS (SELECT 1 FROM quote_conversation_reservations WHERE id=? AND request_id=? AND author_id=?
      AND author_role='customer' AND julianday(created_at)>julianday('now','-10 minutes'))`;
  const statements = [
    database
      .prepare(
        "INSERT INTO quote_conversations(request_id,created_at) VALUES(?,?) ON CONFLICT DO NOTHING",
      )
      .bind(c.requestId, createdAt),
    database
      .prepare(
        `INSERT INTO quote_conversation_messages
      (id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,source,delivery_state)
      VALUES(?,?,'customer',(SELECT ? WHERE ${guard}),?,?,?,?,'email','available')`,
      )
      .bind(
        c.messageId,
        c.requestId,
        c.profileId,
        c.profileId,
        c.profileId,
        c.profileId,
        c.requestId,
        c.tokenHash,
        c.requestId,
        c.profileId,
        c.senderEmail,
        c.now,
        c.profileId,
        c.senderEmail,
        c.receiptId,
        c.leaseId,
        c.now,
        c.messageId,
        c.requestId,
        c.profileId,
        c.body,
        createdAt,
        `inbound-email/${c.receiptId}`,
        c.contentHash,
      ),
  ];
  if (c.attachment)
    statements.push(
      database
        .prepare(
          `INSERT INTO quote_conversation_attachments
    (message_id,filename,content_type,byte_size,checksum,object_key) VALUES(?,?,?,?,?,?)`,
        )
        .bind(
          c.messageId,
          c.attachment.filename,
          c.attachment.contentType,
          c.attachment.byteSize,
          c.attachment.checksum,
          c.attachment.objectKey,
        ),
    );
  statements.push(
    database
      .prepare(
        `INSERT INTO quote_inbound_email_content(content_key,content_hash,receipt_id,request_id,profile_id,message_id,created_at)
      VALUES(?,?,?,?,?,?,?)`,
      )
      .bind(
        c.contentKey,
        c.contentHash,
        c.receiptId,
        c.requestId,
        c.profileId,
        c.messageId,
        c.now,
      ),
    database
      .prepare(
        `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
      VALUES(?,'quote_conversation.email_received','quote_conversation',?,?,?,?)`,
      )
      .bind(
        `inbound-email:${c.receiptId}`,
        c.requestId,
        c.profileId,
        JSON.stringify({
          messageId: c.messageId,
          receiptId: c.receiptId,
          source: "email",
        }),
        createdAt,
      ),
    database
      .prepare(
        `UPDATE quote_inbound_email_receipts SET state='appended',reason=NULL,completed_at=?,request_id=?,message_id=?,lease_id=NULL,lease_until=NULL
      WHERE id=? AND lease_id=? AND state='processing'`,
      )
      .bind(c.now, c.requestId, c.messageId, c.receiptId, c.leaseId),
    database
      .prepare("DELETE FROM quote_conversation_reservations WHERE id=?")
      .bind(c.messageId),
  );
  return statements;
}

const active = "state IN ('staging','pending','processing','retry')";

export function createD1InboundEmail(database: D1Database) {
  return {
    async reserve(command: {
      receiptId: string;
      leaseId: string;
      messageId: string;
      requestId: string;
      profileId: string;
      byteSize: number;
      now: number;
    }) {
      const c = command;
      const guard = `EXISTS (SELECT 1 FROM quote_inbound_email_receipts
        WHERE id=? AND state='processing' AND lease_id=?
        AND lease_until>MAX(?,(julianday('now')-2440587.5)*86400000))
        AND EXISTS (SELECT request.id FROM customer_quote_requests request ${ownedQuoteRequestWhere} AND request.id=?)`;
      const bindings = [
        c.receiptId,
        c.leaseId,
        c.now,
        c.profileId,
        c.profileId,
        c.profileId,
        c.requestId,
      ];
      // Both creation and reuse are fenced in one transaction. Existing rows must
      // not hit INSERT quota triggers, nor may abandoned reservations be renewed.
      try {
        const results = await database.batch([
          database
            .prepare(
              `INSERT INTO quote_conversation_reservations(id,request_id,author_role,author_id,byte_size,created_at)
            SELECT ?,?,'customer',?,?,? WHERE ${guard}
            AND NOT EXISTS (SELECT 1 FROM quote_conversation_reservations WHERE id=?)
            AND NOT EXISTS (SELECT 1 FROM quote_conversation_messages WHERE id=?)`,
            )
            .bind(
              c.messageId,
              c.requestId,
              c.profileId,
              c.byteSize,
              new Date(c.now).toISOString(),
              ...bindings,
              c.messageId,
              c.messageId,
            ),
          database
            .prepare(
              `SELECT id FROM quote_conversation_reservations WHERE id=? AND request_id=?
            AND author_role='customer' AND author_id=? AND byte_size=?
            AND julianday(created_at)>julianday('now','-10 minutes') AND ${guard}`,
            )
            .bind(
              c.messageId,
              c.requestId,
              c.profileId,
              c.byteSize,
              ...bindings,
            ),
        ]);
        return results[1].results.length === 1;
      } catch (error) {
        if (
          error instanceof Error &&
          /conversation rate limit|conversation attachment budget/.test(
            error.message,
          )
        )
          throw new Response("Conversation limit reached", { status: 429 });
        throw error;
      }
    },
    async cleanupDue(now: number, limit: number) {
      return (
        await database
          .prepare(
            "SELECT * FROM quote_inbound_email_receipts WHERE cleanup_pending=1 AND cleanup_next_at<=? ORDER BY cleanup_next_at,id LIMIT ?",
          )
          .bind(now, limit)
          .all<InboundReceipt>()
      ).results;
    },
    async cleaned(id: string) {
      await database
        .prepare(
          "UPDATE quote_inbound_email_receipts SET cleanup_pending=0 WHERE id=? AND state IN ('appended','duplicate','quarantined','dead_letter')",
        )
        .bind(id)
        .run();
    },
    async cleanupFailed(id: string, now: number) {
      await database
        .prepare(
          "UPDATE quote_inbound_email_receipts SET cleanup_attempts=cleanup_attempts+1,cleanup_next_at=? WHERE id=? AND cleanup_pending=1",
        )
        .bind(now + 60_000, id)
        .run();
    },
    read(id: string) {
      return database
        .prepare("SELECT * FROM quote_inbound_email_receipts WHERE id=?")
        .bind(id)
        .first<InboundReceipt>();
    },
    byEvent(key: string) {
      return database
        .prepare("SELECT * FROM quote_inbound_email_receipts WHERE event_key=?")
        .bind(key)
        .first<InboundReceipt>();
    },
    async insert(row: {
      id: string;
      eventKey: string;
      receiptHash: string;
      checksum: string;
      rawSize: number;
      rawKey: string | null;
      envelope: string | null;
      state: "staging" | "quarantined";
      reason: InboundReason | null;
      now: number;
      requestId: string | null;
    }) {
      await database
        .prepare(
          `INSERT INTO quote_inbound_email_receipts
        (id,event_key,receipt_hash,raw_checksum,raw_size,raw_key,protected_envelope,state,reason,created_at,next_attempt_at,next_dispatch_at,completed_at,request_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING`,
        )
        .bind(
          row.id,
          row.eventKey,
          row.receiptHash,
          row.checksum,
          row.rawSize,
          row.rawKey,
          row.envelope,
          row.state,
          row.reason,
          row.now,
          row.now,
          row.now,
          row.state === "quarantined" ? row.now : null,
          row.requestId,
        )
        .run();
    },
    async staged(id: string) {
      await database
        .prepare(
          "UPDATE quote_inbound_email_receipts SET state='pending' WHERE id=? AND state='staging'",
        )
        .bind(id)
        .run();
    },
    claim(id: string, now: number, lease: string) {
      return database
        .prepare(
          `UPDATE quote_inbound_email_receipts SET state='processing',lease_id=?,lease_until=?,attempts=attempts+1
        WHERE id=? AND ${active} AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING *`,
        )
        .bind(lease, now + INBOUND_LEASE_MS, id, now, now)
        .first<InboundReceipt>();
    },
    async finish(
      row: InboundReceipt,
      state: "quarantined" | "dead_letter" | "duplicate",
      reason: InboundReason | null,
      now: number,
      messageId: string | null = null,
    ) {
      await database
        .prepare(
          `UPDATE quote_inbound_email_receipts SET state=?,reason=?,completed_at=?,message_id=?,lease_id=NULL,lease_until=NULL
        WHERE id=? AND state='processing' AND lease_id=?`,
        )
        .bind(state, reason, now, messageId, row.id, row.lease_id)
        .run();
    },
    async retry(row: InboundReceipt, now: number, delay: number) {
      await database
        .prepare(
          `UPDATE quote_inbound_email_receipts SET state='retry',reason='processing_unavailable',next_attempt_at=?,next_dispatch_at=?,lease_id=NULL,lease_until=NULL
        WHERE id=? AND lease_id=? AND state='processing'`,
        )
        .bind(now + delay * 1000, now + delay * 1000, row.id, row.lease_id)
        .run();
    },
    content(key: string) {
      return database
        .prepare(
          "SELECT content_hash,message_id FROM quote_inbound_email_content WHERE content_key=?",
        )
        .bind(key)
        .first<{ content_hash: string; message_id: string }>();
    },
    reservation(id: string) {
      return database
        .prepare(
          `SELECT id,CASE WHEN julianday(created_at)>julianday('now','-10 minutes') THEN 1 ELSE 0 END AS live
        FROM quote_conversation_reservations WHERE id=?`,
        )
        .bind(id)
        .first<{ id: string; live: number }>();
    },
    async due(now: number, limit: number) {
      return (
        await database
          .prepare(
            `SELECT * FROM quote_inbound_email_receipts WHERE ${active} AND next_attempt_at<=? AND next_dispatch_at<=?
        AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_dispatch_at,id LIMIT ?`,
          )
          .bind(now, now, now, limit)
          .all<InboundReceipt>()
      ).results;
    },
    dispatchClaim(row: InboundReceipt, now: number) {
      return database
        .prepare(
          `UPDATE quote_inbound_email_receipts SET next_dispatch_at=?,dispatch_attempts=dispatch_attempts+1
        WHERE id=? AND next_dispatch_at=? AND ${active} AND (lease_until IS NULL OR lease_until<=?) RETURNING *`,
        )
        .bind(now + INBOUND_LEASE_MS, row.id, row.next_dispatch_at, now)
        .first<InboundReceipt>();
    },
    async dispatched(row: InboundReceipt) {
      await database
        .prepare(
          "UPDATE quote_inbound_email_receipts SET dispatch_attempts=0 WHERE id=? AND next_dispatch_at=?",
        )
        .bind(row.id, row.next_dispatch_at)
        .run();
    },
    async dispatchFailed(
      row: InboundReceipt,
      now: number,
      delay: number,
      terminal: boolean,
    ) {
      await database
        .prepare(
          `UPDATE quote_inbound_email_receipts SET next_dispatch_at=?,reason='queue_unavailable',
        state=CASE WHEN ? THEN 'dead_letter' ELSE state END,completed_at=CASE WHEN ? THEN ? ELSE completed_at END
        WHERE id=? AND next_dispatch_at=? AND ${active} AND (lease_until IS NULL OR lease_until<=?)`,
        )
        .bind(
          now + delay * 1000,
          terminal ? 1 : 0,
          terminal ? 1 : 0,
          now,
          row.id,
          row.next_dispatch_at,
          now,
        )
        .run();
    },
    async list(
      limit: number,
      cursor?: string,
      state?: InboundState,
    ): Promise<InboundAdminPage> {
      const before = cursor
        ? await database
            .prepare(
              "SELECT id,created_at FROM quote_inbound_email_receipts WHERE id=?",
            )
            .bind(cursor)
            .first<{ id: string; created_at: number }>()
        : null;
      if (cursor && !before)
        throw new Response("Invalid inbound receipt cursor", { status: 400 });
      const results = (
        await database
          .prepare(
            `SELECT id,state,reason,created_at,completed_at,raw_size,attempts,dispatch_attempts,cleanup_pending,cleanup_attempts,cleanup_next_at,request_id,message_id
        FROM quote_inbound_email_receipts WHERE (? IS NULL OR state=?)
        AND (? IS NULL OR created_at<? OR (created_at=? AND id<?))
        ORDER BY created_at DESC,id DESC LIMIT ?`,
          )
          .bind(
            state ?? null,
            state ?? null,
            before?.id ?? null,
            before?.created_at ?? null,
            before?.created_at ?? null,
            before?.id ?? null,
            limit + 1,
          )
          .all<InboundAdminRow>()
      ).results;
      const rows = results.slice(0, limit);
      return {
        rows,
        nextCursor: results.length > limit ? rows[rows.length - 1].id : null,
      };
    },
  };
}
