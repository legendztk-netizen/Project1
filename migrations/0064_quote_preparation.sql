CREATE TABLE quote_preparation_drafts (
  request_id TEXT PRIMARY KEY REFERENCES customer_quote_requests(id),
  source_hash TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL CHECK(json_valid(source_snapshot_json)),
  prices_json TEXT NOT NULL CHECK(json_valid(prices_json)),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE quote_pricing_commands (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES quote_preparation_drafts(request_id),
  actor_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resulting_version INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER quote_preparation_source_immutable BEFORE UPDATE ON quote_preparation_drafts
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.source_hash IS NOT OLD.source_hash OR NEW.source_snapshot_json IS NOT OLD.source_snapshot_json OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'quote source is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_pricing_commands_no_update BEFORE UPDATE ON quote_pricing_commands BEGIN SELECT RAISE(ABORT, 'pricing commands immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_pricing_commands_no_delete BEFORE DELETE ON quote_pricing_commands BEGIN SELECT RAISE(ABORT, 'pricing commands immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=65, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
