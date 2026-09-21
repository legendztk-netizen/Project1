-- PI lifecycle follows acceptance (0076) and email acceptance copies (0077).
CREATE TABLE pi_replacement_intents (
  pi_id TEXT PRIMARY KEY NOT NULL REFERENCES proforma_invoice_intents(id),
  previous_pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  expected_head_version INTEGER NOT NULL CHECK(expected_head_version > 0),
  expected_document_version INTEGER NOT NULL CHECK(expected_document_version > 0),
  expected_snapshot_hash TEXT NOT NULL CHECK(length(expected_snapshot_hash)=64),
  expected_acceptance_id TEXT REFERENCES pi_acceptances(id),
  previous_snapshot_json TEXT NOT NULL CHECK(json_valid(previous_snapshot_json)),
  previous_source_json TEXT NOT NULL CHECK(json_valid(previous_source_json)),
  reason_json TEXT NOT NULL CHECK(json_valid(reason_json)),
  material_json TEXT NOT NULL CHECK(json_valid(material_json))
);
--> statement-breakpoint
CREATE TABLE pi_supersessions (
  previous_pi_id TEXT PRIMARY KEY NOT NULL REFERENCES proforma_invoices(id),
  replacement_pi_id TEXT NOT NULL UNIQUE REFERENCES proforma_invoices(id),
  superseded_at TEXT NOT NULL,
  CHECK(previous_pi_id <> replacement_pi_id)
);
--> statement-breakpoint
CREATE TRIGGER pi_replacement_intents_no_update BEFORE UPDATE ON pi_replacement_intents BEGIN SELECT RAISE(ABORT,'PI replacement intents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_replacement_intents_no_delete BEFORE DELETE ON pi_replacement_intents BEGIN SELECT RAISE(ABORT,'PI replacement intents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_supersessions_no_update BEFORE UPDATE ON pi_supersessions BEGIN SELECT RAISE(ABORT,'PI supersession history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_supersessions_no_delete BEFORE DELETE ON pi_supersessions BEGIN SELECT RAISE(ABORT,'PI supersession history is immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=79, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
