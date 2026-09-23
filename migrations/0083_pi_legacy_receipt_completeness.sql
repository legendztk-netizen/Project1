ALTER TABLE pi_payment_accounts ADD COLUMN receipt_history_known INTEGER NOT NULL DEFAULT 1 CHECK(receipt_history_known IN (0,1));
--> statement-breakpoint
UPDATE pi_payment_accounts SET receipt_history_known=0 WHERE term_kind='legacy_review';
--> statement-breakpoint
UPDATE application_schema_state SET version=84, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
