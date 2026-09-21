CREATE TABLE pi_customer_views (
  id TEXT PRIMARY KEY NOT NULL,
  pi_id TEXT NOT NULL REFERENCES proforma_invoices(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  purchasing_context_id TEXT NOT NULL REFERENCES customer_purchasing_contexts(id),
  document_version INTEGER NOT NULL CHECK(document_version > 0),
  snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
  pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256)=64),
  pdf_byte_size INTEGER NOT NULL CHECK(pdf_byte_size > 0),
  kind TEXT NOT NULL CHECK(kind IN ('view','download')),
  occurred_at TEXT NOT NULL,
  request_evidence_json TEXT NOT NULL CHECK(json_valid(request_evidence_json)),
  UNIQUE(pi_id,profile_id,purchasing_context_id,kind)
);
--> statement-breakpoint
CREATE TABLE pi_acceptances (
  id TEXT PRIMARY KEY NOT NULL,
  pi_id TEXT NOT NULL UNIQUE REFERENCES proforma_invoices(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  purchasing_context_id TEXT NOT NULL REFERENCES customer_purchasing_contexts(id),
  source TEXT NOT NULL CHECK(source IN ('website','email')),
  document_version INTEGER NOT NULL CHECK(document_version > 0),
  snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
  quote_revision_id TEXT NOT NULL REFERENCES quote_revisions(id),
  view_id TEXT REFERENCES pi_customer_views(id),
  accepted_at TEXT NOT NULL,
  business_hash TEXT NOT NULL CHECK(length(business_hash)=64),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  CHECK(source != 'website' OR view_id IS NOT NULL),
  UNIQUE(id,pi_id,profile_id)
);
--> statement-breakpoint
CREATE TABLE pi_acceptance_commands (
  id TEXT PRIMARY KEY NOT NULL,
  acceptance_id TEXT NOT NULL,
  pi_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
  FOREIGN KEY(acceptance_id,pi_id,profile_id) REFERENCES pi_acceptances(id,pi_id,profile_id)
);
--> statement-breakpoint
CREATE INDEX pi_customer_views_owner ON pi_customer_views(request_id,profile_id,pi_id);
--> statement-breakpoint
CREATE TRIGGER pi_customer_views_no_update BEFORE UPDATE ON pi_customer_views BEGIN SELECT RAISE(ABORT,'PI viewing evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_customer_views_no_delete BEFORE DELETE ON pi_customer_views BEGIN SELECT RAISE(ABORT,'PI viewing evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_acceptances_no_update BEFORE UPDATE ON pi_acceptances BEGIN SELECT RAISE(ABORT,'PI acceptance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_acceptances_no_delete BEFORE DELETE ON pi_acceptances BEGIN SELECT RAISE(ABORT,'PI acceptance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_acceptance_commands_no_update BEFORE UPDATE ON pi_acceptance_commands BEGIN SELECT RAISE(ABORT,'PI acceptance commands are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pi_acceptance_commands_no_delete BEFORE DELETE ON pi_acceptance_commands BEGIN SELECT RAISE(ABORT,'PI acceptance commands are immutable'); END;
--> statement-breakpoint
UPDATE application_schema_state SET version=77, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
