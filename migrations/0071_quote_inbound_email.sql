-- Migration 0071, schema 72. Verified with populated D1 via Wrangler migrations apply.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
DROP TRIGGER quote_notifications_source_guard;
--> statement-breakpoint
DROP TRIGGER quote_conversation_reservation_budget;
--> statement-breakpoint
CREATE TABLE quote_conversation_messages_email_next (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES quote_conversations(request_id),
  author_role TEXT NOT NULL CHECK(author_role IN ('customer','admin')),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body)<=10000),
  created_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('website','email')),
  delivery_state TEXT NOT NULL CHECK(delivery_state='available')
);
--> statement-breakpoint
INSERT INTO quote_conversation_messages_email_next
  SELECT id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,source,delivery_state
  FROM quote_conversation_messages;
--> statement-breakpoint
DROP TABLE quote_conversation_messages;
--> statement-breakpoint
ALTER TABLE quote_conversation_messages_email_next RENAME TO quote_conversation_messages;
--> statement-breakpoint
CREATE INDEX quote_conversation_messages_request ON quote_conversation_messages(request_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER quote_conversation_messages_no_update BEFORE UPDATE ON quote_conversation_messages
BEGIN SELECT RAISE(ABORT,'conversation messages are append only'); END;
--> statement-breakpoint
CREATE TRIGGER quote_conversation_messages_no_delete BEFORE DELETE ON quote_conversation_messages
BEGIN SELECT RAISE(ABORT,'conversation messages are append only'); END;
--> statement-breakpoint
CREATE TRIGGER quote_notifications_source_guard BEFORE INSERT ON quote_notification_outbox
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quote_conversation_messages m WHERE m.id=NEW.message_id
    AND m.request_id=NEW.request_id AND m.author_role='admin' AND m.delivery_state='available'
  ) THEN RAISE(ABORT,'notification requires an Admin conversation message') END;
END;
--> statement-breakpoint
CREATE TRIGGER quote_conversation_reservation_budget BEFORE INSERT ON quote_conversation_reservations
BEGIN
  SELECT CASE WHEN NEW.author_role='customer' AND (
    (SELECT count(*) FROM quote_conversation_messages WHERE request_id=NEW.request_id
      AND author_role='customer' AND julianday(created_at)>=julianday('now','-10 minutes'))
    + (SELECT count(*) FROM quote_conversation_reservations WHERE request_id=NEW.request_id AND author_role='customer')
    >=20
  ) THEN RAISE(ABORT,'conversation rate limit') END;
  SELECT CASE WHEN NEW.byte_size +
    COALESCE((SELECT sum(a.byte_size) FROM quote_conversation_attachments a
      INNER JOIN quote_conversation_messages m ON m.id=a.message_id WHERE m.request_id=NEW.request_id),0)
    + COALESCE((SELECT sum(byte_size) FROM quote_conversation_reservations WHERE request_id=NEW.request_id),0)>104857600
    THEN RAISE(ABORT,'conversation attachment budget') END;
END;
--> statement-breakpoint
CREATE TABLE quote_inbound_email_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  receipt_hash TEXT NOT NULL,
  raw_checksum TEXT NOT NULL,
  raw_size INTEGER NOT NULL CHECK(raw_size>=0),
  raw_key TEXT UNIQUE,
  protected_envelope TEXT,
  state TEXT NOT NULL CHECK(state IN ('staging','pending','processing','retry','appended','duplicate','quarantined','dead_letter')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  next_attempt_at INTEGER NOT NULL,
  next_dispatch_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER,
  request_id TEXT REFERENCES customer_quote_requests(id),
  message_id TEXT REFERENCES quote_conversation_messages(id)
);
--> statement-breakpoint
CREATE INDEX quote_inbound_email_due ON quote_inbound_email_receipts(state,next_dispatch_at,next_attempt_at);
--> statement-breakpoint
CREATE TABLE quote_inbound_email_content (
  content_key TEXT PRIMARY KEY NOT NULL,
  content_hash TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE REFERENCES quote_inbound_email_receipts(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  message_id TEXT NOT NULL UNIQUE REFERENCES quote_conversation_messages(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER quote_inbound_receipt_identity BEFORE UPDATE ON quote_inbound_email_receipts
WHEN NEW.id IS NOT OLD.id OR NEW.event_key IS NOT OLD.event_key OR NEW.receipt_hash IS NOT OLD.receipt_hash
 OR NEW.raw_checksum IS NOT OLD.raw_checksum OR NEW.raw_size IS NOT OLD.raw_size
 OR NEW.raw_key IS NOT OLD.raw_key OR NEW.protected_envelope IS NOT OLD.protected_envelope OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'inbound receipt identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_inbound_receipts_no_delete BEFORE DELETE ON quote_inbound_email_receipts
BEGIN SELECT RAISE(ABORT,'inbound receipts retain deduplication history'); END;
--> statement-breakpoint
CREATE TRIGGER quote_inbound_content_no_update BEFORE UPDATE ON quote_inbound_email_content
BEGIN SELECT RAISE(ABORT,'inbound content identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_inbound_content_no_delete BEFORE DELETE ON quote_inbound_email_content
BEGIN SELECT RAISE(ABORT,'inbound content retains deduplication history'); END;
--> statement-breakpoint
-- SQLite retains the DROP parent's deferred counter even after its replacement
-- restores every FK target. Assert the actual graph BEFORE clearing that counter.
CREATE TABLE quote_inbound_migration_fk_check (violations INTEGER NOT NULL CHECK(violations=0));
--> statement-breakpoint
INSERT INTO quote_inbound_migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE quote_inbound_migration_fk_check;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
--> statement-breakpoint
UPDATE application_schema_state SET version=72,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
