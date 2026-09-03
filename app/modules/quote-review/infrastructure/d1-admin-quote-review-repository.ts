import {
  filterAdminQuoteReviews,
  projectAdminQuoteReview,
  type AdminQuoteReviewFilters,
  type AdminQuoteReviewSource,
} from "../domain/admin-quote-review";

interface AdminQuoteReviewRow {
  id: string;
  reference_number: string;
  snapshot_json: string;
  submitted_at: string;
}

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
  };
}

export function createD1AdminQuoteReviewRepository(database: D1Database) {
  return {
    async find(requestId: string) {
      const row = await database
        .prepare(
          `SELECT id, reference_number, snapshot_json, submitted_at
           FROM customer_quote_requests
           WHERE id = ?
           LIMIT 1`,
        )
        .bind(requestId)
        .first<AdminQuoteReviewRow>();
      return row ? projectAdminQuoteReview(source(row)) : null;
    },

    async list(filters: AdminQuoteReviewFilters) {
      const result = await database
        .prepare(
          `SELECT id, reference_number, snapshot_json, submitted_at
           FROM customer_quote_requests
           ORDER BY submitted_at DESC, id DESC`,
        )
        .all<AdminQuoteReviewRow>();
      return filterAdminQuoteReviews(
        result.results.map((row) => projectAdminQuoteReview(source(row))),
        filters,
      );
    },
  };
}
