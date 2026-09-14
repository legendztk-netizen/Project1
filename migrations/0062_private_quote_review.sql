CREATE TABLE quote_internal_notes (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  actor_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 10000),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE quote_private_evidence (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tax_exemption', 'supporting')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
  checksum TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK(visibility = 'internal'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version = 1),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE quote_private_download_grants (
  token_hash TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES quote_private_evidence(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  actor_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER quote_internal_notes_no_update BEFORE UPDATE ON quote_internal_notes BEGIN SELECT RAISE(ABORT, 'internal notes are append only'); END;
--> statement-breakpoint
CREATE TRIGGER quote_internal_notes_no_delete BEFORE DELETE ON quote_internal_notes BEGIN SELECT RAISE(ABORT, 'internal notes are append only'); END;
--> statement-breakpoint
CREATE TRIGGER quote_private_evidence_no_update BEFORE UPDATE ON quote_private_evidence BEGIN SELECT RAISE(ABORT, 'private evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER quote_private_evidence_no_delete BEFORE DELETE ON quote_private_evidence BEGIN SELECT RAISE(ABORT, 'private evidence is immutable'); END;
--> statement-breakpoint
CREATE INDEX quote_internal_notes_request ON quote_internal_notes(request_id, created_at);
--> statement-breakpoint
CREATE INDEX quote_private_evidence_request ON quote_private_evidence(request_id, created_at);
--> statement-breakpoint
UPDATE application_schema_state SET version=63, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
