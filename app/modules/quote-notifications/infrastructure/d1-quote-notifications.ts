import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import {
  DELIVERY_LEASE_MS,
  notificationAdminCursor,
  notificationAdminPageOptions,
  type NotificationAdminListOptions,
  type NotificationAdminPage,
  type AdminNotificationProjection,
} from "../domain/quote-notification";

export interface NotificationRow {
  id: string;
  message_id: string;
  request_id: string;
  idempotency_key: string;
  state: "pending" | "sending" | "retry" | "sent" | "dead_letter" | "review";
  created_at: number;
  next_attempt_at: number;
  next_dispatch_at: number;
  dispatch_attempts: number;
  attempts: number;
  lease_id: string | null;
  lease_until: number | null;
  first_attempt_at: number | null;
  recipient_profile_id: string | null;
  recipient_email: string | null;
  protected_payload: string | null;
  delivery_mode: "stub" | "resend" | null;
}

export function quoteNotificationOutboxStatement(
  database: D1Database,
  input: {
    messageId: string;
    requestId: string;
    createdAt: string;
  },
): D1PreparedStatement {
  const timestamp = Date.parse(input.createdAt);
  if (
    !Number.isFinite(timestamp) ||
    !input.messageId ||
    input.messageId.length > 200 ||
    !input.requestId
  )
    throw new Error("Invalid notification source");
  // Execute AFTER the source message INSERT in the SAME D1 batch. Customer messages are a no-op.
  return database
    .prepare(
      `INSERT INTO quote_notification_outbox
    (id,message_id,request_id,idempotency_key,created_at,next_attempt_at,next_dispatch_at)
    SELECT m.id,m.id,m.request_id,?,?,?,? FROM quote_conversation_messages m
    WHERE m.id=? AND m.request_id=? AND m.author_role='admin' AND m.delivery_state='available'
    ON CONFLICT(message_id) DO NOTHING`,
    )
    .bind(
      `quote-conversation/${input.messageId}`,
      timestamp,
      timestamp,
      timestamp,
      input.messageId,
      input.requestId,
    );
}

const active = "state IN ('pending','retry','sending')";

