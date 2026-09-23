CREATE TABLE pi_payment_confirmations (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  pi_id TEXT NOT NULL UNIQUE REFERENCES proforma_invoices(id),
  confirmed_cents INTEGER NOT NULL CHECK(confirmed_cents>0),
  currency TEXT NOT NULL CHECK(currency='USD'),
  actual_channel TEXT NOT NULL CHECK(actual_channel IN ('bank_transfer','paypal')),
  external_reference TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  confirmed_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_payment_confirmations_no_update BEFORE UPDATE ON pi_payment_confirmations BEGIN SELECT RAISE(ABORT,'Payment confirmation is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_payment_confirmations_no_delete BEFORE DELETE ON pi_payment_confirmations BEGIN SELECT RAISE(ABORT,'Payment confirmation is immutable'); END;
--> statement-breakpoint
CREATE TABLE confirmed_orders (
  id TEXT PRIMARY KEY NOT NULL,
  order_number TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE REFERENCES customer_quote_requests(id),
  pi_id TEXT NOT NULL UNIQUE REFERENCES proforma_invoices(id),
  purchasing_context_id TEXT NOT NULL REFERENCES customer_purchasing_contexts(id),
  acceptance_id TEXT NOT NULL UNIQUE REFERENCES pi_acceptances(id),
  confirmation_id TEXT NOT NULL UNIQUE REFERENCES pi_payment_confirmations(id),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency='USD'),
  total_cents INTEGER NOT NULL CHECK(total_cents>0),
  confirmed_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE confirmed_order_lines (
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  line_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK(line_number>0),
  line_kind TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  PRIMARY KEY(order_id,line_id),
  UNIQUE(order_id,line_number)
);
--> statement-breakpoint
CREATE TABLE order_fulfillment_initializations (
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  initialized_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status='pending'),
  PRIMARY KEY(order_id,line_id),
  FOREIGN KEY(order_id,line_id) REFERENCES confirmed_order_lines(order_id,line_id)
);
--> statement-breakpoint
CREATE TABLE order_assembly_production_initializations (
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  initialized_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status='pending'),
  PRIMARY KEY(order_id,line_id),
  FOREIGN KEY(order_id,line_id) REFERENCES confirmed_order_lines(order_id,line_id)
);
--> statement-breakpoint
CREATE INDEX confirmed_orders_context ON confirmed_orders(purchasing_context_id,confirmed_at DESC,id DESC);
--> statement-breakpoint
CREATE TRIGGER confirmed_orders_no_update BEFORE UPDATE ON confirmed_orders BEGIN SELECT RAISE(ABORT,'Order commercial result is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER confirmed_orders_no_delete BEFORE DELETE ON confirmed_orders BEGIN SELECT RAISE(ABORT,'Order commercial result is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER confirmed_order_lines_no_update BEFORE UPDATE ON confirmed_order_lines BEGIN SELECT RAISE(ABORT,'Order lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER confirmed_order_lines_no_delete BEFORE DELETE ON confirmed_order_lines BEGIN SELECT RAISE(ABORT,'Order lines are immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=85, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
