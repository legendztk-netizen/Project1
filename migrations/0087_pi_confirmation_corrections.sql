ALTER TABLE pi_payment_accounts ADD COLUMN confirmation_valid INTEGER NOT NULL DEFAULT 1 CHECK(confirmation_valid IN (0,1));
--> statement-breakpoint
ALTER TABLE confirmed_orders ADD COLUMN reverification_id TEXT;
--> statement-breakpoint
CREATE TABLE pi_payment_corrections (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  original_confirmation_id TEXT NOT NULL REFERENCES pi_payment_confirmations(id),
  previous_amount_cents INTEGER NOT NULL,
  corrected_amount_cents INTEGER NOT NULL CHECK(corrected_amount_cents>=0),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  corrected_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_payment_corrections_no_update BEFORE UPDATE ON pi_payment_corrections BEGIN SELECT RAISE(ABORT,'Payment correction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_payment_corrections_no_delete BEFORE DELETE ON pi_payment_corrections BEGIN SELECT RAISE(ABORT,'Payment correction is immutable'); END;
--> statement-breakpoint
CREATE TABLE pi_payment_reverifications (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  original_confirmation_id TEXT NOT NULL REFERENCES pi_payment_confirmations(id),
  correction_id TEXT NOT NULL REFERENCES pi_payment_corrections(id),
  external_reference TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reverified_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_payment_reverifications_no_update BEFORE UPDATE ON pi_payment_reverifications BEGIN SELECT RAISE(ABORT,'Payment reverification is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_payment_reverifications_no_delete BEFORE DELETE ON pi_payment_reverifications BEGIN SELECT RAISE(ABORT,'Payment reverification is immutable'); END;
--> statement-breakpoint
CREATE TABLE pi_payment_correction_resolutions (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  correction_id TEXT NOT NULL REFERENCES pi_payment_corrections(id),
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  reason TEXT NOT NULL,
  verification_reference TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_payment_correction_resolutions_no_update BEFORE UPDATE ON pi_payment_correction_resolutions BEGIN SELECT RAISE(ABORT,'Correction resolution is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_payment_correction_resolutions_no_delete BEFORE DELETE ON pi_payment_correction_resolutions BEGIN SELECT RAISE(ABORT,'Correction resolution is immutable'); END;
--> statement-breakpoint
CREATE TABLE pi_payment_disputes (
  pi_id TEXT PRIMARY KEY NOT NULL REFERENCES proforma_invoices(id),
  correction_id TEXT NOT NULL REFERENCES pi_payment_corrections(id),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_payment_disputes_no_overlap BEFORE UPDATE ON pi_payment_disputes
WHEN OLD.active=1 AND NEW.active=1 AND OLD.correction_id!=NEW.correction_id
BEGIN SELECT RAISE(ABORT,'Existing payment dispute must be resolved first'); END;
--> statement-breakpoint
CREATE TABLE order_release_guards (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES confirmed_orders(id),
  held INTEGER NOT NULL CHECK(held IN (0,1)),
  review_event_id TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO order_release_guards(order_id,held,updated_at)
SELECT id,0,confirmed_at FROM confirmed_orders;
--> statement-breakpoint
CREATE VIEW releasable_confirmed_orders AS
SELECT o.id AS order_id,o.pi_id,o.request_id FROM confirmed_orders o
JOIN order_release_guards g ON g.order_id=o.id AND g.held=0
WHERE NOT EXISTS(SELECT 1 FROM pi_payment_disputes d WHERE d.pi_id=o.pi_id AND d.active=1);
--> statement-breakpoint
CREATE TABLE pi_order_hold_events (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  correction_id TEXT NOT NULL REFERENCES pi_payment_corrections(id),
  kind TEXT NOT NULL CHECK(kind IN ('hold','release')),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_order_hold_events_no_update BEFORE UPDATE ON pi_order_hold_events BEGIN SELECT RAISE(ABORT,'Order hold event is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_order_hold_events_no_delete BEFORE DELETE ON pi_order_hold_events BEGIN SELECT RAISE(ABORT,'Order hold event is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_fund_resolutions_dispute_guard BEFORE INSERT ON pi_fund_resolutions
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM pi_payment_disputes d
    WHERE d.active=1 AND d.pi_id IN (NEW.source_pi_id,NEW.target_pi_id))
    THEN RAISE(ABORT,'Disputed funds cannot be resolved') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=88, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
