import type { PiLifecycleRecord } from "../domain/pi-lifecycle";
import type { ProformaInvoiceSnapshot } from "../domain/proforma-invoice";
import type { PiLifecycleRow } from "../infrastructure/d1-pi-lifecycle";

// Only call after verifying snapshot_json against snapshot_hash.
export function lifecycleRecord(row: PiLifecycleRow): PiLifecycleRecord {
  const snapshot = JSON.parse(row.snapshot_json) as ProformaInvoiceSnapshot;
  return {
    piId: row.id,
    documentVersion: row.document_version,
    snapshotHash: row.snapshot_hash,
    requestId: row.request_id,
    quoteRevisionId: row.quote_revision_id,
    totalCents: snapshot.totals.totalCents,
    issuedAt: row.issued_at,
    validUntil: row.valid_until,
    acceptance: row.acceptance_id
      ? {
          id: row.acceptance_id,
          piId: row.id,
          documentVersion: row.acceptance_document_version!,
          snapshotHash: row.acceptance_snapshot_hash!,
          acceptedAt: row.accepted_at!,
        }
      : null,
    supersededAt: row.superseded_at,
    supersededByPiId: row.superseded_by_pi_id,
  };
}
