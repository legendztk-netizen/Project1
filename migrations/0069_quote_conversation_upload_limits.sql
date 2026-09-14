CREATE TABLE quote_conversation_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  author_role TEXT NOT NULL CHECK(author_role IN ('customer', 'admin')),
  author_id TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 0 AND 10485760),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX quote_conversation_reservations_request ON quote_conversation_reservations(request_id, created_at);
--> statement-breakpoint
CREATE TRIGGER quote_conversation_reservation_budget BEFORE INSERT ON quote_conversation_reservations
BEGIN
  SELECT CASE WHEN NEW.author_role = 'customer' AND (
    (SELECT count(*) FROM quote_conversation_messages WHERE request_id=NEW.request_id
      AND author_role='customer' AND julianday(created_at) >= julianday('now', '-10 minutes'))
    + (SELECT count(*) FROM quote_conversation_reservations WHERE request_id=NEW.request_id
      AND author_role='customer')
    >= 20
  ) THEN RAISE(ABORT, 'conversation rate limit') END;
  SELECT CASE WHEN NEW.byte_size +
    COALESCE((SELECT sum(a.byte_size) FROM quote_conversation_attachments a
      INNER JOIN quote_conversation_messages m ON m.id=a.message_id
      WHERE m.request_id=NEW.request_id), 0)
    + COALESCE((SELECT sum(byte_size) FROM quote_conversation_reservations
      WHERE request_id=NEW.request_id), 0) > 104857600
    THEN RAISE(ABORT, 'conversation attachment budget') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=70, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
