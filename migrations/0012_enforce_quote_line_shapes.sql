CREATE TRIGGER `anonymous_quote_lines_validate_shape_insert`
BEFORE INSERT ON `anonymous_quote_lines`
WHEN (
  NEW.`line_kind` = 'standard'
  AND (
    NEW.`original_length_value` IS NOT NULL
    OR NEW.`original_length_unit` IS NOT NULL
    OR NEW.`normalized_length_ft` IS NOT NULL
    OR NEW.`piece_count` IS NOT NULL
    OR NEW.`total_footage` IS NOT NULL
    OR NEW.`cutting_labeling_fee_rate` IS NOT NULL
    OR NEW.`cutting_labeling_fee_amount` IS NOT NULL
    OR NEW.`cutting_labeling_fee_scope` IS NOT NULL
    OR NEW.`cutting_labeling_fee_version` IS NOT NULL
    OR NEW.`estimated_merchandise_amount` IS NOT NULL
    OR NEW.`current_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'length_based_hose'
  AND (
    NEW.`category` <> 'hydraulic-hose'
    OR NEW.`original_length_value` IS NULL
    OR NEW.`original_length_unit` IS NULL
    OR NEW.`normalized_length_ft` IS NULL
    OR NEW.`piece_count` IS NULL
    OR NEW.`quantity` <> NEW.`piece_count`
    OR NEW.`total_footage` IS NULL
    OR NEW.`cutting_labeling_fee_rate` IS NULL
    OR NEW.`cutting_labeling_fee_amount` IS NULL
    OR NEW.`cutting_labeling_fee_scope` IS NULL
    OR NEW.`cutting_labeling_fee_version` IS NULL
    OR (NEW.`estimated_merchandise_amount` IS NULL) <>
       (NEW.`current_estimate_amount` IS NULL)
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
    NEW.`original_length_value` IS NOT NULL
    OR NEW.`original_length_unit` IS NOT NULL
    OR NEW.`normalized_length_ft` IS NOT NULL
    OR NEW.`piece_count` IS NOT NULL
    OR NEW.`total_footage` IS NOT NULL
    OR NEW.`cutting_labeling_fee_rate` IS NOT NULL
    OR NEW.`cutting_labeling_fee_amount` IS NOT NULL
    OR NEW.`cutting_labeling_fee_scope` IS NOT NULL
    OR NEW.`cutting_labeling_fee_version` IS NOT NULL
    OR NEW.`estimated_merchandise_amount` IS NOT NULL
    OR NEW.`current_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'length_based_hose'
  AND (
    NEW.`category` <> 'hydraulic-hose'
    OR NEW.`original_length_value` IS NULL
    OR NEW.`original_length_unit` IS NULL
    OR NEW.`normalized_length_ft` IS NULL
    OR NEW.`piece_count` IS NULL
    OR NEW.`quantity` <> NEW.`piece_count`
    OR NEW.`total_footage` IS NULL
    OR NEW.`cutting_labeling_fee_rate` IS NULL
    OR NEW.`cutting_labeling_fee_amount` IS NULL
    OR NEW.`cutting_labeling_fee_scope` IS NULL
    OR NEW.`cutting_labeling_fee_version` IS NULL
    OR (NEW.`estimated_merchandise_amount` IS NULL) <>
       (NEW.`current_estimate_amount` IS NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid anonymous quote line shape');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 13, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
