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
  order_id: string | null;
}

const reviewSelect = `SELECT request.id, request.reference_number, request.snapshot_json, request.submitted_at,
  o.id AS order_id,
  CASE
    WHEN o.id IS NOT NULL THEN 'order_created'
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
    AND a.snapshot_hash=p.snapshot_hash AND a.purchasing_context_id=request.purchasing_context_id
  LEFT JOIN confirmed_orders o ON o.pi_id=p.id AND o.request_id=request.id`;

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
    orderId: row.order_id,
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
    async countAwaitingReview() {
      const row = await database
        .prepare(
          `SELECT count(*) AS count FROM (${reviewSelect}) WHERE review_state='awaiting_review'`,
        )
        .first<{ count: number }>();
      return row?.count ?? 0;
    },
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

    list,
    async listPage(filters: AdminQuoteReviewFilters, requestedPage = 1) {
      const page =
        Number.isSafeInteger(requestedPage) && requestedPage > 0
          ? Math.min(requestedPage, 10000)
          : 1;
      const pageSize = 25;
      const offset = (page - 1) * pageSize;
      // Technical state depends on signed review fingerprints and current draft
      // contents. Do not filter/sort an already paginated subset and lose matches.
      if (
        filters.technicalReview !== "all" ||
        filters.sort === "technical_first"
      ) {
        const matches = await list(filters);
        return {
          reviews: matches.slice(offset, offset + pageSize),
          page,
          hasNext: matches.length > offset + pageSize,
        };
      }
      const rows = (await filteredRows(filters, pageSize + 1, offset)).results;
      const visible = rows.slice(0, pageSize);
      const technical = await technicalReviewContexts(
        database,
        visible.map((row) => row.id),
      );
      return {
        reviews: await Promise.all(
          visible.map((row) => project(row, technical.get(row.id))),
        ),
        page,
        hasNext: rows.length > pageSize,
      };
    },
  };

  function filteredRows(
    filters: AdminQuoteReviewFilters,
    limit?: number,
    offset = 0,
  ) {
    const statement = database.prepare(`SELECT * FROM (${reviewSelect})
      WHERE (? = 'all' OR review_state = ?)
      ORDER BY julianday(submitted_at) DESC, id DESC
      ${limit === undefined ? "" : "LIMIT ? OFFSET ?"}`);
    const values: (string | number)[] = [
      filters.reviewState,
      filters.reviewState,
    ];
    if (limit !== undefined) values.push(limit, offset);
    return statement.bind(...values).all<AdminQuoteReviewRow>();
  }

  async function list(filters: AdminQuoteReviewFilters) {
    const result = await filteredRows(filters);
    const technical = await technicalReviewContexts(
      database,
      result.results.map((row) => row.id),
    );
    return filterAdminQuoteReviews(
      await Promise.all(
        result.results.map((row) => project(row, technical.get(row.id))),
      ),
      filters,
    );
  }
}
