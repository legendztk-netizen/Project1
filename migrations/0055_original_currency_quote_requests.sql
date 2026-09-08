CREATE TABLE `customer_quote_requests_new` (
  `id` text PRIMARY KEY NOT NULL,
  `reference_number` text NOT NULL,
  `profile_id` text NOT NULL,
  `purchasing_context_id` text NOT NULL,
  `source_session_id` text NOT NULL,
  `source_session_version` text NOT NULL,
  `source_address_id` text NOT NULL,
  `purchasing_context_kind` text NOT NULL,
  `fulfillment_term` text NOT NULL,
  `currency` text,
  `merchandise_subtotal` real,
  `service_fee_total` real NOT NULL,
  `idempotency_key` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `submitted_at` text NOT NULL,
  CONSTRAINT `customer_quote_request_context_kind`
    CHECK (`purchasing_context_kind` IN ('individual', 'organization')),
  CONSTRAINT `customer_quote_request_fulfillment_term`
    CHECK (`fulfillment_term` IN ('DDP', 'DAP', 'MANUAL')),
  CONSTRAINT `customer_quote_request_currency`
    CHECK (`currency` IS NULL OR `currency` IN ('USD', 'CNY', 'EUR', 'GBP', 'JPY', 'CAD')),
  CONSTRAINT `customer_quote_request_amounts`
    CHECK (`merchandise_subtotal` >= 0 AND `service_fee_total` >= 0),
  CONSTRAINT `customer_quote_request_snapshot_json`
    CHECK (json_valid(`snapshot_json`)),
  FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE restrict,
  FOREIGN KEY (`purchasing_context_id`)
    REFERENCES `customer_purchasing_contexts`(`id`) ON DELETE restrict
);

INSERT INTO customer_quote_requests_new SELECT * FROM customer_quote_requests;
DROP TABLE customer_quote_requests;
ALTER TABLE customer_quote_requests_new RENAME TO customer_quote_requests;

