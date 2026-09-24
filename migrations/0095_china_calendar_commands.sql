CREATE TABLE china_fulfillment_calendar_commands (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resulting_version INTEGER NOT NULL REFERENCES china_fulfillment_calendar_versions(version),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX china_fulfillment_calendar_one_draft
  ON china_fulfillment_calendar_versions(status) WHERE status='draft';
--> statement-breakpoint
UPDATE application_schema_state SET version=96,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
