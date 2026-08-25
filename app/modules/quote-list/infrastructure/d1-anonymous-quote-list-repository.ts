import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import type {
  AnonymousQuoteLine,
  AnonymousQuoteSession,
} from "../domain/anonymous-quote-list";
import type {
  LengthBasedHoseOrder,
  calculateLengthBasedHoseEstimate,
} from "../domain/length-based-hose";
import { lengthBasedHoseLineIdentity } from "../domain/length-based-hose";

type LengthBasedHoseEstimate = ReturnType<
  typeof calculateLengthBasedHoseEstimate
>;

interface QuoteLineRow {
  category: AnonymousQuoteLine["category"];
  currency: string;
  current_estimate_amount: number | null;
  cutting_labeling_fee_amount: number | null;
  cutting_labeling_fee_rate: number | null;
  display_name: string;
  estimated_merchandise_amount: number | null;
  id: string;
  line_kind: AnonymousQuoteLine["lineKind"];
  normalized_length_ft: number | null;
  original_length_unit: "ft" | null;
  original_length_value: number | null;
  piece_count: number | null;
  quantity: number;
  reference_unit_price: number | null;
  sales_unit: string;
  sku: string;
  total_footage: number | null;
  updated_at: string;
}

function lineFromRow(row: QuoteLineRow): AnonymousQuoteLine {
  const common = {
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

  if (row.line_kind === "standard") {
    return {
      ...common,
      currentEstimateAmount: null,
      cuttingLabelingFeeAmount: null,
      cuttingLabelingFeeRate: null,
      estimatedMerchandiseAmount: null,
      lengthOrder: null,
      lineKind: "standard",
    };
  }

  if (
    row.normalized_length_ft === null ||
    row.original_length_unit === null ||
    row.original_length_value === null ||
    row.piece_count === null ||
    row.total_footage === null ||
    row.cutting_labeling_fee_amount === null ||
    row.cutting_labeling_fee_rate === null
  ) {
    throw new Error(`Invalid length-based Quote List line: ${row.id}`);
  }

  return {
    ...common,
    currentEstimateAmount: row.current_estimate_amount,
    cuttingLabelingFeeAmount: row.cutting_labeling_fee_amount,
    cuttingLabelingFeeRate: row.cutting_labeling_fee_rate,
    estimatedMerchandiseAmount: row.estimated_merchandise_amount,
    lengthOrder: {
      normalizedLengthFt: row.normalized_length_ft,
      originalLengthUnit: row.original_length_unit,
      originalLengthValue: row.original_length_value,
      pieceCount: row.piece_count,
      totalFootage: row.total_footage,
    },
    lineKind: "length_based_hose",
  };
}

const activeQuotedProductGuard = `
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
`;

const activeStandardProductGuard = `
  ${activeQuotedProductGuard}
    AND LOWER(COALESCE(o.quantity_input_mode, '')) NOT LIKE '%length%'
`;

const activeLengthBasedHoseGuard = `
  ${activeQuotedProductGuard}
    AND s.product_type = 'hose'
    AND LOWER(COALESCE(o.quantity_input_mode, '')) LIKE '%length%'
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

    async addLengthBasedHoseLine(input: {
      estimate: LengthBasedHoseEstimate;
      expiresAt: string;
      lineId: string;
      now: string;
      order: LengthBasedHoseOrder;
      product: PublicCatalogItem;
      sessionId: string;
    }) {
      const offer = input.product.offer;
      const ordering = offer?.lengthOrdering;
      if (!offer || !ordering) return null;
      const [lineResult, sessionResult] = await database.batch<{ id: string }>([
        database
          .prepare(
            `INSERT INTO anonymous_quote_lines (
               id, session_id, line_identity, sku, catalog_release_id,
               display_name, category, line_kind, quantity, sales_unit,
               currency, reference_unit_price, original_length_value,
               original_length_unit, normalized_length_ft, piece_count,
               total_footage, cutting_labeling_fee_rate,
               cutting_labeling_fee_amount, cutting_labeling_fee_scope,
               cutting_labeling_fee_version, estimated_merchandise_amount,
               current_estimate_amount, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, 'length_based_hose', ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (${activeLengthBasedHoseGuard})
               AND EXISTS (
                 SELECT 1 FROM anonymous_quote_sessions
                 WHERE id = ? AND expires_at > ?
               )
             ON CONFLICT(session_id, line_identity) DO UPDATE SET
               quantity = anonymous_quote_lines.quantity + excluded.quantity,
               piece_count = anonymous_quote_lines.piece_count + excluded.piece_count,
               total_footage = excluded.normalized_length_ft *
                 (anonymous_quote_lines.piece_count + excluded.piece_count),
               catalog_release_id = excluded.catalog_release_id,
               display_name = excluded.display_name,
               category = excluded.category,
               sales_unit = excluded.sales_unit,
               currency = excluded.currency,
               reference_unit_price = excluded.reference_unit_price,
               cutting_labeling_fee_rate = excluded.cutting_labeling_fee_rate,
               cutting_labeling_fee_amount = ROUND(
                 excluded.cutting_labeling_fee_rate *
                 (anonymous_quote_lines.piece_count + excluded.piece_count), 2
               ),
               cutting_labeling_fee_scope = excluded.cutting_labeling_fee_scope,
               cutting_labeling_fee_version = excluded.cutting_labeling_fee_version,
               estimated_merchandise_amount = CASE
                 WHEN excluded.reference_unit_price IS NULL THEN NULL
                 ELSE ROUND(
                   excluded.reference_unit_price * excluded.normalized_length_ft *
                   (anonymous_quote_lines.piece_count + excluded.piece_count), 2
                 )
               END,
               current_estimate_amount = CASE
                 WHEN excluded.reference_unit_price IS NULL THEN NULL
                 ELSE ROUND(
                   excluded.reference_unit_price * excluded.normalized_length_ft *
                   (anonymous_quote_lines.piece_count + excluded.piece_count) +
                   excluded.cutting_labeling_fee_rate *
                   (anonymous_quote_lines.piece_count + excluded.piece_count), 2
                 )
               END,
               updated_at = excluded.updated_at
             RETURNING id`,
          )
          .bind(
            input.lineId,
            input.sessionId,
            lengthBasedHoseLineIdentity(
              input.product.sku,
              input.order.normalizedLengthFt,
            ),
            input.product.sku,
            input.product.releaseId,
            input.product.displayName,
            input.product.category,
            input.order.pieceCount,
            offer.salesUnit,
            offer.currency,
            offer.referencePrice,
            input.order.originalLengthValue,
            input.order.originalLengthUnit,
            input.order.normalizedLengthFt,
            input.order.pieceCount,
            input.order.totalFootage,
            ordering.cuttingLabelingFee.ratePerPiece,
            input.estimate.cuttingLabelingFeeAmount,
            ordering.cuttingLabelingFee.scope,
            ordering.cuttingLabelingFee.version,
            input.estimate.estimatedMerchandiseAmount,
            input.estimate.currentEstimateAmount,
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
          `SELECT id, sku, line_kind AS lineKind,
                  normalized_length_ft AS normalizedLengthFt
           FROM anonymous_quote_lines
           WHERE session_id = ? AND id = ?`,
        )
        .bind(sessionId, lineId)
        .first<{
          id: string;
          lineKind: AnonymousQuoteLine["lineKind"];
          normalizedLengthFt: number | null;
          sku: string;
        }>();
    },

    async listLines(sessionId: string) {
      const rows = await database
        .prepare(
          `SELECT id, sku, display_name, category, line_kind, quantity,
                  sales_unit, currency, reference_unit_price,
                  original_length_value, original_length_unit,
                  normalized_length_ft, piece_count, total_footage,
                  cutting_labeling_fee_rate, cutting_labeling_fee_amount,
                  estimated_merchandise_amount, current_estimate_amount,
                  updated_at
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

    async updateLengthBasedHoseLine(input: {
      estimate: LengthBasedHoseEstimate;
      expiresAt: string;
      lineId: string;
      now: string;
      order: LengthBasedHoseOrder;
      product: PublicCatalogItem;
      sessionId: string;
    }) {
      const offer = input.product.offer;
      const ordering = offer?.lengthOrdering;
      if (!offer || !ordering) return null;
      const [lineResult, sessionResult] = await database.batch<{ id: string }>([
        database
          .prepare(
            `UPDATE anonymous_quote_lines
             SET quantity = ?, piece_count = ?, total_footage = ?,
                 catalog_release_id = ?, display_name = ?, category = ?,
                 sales_unit = ?, currency = ?, reference_unit_price = ?,
                 cutting_labeling_fee_rate = ?,
                 cutting_labeling_fee_amount = ?,
                 cutting_labeling_fee_scope = ?,
                 cutting_labeling_fee_version = ?,
                 estimated_merchandise_amount = ?,
                 current_estimate_amount = ?, updated_at = ?
             WHERE session_id = ? AND id = ? AND sku = ?
               AND line_kind = 'length_based_hose'
               AND normalized_length_ft = ?
               AND EXISTS (${activeLengthBasedHoseGuard})
               AND EXISTS (
                 SELECT 1 FROM anonymous_quote_sessions
                 WHERE id = ? AND expires_at > ?
               )
             RETURNING id`,
          )
          .bind(
            input.order.pieceCount,
            input.order.pieceCount,
            input.order.totalFootage,
            input.product.releaseId,
            input.product.displayName,
            input.product.category,
            offer.salesUnit,
            offer.currency,
            offer.referencePrice,
            ordering.cuttingLabelingFee.ratePerPiece,
            input.estimate.cuttingLabelingFeeAmount,
            ordering.cuttingLabelingFee.scope,
            ordering.cuttingLabelingFee.version,
            input.estimate.estimatedMerchandiseAmount,
            input.estimate.currentEstimateAmount,
            input.now,
            input.sessionId,
            input.lineId,
            input.product.sku,
            input.order.normalizedLengthFt,
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
