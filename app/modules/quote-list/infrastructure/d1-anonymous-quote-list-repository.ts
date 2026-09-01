import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import type {
  AnonymousQuoteLine,
  AnonymousQuoteSession,
} from "../domain/anonymous-quote-list";
import type {
  ConfiguredAssemblyEstimateBasis,
  ConfiguredAssemblySnapshot,
} from "../domain/configured-assembly-quote";
import type {
  LengthBasedHoseOrder,
  calculateLengthBasedHoseEstimate,
} from "../domain/length-based-hose";
import { lengthBasedHoseLineIdentity } from "../domain/length-based-hose";
import { accountQuoteListExpiry } from "./d1-customer-quote-list-merge";

type LengthBasedHoseEstimate = ReturnType<
  typeof calculateLengthBasedHoseEstimate
>;

interface QuoteLineRow {
  catalog_release_id: string;
  category: AnonymousQuoteLine["category"];
  currency: string;
  current_estimate_amount: number | null;
  configured_estimate_inputs_json: string | null;
  configured_snapshot_json: string | null;
  configured_unit_estimate_amount: number | null;
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
    catalogReleaseId: row.catalog_release_id,
    category: row.category,
    currency: row.currency,
    displayName: row.display_name,
    id: row.id,
    quantity: row.quantity,
    referenceUnitPrice: row.reference_unit_price,
    refresh: null,
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

