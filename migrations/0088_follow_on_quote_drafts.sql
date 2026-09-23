CREATE TABLE follow_on_quote_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  source_order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  purchasing_context_id TEXT NOT NULL REFERENCES customer_purchasing_contexts(id),
  created_by_kind TEXT NOT NULL CHECK(created_by_kind IN ('customer','admin')),
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX follow_on_quote_drafts_order ON follow_on_quote_drafts(source_order_id,created_at DESC);
--> statement-breakpoint
CREATE TRIGGER follow_on_quote_drafts_no_update BEFORE UPDATE ON follow_on_quote_drafts BEGIN SELECT RAISE(ABORT,'Follow-on draft origin is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER follow_on_quote_drafts_no_delete BEFORE DELETE ON follow_on_quote_drafts BEGIN SELECT RAISE(ABORT,'Follow-on draft origin is immutable'); END;
--> statement-breakpoint
ALTER TABLE customer_quote_requests ADD COLUMN follow_on_draft_id TEXT REFERENCES follow_on_quote_drafts(id);
--> statement-breakpoint
ALTER TABLE customer_quote_requests ADD COLUMN source_order_id TEXT REFERENCES confirmed_orders(id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_quote_requests_follow_on_draft ON customer_quote_requests(follow_on_draft_id)
WHERE follow_on_draft_id IS NOT NULL;
--> statement-breakpoint
UPDATE application_schema_state SET version=89, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
