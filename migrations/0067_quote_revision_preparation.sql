ALTER TABLE quote_preparation_drafts ADD COLUMN base_revision_id TEXT REFERENCES quote_revisions(id);
--> statement-breakpoint
ALTER TABLE quote_preparation_drafts ADD COLUMN quoted_lines_json TEXT CHECK(quoted_lines_json IS NULL OR json_valid(quoted_lines_json));
--> statement-breakpoint
UPDATE application_schema_state SET version=68, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
