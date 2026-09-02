import type {
  QuoteRequestRecord,
  QuoteRequestSnapshot,
} from "../domain/quote-request";

interface QuoteRequestRow {
  id: string;
  reference_number: string;
  snapshot_json: string;
  submitted_at: string;
}

function record(row: QuoteRequestRow): QuoteRequestRecord {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    snapshot: JSON.parse(row.snapshot_json) as QuoteRequestSnapshot,
    submittedAt: row.submitted_at,
  };
}

const ownedQuoteRequestWhere = `
  INNER JOIN customer_purchasing_contexts context
    ON context.id = request.purchasing_context_id
  WHERE (
    (
      request.purchasing_context_kind = 'individual'
      AND context.kind = 'individual'
      AND context.individual_profile_id = ?
      AND request.profile_id = ?
    ) OR (
      request.purchasing_context_kind = 'organization'
      AND context.kind = 'organization'
      AND EXISTS (
        SELECT 1
        FROM customer_profile_purchasing_context_access access
        INNER JOIN customer_organization_memberships membership
          ON membership.organization_id = context.organization_id
         AND membership.profile_id = access.profile_id
         AND membership.role = 'primary_contact'
         AND membership.status = 'active'
        WHERE access.context_id = context.id
          AND access.profile_id = ?
      )
    )
  )
`;

const selectedIndividualContextGuard = `
  SELECT 1
  FROM customer_account_preferences pref
  INNER JOIN customer_purchasing_contexts context
    ON context.id = pref.selected_purchasing_context_id
  INNER JOIN customer_delivery_addresses address
    ON address.id = pref.selected_delivery_address_id
   AND address.profile_id = pref.profile_id
  WHERE pref.profile_id = ?
    AND context.id = ? AND context.kind = 'individual'
    AND context.individual_profile_id = ?
    AND address.id = ? AND address.profile_id = ?
    AND address.label = ? AND address.recipient_name = ?
    AND address.recipient_email = ? AND address.recipient_phone = ?
    AND address.country_code = ? AND address.state_province = ?
    AND address.city = ? AND address.postal_code = ?
    AND address.address_line_1 = ?
    AND COALESCE(address.address_line_2, '') = ?
`;

const selectedOrganizationContextGuard = `
  SELECT 1
  FROM customer_account_preferences pref
  INNER JOIN customer_purchasing_contexts context
    ON context.id = pref.selected_purchasing_context_id
  INNER JOIN customer_organizations organization
    ON organization.id = context.organization_id
  INNER JOIN customer_profile_purchasing_context_access access
    ON access.context_id = context.id AND access.profile_id = pref.profile_id
  INNER JOIN customer_organization_memberships membership
    ON membership.organization_id = organization.id
   AND membership.profile_id = pref.profile_id
   AND membership.role = 'primary_contact'
   AND membership.status = 'active'
  INNER JOIN customer_delivery_addresses address
    ON address.id = pref.selected_delivery_address_id
   AND address.profile_id = pref.profile_id
  WHERE pref.profile_id = ?
    AND context.id = ? AND context.kind = 'organization'
    AND organization.legal_name = ?
    AND COALESCE(organization.trade_name, '') = ?
    AND organization.country_code = ?
    AND COALESCE(organization.registration_or_tax_id, '') = ?
    AND address.id = ? AND address.profile_id = ?
    AND address.label = ? AND address.recipient_name = ?
    AND address.recipient_email = ? AND address.recipient_phone = ?
    AND address.country_code = ? AND address.state_province = ?
    AND address.city = ? AND address.postal_code = ?
    AND address.address_line_1 = ?
    AND COALESCE(address.address_line_2, '') = ?
`;

function selectedContextGuard(snapshot: QuoteRequestSnapshot) {
  return snapshot.purchasingContext.kind === "organization"
    ? selectedOrganizationContextGuard
    : selectedIndividualContextGuard;
}

