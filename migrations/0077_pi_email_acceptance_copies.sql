-- Migration 0077 / schema 78. Depends on 0076 PI acceptance base.
-- Delivery is asynchronous; only the durable copy intent joins acceptance.
CREATE TABLE pi_email_acceptance_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  source_message_id TEXT NOT NULL REFERENCES quote_conversation_messages(id),
  source_receipt_id TEXT NOT NULL REFERENCES quote_inbound_email_receipts(id),
  sender_email TEXT NOT NULL,
  received_at TEXT NOT NULL,
  raw_object_key TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL CHECK(length(raw_sha256)=64),
  raw_byte_size INTEGER NOT NULL CHECK(raw_byte_size BETWEEN 1 AND 15728640),
  acting_admin_id TEXT NOT NULL,
  review_json TEXT NOT NULL CHECK(json_valid(review_json)),
  recorded_at TEXT NOT NULL,
  UNIQUE(pi_id,source_receipt_id)
);
--> statement-breakpoint
CREATE TRIGGER pi_email_evidence_no_update BEFORE UPDATE ON pi_email_acceptance_evidence BEGIN SELECT RAISE(ABORT,'Email acceptance evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_email_evidence_no_delete BEFORE DELETE ON pi_email_acceptance_evidence BEGIN SELECT RAISE(ABORT,'Email acceptance evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_email_acceptance_source_guard BEFORE INSERT ON pi_acceptances
WHEN NEW.source='email'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM pi_email_acceptance_evidence e JOIN proforma_invoices p ON p.id=e.pi_id
    WHERE e.id=json_extract(NEW.evidence_json,'$.evidence.acknowledgementEvidenceId')
      AND e.pi_id=NEW.pi_id AND e.request_id=NEW.request_id AND e.profile_id=NEW.profile_id
      AND e.acting_admin_id=json_extract(NEW.evidence_json,'$.evidence.actingAdminId')
      AND e.source_message_id=json_extract(NEW.evidence_json,'$.evidence.sourceMessageId')
      AND e.recorded_at=NEW.accepted_at AND p.document_version=NEW.document_version
      AND p.snapshot_hash=NEW.snapshot_hash AND NEW.view_id IS NULL
      AND json_extract(NEW.evidence_json,'$.evidence.source')='email'
      AND json_extract(NEW.evidence_json,'$.evidence.explicitlyConfirmed')=1
  ) THEN RAISE(ABORT,'Verified email acceptance evidence required') END;
END;
--> statement-breakpoint
CREATE TABLE pi_acceptance_copy_outbox (
  id TEXT PRIMARY KEY NOT NULL REFERENCES pi_acceptances(id),
  recipient_profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  recipient_email TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','retry','sent','review','dead_letter')),
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  next_dispatch_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>=1),
  first_attempt_at INTEGER,
  lease_id TEXT,
  lease_until INTEGER,
  protected_payload TEXT,
  delivery_mode TEXT CHECK(delivery_mode IN ('stub','resend')),
  provider_id TEXT,
  failure_code TEXT,
  completed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX pi_acceptance_copies_due ON pi_acceptance_copy_outbox(state,next_dispatch_at,next_attempt_at);
--> statement-breakpoint
CREATE TABLE pi_acceptance_copy_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  acceptance_id TEXT NOT NULL REFERENCES pi_acceptance_copy_outbox(id),
  generation INTEGER NOT NULL CHECK(generation>=1),
  outcome TEXT NOT NULL CHECK(outcome IN ('delivered','confirmed_not_delivered')),
  provider_id TEXT,
  evidence_reference TEXT NOT NULL CHECK(length(evidence_reference)>0),
  reason TEXT NOT NULL CHECK(length(reason)>0),
  actor_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
  prior_attempts INTEGER NOT NULL,
  prior_first_attempt_at INTEGER,
  prior_failure_code TEXT,
  CHECK(outcome!='delivered' OR length(provider_id)>0),
  UNIQUE(acceptance_id,generation)
);
--> statement-breakpoint
CREATE TRIGGER pi_copy_reconciliation_no_update BEFORE UPDATE ON pi_acceptance_copy_reconciliations BEGIN SELECT RAISE(ABORT,'Copy reconciliation is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_copy_reconciliation_no_delete BEFORE DELETE ON pi_acceptance_copy_reconciliations BEGIN SELECT RAISE(ABORT,'Copy reconciliation is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_acceptance_creates_copy AFTER INSERT ON pi_acceptances
BEGIN
  INSERT INTO pi_acceptance_copy_outbox(id,recipient_profile_id,recipient_email,created_at,next_attempt_at,next_dispatch_at)
    SELECT NEW.id,p.id,p.email_normalized,unixepoch(NEW.accepted_at)*1000,unixepoch(NEW.accepted_at)*1000,unixepoch(NEW.accepted_at)*1000
    FROM customer_profiles p WHERE p.id=NEW.profile_id;
END;
--> statement-breakpoint
INSERT INTO pi_acceptance_copy_outbox(id,recipient_profile_id,recipient_email,created_at,next_attempt_at,next_dispatch_at)
  SELECT a.id,p.id,p.email_normalized,unixepoch(a.accepted_at)*1000,unixepoch(a.accepted_at)*1000,unixepoch(a.accepted_at)*1000
  FROM pi_acceptances a JOIN customer_profiles p ON p.id=a.profile_id;
--> statement-breakpoint
CREATE TRIGGER pi_acceptance_copies_identity BEFORE UPDATE ON pi_acceptance_copy_outbox
WHEN NEW.id IS NOT OLD.id OR NEW.recipient_profile_id IS NOT OLD.recipient_profile_id OR NEW.recipient_email IS NOT OLD.recipient_email
  OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.generation=OLD.generation AND OLD.first_attempt_at IS NOT NULL AND NEW.first_attempt_at IS NOT OLD.first_attempt_at)
  OR (NEW.generation IS NOT OLD.generation AND NOT (
    NEW.generation=OLD.generation+1 AND OLD.state IN ('review','dead_letter') AND NEW.state='retry'
    AND NEW.attempts=0 AND NEW.first_attempt_at IS NULL
    AND EXISTS(SELECT 1 FROM pi_acceptance_copy_reconciliations r WHERE r.acceptance_id=OLD.id AND r.generation=OLD.generation AND r.outcome='confirmed_not_delivered')
  ))
  OR (OLD.protected_payload IS NOT NULL AND (NEW.protected_payload IS NOT OLD.protected_payload OR NEW.delivery_mode IS NOT OLD.delivery_mode))
BEGIN SELECT RAISE(ABORT,'Acceptance copy identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_acceptance_copies_no_delete BEFORE DELETE ON pi_acceptance_copy_outbox BEGIN SELECT RAISE(ABORT,'Acceptance copy deduplication is retained'); END;
--> statement-breakpoint
CREATE TABLE pi_acceptance_copy_captures (
  acceptance_id TEXT PRIMARY KEY NOT NULL REFERENCES pi_acceptance_copy_outbox(id),
  protected_payload TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pi_acceptance_copy_captures_no_update BEFORE UPDATE ON pi_acceptance_copy_captures BEGIN SELECT RAISE(ABORT,'Acceptance copies are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_acceptance_copy_captures_no_delete BEFORE DELETE ON pi_acceptance_copy_captures BEGIN SELECT RAISE(ABORT,'Acceptance copies are immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=78,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
