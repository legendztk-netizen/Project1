CREATE TABLE pi_payment_deadline_extensions (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  old_due_date_et TEXT NOT NULL,
  old_due_at TEXT NOT NULL,
  new_due_date_et TEXT NOT NULL,
  new_due_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  extended_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_deadline_extensions_no_update BEFORE UPDATE ON pi_payment_deadline_extensions BEGIN SELECT RAISE(ABORT,'Payment extension is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_deadline_extensions_no_delete BEFORE DELETE ON pi_payment_deadline_extensions BEGIN SELECT RAISE(ABORT,'Payment extension is immutable'); END;
--> statement-breakpoint
CREATE TABLE pi_late_payment_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  decision TEXT NOT NULL CHECK(decision IN ('same_terms_approved','replacement_required')),
  pricing_checked INTEGER NOT NULL CHECK(pricing_checked=1),
  availability_checked INTEGER NOT NULL CHECK(availability_checked=1),
  freight_checked INTEGER NOT NULL CHECK(freight_checked=1),
  trade_terms_checked INTEGER NOT NULL CHECK(trade_terms_checked=1),
  lead_time_checked INTEGER NOT NULL CHECK(lead_time_checked=1),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_late_reviews_no_update BEFORE UPDATE ON pi_late_payment_reviews BEGIN SELECT RAISE(ABORT,'Late review is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_late_reviews_no_delete BEFORE DELETE ON pi_late_payment_reviews BEGIN SELECT RAISE(ABORT,'Late review is immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=86, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
