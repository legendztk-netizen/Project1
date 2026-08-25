import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import type {
  AnonymousQuoteLine,
  AnonymousQuoteSession,
} from "../domain/anonymous-quote-list";

interface QuoteLineRow {
  category: AnonymousQuoteLine["category"];
  currency: string;
  display_name: string;
  id: string;
  quantity: number;
  reference_unit_price: number | null;
  sales_unit: string;
  sku: string;
  updated_at: string;
}

function lineFromRow(row: QuoteLineRow): AnonymousQuoteLine {
  return {
    category: row.category,
    currency: row.currency,
    displayName: row.display_name,
    id: row.id,
    quantity: row.quantity,
    referenceUnitPrice: row.reference_unit_price,
    salesUnit: row.sales_unit,
    sku: row.sku,
    updatedAt: row.updated_at,
  };
}

const activeStandardProductGuard = `
  SELECT 1
  FROM catalog_active_release ar
  INNER JOIN catalog_releases r ON r.id = ar.release_id
  INNER JOIN catalog_skus s ON s.import_id = r.source_import_id
  INNER JOIN catalog_sales_offers o
    ON o.import_id = s.import_id AND o.base_sku = s.sku
  WHERE ar.singleton = 1
    AND ar.release_id = ?
    AND r.status = 'published'
    AND s.sku = ?
    AND s.catalog_publication_status = 'Published'
    AND s.rfq_eligibility = 'Eligible'
    AND s.supply_availability = 'available_for_quote'
    AND LOWER(COALESCE(o.quantity_input_mode, '')) NOT LIKE '%length%'
`;

