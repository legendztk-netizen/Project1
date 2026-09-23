CREATE TABLE pi_original_currency_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  currency TEXT NOT NULL CHECK(length(currency)=3 AND currency<>'USD'),
  amount_decimal TEXT NOT NULL,
  actual_channel TEXT NOT NULL CHECK(actual_channel IN ('bank_transfer','paypal')),
  verification_reference TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX pi_original_currency_receipts_pi ON pi_original_currency_receipts(pi_id,recorded_at);
--> statement-breakpoint
CREATE TRIGGER pi_original_currency_receipts_no_update BEFORE UPDATE ON pi_original_currency_receipts BEGIN SELECT RAISE(ABORT,'Original-currency receipt is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_original_currency_receipts_no_delete BEFORE DELETE ON pi_original_currency_receipts BEGIN SELECT RAISE(ABORT,'Original-currency receipt is immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=83, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
