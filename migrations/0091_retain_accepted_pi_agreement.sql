CREATE TABLE pi_accepted_agreement_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  acceptance_id TEXT NOT NULL REFERENCES pi_acceptances(id),
  document_version INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  reviewed_quote_revision_id TEXT NOT NULL REFERENCES quote_revisions(id),
  expected_head_version INTEGER NOT NULL,
  expected_payment_version INTEGER NOT NULL,
  no_payment_deadline INTEGER NOT NULL CHECK(no_payment_deadline IN (0,1)),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX pi_accepted_agreement_reviews_pi ON pi_accepted_agreement_reviews(pi_id,reviewed_at);
--> statement-breakpoint
CREATE TRIGGER pi_accepted_agreement_reviews_no_update BEFORE UPDATE ON pi_accepted_agreement_reviews BEGIN SELECT RAISE(ABORT,'Accepted agreement review is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_accepted_agreement_reviews_no_delete BEFORE DELETE ON pi_accepted_agreement_reviews BEGIN SELECT RAISE(ABORT,'Accepted agreement review is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_accepted_agreement_reviews_guard BEFORE INSERT ON pi_accepted_agreement_reviews
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM proforma_invoices p
    JOIN proforma_invoice_heads h ON h.pi_id=p.id AND h.request_id=p.request_id
    JOIN pi_acceptances a ON a.pi_id=p.id AND a.request_id=p.request_id
    JOIN pi_payment_accounts pay ON pay.pi_id=p.id
    WHERE p.id=NEW.pi_id AND a.id=NEW.acceptance_id
      AND p.document_version=NEW.document_version AND p.snapshot_hash=NEW.snapshot_hash
      AND a.document_version=p.document_version AND a.snapshot_hash=p.snapshot_hash
      AND a.quote_revision_id=p.quote_revision_id
      AND a.accepted_at>=p.issued_at AND a.accepted_at<p.valid_until
      AND h.version=NEW.expected_head_version AND pay.version=NEW.expected_payment_version
      AND NEW.reviewed_quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1)
      AND NOT EXISTS(SELECT 1 FROM pi_supersessions WHERE previous_pi_id=p.id)
      AND NOT EXISTS(SELECT 1 FROM confirmed_orders WHERE request_id=p.request_id)
      AND NOT EXISTS(SELECT 1 FROM pi_payment_disputes WHERE pi_id=p.id AND active=1)
      AND ((NEW.no_payment_deadline=1 AND pay.term_kind='legacy_review'
        AND json_extract(p.snapshot_json,'$.paymentTerms') IS NULL AND pay.due_at IS NULL)
        OR (NEW.no_payment_deadline=0 AND pay.term_kind!='legacy_review'))
  ) THEN RAISE(ABORT,'Accepted PI agreement changed') END;
END;
--> statement-breakpoint
CREATE VIEW retained_pi_agreements AS
SELECT r.* FROM pi_accepted_agreement_reviews r
JOIN proforma_invoices p ON p.id=r.pi_id AND p.document_version=r.document_version AND p.snapshot_hash=r.snapshot_hash
JOIN proforma_invoice_heads h ON h.pi_id=p.id AND h.request_id=p.request_id
JOIN pi_acceptances a ON a.id=r.acceptance_id AND a.pi_id=p.id AND a.snapshot_hash=p.snapshot_hash
  AND a.document_version=p.document_version AND a.quote_revision_id=p.quote_revision_id
WHERE r.reviewed_quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=p.request_id ORDER BY revision_number DESC LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM pi_supersessions WHERE previous_pi_id=p.id);
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
UPDATE application_schema_state SET version=92,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
