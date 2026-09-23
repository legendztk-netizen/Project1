ALTER TABLE pi_payment_accounts ADD COLUMN late_review_required INTEGER NOT NULL DEFAULT 0 CHECK(late_review_required IN (0,1));
--> statement-breakpoint
ALTER TABLE pi_payment_events ADD COLUMN received_instruction_id TEXT REFERENCES seller_payment_instruction_versions(id);
--> statement-breakpoint
DROP TRIGGER pi_fund_resolutions_guard;
--> statement-breakpoint
CREATE TRIGGER pi_fund_resolutions_guard BEFORE INSERT ON pi_fund_resolutions
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pi_payment_accounts source
    WHERE source.pi_id=NEW.source_pi_id AND source.version=NEW.source_version
      AND source.receipt_history_known=1 AND source.actual_channel=NEW.original_channel
      AND source.amount_received_cents+source.allocated_in_cents-source.allocated_out_cents-source.refunded_cents
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
CREATE TRIGGER pi_payment_confirmations_late_review_guard BEFORE INSERT ON pi_payment_confirmations
WHEN (SELECT late_review_required FROM pi_payment_accounts WHERE pi_id=NEW.pi_id)=1
  AND NOT EXISTS(SELECT 1 FROM pi_late_payment_reviews WHERE pi_id=NEW.pi_id AND decision='same_terms_approved')
BEGIN SELECT RAISE(ABORT,'Late commercial review required'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=91,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
