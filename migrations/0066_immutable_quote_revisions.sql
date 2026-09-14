CREATE TABLE quote_revisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  preparation_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  UNIQUE(request_id, revision_number),
  UNIQUE(request_id, preparation_version)
);
--> statement-breakpoint
CREATE TRIGGER quote_revisions_no_update BEFORE UPDATE ON quote_revisions BEGIN SELECT RAISE(ABORT, 'quote revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_revisions_no_delete BEFORE DELETE ON quote_revisions BEGIN SELECT RAISE(ABORT, 'quote revisions are immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=67, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
