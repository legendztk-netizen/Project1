import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import type { PiRow } from "./d1-proforma-invoice-repository";

export interface PiReplacementIntentRow {
  pi_id: string;
  previous_pi_id: string;
  expected_head_version: number;
  expected_document_version: number;
  expected_snapshot_hash: string;
  expected_acceptance_id: string | null;
  previous_snapshot_json: string;
  previous_source_json: string;
  reason_json: string;
  material_json: string;
}
export interface PiLifecycleRow extends PiRow {
  head_version: number;
  current_pi_id: string;
  current_quote_revision_id: string;
  source_revision_json: string;
  source_revision_hash: string;
  acceptance_id: string | null;
  acceptance_document_version: number | null;
  acceptance_snapshot_hash: string | null;
  accepted_at: string | null;
  superseded_at: string | null;
  superseded_by_pi_id: string | null;
}

// IDs must resolve to immutable evidence on this RFQ, never to arbitrary form prose.
// Conversation attachment evidence uses its owning message ID.
export const replacementEvidenceGuard = `NOT EXISTS(
  SELECT 1 FROM json_each(r.reason_json,'$.evidenceIds') evidence
  WHERE NOT EXISTS(SELECT 1 FROM quote_private_evidence e WHERE e.id=evidence.value AND e.request_id=i.request_id AND e.visibility='internal')
    AND NOT EXISTS(SELECT 1 FROM quote_internal_notes n WHERE n.id=evidence.value AND n.request_id=i.request_id)
    AND NOT EXISTS(SELECT 1 FROM quote_conversation_messages m WHERE m.id=evidence.value AND m.request_id=i.request_id))`;

export const replacementCurrentGuard = `EXISTS(
  SELECT 1 FROM pi_replacement_intents r
  JOIN proforma_invoices old ON old.id=r.previous_pi_id AND old.request_id=i.request_id
  JOIN proforma_invoice_intents original ON original.id=old.id
  JOIN proforma_invoice_heads h ON h.request_id=old.request_id AND h.pi_id=old.id
  WHERE r.pi_id=i.id AND h.version=r.expected_head_version
    AND old.document_version=r.expected_document_version AND old.snapshot_hash=r.expected_snapshot_hash
    AND old.snapshot_json=r.previous_snapshot_json AND original.source_revision_json=r.previous_source_json
    AND (SELECT id FROM pi_acceptances WHERE pi_id=old.id) IS r.expected_acceptance_id
    AND NOT EXISTS(SELECT 1 FROM pi_supersessions WHERE previous_pi_id=old.id)
    AND old.quote_revision_id<>i.quote_revision_id
    AND ${replacementEvidenceGuard})`;

const stateSelect = `SELECT p.*,h.version AS head_version,h.pi_id AS current_pi_id,
  (SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1) AS current_quote_revision_id,
  i.source_revision_json,i.quote_revision_hash AS source_revision_hash,
  a.id AS acceptance_id,a.document_version AS acceptance_document_version,a.snapshot_hash AS acceptance_snapshot_hash,a.accepted_at,
  s.superseded_at,s.replacement_pi_id AS superseded_by_pi_id
  FROM proforma_invoices p JOIN proforma_invoice_heads h ON h.request_id=p.request_id
  JOIN proforma_invoice_intents i ON i.id=p.id
  LEFT JOIN pi_acceptances a ON a.pi_id=p.id
  LEFT JOIN pi_supersessions s ON s.previous_pi_id=p.id`;

export function createD1PiLifecycle(db: D1Database) {
  return {
    async evidence(requestId: string) {
      return (
        await db
          .prepare(
            `SELECT id,'note' AS kind,substr(body,1,200) AS label,created_at AS createdAt FROM quote_internal_notes WHERE request_id=?
        UNION ALL SELECT id,'file',filename,created_at FROM quote_private_evidence WHERE request_id=? AND visibility='internal'
        UNION ALL SELECT id,'message',substr(body,1,200),created_at FROM quote_conversation_messages WHERE request_id=?
        ORDER BY createdAt DESC LIMIT 200`,
          )
          .bind(requestId, requestId, requestId)
          .all<{ id: string; kind: string; label: string; createdAt: string }>()
      ).results;
    },
    async pdfJobs(requestId: string) {
      return (
        await db
          .prepare(
            `SELECT j.command_id AS commandId,j.state,j.attempts FROM proforma_invoice_pdf_jobs j
        JOIN proforma_invoice_intents i ON i.command_id=j.command_id JOIN pi_replacement_intents r ON r.pi_id=i.id
        WHERE i.request_id=? AND j.state<>'completed' AND NOT EXISTS(SELECT 1 FROM proforma_invoices p WHERE p.id=i.id)
        ORDER BY i.issued_at DESC`,
          )
          .bind(requestId)
          .all<{ commandId: string; state: string; attempts: number }>()
      ).results;
    },
    intent(piId: string) {
      return db
        .prepare("SELECT * FROM pi_replacement_intents WHERE pi_id=?")
        .bind(piId)
        .first<PiReplacementIntentRow>();
    },
    reserveStatement(row: PiReplacementIntentRow) {
      return db
        .prepare(
          `INSERT INTO pi_replacement_intents(pi_id,previous_pi_id,expected_head_version,expected_document_version,expected_snapshot_hash,expected_acceptance_id,previous_snapshot_json,previous_source_json,reason_json,material_json)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()=1`,
        )
        .bind(
          row.pi_id,
          row.previous_pi_id,
          row.expected_head_version,
          row.expected_document_version,
          row.expected_snapshot_hash,
          row.expected_acceptance_id,
          row.previous_snapshot_json,
          row.previous_source_json,
          row.reason_json,
          row.material_json,
        );
    },
    current(requestId: string) {
      return db
        .prepare(`${stateSelect} WHERE p.request_id=? AND p.id=h.pi_id`)
        .bind(requestId)
        .first<PiLifecycleRow>();
    },
    async history(requestId: string, profileId?: string) {
      return (
        await db
          .prepare(
            `${stateSelect} WHERE p.request_id=? ${profileId === undefined ? "" : `AND EXISTS(SELECT request.id FROM customer_quote_requests request ${ownedQuoteRequestWhere} AND request.id=p.request_id)`} ORDER BY p.document_version DESC`,
          )
          .bind(
            requestId,
            ...(profileId === undefined
              ? []
              : [profileId, profileId, profileId]),
          )
          .all<PiLifecycleRow>()
      ).results;
    },
  };
}