export function createD1QuoteNotifications(database: D1Database) {
  const read = (id: string) =>
    database
      .prepare("SELECT * FROM quote_notification_outbox WHERE id=?")
      .bind(id)
      .first<NotificationRow>();
  return {
    read,
    async recipient(
      requestId: string,
      profileId: string | null = null,
      email: string | null = null,
    ) {
      const candidates = await database
        .prepare(
          `SELECT p.id,p.email_normalized AS email FROM customer_profiles p
        WHERE p.email_verified_at IS NOT NULL AND length(p.email_verified_at)>0
        AND (? IS NULL OR p.id=?) AND (? IS NULL OR p.email_normalized=?)
        AND (p.id=(SELECT profile_id FROM customer_quote_requests WHERE id=?)
          OR p.id IN (SELECT access.profile_id FROM customer_profile_purchasing_context_access access
            JOIN customer_quote_requests request ON request.purchasing_context_id=access.context_id WHERE request.id=?))
        ORDER BY p.id`,
        )
        .bind(profileId, profileId, email, email, requestId, requestId)
        .all<{ id: string; email: string }>();
      for (const candidate of candidates.results) {
        const owned = await database
          .prepare(
            `SELECT request.id FROM customer_quote_requests request
          ${ownedQuoteRequestWhere} AND request.id=?`,
          )
          .bind(candidate.id, candidate.id, candidate.id, requestId)
          .first();
        if (owned) return candidate;
      }
      return null;
    },
    source(row: NotificationRow) {
      return database
        .prepare(
          `SELECT body FROM quote_conversation_messages
        WHERE id=? AND request_id=? AND author_role='admin' AND delivery_state='available'`,
        )
        .bind(row.message_id, row.request_id)
        .first<{ body: string }>();
    },
    claim(id: string, now: number, leaseId: string) {
      return database
        .prepare(
          `UPDATE quote_notification_outbox SET state='sending',lease_id=?,lease_until=?
        WHERE id=? AND ${active} AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING *`,
        )
        .bind(leaseId, now + DELIVERY_LEASE_MS, id, now, now)
        .first<NotificationRow>();
    },
    async prepare(
      row: NotificationRow,
      input: {
        profileId: string;
        email: string;
        payload: string;
        mode: "stub" | "resend";
        tokenHash: string;
        now: number;
        expiresAt: number;
      },
    ) {
      await database.batch([
        database
          .prepare(
            `UPDATE quote_notification_outbox SET recipient_profile_id=?,recipient_email=?,protected_payload=?,delivery_mode=?
          WHERE id=? AND lease_id=? AND lease_until>? AND state='sending' AND protected_payload IS NULL`,
          )
          .bind(
            input.profileId,
            input.email,
            input.payload,
            input.mode,
            row.id,
            row.lease_id,
            input.now,
          ),
        database
          .prepare(
            `INSERT INTO quote_notification_reply_tokens
          (token_hash,notification_id,request_id,profile_id,recipient_email,created_at,expires_at)
          SELECT ?,id,request_id,recipient_profile_id,recipient_email,?,? FROM quote_notification_outbox
          WHERE id=? AND lease_id=? AND protected_payload=?
          ON CONFLICT(notification_id) DO NOTHING`,
          )
          .bind(
            input.tokenHash,
            input.now,
            input.expiresAt,
            row.id,
            row.lease_id,
            input.payload,
          ),
      ]);
      return read(row.id);
    },
    markAttempt(row: NotificationRow, now: number) {
      return database
        .prepare(
          `UPDATE quote_notification_outbox
        SET first_attempt_at=COALESCE(first_attempt_at,?),attempts=attempts+1
        WHERE id=? AND lease_id=? AND lease_until>? AND state='sending' RETURNING *`,
        )
        .bind(now, row.id, row.lease_id, now)
        .first<NotificationRow>();
    },
    async finish(
      row: NotificationRow,
      state: "sent" | "dead_letter" | "review",
      code: string | null,
      now: number,
      providerId: string | null = null,
    ) {
      await database
        .prepare(
          `UPDATE quote_notification_outbox SET state=?,failure_code=?,provider_id=?,completed_at=?,lease_id=NULL,lease_until=NULL
        WHERE id=? AND lease_id=? AND state='sending'`,
        )
        .bind(state, code, providerId, now, row.id, row.lease_id)
        .run();
    },
    async capture(row: NotificationRow, now: number) {
      await database.batch([
        database
          .prepare(
            `INSERT INTO quote_notification_local_captures(notification_id,protected_payload,captured_at)
          SELECT id,protected_payload,? FROM quote_notification_outbox
          WHERE id=? AND lease_id=? AND lease_until>? AND state='sending' AND delivery_mode='stub'
          ON CONFLICT(notification_id) DO NOTHING`,
          )
          .bind(now, row.id, row.lease_id, now),
        database
          .prepare(
            `UPDATE quote_notification_outbox SET state='sent',completed_at=?,provider_id=?,lease_id=NULL,lease_until=NULL
          WHERE id=? AND lease_id=? AND state='sending'
          AND EXISTS (SELECT 1 FROM quote_notification_local_captures WHERE notification_id=?)`,
          )
          .bind(now, `stub:${row.id}`, row.id, row.lease_id, row.id),
      ]);
    },
    async retry(row: NotificationRow, code: string, next: number) {
      await database
        .prepare(
          `UPDATE quote_notification_outbox SET state='retry',failure_code=?,next_attempt_at=?,next_dispatch_at=?,lease_id=NULL,lease_until=NULL
        WHERE id=? AND lease_id=? AND state='sending'`,
        )
        .bind(code, next, next, row.id, row.lease_id)
        .run();
    },
    async due(now: number, limit: number) {
      return (
        await database
          .prepare(
            `SELECT * FROM quote_notification_outbox WHERE ${active}
        AND next_dispatch_at<=? AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)
        ORDER BY next_dispatch_at,id LIMIT ?`,
          )
          .bind(now, now, now, limit)
          .all<NotificationRow>()
      ).results;
    },
    claimDispatch(row: NotificationRow, now: number) {
      return database
        .prepare(
          `UPDATE quote_notification_outbox SET next_dispatch_at=?,dispatch_attempts=dispatch_attempts+1
        WHERE id=? AND ${active} AND next_dispatch_at=? AND next_dispatch_at<=?
        AND (lease_until IS NULL OR lease_until<=?) RETURNING *`,
        )
        .bind(now + DELIVERY_LEASE_MS, row.id, row.next_dispatch_at, now, now)
        .first<NotificationRow>();
    },
    async dispatched(row: NotificationRow) {
      await database
        .prepare(
          `UPDATE quote_notification_outbox SET dispatch_attempts=0
        WHERE id=? AND next_dispatch_at=?`,
        )
        .bind(row.id, row.next_dispatch_at)
        .run();
    },
    async dispatchFailed(
      row: NotificationRow,
      next: number,
      terminal: boolean,
      now: number,
    ) {
      await database
        .prepare(
          `UPDATE quote_notification_outbox SET next_dispatch_at=?,failure_code='queue_unavailable',
        state=CASE WHEN ? THEN CASE WHEN first_attempt_at IS NULL THEN 'dead_letter' ELSE 'review' END ELSE state END,
        completed_at=CASE WHEN ? THEN ? ELSE completed_at END
        WHERE id=? AND next_dispatch_at=? AND ${active} AND (lease_until IS NULL OR lease_until<=?)`,
        )
        .bind(
          next,
          terminal ? 1 : 0,
          terminal ? 1 : 0,
          now,
          row.id,
          row.next_dispatch_at,
          now,
        )
        .run();
    },
    async adminList(
      options: NotificationAdminListOptions = {},
    ): Promise<NotificationAdminPage> {
      const { limit, filter, cursor } = notificationAdminPageOptions(options);
      if (
        cursor &&
        !(await database
          .prepare(
            "SELECT id FROM quote_notification_outbox WHERE id=? AND created_at=?",
          )
          .bind(cursor.id, cursor.createdAt)
          .first())
      )
        throw new Response("Invalid notification cursor", { status: 400 });
      const result = (
        await database
          .prepare(
            `SELECT o.id,o.message_id,o.request_id,o.state,o.created_at,o.attempts,
        o.dispatch_attempts,o.failure_code,o.next_attempt_at,o.completed_at,
        EXISTS(SELECT 1 FROM quote_notification_local_captures c WHERE c.notification_id=o.id) AS has_local_capture
        FROM quote_notification_outbox o
        WHERE (?='all' OR o.state IN ('review','dead_letter'))
          AND (? IS NULL OR o.created_at < ? OR (o.created_at = ? AND o.id < ?))
        ORDER BY o.created_at DESC,o.id DESC LIMIT ?`,
          )
          .bind(
            filter,
            cursor?.id ?? null,
            cursor?.createdAt ?? null,
            cursor?.createdAt ?? null,
            cursor?.id ?? null,
            limit + 1,
          )
          .all<AdminNotificationProjection>()
      ).results;
      const rows = result.slice(0, limit);
      const last = rows[rows.length - 1];
      return {
        rows,
        nextCursor:
          result.length > limit
            ? notificationAdminCursor({
                version: 1,
                filter,
                createdAt: last.created_at,
                id: last.id,
              })
            : null,
      };
    },
    capturePayload(id: string) {
      return database
        .prepare(
          "SELECT protected_payload FROM quote_notification_local_captures WHERE notification_id=?",
        )
        .bind(id)
        .first<{ protected_payload: string }>();
    },
    validReplyToken(id: string, now: number) {
      return database
        .prepare(
          "SELECT notification_id FROM quote_notification_reply_tokens WHERE notification_id=? AND expires_at>? AND revoked_at IS NULL",
        )
        .bind(id, now)
        .first();
    },
    replyScope(hash: string, email: string, now: number) {
      return database
        .prepare(
          `SELECT t.request_id,t.profile_id,t.recipient_email,t.expires_at
        FROM quote_notification_reply_tokens t JOIN quote_notification_outbox o ON o.id=t.notification_id
        WHERE t.token_hash=? AND t.recipient_email=? AND t.expires_at>? AND t.revoked_at IS NULL
        AND o.first_attempt_at IS NOT NULL`,
        )
        .bind(hash, email, now)
        .first<{
          request_id: string;
          profile_id: string;
          recipient_email: string;
          expires_at: number;
        }>();
    },
  };
}
