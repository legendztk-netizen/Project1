-- Conservative storage safety ceilings, not customer commercial entitlements.
-- Lifetime accounting includes quarantined receipts and retained raw MIME.
CREATE TRIGGER quote_inbound_ingress_budget BEFORE INSERT ON quote_inbound_email_receipts
WHEN NOT EXISTS (SELECT 1 FROM quote_inbound_email_receipts WHERE event_key=NEW.event_key)
BEGIN
  SELECT CASE WHEN NEW.raw_key IS NULL AND
    (SELECT count(*) FROM quote_inbound_email_receipts WHERE raw_key IS NULL)>=10000
    THEN RAISE(ABORT,'inbound unverified metadata capacity exhausted') END;
  SELECT CASE WHEN NEW.raw_key IS NOT NULL AND (
    (SELECT count(*) FROM quote_inbound_email_receipts WHERE raw_key IS NOT NULL)>=10000
    OR NEW.raw_size + COALESCE((SELECT sum(raw_size) FROM quote_inbound_email_receipts WHERE raw_key IS NOT NULL),0)>1073741824)
    THEN RAISE(ABORT,'inbound ingress capacity exhausted') END;
  SELECT CASE WHEN NEW.raw_key IS NOT NULL AND NEW.request_id IS NOT NULL AND (
    (SELECT count(*) FROM quote_inbound_email_receipts WHERE request_id=NEW.request_id AND raw_key IS NOT NULL)>=200
    OR NEW.raw_size + COALESCE((SELECT sum(raw_size) FROM quote_inbound_email_receipts WHERE request_id=NEW.request_id AND raw_key IS NOT NULL),0)>104857600)
    THEN RAISE(ABORT,'inbound quote ingress capacity exhausted') END;
END;
--> statement-breakpoint
CREATE INDEX quote_inbound_ingress_request ON quote_inbound_email_receipts(request_id);
--> statement-breakpoint
ALTER TABLE quote_inbound_email_receipts ADD COLUMN cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_pending IN (0,1));
--> statement-breakpoint
ALTER TABLE quote_inbound_email_receipts ADD COLUMN cleanup_next_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE quote_inbound_email_receipts ADD COLUMN cleanup_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX quote_inbound_cleanup_due ON quote_inbound_email_receipts(cleanup_pending,cleanup_next_at);
--> statement-breakpoint
CREATE TRIGGER quote_inbound_cleanup_terminal AFTER UPDATE OF state ON quote_inbound_email_receipts
WHEN NEW.state IN ('appended','duplicate','quarantined','dead_letter') AND OLD.state IS NOT NEW.state
BEGIN
  UPDATE quote_inbound_email_receipts SET cleanup_pending=1,cleanup_next_at=0 WHERE id=NEW.id;
END;
--> statement-breakpoint
UPDATE quote_inbound_email_receipts SET cleanup_pending=1 WHERE state IN ('appended','duplicate','quarantined','dead_letter');
--> statement-breakpoint
UPDATE application_schema_state SET version=73,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
