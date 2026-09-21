import type { PiAcceptance } from "../domain/pi-acceptance";
import {
  piAcceptanceLiveSql,
  piAcceptanceLiveBindings,
  type AcceptancePiRow,
} from "./d1-pi-acceptance";

export interface PiEmailSource {
  id: string;
  request_id: string;
  profile_id: string;
  message_id: string;
  body: string;
  created_at: number;
  raw_key: string;
  raw_checksum: string;
  raw_size: number;
  protected_envelope: string;
  email: string;
}
const sourceSql = `SELECT r.id,r.request_id,c.profile_id,r.message_id,m.body,r.created_at,
  r.raw_key,r.raw_checksum,r.raw_size,r.protected_envelope,p.email_normalized AS email
  FROM quote_inbound_email_receipts r JOIN quote_inbound_email_content c ON c.receipt_id=r.id AND c.message_id=r.message_id AND c.request_id=r.request_id
  JOIN quote_conversation_messages m ON m.id=r.message_id AND m.request_id=r.request_id AND m.author_id=c.profile_id
  JOIN customer_profiles p ON p.id=c.profile_id
  WHERE r.state='appended' AND m.author_role='customer' AND m.source='email' AND m.delivery_state='available'
  AND length(p.email_verified_at)>0 AND r.raw_key IS NOT NULL AND r.protected_envelope IS NOT NULL`;

export function createD1PiEmailAcceptance(db: D1Database) {
  return {
    adminPi(requestId: string, piId: string) {
      return db
        .prepare(
          `SELECT p.*,q.purchasing_context_id,h.pi_id AS current_pi_id,h.version AS head_version,
        (SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1) AS current_quote_revision_id,
        (SELECT id FROM pi_acceptances WHERE pi_id=p.id) AS acceptance_id
        FROM proforma_invoices p JOIN customer_quote_requests q ON q.id=p.request_id
        LEFT JOIN proforma_invoice_heads h ON h.request_id=p.request_id WHERE p.request_id=? AND p.id=?`,
        )
        .bind(requestId, piId)
        .first<AcceptancePiRow & { acceptance_id: string | null }>();
    },
    async sourceChoices(requestId: string, before?: string) {
      const cursor = before
        ? await db
            .prepare(
              "SELECT id,created_at FROM quote_inbound_email_receipts WHERE id=? AND request_id=?",
            )
            .bind(before, requestId)
            .first<{ id: string; created_at: number }>()
        : null;
      if (before && !cursor)
        throw new Response("Invalid email cursor", { status: 400 });
      const rows = (
        await db
          .prepare(
            `${sourceSql} AND r.request_id=?
        AND (? IS NULL OR r.created_at<? OR (r.created_at=? AND r.id<?))
        ORDER BY r.created_at DESC,r.id DESC LIMIT 21`,
          )
          .bind(
            requestId,
            cursor?.id ?? null,
            cursor?.created_at ?? null,
            cursor?.created_at ?? null,
            cursor?.id ?? null,
          )
          .all<PiEmailSource>()
      ).results;
      return {
        rows: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19].id : null,
      };
    },
    source(requestId: string, messageId: string) {
      return db
        .prepare(`${sourceSql} AND r.request_id=? AND m.id=?`)
        .bind(requestId, messageId)
        .first<PiEmailSource>();
    },
    async accept(
      row: AcceptancePiRow,
      input: {
        id: string;
        evidenceId: string;
        adminId: string;
        commandId: string;
        commandHash: string;
        businessHash: string;
        evidence: PiAcceptance;
        source: PiEmailSource;
        reviewJson: string;
      },
    ) {
      const { source, evidence } = input;
      // The first INSERT is the live authorization/version/deadline decision.
      // D1 batch is atomic: rechecking wall time in a later statement could
      // otherwise commit orphan evidence if the deadline passes mid-batch.
      await db.batch([
        db
          .prepare(
            `INSERT INTO pi_email_acceptance_evidence(id,pi_id,request_id,profile_id,source_message_id,source_receipt_id,
          sender_email,received_at,raw_object_key,raw_sha256,raw_byte_size,acting_admin_id,review_json,recorded_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${piAcceptanceLiveSql})
          AND EXISTS(${sourceSql} AND r.id=? AND m.id=? AND c.profile_id=? AND r.request_id=?
            AND r.raw_checksum=? AND r.created_at=? AND p.email_normalized=?
            AND r.raw_key=? AND r.raw_size=? AND r.protected_envelope=? AND m.body=?)
          AND NOT EXISTS(SELECT 1 FROM pi_acceptances WHERE pi_id=?)
          ON CONFLICT(pi_id,source_receipt_id) DO NOTHING`,
          )
          .bind(
            input.evidenceId,
            row.id,
            row.request_id,
            source.profile_id,
            source.message_id,
            source.id,
            source.email,
            evidence.evidence.occurredAt,
            source.raw_key,
            source.raw_checksum,
            source.raw_size,
            input.adminId,
            input.reviewJson,
            evidence.acceptedAt,
            ...piAcceptanceLiveBindings(
              row,
              source.profile_id,
              evidence.acceptedAt,
            ),
            source.id,
            source.message_id,
            source.profile_id,
            row.request_id,
            source.raw_checksum,
            source.created_at,
            source.email,
            source.raw_key,
            source.raw_size,
            source.protected_envelope,
            source.body,
            row.id,
          ),
        db
          .prepare(
            `INSERT INTO pi_acceptances(id,pi_id,request_id,profile_id,purchasing_context_id,source,
          document_version,snapshot_hash,quote_revision_id,view_id,accepted_at,business_hash,evidence_json)
          SELECT ?,?,?,?,?,'email',?,?,?,NULL,?,?,?
          WHERE changes()=1 AND EXISTS(SELECT 1 FROM pi_email_acceptance_evidence WHERE id=? AND pi_id=? AND acting_admin_id=?)
          ON CONFLICT(pi_id) DO NOTHING`,
          )
          .bind(
            input.id,
            row.id,
            row.request_id,
            source.profile_id,
            row.purchasing_context_id,
            row.document_version,
            row.snapshot_hash,
            row.quote_revision_id,
            evidence.acceptedAt,
            input.businessHash,
            JSON.stringify(evidence),
            input.evidenceId,
            row.id,
            input.adminId,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.accepted','proforma_invoice',?,?,?,? WHERE changes()=1`,
          )
          .bind(
            `pi-accepted:${input.id}`,
            row.id,
            input.adminId,
            JSON.stringify({
              acceptanceId: input.id,
              source: "email",
              evidenceId: input.evidenceId,
            }),
            evidence.acceptedAt,
          ),
        db
          .prepare(
            `INSERT INTO pi_acceptance_commands(id,acceptance_id,pi_id,profile_id,command_hash)
          SELECT ?,a.id,a.pi_id,a.profile_id,? FROM pi_acceptances a
          WHERE a.pi_id=? AND a.source='email' AND a.profile_id=? AND a.business_hash=?`,
          )
          .bind(
            input.commandId,
            input.commandHash,
            row.id,
            source.profile_id,
            input.businessHash,
          ),
      ]);
    },
  };
}
