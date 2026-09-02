CREATE TABLE `customer_quote_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `reference_number` text NOT NULL,
  `profile_id` text NOT NULL,
  `purchasing_context_id` text NOT NULL,
  `source_session_id` text NOT NULL,
  `source_session_version` text NOT NULL,
  `source_address_id` text NOT NULL,
  `purchasing_context_kind` text NOT NULL,
  `fulfillment_term` text NOT NULL,
  `currency` text NOT NULL,
  `merchandise_subtotal` real NOT NULL,
  `service_fee_total` real NOT NULL,
  `idempotency_key` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `submitted_at` text NOT NULL,
  CONSTRAINT `customer_quote_request_context_kind`
    CHECK (`purchasing_context_kind` IN ('individual', 'organization')),
  CONSTRAINT `customer_quote_request_fulfillment_term`
    CHECK (`fulfillment_term` IN ('DDP', 'DAP')),
  CONSTRAINT `customer_quote_request_currency`
    CHECK (`currency` = 'USD'),
  CONSTRAINT `customer_quote_request_amounts`
    CHECK (`merchandise_subtotal` >= 0 AND `service_fee_total` >= 0),
  CONSTRAINT `customer_quote_request_snapshot_json`
    CHECK (json_valid(`snapshot_json`)),
  FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE restrict,
  FOREIGN KEY (`purchasing_context_id`)
    REFERENCES `customer_purchasing_contexts`(`id`) ON DELETE restrict
);
--> statement-breakpoint
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
SET `version` = 39, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
