import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import type { QuoteRevisionSnapshot } from "../../quote-review/domain/quote-revision";
import type {
  PaymentChannel,
  PaymentInstructionVersion,
  SellerIdentityVersion,
} from "../../seller-settings/domain/seller-commercial-settings";
import type { ProformaInvoiceSnapshot } from "../domain/proforma-invoice";
import { dueDateInstant } from "../domain/pi-payment-terms";

export interface PiIntentRow {
  id: string;
  command_id: string;
  command_hash: string;
  request_id: string;
  quote_revision_id: string;
  quote_revision_hash: string;
  source_revision_json: string;
  seller_identity_id: string;
  seller_version: number;
  payment_instruction_id: string;
  payment_instruction_version: number;
  payment_channel: PaymentChannel;
  snapshot_json: string;
  snapshot_hash: string;
  issued_by: string;
  issued_at: string;
  valid_until: string;
}

export interface PiRow {
  id: string;
  request_id: string;
  quote_revision_id: string;
  document_number: string;
  document_version: number;
  previous_pi_id: string | null;
  snapshot_json: string;
  snapshot_hash: string;
  pdf_object_key: string;
  pdf_sha256: string;
  pdf_byte_size: number;
  pdf_page_count: number;
  pdf_renderer_version: string;
  payment_channel: PaymentChannel;
  issued_by: string;
  issued_at: string;
  valid_until: string;
}

export interface PiPdfRecord {
  objectKey: string;
  sha256: string;
  byteSize: number;
  pageCount: number;
  rendererVersion: string;
}

