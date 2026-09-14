CREATE TABLE quote_private_commands (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  actor_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  record_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER quote_private_commands_no_update BEFORE UPDATE ON quote_private_commands BEGIN SELECT RAISE(ABORT, 'private commands are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_private_commands_no_delete BEFORE DELETE ON quote_private_commands BEGIN SELECT RAISE(ABORT, 'private commands are immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=64, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
