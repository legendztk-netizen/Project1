import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import {
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  SAFE_PROVIDER_RETRY_MS,
} from "../../quote-notifications/domain/quote-notification";

export interface AcceptanceCopyRow {
  id: string;
  recipient_profile_id: string;
  recipient_email: string;
  state: "pending" | "sending" | "retry" | "sent" | "review" | "dead_letter";
  created_at: number;
  next_attempt_at: number;
  next_dispatch_at: number;
  attempts: number;
  dispatch_attempts: number;
  generation: number;
  first_attempt_at: number | null;
  lease_id: string | null;
  lease_until: number | null;
  protected_payload: string | null;
  delivery_mode: "stub" | "resend" | null;
}
const active = "state IN ('pending','sending','retry')";
export function createD1PiAcceptanceCopies(db: D1Database) {
  return {
    read(id: string) {
      return db
        .prepare("SELECT * FROM pi_acceptance_copy_outbox WHERE id=?")
        .bind(id)
        .first<AcceptanceCopyRow>();
    },
    source(row: AcceptanceCopyRow) {
      return db
        .prepare(
          `SELECT a.evidence_json,a.pi_id,a.source,p.document_version,p.snapshot_json,p.snapshot_hash,p.document_number FROM pi_acceptances a
        JOIN proforma_invoices p ON p.id=a.pi_id WHERE a.id=? AND a.profile_id=?`,
        )
        .bind(row.id, row.recipient_profile_id)
        .first<{
          evidence_json: string;
          snapshot_json: string;
          snapshot_hash: string;
          document_number: string;
          pi_id: string;
          source: "website" | "email";
          document_version: number;
        }>();
    },
    authorized(row: AcceptanceCopyRow) {
      return db
        .prepare(
          `SELECT a.id FROM pi_acceptances a WHERE a.id=? AND a.profile_id=?
        AND EXISTS(SELECT 1 FROM customer_profiles WHERE id=? AND email_normalized=? AND length(email_verified_at)>0)
        AND EXISTS(SELECT request.id FROM customer_quote_requests request ${ownedQuoteRequestWhere} AND request.id=a.request_id)`,
        )
        .bind(
          row.id,
          row.recipient_profile_id,
          row.recipient_profile_id,
          row.recipient_email,
          row.recipient_profile_id,
          row.recipient_profile_id,
          row.recipient_profile_id,
        )
        .first();
    },
    claim(id: string, now: number, lease: string) {
      return db
        .prepare(
          `UPDATE pi_acceptance_copy_outbox SET state='sending',lease_id=?,lease_until=?
        WHERE id=? AND ${active} AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING *`,
        )
        .bind(lease, now + DELIVERY_LEASE_MS, id, now, now)
        .first<AcceptanceCopyRow>();
    },
    prepare(
      row: AcceptanceCopyRow,
      payload: string,
      mode: "stub" | "resend",
      now: number,
    ) {
      return db
        .prepare(
          `UPDATE pi_acceptance_copy_outbox SET protected_payload=?,delivery_mode=?
        WHERE id=? AND lease_id=? AND lease_until>? AND state='sending' AND protected_payload IS NULL RETURNING *`,
        )
        .bind(payload, mode, row.id, row.lease_id, now)
        .first<AcceptanceCopyRow>();
    },
    attempt(row: AcceptanceCopyRow, now: number) {
      return db
        .prepare(
          `UPDATE pi_acceptance_copy_outbox SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?)
        WHERE id=? AND lease_id=? AND lease_until>? AND state='sending' AND attempts<?
        AND (first_attempt_at IS NULL OR first_attempt_at>?) RETURNING *`,
        )
        .bind(
          now,
          row.id,
          row.lease_id,
          now,
          MAX_DELIVERY_ATTEMPTS,
          now - SAFE_PROVIDER_RETRY_MS,
        )
        .first<AcceptanceCopyRow>();
    },
    finish(
      row: AcceptanceCopyRow,
      state: "sent" | "review" | "dead_letter",
      code: string | null,
      now: number,
      providerId: string | null = null,
    ) {
      return db
        .prepare(
          `UPDATE pi_acceptance_copy_outbox SET state=?,failure_code=?,provider_id=?,completed_at=?,lease_id=NULL,lease_until=NULL
        WHERE id=? AND lease_id=? AND state='sending'`,
        )
        .bind(state, code, providerId, now, row.id, row.lease_id)
        .run();
    },
    retry(row: AcceptanceCopyRow, code: string, next: number) {
      return db
        .prepare(
          `UPDATE pi_acceptance_copy_outbox SET state='retry',failure_code=?,next_attempt_at=?,next_dispatch_at=?,lease_id=NULL,lease_until=NULL
        WHERE id=? AND lease_id=? AND state='sending'`,
        )
        .bind(code, next, next, row.id, row.lease_id)
        .run();
    },
    async capture(row: AcceptanceCopyRow, now: number) {
      await db.batch([
        db
          .prepare(
            `INSERT INTO pi_acceptance_copy_captures(acceptance_id,protected_payload,captured_at)
          SELECT id,protected_payload,? FROM pi_acceptance_copy_outbox WHERE id=? AND lease_id=? AND lease_until>? AND state='sending' AND delivery_mode='stub'
          ON CONFLICT(acceptance_id) DO NOTHING`,
          )
          .bind(now, row.id, row.lease_id, now),
        db
          .prepare(
            `UPDATE pi_acceptance_copy_outbox SET state='sent',completed_at=?,provider_id=?,lease_id=NULL,lease_until=NULL
          WHERE id=? AND lease_id=? AND state='sending' AND EXISTS(SELECT 1 FROM pi_acceptance_copy_captures WHERE acceptance_id=?)`,
          )
          .bind(now, `stub:${row.id}`, row.id, row.lease_id, row.id),
      ]);
    },
    async due(now: number, limit: number) {
      return (
        await db
          .prepare(
            `SELECT * FROM pi_acceptance_copy_outbox WHERE ${active} AND next_dispatch_at<=? AND next_attempt_at<=?
        AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_dispatch_at,id LIMIT ?`,
          )
          .bind(now, now, now, limit)
          .all<AcceptanceCopyRow>()
      ).results;
    },
    dispatchClaim(row: AcceptanceCopyRow, now: number) {
      return db
        .prepare(
          `UPDATE pi_acceptance_copy_outbox SET next_dispatch_at=?,dispatch_attempts=dispatch_attempts+1
        WHERE id=? AND ${active} AND next_dispatch_at=? AND (lease_until IS NULL OR lease_until<=?) RETURNING *`,
        )
        .bind(now + DELIVERY_LEASE_MS, row.id, row.next_dispatch_at, now)
        .first<AcceptanceCopyRow>();
    },
    dispatched(row: AcceptanceCopyRow) {
      return db
        .prepare(
          "UPDATE pi_acceptance_copy_outbox SET dispatch_attempts=0 WHERE id=? AND next_dispatch_at=?",
        )
        .bind(row.id, row.next_dispatch_at)
        .run();
    },
    dispatchFailed(row: AcceptanceCopyRow, now: number, delay: number) {
      return db
        .prepare(
          `UPDATE pi_acceptance_copy_outbox SET next_dispatch_at=?,failure_code='queue_unavailable',
        state=CASE WHEN dispatch_attempts>=? THEN 'review' ELSE state END
        WHERE id=? AND next_dispatch_at=? AND ${active} AND (lease_until IS NULL OR lease_until<=?)`,
        )
        .bind(
          now + delay * 1000,
          MAX_DELIVERY_ATTEMPTS,
          row.id,
          row.next_dispatch_at,
          now,
        )
        .run();
    },
    async list(limit: number, unresolved: boolean, before?: string) {
      const cursor = before
        ? await db
            .prepare(
              "SELECT id,created_at FROM pi_acceptance_copy_outbox WHERE id=?",
            )
            .bind(before)
            .first<{ id: string; created_at: number }>()
        : null;
      if (before && !cursor)
        throw new Response("Invalid copy cursor", { status: 400 });
      const rows = (
        await db
          .prepare(
            `SELECT o.id,o.state,o.attempts,o.dispatch_attempts,o.generation,o.failure_code,o.created_at,o.completed_at,o.first_attempt_at,
        a.pi_id,a.request_id,p.document_number,p.document_version,
        EXISTS(SELECT 1 FROM pi_acceptance_copy_captures WHERE acceptance_id=o.id) AS has_local_capture
        FROM pi_acceptance_copy_outbox o JOIN pi_acceptances a ON a.id=o.id JOIN proforma_invoices p ON p.id=a.pi_id
        WHERE (?=0 OR o.state IN ('review','dead_letter')) AND (? IS NULL OR o.created_at<? OR (o.created_at=? AND o.id<?)) ORDER BY o.created_at DESC,o.id DESC LIMIT ?`,
          )
          .bind(
            unresolved ? 1 : 0,
            cursor?.id ?? null,
            cursor?.created_at ?? null,
            cursor?.created_at ?? null,
            cursor?.id ?? null,
            limit + 1,
          )
          .all<{
            id: string;
            state: string;
            attempts: number;
            dispatch_attempts: number;
            generation: number;
            failure_code: string | null;
            created_at: number;
            completed_at: number | null;
            first_attempt_at: number | null;
            pi_id: string;
            request_id: string;
            document_number: string;
            document_version: number;
            has_local_capture: number;
          }>()
      ).results;
      return {
        rows: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
    capturePayload(id: string) {
      return db
        .prepare(
          "SELECT protected_payload FROM pi_acceptance_copy_captures WHERE acceptance_id=?",
        )
        .bind(id)
        .first<{ protected_payload: string }>();
    },
    reconciliation(commandId: string) {
      return db
        .prepare(
          "SELECT command_hash,acceptance_id FROM pi_acceptance_copy_reconciliations WHERE id=?",
        )
        .bind(commandId)
        .first<{ command_hash: string; acceptance_id: string }>();
    },
    async reconcile(input: {
      commandId: string;
      acceptanceId: string;
      generation: number;
      commandHash: string;
      outcome: "delivered" | "confirmed_not_delivered";
      providerId: string | null;
      reference: string;
      reason: string;
      actorId: string;
      now: number;
    }) {
      const {
        commandId,
        acceptanceId,
        generation,
        commandHash,
        outcome,
        providerId,
        reference,
        reason,
        actorId,
        now,
      } = input;
      await db.batch([
        db
          .prepare(
            `INSERT INTO pi_acceptance_copy_reconciliations(id,acceptance_id,generation,outcome,provider_id,evidence_reference,reason,actor_id,recorded_at,command_hash,prior_attempts,prior_first_attempt_at,prior_failure_code)
          SELECT ?,?,?,?,?,?,?,?,?,?,attempts,first_attempt_at,failure_code FROM pi_acceptance_copy_outbox WHERE id=? AND generation=? AND state IN ('review','dead_letter')
          AND (lease_until IS NULL OR lease_until<=?) ON CONFLICT(id) DO NOTHING`,
          )
          .bind(
            commandId,
            acceptanceId,
            generation,
            outcome,
            providerId,
            reference,
            reason,
            actorId,
            now,
            commandHash,
            acceptanceId,
            generation,
            now,
          ),
        db
          .prepare(
            `UPDATE pi_acceptance_copy_outbox SET
          state=CASE WHEN ?='delivered' THEN 'sent' ELSE 'retry' END,
          generation=generation+CASE WHEN ?='confirmed_not_delivered' THEN 1 ELSE 0 END,
          attempts=CASE WHEN ?='confirmed_not_delivered' THEN 0 ELSE attempts END,
          first_attempt_at=CASE WHEN ?='confirmed_not_delivered' THEN NULL ELSE first_attempt_at END,
          provider_id=?,completed_at=CASE WHEN ?='delivered' THEN ? ELSE NULL END,
          next_attempt_at=?,next_dispatch_at=?,dispatch_attempts=0,failure_code=NULL,lease_id=NULL,lease_until=NULL
          WHERE id=? AND generation=? AND state IN ('review','dead_letter')
          AND EXISTS(SELECT 1 FROM pi_acceptance_copy_reconciliations WHERE id=? AND acceptance_id=? AND generation=? AND command_hash=?)`,
          )
          .bind(
            outcome,
            outcome,
            outcome,
            outcome,
            providerId,
            outcome,
            now,
            now,
            now,
            acceptanceId,
            generation,
            commandId,
            acceptanceId,
            generation,
            commandHash,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.acceptance_copy_reconciled','pi_acceptance',?,?,?,? WHERE changes()=1`,
          )
          .bind(
            `pi-copy-reconciled:${commandId}`,
            acceptanceId,
            actorId,
            JSON.stringify({
              commandId,
              generation,
              outcome,
              providerId,
              reference,
              reason,
            }),
            new Date(now).toISOString(),
          ),
      ]);
    },
    async retryAdmin(id: string, actorId: string, reason: string, now: number) {
      const results = await db.batch([
        db
          .prepare(
            `UPDATE pi_acceptance_copy_outbox SET state='retry',next_attempt_at=?,next_dispatch_at=?,dispatch_attempts=0,completed_at=NULL
          WHERE id=? AND state IN ('review','dead_letter') AND attempts<? AND (first_attempt_at IS NULL OR first_attempt_at>?)`,
          )
          .bind(
            now,
            now,
            id,
            MAX_DELIVERY_ATTEMPTS,
            now - SAFE_PROVIDER_RETRY_MS,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.acceptance_copy_retry','pi_acceptance',?,?,?,? WHERE changes()=1`,
          )
          .bind(
            crypto.randomUUID(),
            id,
            actorId,
            JSON.stringify({ reason }),
            new Date(now).toISOString(),
          ),
      ]);
      return results[0].meta.changes === 1;
    },
  };
}