CREATE UNIQUE INDEX `customer_quote_request_reference_uq`
ON `customer_quote_requests` (`reference_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_quote_request_idempotency_uq`
ON `customer_quote_requests` (`profile_id`, `idempotency_key`);
--> statement-breakpoint
CREATE INDEX `customer_quote_request_profile_submitted_idx`
ON `customer_quote_requests` (`profile_id`, `submitted_at` DESC);
--> statement-breakpoint
CREATE TRIGGER `customer_quote_requests_immutable_update`
BEFORE UPDATE ON `customer_quote_requests`
BEGIN
  SELECT RAISE(ABORT, 'submitted quote requests are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `customer_quote_requests_immutable_delete`
BEFORE DELETE ON `customer_quote_requests`
BEGIN
  SELECT RAISE(ABORT, 'submitted quote requests are immutable');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 56, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;

-- A non-USD hose amount and a USD cutting fee have no combined total.
DROP TRIGGER anonymous_quote_lines_validate_shape_insert;
DROP TRIGGER anonymous_quote_lines_validate_shape_update;
CREATE TRIGGER `anonymous_quote_lines_validate_shape_insert`
BEFORE INSERT ON `anonymous_quote_lines`
WHEN (
  NEW.`line_kind` = 'standard'
  AND (
    NEW.`original_length_value` IS NOT NULL OR NEW.`original_length_unit` IS NOT NULL
    OR NEW.`normalized_length_ft` IS NOT NULL OR NEW.`piece_count` IS NOT NULL
    OR NEW.`total_footage` IS NOT NULL OR NEW.`cutting_labeling_fee_rate` IS NOT NULL
    OR NEW.`cutting_labeling_fee_amount` IS NOT NULL OR NEW.`cutting_labeling_fee_scope` IS NOT NULL
    OR NEW.`cutting_labeling_fee_version` IS NOT NULL OR NEW.`estimated_merchandise_amount` IS NOT NULL
    OR NEW.`current_estimate_amount` IS NOT NULL OR NEW.`configured_snapshot_json` IS NOT NULL
    OR NEW.`configured_estimate_inputs_json` IS NOT NULL OR NEW.`configured_unit_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'length_based_hose'
  AND (
    NEW.`category` <> 'hydraulic-hose' OR NEW.`original_length_value` IS NULL
    OR NEW.`original_length_unit` IS NULL OR NEW.`normalized_length_ft` IS NULL
    OR NEW.`piece_count` IS NULL OR NEW.`quantity` <> NEW.`piece_count`
    OR NEW.`total_footage` IS NULL OR NEW.`cutting_labeling_fee_rate` IS NULL
    OR NEW.`cutting_labeling_fee_amount` IS NULL OR NEW.`cutting_labeling_fee_scope` IS NULL
    OR NEW.`cutting_labeling_fee_version` IS NULL
    OR (NEW.currency='USD' AND (NEW.`estimated_merchandise_amount` IS NULL) <> (NEW.`current_estimate_amount` IS NULL))
    OR (NEW.currency<>'USD' AND NEW.current_estimate_amount IS NOT NULL)
    OR NEW.`configured_snapshot_json` IS NOT NULL OR NEW.`configured_estimate_inputs_json` IS NOT NULL
    OR NEW.`configured_unit_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'configured_assembly'
  AND (
    NEW.`category` <> 'hydraulic-hose' OR NEW.`sales_unit` <> 'each' OR NEW.`currency` <> 'USD'
    OR NEW.`reference_unit_price` IS NOT NULL OR NEW.`original_length_value` IS NOT NULL
    OR NEW.`original_length_unit` IS NOT NULL OR NEW.`normalized_length_ft` IS NOT NULL
    OR NEW.`piece_count` IS NOT NULL OR NEW.`total_footage` IS NOT NULL
    OR NEW.`cutting_labeling_fee_rate` IS NOT NULL OR NEW.`cutting_labeling_fee_amount` IS NOT NULL
    OR NEW.`cutting_labeling_fee_scope` IS NOT NULL OR NEW.`cutting_labeling_fee_version` IS NOT NULL
    OR NEW.`estimated_merchandise_amount` IS NOT NULL OR NEW.`configured_snapshot_json` IS NULL
    OR NOT json_valid(NEW.`configured_snapshot_json`) OR NEW.`configured_estimate_inputs_json` IS NULL
    OR NOT json_valid(NEW.`configured_estimate_inputs_json`)
    OR (NEW.`configured_unit_estimate_amount` IS NULL) <> (NEW.`current_estimate_amount` IS NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid anonymous quote line shape');
END;
--> statement-breakpoint
CREATE TRIGGER `anonymous_quote_lines_validate_shape_update`
BEFORE UPDATE ON `anonymous_quote_lines`
WHEN (
  NEW.`line_kind` = 'standard'
  AND (
    NEW.`original_length_value` IS NOT NULL OR NEW.`original_length_unit` IS NOT NULL
    OR NEW.`normalized_length_ft` IS NOT NULL OR NEW.`piece_count` IS NOT NULL
    OR NEW.`total_footage` IS NOT NULL OR NEW.`cutting_labeling_fee_rate` IS NOT NULL
    OR NEW.`cutting_labeling_fee_amount` IS NOT NULL OR NEW.`cutting_labeling_fee_scope` IS NOT NULL
    OR NEW.`cutting_labeling_fee_version` IS NOT NULL OR NEW.`estimated_merchandise_amount` IS NOT NULL
    OR NEW.`current_estimate_amount` IS NOT NULL OR NEW.`configured_snapshot_json` IS NOT NULL
    OR NEW.`configured_estimate_inputs_json` IS NOT NULL OR NEW.`configured_unit_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'length_based_hose'
  AND (
    NEW.`category` <> 'hydraulic-hose' OR NEW.`original_length_value` IS NULL
    OR NEW.`original_length_unit` IS NULL OR NEW.`normalized_length_ft` IS NULL
    OR NEW.`piece_count` IS NULL OR NEW.`quantity` <> NEW.`piece_count`
    OR NEW.`total_footage` IS NULL OR NEW.`cutting_labeling_fee_rate` IS NULL
    OR NEW.`cutting_labeling_fee_amount` IS NULL OR NEW.`cutting_labeling_fee_scope` IS NULL
    OR NEW.`cutting_labeling_fee_version` IS NULL
    OR (NEW.currency='USD' AND (NEW.`estimated_merchandise_amount` IS NULL) <> (NEW.`current_estimate_amount` IS NULL))
    OR (NEW.currency<>'USD' AND NEW.current_estimate_amount IS NOT NULL)
    OR NEW.`configured_snapshot_json` IS NOT NULL OR NEW.`configured_estimate_inputs_json` IS NOT NULL
    OR NEW.`configured_unit_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'configured_assembly'
  AND (
    NEW.`category` <> 'hydraulic-hose' OR NEW.`sales_unit` <> 'each' OR NEW.`currency` <> 'USD'
    OR NEW.`reference_unit_price` IS NOT NULL OR NEW.`original_length_value` IS NOT NULL
    OR NEW.`original_length_unit` IS NOT NULL OR NEW.`normalized_length_ft` IS NOT NULL
    OR NEW.`piece_count` IS NOT NULL OR NEW.`total_footage` IS NOT NULL
    OR NEW.`cutting_labeling_fee_rate` IS NOT NULL OR NEW.`cutting_labeling_fee_amount` IS NOT NULL
    OR NEW.`cutting_labeling_fee_scope` IS NOT NULL OR NEW.`cutting_labeling_fee_version` IS NOT NULL
    OR NEW.`estimated_merchandise_amount` IS NOT NULL OR NEW.`configured_snapshot_json` IS NULL
    OR NOT json_valid(NEW.`configured_snapshot_json`) OR NEW.`configured_estimate_inputs_json` IS NULL
    OR NOT json_valid(NEW.`configured_estimate_inputs_json`)
    OR (NEW.`configured_unit_estimate_amount` IS NULL) <> (NEW.`current_estimate_amount` IS NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid anonymous quote line shape');
END;
--> statement-breakpoint