function selectedContextBindings(input: {
  profileId: string;
  purchasingContextId: string;
  snapshot: QuoteRequestSnapshot;
  sourceAddressId: string;
}) {
  const destinationBindings = [
    input.sourceAddressId,
    input.profileId,
    input.snapshot.destination.label,
    input.snapshot.destination.recipientName,
    input.snapshot.destination.recipientEmail,
    input.snapshot.destination.recipientPhone,
    input.snapshot.destination.countryCode,
    input.snapshot.destination.stateProvince,
    input.snapshot.destination.city,
    input.snapshot.destination.postalCode,
    input.snapshot.destination.addressLine1,
    input.snapshot.destination.addressLine2,
  ];
  if (input.snapshot.purchasingContext.kind === "organization") {
    return [
      input.profileId,
      input.purchasingContextId,
      input.snapshot.purchasingContext.legalName,
      input.snapshot.purchasingContext.tradeName ?? "",
      input.snapshot.purchasingContext.countryCode,
      input.snapshot.purchasingContext.registrationOrTaxId ?? "",
      ...destinationBindings,
    ];
  }
  return [
    input.profileId,
    input.purchasingContextId,
    input.profileId,
    ...destinationBindings,
  ];
}

function deleteGuardForInvalidConfiguredEnd(end: "A" | "B") {
  return `DELETE FROM customer_quote_request_submission_guards AS guard
          WHERE guard.id = ? AND EXISTS (
            SELECT 1 FROM anonymous_quote_lines line
            INNER JOIN catalog_active_release active ON active.singleton = 1
            INNER JOIN catalog_releases release ON release.id = active.release_id
            WHERE line.session_id = guard.session_id
              AND line.id IN (SELECT value FROM json_each(?))
              AND line.line_kind = 'configured_assembly'
              AND NOT EXISTS (
                SELECT 1 FROM catalog_compatibilities compatibility
                INNER JOIN catalog_skus hose_end
                  ON hose_end.import_id = compatibility.import_id
                 AND hose_end.sku = compatibility.hose_end_sku
                INNER JOIN catalog_skus ferrule
                  ON ferrule.import_id = compatibility.import_id
                 AND ferrule.sku = compatibility.ferrule_sku
                WHERE compatibility.import_id = release.source_import_id
                  AND compatibility.compatibility_id = json_extract(
                    line.configured_snapshot_json,
                    '$.configuration.end${end}.compatibilityId'
                  )
                  AND compatibility.hose_sku = line.sku
                  AND compatibility.hose_end_sku = json_extract(
                    line.configured_snapshot_json,
                    '$.configuration.end${end}.hoseEnd.sku'
                  )
                  AND compatibility.ferrule_sku = json_extract(
                    line.configured_snapshot_json,
                    '$.configuration.end${end}.ferrule.sku'
                  )
                  AND compatibility.catalog_publication_status = 'Published'
                  AND compatibility.rfq_eligibility = 'Eligible'
                  AND hose_end.catalog_publication_status = 'Published'
                  AND hose_end.rfq_eligibility = 'Eligible'
                  AND hose_end.supply_availability = 'available_for_quote'
                  AND ferrule.catalog_publication_status = 'Published'
                  AND ferrule.rfq_eligibility = 'Eligible'
                  AND ferrule.supply_availability = 'available_for_quote'
              )
          )`;
}

function deleteGuardForInvalidRegistry(input: {
  entryKeySql: string;
  recordVersionPath: string;
  registryType: string;
  whenSql?: string;
}) {
  return `DELETE FROM customer_quote_request_submission_guards AS guard
          WHERE guard.id = ? AND EXISTS (
            SELECT 1 FROM anonymous_quote_lines line
            INNER JOIN catalog_active_release active ON active.singleton = 1
            WHERE line.session_id = guard.session_id
              AND line.id IN (SELECT value FROM json_each(?))
              AND line.line_kind = 'configured_assembly'
              ${input.whenSql ? `AND ${input.whenSql}` : ""}
              AND NOT EXISTS (
                SELECT 1 FROM catalog_configurator_registry_entries registry
                WHERE registry.release_id = active.release_id
                  AND registry.registry_type = '${input.registryType}'
                  AND registry.entry_key = ${input.entryKeySql}
                  AND registry.record_version = json_extract(
                    line.configured_snapshot_json,
                    '${input.recordVersionPath}'
                  )
              )
          )`;
}

