CREATE TABLE pi_order_finalization_assertions (
  id TEXT PRIMARY KEY NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  valid INTEGER NOT NULL CHECK(valid=1),
  asserted_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_order_finalization_assertions_no_update BEFORE UPDATE ON pi_order_finalization_assertions BEGIN SELECT RAISE(ABORT,'Order finalization assertion is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_order_finalization_assertions_no_delete BEFORE DELETE ON pi_order_finalization_assertions BEGIN SELECT RAISE(ABORT,'Order finalization assertion is immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=90, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