  if (row.line_kind === "configured_assembly") {
    if (
      row.configured_snapshot_json === null ||
      row.configured_estimate_inputs_json === null
    ) {
      throw new Error(`Invalid configured assembly Quote List line: ${row.id}`);
    }
    return {
      ...common,
      configuredAssembly: {
        currentIssue: null,
        estimateBasis: JSON.parse(
          row.configured_estimate_inputs_json,
        ) as ConfiguredAssemblyEstimateBasis,
        snapshot: JSON.parse(
          row.configured_snapshot_json,
        ) as ConfiguredAssemblySnapshot,
        unitEstimateAmount: row.configured_unit_estimate_amount,
      },
      currentEstimateAmount: row.current_estimate_amount,
      cuttingLabelingFeeAmount: null,
      cuttingLabelingFeeRate: null,
      estimatedMerchandiseAmount: null,
      lengthOrder: null,
      lineKind: "configured_assembly",
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

const activeConfiguredAssemblyGuard = `
  ${activeQuotedProductGuard}
    AND s.product_type = 'hose'
    AND EXISTS (
      SELECT 1
      FROM catalog_compatibilities c
      INNER JOIN catalog_skus es
        ON es.import_id = c.import_id AND es.sku = c.hose_end_sku
      INNER JOIN catalog_skus fs
        ON fs.import_id = c.import_id AND fs.sku = c.ferrule_sku
      WHERE c.import_id = r.source_import_id
        AND c.compatibility_id = ? AND c.hose_sku = s.sku
        AND c.hose_end_sku = ? AND c.ferrule_sku = ?
        AND c.catalog_publication_status = 'Published'
        AND c.rfq_eligibility = 'Eligible'
        AND es.catalog_publication_status = 'Published'
        AND es.rfq_eligibility = 'Eligible'
        AND es.supply_availability = 'available_for_quote'
        AND fs.catalog_publication_status = 'Published'
        AND fs.rfq_eligibility = 'Eligible'
        AND fs.supply_availability = 'available_for_quote'
    )
    AND EXISTS (
      SELECT 1
      FROM catalog_compatibilities c
      INNER JOIN catalog_skus es
        ON es.import_id = c.import_id AND es.sku = c.hose_end_sku
      INNER JOIN catalog_skus fs
        ON fs.import_id = c.import_id AND fs.sku = c.ferrule_sku
      WHERE c.import_id = r.source_import_id
        AND c.compatibility_id = ? AND c.hose_sku = s.sku
        AND c.hose_end_sku = ? AND c.ferrule_sku = ?
        AND c.catalog_publication_status = 'Published'
        AND c.rfq_eligibility = 'Eligible'
        AND es.catalog_publication_status = 'Published'
        AND es.rfq_eligibility = 'Eligible'
        AND es.supply_availability = 'available_for_quote'
        AND fs.catalog_publication_status = 'Published'
        AND fs.rfq_eligibility = 'Eligible'
        AND fs.supply_availability = 'available_for_quote'
    )
    AND EXISTS (
      SELECT 1 FROM catalog_configurator_registry_entries e
      WHERE e.release_id = r.id AND e.registry_type = 'installed_protection'
        AND e.entry_key = ? AND e.record_version = ?
    )
    AND EXISTS (
      SELECT 1 FROM catalog_configurator_registry_entries e
      WHERE e.release_id = r.id AND e.registry_type = 'assembly_estimate_schedule'
        AND e.entry_key = 'DEFAULT' AND e.record_version = ?
    )
    AND (
      ? IS NULL OR EXISTS (
        SELECT 1 FROM catalog_configurator_registry_entries e
        WHERE e.release_id = r.id AND e.registry_type = 'measurement_method'
          AND e.entry_key = ? AND e.record_version = ?
      )
    )
    AND (
      ? IS NULL OR EXISTS (
        SELECT 1 FROM catalog_configurator_registry_entries e
        WHERE e.release_id = r.id AND e.registry_type = 'clocking_convention'
          AND e.entry_key = 'M08' AND e.record_version = ?
      )
    )
`;

export function createD1AnonymousQuoteListRepository(database: D1Database) {
  function configuredAssemblyGuardBindings(input: {
    estimateBasis: ConfiguredAssemblyEstimateBasis;
    product: PublicCatalogItem;
    snapshot: ConfiguredAssemblySnapshot;
  }) {
    const configuration = input.snapshot.configuration;
    const endA = configuration.endA;
    const endB = configuration.endB;
    const protection = configuration.installedProtection;
    if (!endA || !endB || !protection) return null;
    const measurement =
      configuration.measurementSelection?.state === "selected"
        ? configuration.measurementSelection.method
        : null;
    const clockingVersion =
      configuration.clocking?.convention.recordVersion ?? null;
    return [
      input.product.releaseId,
      input.product.sku,
      endA.compatibilityId,
      endA.hoseEnd.sku,
      endA.ferrule.sku,
      endB.compatibilityId,
      endB.hoseEnd.sku,
      endB.ferrule.sku,
      protection.code,
      protection.recordVersion,
      input.estimateBasis.scheduleRecordVersion,
      measurement?.code ?? null,
      measurement?.code ?? null,
      measurement?.recordVersion ?? null,
      clockingVersion,
      clockingVersion,
    ];
  }

  function touchSessionStatement(
    sessionId: string,
    now: string,
    expiresAt: string,
  ) {
    return database
      .prepare(
        `UPDATE anonymous_quote_sessions
         SET last_activity_at = ?,
             expires_at = CASE WHEN profile_id IS NULL THEN ? ELSE expires_at END
         WHERE id = ? AND retired_at IS NULL AND expires_at > ?
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
    async addConfiguredAssemblyLine(input: {
      createSession: boolean;
      estimateBasis: ConfiguredAssemblyEstimateBasis;
      expiresAt: string;
      lineId: string;
      lineIdentity: string;
      now: string;
      product: PublicCatalogItem;
      quantity: number;
      sessionId: string;
      snapshot: ConfiguredAssemblySnapshot;
      unitEstimateAmount: number | null;
    }) {
      const guardBindings = configuredAssemblyGuardBindings(input);
      if (!guardBindings) return null;
      const totalEstimate =
        input.unitEstimateAmount === null
          ? null
          : Math.round(
              (input.unitEstimateAmount * input.quantity + Number.EPSILON) *
                100,
            ) / 100;
      const statements: D1PreparedStatement[] = [];
      if (input.createSession) {
        statements.push(
          database
            .prepare(
              `INSERT INTO anonymous_quote_sessions
                 (id, created_at, last_activity_at, expires_at)
               SELECT ?, ?, ?, ?
               WHERE EXISTS (${activeConfiguredAssemblyGuard})`,
            )
            .bind(
              input.sessionId,
              input.now,
              input.now,
              input.expiresAt,
              ...guardBindings,
            ),
        );
      }
      const lineResultIndex = statements.length;
      statements.push(
        database
          .prepare(
            `INSERT INTO anonymous_quote_lines (
               id, session_id, line_identity, sku, catalog_release_id,
               display_name, category, line_kind, quantity, sales_unit,
               currency, reference_unit_price, current_estimate_amount,
               configured_snapshot_json, configured_estimate_inputs_json,
               configured_unit_estimate_amount, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, 'hydraulic-hose', 'configured_assembly',
                    ?, 'each', 'USD', NULL, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (${activeConfiguredAssemblyGuard})
               AND EXISTS (
                 SELECT 1 FROM anonymous_quote_sessions
                 WHERE id = ? AND expires_at > ?
               )
             ON CONFLICT(session_id, line_identity) DO UPDATE SET
               quantity = anonymous_quote_lines.quantity + excluded.quantity,
               current_estimate_amount = CASE
                 WHEN excluded.configured_unit_estimate_amount IS NULL THEN NULL
                 ELSE ROUND(
                   excluded.configured_unit_estimate_amount *
                   (anonymous_quote_lines.quantity + excluded.quantity), 2
                 )
               END,
               configured_snapshot_json = excluded.configured_snapshot_json,
               configured_estimate_inputs_json = excluded.configured_estimate_inputs_json,
               configured_unit_estimate_amount = excluded.configured_unit_estimate_amount,
               updated_at = excluded.updated_at
             RETURNING id`,
          )
          .bind(
            input.lineId,
            input.sessionId,
            input.lineIdentity,
            input.product.sku,
            input.product.releaseId,
            `${input.product.familyName} Assembly`,
            input.quantity,
            totalEstimate,
            JSON.stringify(input.snapshot),
            JSON.stringify(input.estimateBasis),
            input.unitEstimateAmount,
            input.now,
            input.now,
            ...guardBindings,
            input.sessionId,
            input.now,
          ),
      );
      const sessionResultIndex = statements.length;
      statements.push(
        database
          .prepare(
            `UPDATE anonymous_quote_sessions
             SET last_activity_at = ?,
                 expires_at = CASE WHEN profile_id IS NULL THEN ? ELSE expires_at END
             WHERE id = ? AND retired_at IS NULL AND expires_at > ?
               AND EXISTS (${activeConfiguredAssemblyGuard})
             RETURNING id`,
          )
          .bind(
            input.now,
            input.expiresAt,
            input.sessionId,
            input.now,
            ...guardBindings,
          ),
      );
      const results = await database.batch<{ id: string }>(statements);
      const lineResult = results[lineResultIndex];
      const sessionResult = results[sessionResultIndex];
      const lineId = lineResult?.results[0]?.id;
      return lineId && sessionResult?.results[0]?.id ? lineId : null;
    },

    async replaceConfiguredAssemblyLine(input: {
      estimateBasis: ConfiguredAssemblyEstimateBasis;
      expiresAt: string;
      lineId: string;
      lineIdentity: string;
      newLineId: string;
      now: string;
      product: PublicCatalogItem;
      quantity: number;
      sessionId: string;
      snapshot: ConfiguredAssemblySnapshot;
      unitEstimateAmount: number | null;
    }) {
      const guardBindings = configuredAssemblyGuardBindings(input);
      if (!guardBindings) return null;
      const totalEstimate =
        input.unitEstimateAmount === null
          ? null
          : Math.round(
              (input.unitEstimateAmount * input.quantity + Number.EPSILON) *
                100,
            ) / 100;
      const [lineResult, deleteResult, sessionResult] = await database.batch<{
        id: string;
      }>([
        database
          .prepare(
            `INSERT INTO anonymous_quote_lines (
               id, session_id, line_identity, sku, catalog_release_id,
               display_name, category, line_kind, quantity, sales_unit,
               currency, reference_unit_price, current_estimate_amount,
               configured_snapshot_json, configured_estimate_inputs_json,
               configured_unit_estimate_amount, created_at, updated_at
             )
             SELECT ?, source.session_id, ?, ?, ?, ?, 'hydraulic-hose',
                    'configured_assembly', ?, 'each', 'USD', NULL, ?, ?, ?, ?,
                    source.created_at, ?
             FROM anonymous_quote_lines source
             WHERE source.session_id = ? AND source.id = ?
               AND source.line_kind = 'configured_assembly'
               AND EXISTS (${activeConfiguredAssemblyGuard})
               AND EXISTS (
                 SELECT 1 FROM anonymous_quote_sessions
                 WHERE id = ? AND expires_at > ?
               )
             ON CONFLICT(session_id, line_identity) DO UPDATE SET
               quantity = CASE
                 WHEN anonymous_quote_lines.id = ? THEN excluded.quantity
                 ELSE anonymous_quote_lines.quantity + excluded.quantity
               END,
               current_estimate_amount = CASE
                 WHEN excluded.configured_unit_estimate_amount IS NULL THEN NULL
                 ELSE ROUND(
                   excluded.configured_unit_estimate_amount *
                   CASE
                     WHEN anonymous_quote_lines.id = ? THEN excluded.quantity
                     ELSE anonymous_quote_lines.quantity + excluded.quantity
                   END, 2
                 )
               END,
               sku = excluded.sku,
               catalog_release_id = excluded.catalog_release_id,
               display_name = excluded.display_name,
               configured_snapshot_json = excluded.configured_snapshot_json,
               configured_estimate_inputs_json = excluded.configured_estimate_inputs_json,
               configured_unit_estimate_amount = excluded.configured_unit_estimate_amount,
               updated_at = excluded.updated_at
             RETURNING id`,
          )
          .bind(
            input.newLineId,
            input.lineIdentity,
            input.product.sku,
            input.product.releaseId,
            `${input.product.familyName} Assembly`,
            input.quantity,
            totalEstimate,
            JSON.stringify(input.snapshot),
            JSON.stringify(input.estimateBasis),
            input.unitEstimateAmount,
            input.now,
            input.sessionId,
            input.lineId,
            ...guardBindings,
            input.sessionId,
            input.now,
            input.lineId,
            input.lineId,
          ),
        database
          .prepare(
            `DELETE FROM anonymous_quote_lines
             WHERE session_id = ? AND id = ?
               AND line_kind = 'configured_assembly'
               AND line_identity <> ?
               AND EXISTS (${activeConfiguredAssemblyGuard})
               AND EXISTS (
                 SELECT 1 FROM anonymous_quote_lines replacement
                 WHERE replacement.session_id = ?
                   AND replacement.line_identity = ?
                   AND replacement.line_kind = 'configured_assembly'
               )
             RETURNING id`,
          )
          .bind(
            input.sessionId,
            input.lineId,
            input.lineIdentity,
            ...guardBindings,
            input.sessionId,
            input.lineIdentity,
          ),
        database
          .prepare(
            `UPDATE anonymous_quote_sessions
             SET last_activity_at = ?,
                 expires_at = CASE WHEN profile_id IS NULL THEN ? ELSE expires_at END
             WHERE id = ? AND retired_at IS NULL AND expires_at > ?
               AND EXISTS (${activeConfiguredAssemblyGuard})
             RETURNING id`,
          )
          .bind(
            input.now,
            input.expiresAt,
            input.sessionId,
            input.now,
            ...guardBindings,
          ),
      ]);
      const replacementId = lineResult?.results[0]?.id;
      const sourceRemovedOrRetained =
        replacementId === input.lineId || Boolean(deleteResult?.results[0]?.id);
      return replacementId &&
        sourceRemovedOrRetained &&
        sessionResult?.results[0]?.id
        ? replacementId
        : null;
    },

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

    async findOrCreateAccountSession(input: {
      now: string;
      profileId: string;
      sessionId: string;
    }) {
      await database
        .prepare(
          `INSERT INTO anonymous_quote_sessions
             (id, created_at, last_activity_at, expires_at, profile_id)
           SELECT ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM customer_profiles WHERE id = ?)
           ON CONFLICT(profile_id) WHERE profile_id IS NOT NULL DO NOTHING`,
        )
        .bind(
          input.sessionId,
          input.now,
          input.now,
          accountQuoteListExpiry,
          input.profileId,
          input.profileId,
        )
        .run();
      return database
        .prepare(
          `SELECT id, expires_at AS expiresAt
           FROM anonymous_quote_sessions
           WHERE profile_id = ? AND retired_at IS NULL`,
        )
        .bind(input.profileId)
        .first<AnonymousQuoteSession>();
    },

    async findAccountSession(profileId: string) {
      return database
        .prepare(
          `SELECT id, expires_at AS expiresAt
           FROM anonymous_quote_sessions
           WHERE profile_id = ? AND retired_at IS NULL`,
        )
        .bind(profileId)
        .first<AnonymousQuoteSession>();
    },

    async deleteExpiredSessions(now: string) {
      await database
        .prepare(
          `DELETE FROM anonymous_quote_sessions
           WHERE profile_id IS NULL AND expires_at <= ?`,
        )
        .bind(now)
        .run();
    },

    async findActiveSession(sessionId: string, now: string) {
      return database
        .prepare(
          `SELECT id, expires_at AS expiresAt
           FROM anonymous_quote_sessions
           WHERE id = ? AND profile_id IS NULL AND retired_at IS NULL
             AND expires_at > ?`,
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

    async findDetailedLine(sessionId: string, lineId: string) {
      const row = await database
        .prepare(
          `SELECT id, sku, catalog_release_id, display_name, category, line_kind, quantity,
                  sales_unit, currency, reference_unit_price,
                  original_length_value, original_length_unit,
                  normalized_length_ft, piece_count, total_footage,
                  cutting_labeling_fee_rate, cutting_labeling_fee_amount,
                  estimated_merchandise_amount, current_estimate_amount,
                  configured_snapshot_json, configured_estimate_inputs_json,
                  configured_unit_estimate_amount,
                  updated_at
           FROM anonymous_quote_lines
           WHERE session_id = ? AND id = ?`,
        )
        .bind(sessionId, lineId)
        .first<QuoteLineRow>();
      return row ? lineFromRow(row) : null;
    },

    async listLines(sessionId: string) {
      const rows = await database
        .prepare(
          `SELECT id, sku, catalog_release_id, display_name, category, line_kind, quantity,
                  sales_unit, currency, reference_unit_price,
                  original_length_value, original_length_unit,
                  normalized_length_ft, piece_count, total_footage,
                  cutting_labeling_fee_rate, cutting_labeling_fee_amount,
                  estimated_merchandise_amount, current_estimate_amount,
                  configured_snapshot_json, configured_estimate_inputs_json,
                  configured_unit_estimate_amount,
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

    async updateConfiguredAssemblyQuantity(input: {
      expiresAt: string;
      lineId: string;
      now: string;
      quantity: number;
      sessionId: string;
    }) {
      const [lineResult, sessionResult] = await database.batch<{ id: string }>([
        database
          .prepare(
            `UPDATE anonymous_quote_lines
             SET quantity = ?,
                 current_estimate_amount = CASE
                   WHEN configured_unit_estimate_amount IS NULL THEN NULL
                   ELSE ROUND(configured_unit_estimate_amount * ?, 2)
                 END,
                 updated_at = ?
             WHERE session_id = ? AND id = ?
               AND line_kind = 'configured_assembly'
               AND EXISTS (
                 SELECT 1 FROM anonymous_quote_sessions
                 WHERE id = ? AND expires_at > ?
               )
             RETURNING id`,
          )
          .bind(
            input.quantity,
            input.quantity,
            input.now,
            input.sessionId,
            input.lineId,
            input.sessionId,
            input.now,
          ),
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