export function createD1ProformaInvoiceRepository(db: D1Database) {
  // These same predicates run again in the final INSERT, after PDF/R2 work.
  const currentInputs = `
    i.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=i.request_id ORDER BY revision_number DESC LIMIT 1)
    AND EXISTS(SELECT 1 FROM quote_revisions q WHERE q.id=i.quote_revision_id AND q.request_id=i.request_id AND q.snapshot_hash=i.quote_revision_hash AND q.snapshot_json=i.source_revision_json)
    AND EXISTS(SELECT 1 FROM seller_identity_versions s WHERE s.id=i.seller_identity_id AND s.version=i.seller_version AND s.status='current')
    AND EXISTS(SELECT 1 FROM seller_payment_instruction_versions p WHERE p.id=i.payment_instruction_id AND p.version=i.payment_instruction_version AND p.channel=i.payment_channel AND p.status='current')
    AND (json_extract(i.source_revision_json,'$.terms.taxTreatment') <> 'Exempt'
      OR EXISTS(SELECT 1 FROM quote_private_evidence e WHERE e.id=json_extract(i.source_revision_json,'$.terms.taxEvidenceId') AND e.request_id=i.request_id AND e.kind='tax_exemption' AND e.visibility='internal'))
    AND NOT EXISTS(SELECT 1 FROM proforma_invoice_heads h WHERE h.request_id=i.request_id)
    AND NOT EXISTS(SELECT 1 FROM proforma_invoices p WHERE p.request_id=i.request_id)`;

  return {
    currentQuote(requestId: string) {
      return db
        .prepare(
          "SELECT id,snapshot_json,snapshot_hash FROM quote_revisions WHERE request_id=? ORDER BY revision_number DESC LIMIT 1",
        )
        .bind(requestId)
        .first<{ id: string; snapshot_json: string; snapshot_hash: string }>();
    },
    currentSeller() {
      return db
        .prepare(
          `SELECT id,version,legal_name AS legalName,registered_address_en AS registeredAddressEn,
        registered_country_code AS registeredCountryCode,status,created_at AS createdAt,created_by AS createdBy,superseded_at AS supersededAt
        FROM seller_identity_versions WHERE status='current'`,
        )
        .first<SellerIdentityVersion>();
    },
    currentPayment(channel: PaymentChannel) {
      return db
        .prepare(
          `SELECT id,version,channel,instructions,status,created_at AS createdAt,created_by AS createdBy,superseded_at AS supersededAt
        FROM seller_payment_instruction_versions WHERE channel=? AND status='current'`,
        )
        .bind(channel)
        .first<PaymentInstructionVersion>();
    },
    paymentById(id: string, version: number) {
      return db
        .prepare(
          `SELECT id,version,channel,instructions,status,created_at AS createdAt,created_by AS createdBy,superseded_at AS supersededAt
           FROM seller_payment_instruction_versions WHERE id=? AND version=?`,
        )
        .bind(id, version)
        .first<PaymentInstructionVersion>();
    },
    intent(commandId: string) {
      return db
        .prepare("SELECT * FROM proforma_invoice_intents WHERE command_id=?")
        .bind(commandId)
        .first<PiIntentRow>();
    },
    byId(requestId: string, id: string) {
      return db
        .prepare("SELECT * FROM proforma_invoices WHERE request_id=? AND id=?")
        .bind(requestId, id)
        .first<PiRow>();
    },
    current(requestId: string) {
      return db
        .prepare(
          "SELECT p.* FROM proforma_invoices p JOIN proforma_invoice_heads h ON h.pi_id=p.id AND h.request_id=p.request_id WHERE p.request_id=?",
        )
        .bind(requestId)
        .first<PiRow>();
    },
    owned(profileId: string, requestId: string, id?: string) {
      return db
        .prepare(
          `SELECT p.* FROM proforma_invoices p
        ${id ? "" : "JOIN proforma_invoice_heads h ON h.pi_id=p.id AND h.request_id=p.request_id"}
        WHERE p.request_id=? ${id ? "AND p.id=?" : ""}
        AND EXISTS(SELECT request.id FROM customer_quote_requests request ${ownedQuoteRequestWhere} AND request.id=p.request_id)`,
        )
        .bind(requestId, ...(id ? [id] : []), profileId, profileId, profileId)
        .first<PiRow>();
    },
    async requireOwnedQuote(profileId: string, requestId: string) {
      const row = await db
        .prepare(
          `SELECT request.id FROM customer_quote_requests request ${ownedQuoteRequestWhere} AND request.id=?`,
        )
        .bind(profileId, profileId, profileId, requestId)
        .first();
      if (!row) throw new Response("Not found", { status: 404 });
    },
    async reserve(intent: PiIntentRow) {
      await db
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
        )
        .run();
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
    async publish(intent: PiIntentRow, pdf: PiPdfRecord) {
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
          SELECT i.id,i.request_id,i.quote_revision_id,?,1,NULL,i.snapshot_json,i.snapshot_hash,?,?,?,?,?,i.payment_channel,i.issued_by,i.issued_at,i.valid_until
          FROM proforma_invoice_intents i WHERE i.id=? AND ${currentInputs}
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
            evidence,
            evidence,
          ),
        db
          .prepare(
            `INSERT INTO proforma_invoice_heads(request_id,pi_id,version)
          SELECT request_id,id,1 FROM proforma_invoices WHERE id=? AND changes()=1`,
          )
          .bind(intent.id),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'proforma_invoice.issued','proforma_invoice',id,issued_by,?,issued_at FROM proforma_invoices WHERE id=? AND changes()=1`,
          )
          .bind(
            `pi-issued:${intent.id}`,
            JSON.stringify({
              quoteRevisionId: intent.quote_revision_id,
              snapshotHash: intent.snapshot_hash,
              pdfSha256: pdf.sha256,
            }),
            intent.id,
          ),
        db
          .prepare(
            `INSERT INTO pi_payment_accounts(pi_id,request_id,purchasing_context_id,currency,total_due_cents,
          term_kind,calendar_version,fixed_due_date_et,due_date_et,due_at,instruction_channel,instruction_id,
          instruction_version,created_at,updated_at)
          SELECT p.id,p.request_id,q.purchasing_context_id,'USD',?, ?, ?, ?, ?, ?, ?, ?, ?,p.issued_at,p.issued_at
          FROM proforma_invoices p JOIN customer_quote_requests q ON q.id=p.request_id WHERE p.id=?`,
          )
          .bind(
            snapshot.totals.totalCents,
            snapshot.paymentTerms?.kind ?? "legacy_review",
            snapshot.paymentTerms?.calendarVersion ?? null,
            snapshot.paymentTerms?.kind === "fixed_et_date"
              ? snapshot.paymentTerms.dueDateEt
              : null,
            snapshot.paymentTerms?.kind === "fixed_et_date"
              ? snapshot.paymentTerms.dueDateEt
              : null,
            snapshot.paymentTerms?.kind === "fixed_et_date"
              ? dueDateInstant(snapshot.paymentTerms.dueDateEt)
              : null,
            snapshot.paymentSelection.channel,
            snapshot.paymentSelection.instructionId,
            snapshot.paymentSelection.instructionVersion,
            intent.id,
          ),
      ]);
    },
  };
}
