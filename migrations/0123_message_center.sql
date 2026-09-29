-- Message Center: one conversation per Quote Request (continuing through its
-- Order and After-sales Cases). Conversation messages stay in
-- quote_conversation_messages; these tables add read state, Admin-only notes,
-- optional Case topics and files attached to after-sales operation records.
CREATE TABLE message_thread_reads (
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  reader_role TEXT NOT NULL CHECK(reader_role IN ('customer','admin')),
  reader_id TEXT NOT NULL CHECK(length(trim(reader_id))>0),
  last_read_at TEXT NOT NULL,
  PRIMARY KEY(request_id,reader_role,reader_id)
);
--> statement-breakpoint
CREATE TRIGGER message_thread_reads_forward_only
BEFORE UPDATE ON message_thread_reads BEGIN
  SELECT CASE WHEN NEW.request_id!=OLD.request_id OR NEW.reader_role!=OLD.reader_role
    OR NEW.reader_id!=OLD.reader_id OR NEW.last_read_at<OLD.last_read_at
    THEN RAISE(ABORT,'Read position only moves forward') END;
END;
--> statement-breakpoint
CREATE TABLE message_internal_notes (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  case_id TEXT REFERENCES after_sales_cases(id),
  admin_id TEXT NOT NULL CHECK(length(trim(admin_id))>0),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX message_internal_notes_request ON message_internal_notes(request_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER message_internal_note_case_guard
BEFORE INSERT ON message_internal_notes WHEN NEW.case_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_cases c
    JOIN confirmed_orders o ON o.id=c.order_id
    WHERE c.id=NEW.case_id AND o.request_id=NEW.request_id)
    THEN RAISE(ABORT,'Note Case must belong to this conversation') END;
END;
--> statement-breakpoint
CREATE TRIGGER message_internal_note_no_update
BEFORE UPDATE ON message_internal_notes BEGIN
  SELECT RAISE(ABORT,'Internal notes are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER message_internal_note_no_delete
BEFORE DELETE ON message_internal_notes BEGIN
  SELECT RAISE(ABORT,'Internal notes are append-only');
END;
--> statement-breakpoint
CREATE TABLE message_case_topics (
  message_id TEXT PRIMARY KEY NOT NULL REFERENCES quote_conversation_messages(id),
  case_id TEXT NOT NULL REFERENCES after_sales_cases(id)
);
--> statement-breakpoint
CREATE INDEX message_case_topics_case ON message_case_topics(case_id);
--> statement-breakpoint
CREATE TRIGGER message_case_topic_guard
BEFORE INSERT ON message_case_topics BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quote_conversation_messages m
    JOIN confirmed_orders o ON o.request_id=m.request_id
    JOIN after_sales_cases c ON c.order_id=o.id
    WHERE m.id=NEW.message_id AND c.id=NEW.case_id)
    THEN RAISE(ABORT,'Message Case must belong to this conversation') END;
END;
--> statement-breakpoint
CREATE TRIGGER message_case_topic_no_update
BEFORE UPDATE ON message_case_topics BEGIN
  SELECT RAISE(ABORT,'Message topics are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER message_case_topic_no_delete
BEFORE DELETE ON message_case_topics BEGIN
  SELECT RAISE(ABORT,'Message topics are immutable');
END;
--> statement-breakpoint
CREATE TABLE after_sales_event_files (
  event_id TEXT NOT NULL REFERENCES after_sales_case_messages(id),
  file_id TEXT NOT NULL REFERENCES after_sales_files(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(event_id,file_id)
);
--> statement-breakpoint
CREATE TRIGGER after_sales_event_file_guard
BEFORE INSERT ON after_sales_event_files BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_case_messages e
    JOIN after_sales_files f ON f.scope_kind='case' AND f.scope_id=e.case_id
    WHERE e.id=NEW.event_id AND e.kind='event' AND f.id=NEW.file_id
      AND f.visibility IN ('shared','customer'))
    THEN RAISE(ABORT,'Event attachment must be a shared file of the same Case') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_event_file_no_update
BEFORE UPDATE ON after_sales_event_files BEGIN
  SELECT RAISE(ABORT,'Event attachments are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_event_file_no_delete
BEFORE DELETE ON after_sales_event_files BEGIN
  SELECT RAISE(ABORT,'Event attachments are immutable');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=124,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
