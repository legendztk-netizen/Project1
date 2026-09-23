import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";
import type { PiRow } from "./d1-proforma-invoice-repository";
import type { PiAcceptance } from "../domain/pi-acceptance";
import type { ProformaInvoiceSnapshot } from "../domain/proforma-invoice";
import { paymentDeadlineOnAcceptance } from "./d1-pi-payment-deadline";
import { orderCreationStatements } from "./d1-order-creation";

export interface AcceptancePiRow extends PiRow {
  purchasing_context_id: string;
  current_pi_id: string | null;
  head_version: number | null;
  current_quote_revision_id: string | null;
}
export interface PiViewRow {
  id: string;
  pi_id: string;
  profile_id: string;
  purchasing_context_id: string;
  document_version: number;
  snapshot_hash: string;
  pdf_sha256: string;
  pdf_byte_size: number;
  kind: "view" | "download";
  occurred_at: string;
}
export interface PiAcceptanceRow {
  id: string;
  pi_id: string;
  profile_id: string;
  purchasing_context_id: string;
  source: "website" | "email";
  business_hash: string;
  evidence_json: string;
}
export interface AcceptanceReceipt {
  id: string;
  pi_id: string;
  profile_id: string;
  acceptance_id: string;
  command_hash: string;
}

// Shared current organization ownership plus live verified profile evidence.
const ownership = `SELECT request.id FROM customer_quote_requests request
  ${ownedQuoteRequestWhere} AND request.id=p.request_id
  AND EXISTS(SELECT 1 FROM customer_profiles profile WHERE profile.id=?
    AND profile.email_verified_at IS NOT NULL AND length(profile.email_verified_at)>0)`;
const ownerBindings = (profileId: string) => [
  profileId,
  profileId,
  profileId,
  profileId,
];
export const piAcceptanceLiveSql = `SELECT p.id FROM proforma_invoices p
  JOIN proforma_invoice_heads h ON h.pi_id=p.id AND h.request_id=p.request_id
  JOIN customer_quote_requests q ON q.id=p.request_id
  WHERE p.id=? AND p.request_id=? AND p.document_version=? AND p.snapshot_hash=?
    AND p.snapshot_json=? AND p.quote_revision_id=? AND h.version=?
    AND q.purchasing_context_id=?
    AND p.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1)
    AND julianday(p.issued_at)<=julianday('now') AND julianday(p.valid_until)>julianday('now')
    AND julianday(p.issued_at)<=julianday(?) AND julianday(p.valid_until)>julianday(?)
    AND EXISTS(${ownership})`;
export function piAcceptanceLiveBindings(
  row: AcceptancePiRow,
  profileId: string,
  now: string,
) {
  return [
    row.id,
    row.request_id,
    row.document_version,
    row.snapshot_hash,
    row.snapshot_json,
    row.quote_revision_id,
    row.head_version,
    row.purchasing_context_id,
    now,
    now,
    ...ownerBindings(profileId),
  ];
}

