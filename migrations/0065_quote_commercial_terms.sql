ALTER TABLE quote_preparation_drafts ADD COLUMN terms_json TEXT CHECK(terms_json IS NULL OR json_valid(terms_json));
--> statement-breakpoint
UPDATE application_schema_state SET version=66, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
