CREATE TABLE pi_payment_accounts (
  pi_id TEXT PRIMARY KEY NOT NULL REFERENCES proforma_invoices(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  purchasing_context_id TEXT NOT NULL REFERENCES customer_purchasing_contexts(id),
  currency TEXT NOT NULL CHECK(currency='USD'),
  total_due_cents INTEGER NOT NULL CHECK(total_due_cents>=0),
  term_kind TEXT NOT NULL CHECK(term_kind IN ('ten_us_business_days','fixed_et_date','legacy_review')),
  calendar_version TEXT,
  fixed_due_date_et TEXT,
  due_date_et TEXT,
  due_at TEXT,
  amount_received_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_received_cents>=0),
  actual_channel TEXT CHECK(actual_channel IN ('bank_transfer','paypal')),
  ever_received INTEGER NOT NULL DEFAULT 0 CHECK(ever_received IN (0,1)),
  instruction_channel TEXT NOT NULL CHECK(instruction_channel IN ('bank_transfer','paypal')),
  instruction_id TEXT NOT NULL REFERENCES seller_payment_instruction_versions(id),
  instruction_version INTEGER NOT NULL CHECK(instruction_version>0),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((due_date_et IS NULL AND due_at IS NULL) OR (due_date_et IS NOT NULL AND due_at IS NOT NULL)),
  CHECK(term_kind!='legacy_review' OR (due_date_et IS NULL AND due_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE pi_payment_events (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  kind TEXT NOT NULL CHECK(kind IN ('amount_received','instruction_changed','deadline_frozen')),
  previous_version INTEGER NOT NULL,
  next_version INTEGER NOT NULL,
  previous_amount_cents INTEGER,
  new_amount_cents INTEGER,
  currency TEXT,
  actual_channel TEXT,
  old_instruction_id TEXT,
  new_instruction_id TEXT,
  reason TEXT,
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
--> statement-breakpoint
CREATE INDEX pi_payment_events_pi ON pi_payment_events(pi_id,occurred_at);
--> statement-breakpoint
CREATE TRIGGER pi_payment_events_no_update BEFORE UPDATE ON pi_payment_events BEGIN SELECT RAISE(ABORT,'Payment event is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_payment_events_no_delete BEFORE DELETE ON pi_payment_events BEGIN SELECT RAISE(ABORT,'Payment event is immutable'); END;
--> statement-breakpoint
INSERT INTO pi_payment_accounts(pi_id,request_id,purchasing_context_id,currency,total_due_cents,term_kind,calendar_version,
  fixed_due_date_et,instruction_channel,instruction_id,instruction_version,created_at,updated_at)
SELECT p.id,p.request_id,q.purchasing_context_id,'USD',json_extract(p.snapshot_json,'$.totals.totalCents'),
  CASE WHEN json_extract(p.snapshot_json,'$.paymentTerms.kind') IN ('ten_us_business_days','fixed_et_date')
    THEN json_extract(p.snapshot_json,'$.paymentTerms.kind') ELSE 'legacy_review' END,
  json_extract(p.snapshot_json,'$.paymentTerms.calendarVersion'),
  json_extract(p.snapshot_json,'$.paymentTerms.dueDateEt'),p.payment_channel,
  json_extract(p.snapshot_json,'$.paymentSelection.instructionId'),
  json_extract(p.snapshot_json,'$.paymentSelection.instructionVersion'),p.issued_at,p.issued_at
FROM proforma_invoices p JOIN customer_quote_requests q ON q.id=p.request_id;
--> statement-breakpoint
UPDATE application_schema_state SET version=82, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