export function createD1PiAcceptance(db: D1Database) {
  function receiptStatement(input: {
    commandId: string;
    commandHash: string;
    piId: string;
    profileId: string;
    businessHash: string;
    source?: "website" | "email";
  }) {
    return db
      .prepare(
        `INSERT INTO pi_acceptance_commands(id,acceptance_id,pi_id,profile_id,command_hash)
      SELECT ?,a.id,a.pi_id,a.profile_id,? FROM pi_acceptances a
      JOIN proforma_invoices p ON p.id=a.pi_id
      WHERE a.pi_id=? AND a.profile_id=? AND a.business_hash=? AND a.source=?
      AND EXISTS(${ownership})`,
      )
      .bind(
        input.commandId,
        input.commandHash,
        input.piId,
        input.profileId,
        input.businessHash,
        input.source ?? "website",
        ...ownerBindings(input.profileId),
      );
  }
  return {
    owned(profileId: string, requestId: string, piId?: string) {
      return db
        .prepare(
          `SELECT p.*,q.purchasing_context_id,h.pi_id AS current_pi_id,h.version AS head_version,
        (SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1) AS current_quote_revision_id
        FROM proforma_invoices p JOIN customer_quote_requests q ON q.id=p.request_id
        LEFT JOIN proforma_invoice_heads h ON h.request_id=p.request_id
        WHERE p.request_id=? AND ${piId ? "p.id=?" : "p.id=h.pi_id"} AND EXISTS(${ownership})`,
        )
        .bind(requestId, ...(piId ? [piId] : []), ...ownerBindings(profileId))
        .first<AcceptancePiRow>();
    },
    async views(row: AcceptancePiRow, profileId: string) {
      return (
        await db
          .prepare(
            `SELECT v.* FROM pi_customer_views v JOIN proforma_invoices p ON p.id=v.pi_id
        WHERE v.pi_id=? AND v.profile_id=? AND v.purchasing_context_id=? AND EXISTS(${ownership})
        ORDER BY v.occurred_at DESC,v.id DESC LIMIT 2`,
          )
          .bind(
            row.id,
            profileId,
            row.purchasing_context_id,
            ...ownerBindings(profileId),
          )
          .all<PiViewRow>()
      ).results;
    },
    acceptance(piId: string, profileId: string) {
      return db
        .prepare(
          `SELECT a.* FROM pi_acceptances a JOIN proforma_invoices p ON p.id=a.pi_id
        WHERE a.pi_id=? AND EXISTS(${ownership})`,
        )
        .bind(piId, ...ownerBindings(profileId))
        .first<PiAcceptanceRow>();
    },
    command(commandId: string) {
      return db
        .prepare("SELECT * FROM pi_acceptance_commands WHERE id=?")
        .bind(commandId)
        .first<AcceptanceReceipt>();
    },
    async recordView(
      row: AcceptancePiRow,
      profileId: string,
      input: {
        id: string;
        kind: "view" | "download";
        now: string;
        requestEvidenceJson: string;
      },
    ) {
      await db
        .prepare(
          `INSERT INTO pi_customer_views(id,pi_id,request_id,profile_id,purchasing_context_id,
        document_version,snapshot_hash,pdf_sha256,pdf_byte_size,kind,occurred_at,request_evidence_json)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${piAcceptanceLiveSql})
        AND EXISTS(SELECT 1 FROM proforma_invoices WHERE id=? AND pdf_sha256=? AND pdf_byte_size=?)
        ON CONFLICT(pi_id,profile_id,purchasing_context_id,kind) DO NOTHING`,
        )
        .bind(
          input.id,
          row.id,
          row.request_id,
          profileId,
          row.purchasing_context_id,
          row.document_version,
          row.snapshot_hash,
          row.pdf_sha256,
          row.pdf_byte_size,
          input.kind,
          input.now,
          input.requestEvidenceJson,
          ...piAcceptanceLiveBindings(row, profileId, input.now),
          row.id,
          row.pdf_sha256,
          row.pdf_byte_size,
        )
        .run();
    },
    replay(input: {
      commandId: string;
      commandHash: string;
      piId: string;
      profileId: string;
      businessHash: string;
      source?: "website" | "email";
    }) {
      return receiptStatement(input).run();
    },
    async accept(
      row: AcceptancePiRow,
      input: {
        id: string;
        profileId: string;
        commandId: string;
        commandHash: string;
        businessHash: string;
        evidence: PiAcceptance;
        view: PiViewRow;
      },
    ) {
      const { evidence, view } = input;
      const fixed = JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
      await db.batch([
        db
          .prepare(
            `INSERT INTO pi_acceptances(id,pi_id,request_id,profile_id,purchasing_context_id,source,
          document_version,snapshot_hash,quote_revision_id,view_id,accepted_at,business_hash,evidence_json)
          SELECT ?,?,?,?,?,'website',?,?,?,?,?,?,? WHERE EXISTS(${piAcceptanceLiveSql})
          AND EXISTS(SELECT 1 FROM pi_customer_views v WHERE v.id=? AND v.pi_id=? AND v.profile_id=?
            AND v.purchasing_context_id=? AND v.document_version=? AND v.snapshot_hash=?
            AND v.pdf_sha256=? AND v.pdf_byte_size=? AND julianday(v.occurred_at)<=julianday(?))
          ON CONFLICT(pi_id) DO NOTHING`,
          )
          .bind(
            input.id,
            row.id,
            row.request_id,
            input.profileId,
            row.purchasing_context_id,
            row.document_version,
            row.snapshot_hash,
            row.quote_revision_id,
            view.id,
            evidence.acceptedAt,
            input.businessHash,
            JSON.stringify(evidence),
            ...piAcceptanceLiveBindings(
              row,
              input.profileId,
              evidence.acceptedAt,
            ),
            view.id,
            row.id,
            input.profileId,
            row.purchasing_context_id,
            row.document_version,
            row.snapshot_hash,
            row.pdf_sha256,
            row.pdf_byte_size,
            evidence.acceptedAt,
          ),
        db
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?,'pi.accepted','proforma_invoice',?,?,?,? WHERE changes()=1`,
          )
          .bind(
            `pi-accepted:${input.id}`,
            row.id,
            input.profileId,
            JSON.stringify({
              acceptanceId: input.id,
              source: "website",
              piId: row.id,
              snapshotHash: row.snapshot_hash,
            }),
            evidence.acceptedAt,
          ),
        receiptStatement({ ...input, piId: row.id }),
        ...paymentDeadlineOnAcceptance(db, fixed, {
          piId: row.id,
          acceptanceId: input.id,
          acceptedAt: evidence.acceptedAt,
          actorId: input.profileId,
        }),
        ...(fixed.paymentTerms
          ? await orderCreationStatements(db, {
              piId: row.id,
              requestId: row.request_id,
              now: evidence.acceptedAt,
              finalEvent: "acceptance",
            })
          : []),
      ]);
    },
  };
}
