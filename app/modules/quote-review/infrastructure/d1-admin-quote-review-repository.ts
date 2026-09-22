import {
  filterAdminQuoteReviews,
  projectAdminQuoteReview,
  type AdminQuoteReviewFilters,
  type AdminQuoteReviewSource,
  type AdminQuoteReviewState,
} from "../domain/admin-quote-review";
import {
  technicalReviewContext,
  technicalReviewContexts,
} from "./d1-technical-review";

interface AdminQuoteReviewRow {
  id: string;
  reference_number: string;
  snapshot_json: string;
  submitted_at: string;
  review_state: AdminQuoteReviewState;
}

const reviewSelect = `SELECT request.id, request.reference_number, request.snapshot_json, request.submitted_at,
  CASE
    WHEN a.id IS NOT NULL THEN 'pi_accepted'
    WHEN p.id IS NOT NULL AND julianday(p.valid_until) <= julianday('now') THEN 'pi_expired'
    WHEN p.id IS NOT NULL THEN 'pi_ready'
    WHEN q.id IS NOT NULL THEN 'quote_ready'
    WHEN EXISTS (SELECT 1 FROM quote_preparation_drafts d WHERE d.request_id=request.id) THEN 'reviewing'
    ELSE 'awaiting_review'
  END AS review_state
  FROM customer_quote_requests request
  LEFT JOIN quote_revisions q ON q.id=(SELECT r.id FROM quote_revisions r WHERE r.request_id=request.id ORDER BY r.revision_number DESC LIMIT 1)
  LEFT JOIN proforma_invoice_heads h ON h.request_id=request.id
  LEFT JOIN proforma_invoices p ON p.id=h.pi_id AND p.request_id=request.id AND p.quote_revision_id=q.id
  LEFT JOIN pi_acceptances a ON a.pi_id=p.id AND a.request_id=request.id
    AND a.quote_revision_id=q.id AND a.document_version=p.document_version
    AND a.snapshot_hash=p.snapshot_hash AND a.purchasing_context_id=request.purchasing_context_id`;

function source(row: AdminQuoteReviewRow): AdminQuoteReviewSource {
  let snapshot: unknown = null;
  try {
    snapshot = JSON.parse(row.snapshot_json) as unknown;
  } catch {
    // Historical rows remain inspectable even if their payload is malformed.
  }
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    snapshot,
    submittedAt: row.submitted_at,
    reviewState: row.review_state,
  };
}

export function createD1AdminQuoteReviewRepository(database: D1Database) {
  async function project(
    row: AdminQuoteReviewRow,
    loaded?: Awaited<ReturnType<typeof technicalReviewContext>>,
  ) {
    const technical =
      loaded ?? (await technicalReviewContext(database, row.id));
    return projectAdminQuoteReview({
      ...source(row),
      technicalSnapshot: technical.snapshot,
      technicalCompletion: technical.completion,
      technicalReviewInvalidated:
        technical.previouslyReviewed && !technical.completion,
    });
  }
  return {
    async find(requestId: string) {
      const row = await database
        .prepare(
          `${reviewSelect}
           WHERE request.id = ?
           LIMIT 1`,
        )
        .bind(requestId)
        .first<AdminQuoteReviewRow>();
      return row ? project(row) : null;
    },

    async list(filters: AdminQuoteReviewFilters) {
      const technical = await technicalReviewContexts(database);
      const result = await database
        .prepare(
          `${reviewSelect}
           ORDER BY request.submitted_at DESC, request.id DESC`,
        )
        .all<AdminQuoteReviewRow>();
      return filterAdminQuoteReviews(
        await Promise.all(
          result.results.map((row) => project(row, technical.get(row.id))),
        ),
        filters,
      );
    },
  };
}
