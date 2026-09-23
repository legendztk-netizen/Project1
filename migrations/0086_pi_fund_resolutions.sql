ALTER TABLE pi_payment_accounts ADD COLUMN allocated_in_cents INTEGER NOT NULL DEFAULT 0 CHECK(allocated_in_cents>=0);
--> statement-breakpoint
ALTER TABLE pi_payment_accounts ADD COLUMN allocated_out_cents INTEGER NOT NULL DEFAULT 0 CHECK(allocated_out_cents>=0);
--> statement-breakpoint
ALTER TABLE pi_payment_accounts ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_cents>=0);
--> statement-breakpoint
CREATE TABLE pi_fund_resolutions (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('allocation','external_refund')),
  source_pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  target_pi_id TEXT REFERENCES proforma_invoices(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  currency TEXT NOT NULL CHECK(currency='USD'),
  source_version INTEGER NOT NULL,
  target_version INTEGER,
  customer_authorization TEXT NOT NULL CHECK(length(trim(customer_authorization))>0),
  external_reference TEXT NOT NULL CHECK(length(trim(external_reference))>0),
  original_channel TEXT NOT NULL CHECK(original_channel IN ('bank_transfer','paypal')),
  actor_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  CHECK((kind='allocation' AND target_pi_id IS NOT NULL AND target_version IS NOT NULL)
    OR (kind='external_refund' AND target_pi_id IS NULL AND target_version IS NULL))
);
--> statement-breakpoint
CREATE INDEX pi_fund_resolutions_source ON pi_fund_resolutions(source_pi_id,resolved_at);
--> statement-breakpoint
CREATE INDEX pi_fund_resolutions_target ON pi_fund_resolutions(target_pi_id,resolved_at);
--> statement-breakpoint
CREATE TRIGGER pi_fund_resolutions_guard BEFORE INSERT ON pi_fund_resolutions
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pi_payment_accounts source
    WHERE source.pi_id=NEW.source_pi_id AND source.version=NEW.source_version
      AND source.receipt_history_known=1 AND source.actual_channel=NEW.original_channel
      AND source.amount_received_cents-source.allocated_out_cents-source.refunded_cents
        -CASE WHEN EXISTS(SELECT 1 FROM pi_payment_confirmations c WHERE c.pi_id=source.pi_id)
          THEN source.total_due_cents ELSE 0 END >= NEW.amount_cents
  ) THEN RAISE(ABORT,'Source funds unavailable') END,
  CASE WHEN NEW.kind='allocation' AND NOT EXISTS(
    SELECT 1 FROM pi_payment_accounts target
    JOIN pi_payment_accounts source ON source.pi_id=NEW.source_pi_id
    JOIN proforma_invoice_heads head ON head.pi_id=target.pi_id
    JOIN proforma_invoices p ON p.id=target.pi_id
    WHERE target.pi_id=NEW.target_pi_id AND target.version=NEW.target_version
      AND source.pi_id!=target.pi_id
      AND source.purchasing_context_id=target.purchasing_context_id
      AND source.currency=target.currency AND target.currency=NEW.currency
      AND target.receipt_history_known=1 AND target.term_kind!='legacy_review'
      AND target.total_due_cents-(target.amount_received_cents+target.allocated_in_cents
        -target.allocated_out_cents-target.refunded_cents)>=NEW.amount_cents
      AND NOT EXISTS(SELECT 1 FROM pi_payment_confirmations c WHERE c.pi_id=target.pi_id)
      AND ((EXISTS(SELECT 1 FROM pi_acceptances a WHERE a.pi_id=target.pi_id)
        AND target.due_at>=NEW.resolved_at)
        OR (NOT EXISTS(SELECT 1 FROM pi_acceptances a WHERE a.pi_id=target.pi_id)
          AND p.valid_until>NEW.resolved_at))
      AND NOT EXISTS(SELECT 1 FROM confirmed_orders o WHERE o.request_id=p.request_id)
  ) THEN RAISE(ABORT,'Target PI unavailable or funding exceeds shortfall') END;
END;
--> statement-breakpoint
CREATE TRIGGER pi_fund_resolutions_no_update BEFORE UPDATE ON pi_fund_resolutions BEGIN SELECT RAISE(ABORT,'Fund resolution is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_fund_resolutions_no_delete BEFORE DELETE ON pi_fund_resolutions BEGIN SELECT RAISE(ABORT,'Fund resolution is immutable'); END;
--> statement-breakpoint
CREATE TABLE pi_original_currency_receipt_balances (
  receipt_id TEXT PRIMARY KEY NOT NULL REFERENCES pi_original_currency_receipts(id),
  currency_digits INTEGER NOT NULL CHECK(currency_digits BETWEEN 0 AND 3),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_minor>=0 AND refunded_minor<=amount_minor),
  version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE pi_original_currency_refunds (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  receipt_id TEXT NOT NULL REFERENCES pi_original_currency_receipts(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL,
  customer_authorization TEXT NOT NULL,
  external_reference TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  refunded_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_original_currency_refunds_guard BEFORE INSERT ON pi_original_currency_refunds
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pi_original_currency_receipts r
    JOIN pi_original_currency_receipt_balances b ON b.receipt_id=r.id
    WHERE r.id=NEW.receipt_id AND r.currency=NEW.currency
      AND b.amount_minor-b.refunded_minor>=NEW.amount_minor
  ) THEN RAISE(ABORT,'Original-currency receipt unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER pi_original_currency_refunds_no_update BEFORE UPDATE ON pi_original_currency_refunds BEGIN SELECT RAISE(ABORT,'Original currency refund is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_original_currency_refunds_no_delete BEFORE DELETE ON pi_original_currency_refunds BEGIN SELECT RAISE(ABORT,'Original currency refund is immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=87, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
