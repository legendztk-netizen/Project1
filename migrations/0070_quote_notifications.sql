CREATE TABLE quote_notification_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL UNIQUE REFERENCES quote_conversation_messages(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','retry','sent','dead_letter','review')),
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  next_dispatch_at INTEGER NOT NULL,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER,
  first_attempt_at INTEGER,
  recipient_profile_id TEXT REFERENCES customer_profiles(id),
  recipient_email TEXT,
  protected_payload TEXT,
  delivery_mode TEXT CHECK(delivery_mode IN ('stub','resend')),
  provider_id TEXT,
  failure_code TEXT,
  completed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX quote_notifications_due ON quote_notification_outbox(state,next_dispatch_at,next_attempt_at);
--> statement-breakpoint
CREATE TABLE quote_notification_reply_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64),
  notification_id TEXT NOT NULL UNIQUE REFERENCES quote_notification_outbox(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  recipient_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
--> statement-breakpoint
CREATE TABLE quote_notification_local_captures (
  notification_id TEXT PRIMARY KEY NOT NULL REFERENCES quote_notification_outbox(id),
  protected_payload TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER quote_notifications_source_guard BEFORE INSERT ON quote_notification_outbox
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quote_conversation_messages m WHERE m.id=NEW.message_id
    AND m.request_id=NEW.request_id AND m.author_role='admin' AND m.delivery_state='available'
  ) THEN RAISE(ABORT,'notification requires an Admin conversation message') END;
END;
--> statement-breakpoint
CREATE TRIGGER quote_notifications_frozen_identity BEFORE UPDATE ON quote_notification_outbox
WHEN NEW.id IS NOT OLD.id OR NEW.message_id IS NOT OLD.message_id
 OR NEW.request_id IS NOT OLD.request_id OR NEW.idempotency_key IS NOT OLD.idempotency_key
 OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.first_attempt_at IS NOT NULL AND NEW.first_attempt_at IS NOT OLD.first_attempt_at)
 OR (OLD.protected_payload IS NOT NULL AND (
   NEW.protected_payload IS NOT OLD.protected_payload OR NEW.recipient_profile_id IS NOT OLD.recipient_profile_id
   OR NEW.recipient_email IS NOT OLD.recipient_email OR NEW.delivery_mode IS NOT OLD.delivery_mode))
BEGIN SELECT RAISE(ABORT,'notification delivery identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_notifications_no_delete BEFORE DELETE ON quote_notification_outbox
BEGIN SELECT RAISE(ABORT,'notification deduplication records must be retained'); END;
--> statement-breakpoint
CREATE TRIGGER quote_notification_tokens_frozen_scope BEFORE UPDATE ON quote_notification_reply_tokens
WHEN NEW.token_hash IS NOT OLD.token_hash OR NEW.notification_id IS NOT OLD.notification_id
 OR NEW.request_id IS NOT OLD.request_id OR NEW.profile_id IS NOT OLD.profile_id
 OR NEW.recipient_email IS NOT OLD.recipient_email OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'reply token scope is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_notification_captures_no_update BEFORE UPDATE ON quote_notification_local_captures
BEGIN SELECT RAISE(ABORT,'local delivery captures are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_notification_captures_no_delete BEFORE DELETE ON quote_notification_local_captures
BEGIN SELECT RAISE(ABORT,'local delivery captures are immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=71, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