export const staleLengthBasedHoseFeeGuardSql = `
  DELETE FROM customer_quote_request_submission_guards AS guard
  WHERE guard.id = ? AND (
    (SELECT COUNT(*) FROM anonymous_quote_lines line
     WHERE line.session_id = guard.session_id
       AND line.id IN (SELECT value FROM json_each(?))
       AND line.line_kind = 'length_based_hose')
      != json_array_length(?)
    OR EXISTS (
      SELECT 1 FROM json_each(?) expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM anonymous_quote_lines line
        INNER JOIN catalog_active_release active ON active.singleton = 1
        INNER JOIN catalog_releases release ON release.id = active.release_id
        INNER JOIN catalog_skus sku
          ON sku.import_id = release.source_import_id
         AND sku.sku = line.sku
        LEFT JOIN cutting_labeling_fee_rates global_fee
          ON global_fee.scope_key = 'global'
        LEFT JOIN cutting_labeling_fee_rates series_fee
          ON series_fee.scope_key = 'series:' || sku.hose_series
        WHERE line.id = json_extract(expected.value, '$.lineId')
          AND line.session_id = guard.session_id
          AND line.line_kind = 'length_based_hose'
          AND COALESCE(series_fee.scope_key, global_fee.scope_key)
                = json_extract(expected.value, '$.scope')
          AND COALESCE(series_fee.rate_per_piece, global_fee.rate_per_piece)
                = json_extract(expected.value, '$.ratePerPiece')
          AND COALESCE(series_fee.version, global_fee.version)
                = json_extract(expected.value, '$.version')
      )
    )
  )`;