export function createD1AnonymousQuoteListRepository(database: D1Database) {
  function touchSessionStatement(
    sessionId: string,
    now: string,
    expiresAt: string,
  ) {
    return database
      .prepare(
        `UPDATE anonymous_quote_sessions
         SET last_activity_at = ?, expires_at = ?
         WHERE id = ? AND expires_at > ?
         RETURNING id`,
      )
      .bind(now, expiresAt, sessionId, now);
  }

  async function touchSession(
    sessionId: string,
    now: string,
    expiresAt: string,
  ) {
    const result = await touchSessionStatement(
      sessionId,
      now,
      expiresAt,
    ).first<{ id: string }>();
    return Boolean(result);
  }

  return {
    async addStandardLine(input: {
      expiresAt: string;
      lineId: string;
      now: string;
      product: PublicCatalogItem;
      quantity: number;
      sessionId: string;
    }) {
      const offer = input.product.offer;
      if (!offer) return null;
      const [lineResult, sessionResult] = await database.batch<{ id: string }>([
        database
          .prepare(
            `INSERT INTO anonymous_quote_lines (
             id, session_id, line_identity, sku, catalog_release_id,
             display_name, category, quantity, sales_unit, currency,
             reference_unit_price, created_at, updated_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (${activeStandardProductGuard})
             AND EXISTS (
               SELECT 1 FROM anonymous_quote_sessions
               WHERE id = ? AND expires_at > ?
             )
           ON CONFLICT(session_id, line_identity) DO UPDATE SET
             quantity = anonymous_quote_lines.quantity + excluded.quantity,
             catalog_release_id = excluded.catalog_release_id,
             display_name = excluded.display_name,
             category = excluded.category,
             sales_unit = excluded.sales_unit,
             currency = excluded.currency,
             reference_unit_price = excluded.reference_unit_price,
             updated_at = excluded.updated_at
           RETURNING id`,
          )
          .bind(
            input.lineId,
            input.sessionId,
            `standard:${input.product.sku}`,
            input.product.sku,
            input.product.releaseId,
            input.product.displayName,
            input.product.category,
            input.quantity,
            offer.salesUnit,
            offer.currency,
            offer.referencePrice,
            input.now,
            input.now,
            input.product.releaseId,
            input.product.sku,
            input.sessionId,
            input.now,
          ),
        touchSessionStatement(input.sessionId, input.now, input.expiresAt),
      ]);
      const lineId = lineResult?.results[0]?.id;
      return lineId && sessionResult?.results[0]?.id ? lineId : null;
    },

    async createSession(session: AnonymousQuoteSession, now: string) {
      await database
        .prepare(
          `INSERT INTO anonymous_quote_sessions
             (id, created_at, last_activity_at, expires_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(session.id, now, now, session.expiresAt)
        .run();
    },

    async deleteExpiredSessions(now: string) {
      await database
        .prepare(`DELETE FROM anonymous_quote_sessions WHERE expires_at <= ?`)
        .bind(now)
        .run();
    },

    async findActiveSession(sessionId: string, now: string) {
      return database
        .prepare(
          `SELECT id, expires_at AS expiresAt
           FROM anonymous_quote_sessions
           WHERE id = ? AND expires_at > ?`,
        )
        .bind(sessionId, now)
        .first<AnonymousQuoteSession>();
    },

    async findLine(sessionId: string, lineId: string) {
      return database
        .prepare(
          `SELECT id, sku
           FROM anonymous_quote_lines
           WHERE session_id = ? AND id = ?`,
        )
        .bind(sessionId, lineId)
        .first<{ id: string; sku: string }>();
    },

    async listLines(sessionId: string) {
      const rows = await database
        .prepare(
          `SELECT id, sku, display_name, category, quantity, sales_unit,
                  currency, reference_unit_price, updated_at
           FROM anonymous_quote_lines
           WHERE session_id = ?
           ORDER BY created_at, id`,
        )
        .bind(sessionId)
        .all<QuoteLineRow>();
      return rows.results.map(lineFromRow);
    },

    async removeLine(input: {
      expiresAt: string;
      lineId: string;
      now: string;
      sessionId: string;
    }) {
      const [lineResult, sessionResult] = await database.batch<{ id: string }>([
        database
          .prepare(
            `DELETE FROM anonymous_quote_lines
           WHERE session_id = ? AND id = ?
             AND EXISTS (
               SELECT 1 FROM anonymous_quote_sessions
               WHERE id = ? AND expires_at > ?
             )
           RETURNING id`,
          )
          .bind(input.sessionId, input.lineId, input.sessionId, input.now),
        touchSessionStatement(input.sessionId, input.now, input.expiresAt),
      ]);
      return Boolean(
        lineResult?.results[0]?.id && sessionResult?.results[0]?.id,
      );
    },

    touchSession,

    async updateStandardLine(input: {
      expiresAt: string;
      lineId: string;
      now: string;
      product: PublicCatalogItem;
      quantity: number;
      sessionId: string;
    }) {
      const offer = input.product.offer;
      if (!offer) return null;
      const [lineResult, sessionResult] = await database.batch<{ id: string }>([
        database
          .prepare(
            `UPDATE anonymous_quote_lines
           SET quantity = ?, catalog_release_id = ?, display_name = ?,
               category = ?, sales_unit = ?, currency = ?,
               reference_unit_price = ?, updated_at = ?
           WHERE session_id = ? AND id = ? AND sku = ?
             AND EXISTS (${activeStandardProductGuard})
             AND EXISTS (
               SELECT 1 FROM anonymous_quote_sessions
               WHERE id = ? AND expires_at > ?
             )
           RETURNING id`,
          )
          .bind(
            input.quantity,
            input.product.releaseId,
            input.product.displayName,
            input.product.category,
            offer.salesUnit,
            offer.currency,
            offer.referencePrice,
            input.now,
            input.sessionId,
            input.lineId,
            input.product.sku,
            input.product.releaseId,
            input.product.sku,
            input.sessionId,
            input.now,
          ),
        touchSessionStatement(input.sessionId, input.now, input.expiresAt),
      ]);
      const lineId = lineResult?.results[0]?.id;
      return lineId && sessionResult?.results[0]?.id ? lineId : null;
    },
  };
}
