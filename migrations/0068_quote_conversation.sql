CREATE TABLE quote_conversations (
  request_id TEXT PRIMARY KEY NOT NULL REFERENCES customer_quote_requests(id),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE quote_conversation_messages (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES quote_conversations(request_id),
  author_role TEXT NOT NULL CHECK(author_role IN ('customer', 'admin')),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) <= 10000),
  created_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source = 'website'),
  delivery_state TEXT NOT NULL CHECK(delivery_state = 'available')
);
--> statement-breakpoint
CREATE TABLE quote_conversation_attachments (
  message_id TEXT PRIMARY KEY NOT NULL REFERENCES quote_conversation_messages(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
  checksum TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL DEFAULT 'conversation' CHECK(visibility = 'conversation')
);
--> statement-breakpoint
CREATE INDEX quote_conversation_messages_request ON quote_conversation_messages(request_id, created_at, id);
--> statement-breakpoint
CREATE TRIGGER quote_conversations_no_update BEFORE UPDATE ON quote_conversations BEGIN SELECT RAISE(ABORT, 'quote conversations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_conversations_no_delete BEFORE DELETE ON quote_conversations BEGIN SELECT RAISE(ABORT, 'quote conversations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_conversation_messages_no_update BEFORE UPDATE ON quote_conversation_messages BEGIN SELECT RAISE(ABORT, 'conversation messages are append only'); END;
--> statement-breakpoint
CREATE TRIGGER quote_conversation_messages_no_delete BEFORE DELETE ON quote_conversation_messages BEGIN SELECT RAISE(ABORT, 'conversation messages are append only'); END;
--> statement-breakpoint
CREATE TRIGGER quote_conversation_attachments_no_update BEFORE UPDATE ON quote_conversation_attachments BEGIN SELECT RAISE(ABORT, 'conversation attachments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_conversation_attachments_no_delete BEFORE DELETE ON quote_conversation_attachments BEGIN SELECT RAISE(ABORT, 'conversation attachments are immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=69, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
