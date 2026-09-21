import type { QuoteRevisionSnapshot } from "../../quote-review/domain/quote-revision";
import type { ProformaInvoiceSnapshot } from "../domain/proforma-invoice";
import {
  createD1PiLifecycle,
  replacementCurrentGuard,
  type PiReplacementIntentRow,
} from "./d1-pi-lifecycle";

import {
  createD1ProformaInvoiceRepository,
  type PiIntentRow,
  type PiPdfRecord,
} from "./d1-proforma-invoice-repository";
export type { PiIntentRow, PiRow } from "./d1-proforma-invoice-repository";

export function createD1PiReplacementRepository(db: D1Database) {
  // These same predicates run again in the final INSERT, after PDF/R2 work.
  const currentInputs = `
    i.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=i.request_id ORDER BY revision_number DESC LIMIT 1)
    AND EXISTS(SELECT 1 FROM quote_revisions q WHERE q.id=i.quote_revision_id AND q.request_id=i.request_id AND q.snapshot_hash=i.quote_revision_hash AND q.snapshot_json=i.source_revision_json)
    AND EXISTS(SELECT 1 FROM seller_identity_versions s WHERE s.id=i.seller_identity_id AND s.version=i.seller_version AND s.status='current')
    AND EXISTS(SELECT 1 FROM seller_payment_instruction_versions p WHERE p.id=i.payment_instruction_id AND p.version=i.payment_instruction_version AND p.channel=i.payment_channel AND p.status='current')
    AND (json_extract(i.source_revision_json,'$.terms.taxTreatment') <> 'Exempt'
      OR EXISTS(SELECT 1 FROM quote_private_evidence e WHERE e.id=json_extract(i.source_revision_json,'$.terms.taxEvidenceId') AND e.request_id=i.request_id AND e.kind='tax_exemption' AND e.visibility='internal'))
    AND ${replacementCurrentGuard}`;

  return {
    ...createD1ProformaInvoiceRepository(db),
    async reserve(intent: PiIntentRow, replacement: PiReplacementIntentRow) {
      const statement = db
        .prepare(
          `INSERT INTO proforma_invoice_intents(
        id,command_id,command_hash,request_id,quote_revision_id,quote_revision_hash,source_revision_json,
        seller_identity_id,seller_version,payment_instruction_id,payment_instruction_version,payment_channel,
        snapshot_json,snapshot_hash,issued_by,issued_at,valid_until)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(command_id) DO NOTHING`,
        )
        .bind(
          intent.id,
          intent.command_id,
          intent.command_hash,
          intent.request_id,
          intent.quote_revision_id,
          intent.quote_revision_hash,
          intent.source_revision_json,
          intent.seller_identity_id,
          intent.seller_version,
          intent.payment_instruction_id,
          intent.payment_instruction_version,
          intent.payment_channel,
          intent.snapshot_json,
          intent.snapshot_hash,
          intent.issued_by,
          intent.issued_at,
          intent.valid_until,
        );
      await db.batch([
        statement,
        createD1PiLifecycle(db).reserveStatement(replacement),
      ]);
    },
    async assertCurrent(intent: PiIntentRow) {
      const row = await db
        .prepare(
          `SELECT i.id FROM proforma_invoice_intents i WHERE i.id=? AND ${currentInputs}`,
        )
        .bind(intent.id)
        .first();
      if (!row)
        throw new Response("PI inputs changed; reload before issuing", {
          status: 409,
        });
    },
    async publish(intent: PiIntentRow, pdf: PiPdfRecord, publishedAt: string) {
      const snapshot = JSON.parse(
        intent.snapshot_json,
      ) as ProformaInvoiceSnapshot;
      const revision = JSON.parse(
        intent.source_revision_json,
      ) as QuoteRevisionSnapshot;
      const evidence =
        revision.terms.taxTreatment === "Exempt"
          ? revision.terms.taxEvidenceId
          : null;
      await db.batch([
        db
          .prepare(
            `INSERT INTO proforma_invoices(id,request_id,quote_revision_id,document_number,document_version,previous_pi_id,
          snapshot_json,snapshot_hash,pdf_object_key,pdf_sha256,pdf_byte_size,pdf_page_count,pdf_renderer_version,payment_channel,issued_by,issued_at,valid_until)
          SELECT i.id,i.request_id,i.quote_revision_id,?,(SELECT expected_document_version+1 FROM pi_replacement_intents WHERE pi_id=i.id),(SELECT previous_pi_id FROM pi_replacement_intents WHERE pi_id=i.id),i.snapshot_json,i.snapshot_hash,?,?,?,?,?,i.payment_channel,i.issued_by,i.issued_at,i.valid_until
          FROM proforma_invoice_intents i WHERE i.id=? AND ${currentInputs}
          AND julianday(i.valid_until)>julianday('now')
          AND julianday(i.valid_until)>julianday(?)
          AND julianday(i.issued_at)<=julianday(?)
          AND (? IS NULL OR EXISTS(SELECT 1 FROM quote_private_evidence e WHERE e.id=? AND e.request_id=i.request_id AND e.kind='tax_exemption' AND e.visibility='internal'))`,
          )
          .bind(
            snapshot.documentNumber,
            pdf.objectKey,
            pdf.sha256,
            pdf.byteSize,
            pdf.pageCount,
            pdf.rendererVersion,
            intent.id,
            publishedAt,
            publishedAt,
            evidence,
            evidence,
          ),
        db
          .prepare(
            `UPDATE proforma_invoice_heads SET pi_id=?,version=version+1
          WHERE request_id=(SELECT request_id FROM proforma_invoices WHERE id=?)
          AND pi_id=(SELECT previous_pi_id FROM pi_replacement_intents WHERE pi_id=?)
          AND version=(SELECT expected_head_version FROM pi_replacement_intents WHERE pi_id=?) AND changes()=1`,
          )
          .bind(intent.id, intent.id, intent.id, intent.id),
        db
          .prepare(
            `INSERT INTO pi_supersessions(previous_pi_id,replacement_pi_id,superseded_at)
          SELECT r.previous_pi_id,p.id,? FROM proforma_invoices p JOIN pi_replacement_intents r ON r.pi_id=p.id
          WHERE p.id=? AND changes()=1`,
          )
          .bind(publishedAt, intent.id),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'proforma_invoice.replaced','proforma_invoice',id,issued_by,?,? FROM proforma_invoices WHERE id=? AND changes()=1`,
          )
          .bind(
            `pi-issued:${intent.id}`,
            JSON.stringify({
              quoteRevisionId: intent.quote_revision_id,
              snapshotHash: intent.snapshot_hash,
              pdfSha256: pdf.sha256,
            }),
            publishedAt,
            intent.id,
          ),
      ]);
    },
  };
}
