export interface CustomerQuoteListMergeInput {
  actorProfileId: string;
  challengeId: string;
  challengeNonce: string;
  destinationSessionId: string;
  mergeId: string;
  now: string;
  profileId: string;
  sourceSessionId: string;
}

const accountQuoteListExpiry = "9999-12-31T23:59:59.999Z";

function destinationSessionIdSql() {
  return `(SELECT id FROM anonymous_quote_sessions WHERE profile_id = ?)`;
}

function completedChallengeSql() {
  return `EXISTS (
    SELECT 1 FROM customer_otp_challenges
    WHERE id = ? AND consumption_nonce = ?
      AND quote_session_id_at_request = ?
  )`;
}

function activeAnonymousSourceSql() {
  return `EXISTS (
    SELECT 1 FROM anonymous_quote_sessions
    WHERE id = ? AND profile_id IS NULL AND retired_at IS NULL
      AND expires_at > ?
  )`;
}

export function customerQuoteListMergeStatements(
  database: D1Database,
  input: CustomerQuoteListMergeInput,
) {
  const destination = destinationSessionIdSql();
  const challenge = completedChallengeSql();
  const source = activeAnonymousSourceSql();
  return [
    database
      .prepare(
        `INSERT INTO anonymous_quote_sessions
           (id, created_at, last_activity_at, expires_at, profile_id)
         SELECT ?, ?, ?, ?, ?
         WHERE ${challenge} AND ${source}
           AND EXISTS (SELECT 1 FROM customer_profiles WHERE id = ?)
         ON CONFLICT(profile_id) WHERE profile_id IS NOT NULL DO NOTHING`,
      )
      .bind(
        input.destinationSessionId,
        input.now,
        input.now,
        accountQuoteListExpiry,
        input.profileId,
        input.challengeId,
        input.challengeNonce,
        input.sourceSessionId,
        input.sourceSessionId,
        input.now,
        input.profileId,
      ),
    database
      .prepare(
        `INSERT INTO customer_quote_list_merges
           (id, source_session_id, destination_session_id, profile_id,
            actor_profile_id, result_json, created_at)
         SELECT ?, ?, destination.id, ?, ?,
           json_object(
             'sourceLineCount', (
               SELECT COUNT(*) FROM anonymous_quote_lines source_line
               WHERE source_line.session_id = ?
             ),
             'combinedLineCount', (
               SELECT COUNT(*) FROM anonymous_quote_lines source_line
               WHERE source_line.session_id = ? AND EXISTS (
                 SELECT 1 FROM anonymous_quote_lines destination_line
                 WHERE destination_line.session_id = destination.id
                   AND destination_line.line_identity = source_line.line_identity
               )
             ),
             'movedLineCount', (
               SELECT COUNT(*) FROM anonymous_quote_lines source_line
               WHERE source_line.session_id = ? AND NOT EXISTS (
                 SELECT 1 FROM anonymous_quote_lines destination_line
                 WHERE destination_line.session_id = destination.id
                   AND destination_line.line_identity = source_line.line_identity
               )
             ),
             'lines', json(COALESCE((
               SELECT json_group_array(json(line_result)) FROM (
                 SELECT json_object(
                   'sourceLineId', source_line.id,
                   'lineIdentity', source_line.line_identity,
                   'lineKind', source_line.line_kind,
                   'sourceQuantity', source_line.quantity,
                   'destinationQuantity', destination_line.quantity,
                   'finalDestinationLineId', COALESCE(
                     destination_line.id, source_line.id
                   ),
                   'finalQuantity', source_line.quantity + COALESCE(
                     destination_line.quantity, 0
                   ),
                   'result', CASE WHEN destination_line.id IS NULL
                     THEN 'moved' ELSE 'quantity_combined' END,
                   'sourceRetainedContext', json_object(
                     'catalogReleaseId', source_line.catalog_release_id,
                     'referenceUnitPrice', source_line.reference_unit_price,
                     'originalLengthValue', source_line.original_length_value,
                     'originalLengthUnit', source_line.original_length_unit,
                     'normalizedLengthFt', source_line.normalized_length_ft,
                     'pieceCount', source_line.piece_count,
                     'totalFootage', source_line.total_footage,
                     'cuttingLabelingFeeRate',
                       source_line.cutting_labeling_fee_rate,
                     'cuttingLabelingFeeAmount',
                       source_line.cutting_labeling_fee_amount,
                     'cuttingLabelingFeeScope',
                       source_line.cutting_labeling_fee_scope,
                     'cuttingLabelingFeeVersion',
                       source_line.cutting_labeling_fee_version,
                     'estimatedMerchandiseAmount',
                       source_line.estimated_merchandise_amount,
                     'currentEstimateAmount', source_line.current_estimate_amount,
                     'configuredSnapshot', CASE
                       WHEN source_line.configured_snapshot_json IS NULL THEN NULL
                       ELSE json(source_line.configured_snapshot_json) END,
                     'configuredEstimateInputs', CASE
                       WHEN source_line.configured_estimate_inputs_json IS NULL THEN NULL
                       ELSE json(source_line.configured_estimate_inputs_json) END,
                     'configuredUnitEstimateAmount',
                       source_line.configured_unit_estimate_amount
                   )
                 ) AS line_result
                 FROM anonymous_quote_lines source_line
                 LEFT JOIN anonymous_quote_lines destination_line
                   ON destination_line.session_id = destination.id
                  AND destination_line.line_identity = source_line.line_identity
                 WHERE source_line.session_id = ?
                 ORDER BY source_line.id
               )
             ), '[]'))
           ), ?
         FROM anonymous_quote_sessions destination
         WHERE destination.profile_id = ? AND ${challenge} AND ${source}
           AND NOT EXISTS (
             SELECT 1
             FROM anonymous_quote_lines source_line
             JOIN anonymous_quote_lines destination_line
               ON destination_line.session_id = destination.id
              AND destination_line.line_identity = source_line.line_identity
             WHERE source_line.session_id = ?
               AND source_line.quantity + destination_line.quantity > 9999
           )
         ON CONFLICT(source_session_id) DO NOTHING`,
      )
      .bind(
        input.mergeId,
        input.sourceSessionId,
        input.profileId,
        input.actorProfileId,
        input.sourceSessionId,
        input.sourceSessionId,
        input.sourceSessionId,
        input.sourceSessionId,
        input.now,
        input.profileId,
        input.challengeId,
        input.challengeNonce,
        input.sourceSessionId,
        input.sourceSessionId,
        input.now,
        input.sourceSessionId,
      ),
    database
      .prepare(
        `UPDATE anonymous_quote_lines AS destination_line
         SET quantity = quantity + (
               SELECT source_line.quantity FROM anonymous_quote_lines source_line
               WHERE source_line.session_id = ?
                 AND source_line.line_identity = destination_line.line_identity
             ),
             piece_count = CASE WHEN line_kind = 'length_based_hose'
               THEN piece_count + (
                 SELECT source_line.piece_count FROM anonymous_quote_lines source_line
                 WHERE source_line.session_id = ?
                   AND source_line.line_identity = destination_line.line_identity
               ) ELSE piece_count END,
             total_footage = CASE WHEN line_kind = 'length_based_hose'
               THEN normalized_length_ft * (piece_count + (
                 SELECT source_line.piece_count FROM anonymous_quote_lines source_line
                 WHERE source_line.session_id = ?
                   AND source_line.line_identity = destination_line.line_identity
               )) ELSE total_footage END,
             cutting_labeling_fee_amount = CASE WHEN line_kind = 'length_based_hose'
               THEN ROUND(cutting_labeling_fee_rate * (piece_count + (
                 SELECT source_line.piece_count FROM anonymous_quote_lines source_line
                 WHERE source_line.session_id = ?
                   AND source_line.line_identity = destination_line.line_identity
               )), 2) ELSE cutting_labeling_fee_amount END,
             estimated_merchandise_amount = CASE
               WHEN line_kind = 'length_based_hose' AND reference_unit_price IS NOT NULL
               THEN ROUND(reference_unit_price * normalized_length_ft *
                 (piece_count + (
                   SELECT source_line.piece_count FROM anonymous_quote_lines source_line
                   WHERE source_line.session_id = ?
                     AND source_line.line_identity = destination_line.line_identity
                 )), 2)
               ELSE estimated_merchandise_amount END,
             current_estimate_amount = CASE
               WHEN line_kind = 'length_based_hose' AND reference_unit_price IS NOT NULL
               THEN ROUND(
                 (reference_unit_price * normalized_length_ft + cutting_labeling_fee_rate) *
                 (piece_count + (
                   SELECT source_line.piece_count FROM anonymous_quote_lines source_line
                   WHERE source_line.session_id = ?
                     AND source_line.line_identity = destination_line.line_identity
                 )), 2)
               WHEN line_kind = 'configured_assembly'
                    AND configured_unit_estimate_amount IS NOT NULL
               THEN ROUND(configured_unit_estimate_amount * (quantity + (
                 SELECT source_line.quantity FROM anonymous_quote_lines source_line
                 WHERE source_line.session_id = ?
                   AND source_line.line_identity = destination_line.line_identity
               )), 2)
               ELSE current_estimate_amount END,
             updated_at = ?
         WHERE session_id = ${destination}
           AND EXISTS (
             SELECT 1 FROM anonymous_quote_lines source_line
             WHERE source_line.session_id = ?
               AND source_line.line_identity = destination_line.line_identity
           )
           AND EXISTS (
             SELECT 1 FROM customer_quote_list_merges
             WHERE id = ? AND source_session_id = ?
           )`,
      )
      .bind(
        input.sourceSessionId,
        input.sourceSessionId,
        input.sourceSessionId,
        input.sourceSessionId,
        input.sourceSessionId,
        input.sourceSessionId,
        input.sourceSessionId,
        input.now,
        input.profileId,
        input.sourceSessionId,
        input.mergeId,
        input.sourceSessionId,
      ),
    database
      .prepare(
        `DELETE FROM anonymous_quote_lines AS source_line
         WHERE source_line.session_id = ? AND EXISTS (
           SELECT 1 FROM anonymous_quote_lines destination_line
           WHERE destination_line.session_id = ${destination}
             AND destination_line.line_identity = source_line.line_identity
         ) AND EXISTS (
           SELECT 1 FROM customer_quote_list_merges
           WHERE id = ? AND source_session_id = ?
         )`,
      )
      .bind(
        input.sourceSessionId,
        input.profileId,
        input.mergeId,
        input.sourceSessionId,
      ),
    database
      .prepare(
        `UPDATE anonymous_quote_lines
         SET session_id = ${destination}, updated_at = ?
         WHERE session_id = ? AND EXISTS (
           SELECT 1 FROM customer_quote_list_merges
           WHERE id = ? AND source_session_id = ?
         )`,
      )
      .bind(
        input.profileId,
        input.now,
        input.sourceSessionId,
        input.mergeId,
        input.sourceSessionId,
      ),
    database
      .prepare(
        `UPDATE anonymous_quote_sessions
         SET retired_at = ?, expires_at = ?, merged_into_session_id = ${destination}
         WHERE id = ? AND profile_id IS NULL AND retired_at IS NULL
           AND EXISTS (
             SELECT 1 FROM customer_quote_list_merges
             WHERE id = ? AND source_session_id = ?
           )`,
      )
      .bind(
        input.now,
        input.now,
        input.profileId,
        input.sourceSessionId,
        input.mergeId,
        input.sourceSessionId,
      ),
    database
      .prepare(
        `UPDATE anonymous_quote_sessions
         SET last_activity_at = ?
         WHERE id = ${destination} AND EXISTS (
           SELECT 1 FROM customer_quote_list_merges
           WHERE id = ? AND source_session_id = ?
         )`,
      )
      .bind(input.now, input.profileId, input.mergeId, input.sourceSessionId),
  ];
}

export { accountQuoteListExpiry };