export function createD1QuoteRequestRepository(database: D1Database) {
  async function findByIdempotency(profileId: string, idempotencyKey: string) {
    const row = await database
      .prepare(
        `SELECT id, reference_number, snapshot_json, submitted_at
         FROM customer_quote_requests
         WHERE profile_id = ? AND idempotency_key = ?`,
      )
      .bind(profileId, idempotencyKey)
      .first<QuoteRequestRow>();
    return row ? record(row) : null;
  }

  return {
    findByIdempotency,

    async listOwned(profileId: string) {
      const result = await database
        .prepare(
          `SELECT request.id, request.reference_number,
                  request.snapshot_json, request.submitted_at
           FROM customer_quote_requests request
           ${ownedQuoteRequestWhere}
           ORDER BY request.submitted_at DESC, request.id DESC`,
        )
        .bind(profileId, profileId, profileId)
        .all<QuoteRequestRow>();
      return result.results.map(record);
    },

    async findOwned(profileId: string, requestId: string) {
      const row = await database
        .prepare(
          `SELECT request.id, request.reference_number,
                  request.snapshot_json, request.submitted_at
           FROM customer_quote_requests request
           ${ownedQuoteRequestWhere}
           AND request.id = ?`,
        )
        .bind(profileId, profileId, profileId, requestId)
        .first<QuoteRequestRow>();
      return row ? record(row) : null;
    },

    async createAndClearSelectedQuoteLines(input: {
      expectedCatalogReleaseId: string;
      expectedLengthBasedHoseFees: {
        lineId: string;
        ratePerPiece: number | null;
        scope: string | null;
        version: number | null;
      }[];
      expectedLineCount: number;
      expectedLineState: string;
      id: string;
      idempotencyKey: string;
      profileId: string;
      purchasingContextId: string;
      referenceNumber: string;
      sessionId: string;
      sessionVersion: string;
      snapshot: QuoteRequestSnapshot;
      sourceAddressId: string;
      selectedLineIds: string[];
    }) {
      const snapshotJson = JSON.stringify(input.snapshot);
      const selectedLineIdsJson = JSON.stringify(input.selectedLineIds);
      const expectedLengthBasedHoseFeesJson = JSON.stringify(
        input.expectedLengthBasedHoseFees,
      );
      const contextBindings = selectedContextBindings(input);
      const batchResults = await database.batch<QuoteRequestRow>([
        database
          .prepare(
            `INSERT INTO customer_quote_request_submission_guards
               (id, profile_id, session_id, created_at)
             SELECT ?, ?, s.id, ?
             FROM anonymous_quote_sessions s
             WHERE s.id = ? AND s.profile_id = ? AND s.retired_at IS NULL
               AND (SELECT release_id FROM catalog_active_release
                    WHERE singleton = 1) = ?
               AND EXISTS (
                 SELECT 1 FROM customer_profiles profile
                 WHERE profile.id = ? AND profile.email_display = ?
                   AND profile.email_verified_at = ?
                   AND COALESCE(profile.full_name, '') = ?
                   AND COALESCE(profile.phone_number, '') = ?
               )
               AND EXISTS (${selectedContextGuard(input.snapshot)})
               AND json_array_length(?) = ?
               AND (SELECT COUNT(*) FROM anonymous_quote_lines l
                    WHERE l.session_id = s.id
                      AND l.id IN (SELECT value FROM json_each(?))) = ?
               AND (SELECT json_group_array(
                              json_object('id', id, 'quantity', quantity,
                                          'updatedAt', updated_at)
                            )
                    FROM (SELECT id, quantity, updated_at
                          FROM anonymous_quote_lines
                          WHERE session_id = s.id
                            AND id IN (SELECT value FROM json_each(?))
                          ORDER BY created_at, id)) = ?
             ON CONFLICT(id) DO NOTHING`,
          )
          .bind(
            input.id,
            input.profileId,
            input.snapshot.submittedAt,
            input.sessionId,
            input.profileId,
            input.expectedCatalogReleaseId,
            input.profileId,
            input.snapshot.actor.email,
            input.snapshot.actor.verifiedAt,
            input.snapshot.actor.fullName ?? "",
            input.snapshot.actor.phoneNumber ?? "",
            ...contextBindings,
            selectedLineIdsJson,
            input.expectedLineCount,
            selectedLineIdsJson,
            input.expectedLineCount,
            selectedLineIdsJson,
            input.expectedLineState,
          ),
        database
          .prepare(
            `DELETE FROM customer_quote_request_submission_guards AS guard
             WHERE guard.id = ? AND EXISTS (
               SELECT 1 FROM anonymous_quote_lines line
               WHERE line.session_id = guard.session_id
                 AND line.id IN (SELECT value FROM json_each(?))
                 AND NOT EXISTS (
                   SELECT 1
                   FROM catalog_active_release active
                   INNER JOIN catalog_releases release
                     ON release.id = active.release_id
                   INNER JOIN catalog_skus sku
                     ON sku.import_id = release.source_import_id
                    AND sku.sku = line.sku
                   INNER JOIN catalog_sales_offers offer
                     ON offer.import_id = sku.import_id
                    AND offer.base_sku = sku.sku
                   WHERE active.singleton = 1 AND active.release_id = ?
                     AND release.status = 'published'
                     AND sku.catalog_publication_status = 'Published'
                     AND sku.rfq_eligibility = 'Eligible'
                     AND sku.supply_availability = 'available_for_quote'
                     AND (
                       (line.line_kind = 'standard'
                         AND LOWER(COALESCE(offer.quantity_input_mode, ''))
                           NOT LIKE '%length%')
                       OR (line.line_kind = 'length_based_hose'
                         AND sku.product_type = 'hose'
                         AND LOWER(COALESCE(offer.quantity_input_mode, ''))
                           LIKE '%length%')
                       OR (line.line_kind = 'configured_assembly'
                         AND sku.product_type = 'hose')
                     )
                 )
             )`,
          )
          .bind(input.id, selectedLineIdsJson, input.expectedCatalogReleaseId),
        database
          .prepare(staleLengthBasedHoseFeeGuardSql)
          .bind(
            input.id,
            selectedLineIdsJson,
            expectedLengthBasedHoseFeesJson,
            expectedLengthBasedHoseFeesJson,
          ),
        database
          .prepare(deleteGuardForInvalidConfiguredEnd("A"))
          .bind(input.id, selectedLineIdsJson),
        database
          .prepare(deleteGuardForInvalidConfiguredEnd("B"))
          .bind(input.id, selectedLineIdsJson),
        database
          .prepare(
            deleteGuardForInvalidRegistry({
              entryKeySql:
                "json_extract(line.configured_snapshot_json, '$.configuration.installedProtection.code')",
              recordVersionPath:
                "$.configuration.installedProtection.recordVersion",
              registryType: "installed_protection",
            }),
          )
          .bind(input.id, selectedLineIdsJson),
        database
          .prepare(
            deleteGuardForInvalidRegistry({
              entryKeySql: "'DEFAULT'",
              recordVersionPath:
                "$.configuration.lengthReferencePricing.scheduleRecordVersion",
              registryType: "assembly_estimate_schedule",
            }),
          )
          .bind(input.id, selectedLineIdsJson),
        database
          .prepare(
            deleteGuardForInvalidRegistry({
              entryKeySql:
                "json_extract(line.configured_snapshot_json, '$.configuration.measurementSelection.method.code')",
              recordVersionPath:
                "$.configuration.measurementSelection.method.recordVersion",
              registryType: "measurement_method",
              whenSql:
                "json_extract(line.configured_snapshot_json, '$.configuration.measurementSelection.state') = 'selected'",
            }),
          )
          .bind(input.id, selectedLineIdsJson),
        database
          .prepare(
            deleteGuardForInvalidRegistry({
              entryKeySql: "'M08'",
              recordVersionPath:
                "$.configuration.clocking.convention.recordVersion",
              registryType: "clocking_convention",
              whenSql:
                "json_extract(line.configured_snapshot_json, '$.configuration.clocking.convention.recordVersion') IS NOT NULL",
            }),
          )
          .bind(input.id, selectedLineIdsJson),
        database
          .prepare(
            `INSERT INTO customer_quote_requests
               (id, reference_number, profile_id, purchasing_context_id,
                source_session_id, source_session_version, source_address_id,
                purchasing_context_kind, fulfillment_term, currency,
                merchandise_subtotal, service_fee_total, idempotency_key,
                snapshot_json, submitted_at)
             SELECT ?, ?, ?, ?, s.id, ?, ?, ?, ?, 'USD',
                    ?, ?, ?, ?, ?
             FROM customer_quote_request_submission_guards guard
             INNER JOIN anonymous_quote_sessions s ON s.id = guard.session_id
             WHERE guard.id = ?
             ON CONFLICT(profile_id, idempotency_key) DO NOTHING
             RETURNING id, reference_number, snapshot_json, submitted_at`,
          )
          .bind(
            input.id,
            input.referenceNumber,
            input.profileId,
            input.purchasingContextId,
            input.sessionVersion,
            input.sourceAddressId,
            input.snapshot.purchasingContext.kind,
            input.snapshot.importResponsibility.fulfillmentTerm,
            input.snapshot.amounts.merchandiseSubtotal,
            input.snapshot.amounts.serviceFeeTotal,
            input.idempotencyKey,
            snapshotJson,
            input.snapshot.submittedAt,
            input.id,
          ),
        database
          .prepare(
            `DELETE FROM anonymous_quote_lines
             WHERE session_id = ?
               AND id IN (SELECT value FROM json_each(?))
               AND EXISTS (
                 SELECT 1 FROM customer_quote_requests
                 WHERE id = ? AND source_session_id = ?
               )`,
          )
          .bind(
            input.sessionId,
            selectedLineIdsJson,
            input.id,
            input.sessionId,
          ),
        database
          .prepare(
            `DELETE FROM customer_quote_request_submission_guards WHERE id = ?`,
          )
          .bind(input.id),
      ]);

      const insertResult = batchResults[9];
      const inserted = insertResult?.results[0];
      if (inserted) return { created: true, record: record(inserted) };
      const existing = await findByIdempotency(
        input.profileId,
        input.idempotencyKey,
      );
      return existing
        ? { created: false, record: existing }
        : { created: false, record: null };
    },
  };
}
