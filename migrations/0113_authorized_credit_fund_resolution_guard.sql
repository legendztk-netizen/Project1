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
          THEN source.total_due_cents-coalesce((SELECT authorized_credit_cents
            FROM order_change_financial_contract WHERE pi_id=source.pi_id),0)
          ELSE 0 END >= NEW.amount_cents
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
      AND target.receipt_history_known=1
      AND (target.term_kind!='legacy_review' OR EXISTS(SELECT 1 FROM retained_pi_agreements r WHERE r.pi_id=p.id AND r.no_payment_deadline=1))
      AND target.total_due_cents-(target.amount_received_cents+target.allocated_in_cents
        -target.allocated_out_cents-target.refunded_cents)>=NEW.amount_cents
      AND NOT EXISTS(SELECT 1 FROM pi_payment_confirmations c WHERE c.pi_id=target.pi_id)
      AND ((EXISTS(SELECT 1 FROM pi_acceptances a WHERE a.pi_id=target.pi_id)
        AND (target.due_at>=NEW.resolved_at OR EXISTS(SELECT 1 FROM retained_pi_agreements r WHERE r.pi_id=p.id AND r.no_payment_deadline=1)))
        OR (NOT EXISTS(SELECT 1 FROM pi_acceptances a WHERE a.pi_id=target.pi_id)
          AND p.valid_until>NEW.resolved_at))
      AND NOT EXISTS(SELECT 1 FROM confirmed_orders o WHERE o.request_id=p.request_id)
  ) THEN RAISE(ABORT,'Target PI unavailable or funding exceeds shortfall') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=114,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
