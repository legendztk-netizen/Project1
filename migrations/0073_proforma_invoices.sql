CREATE TABLE proforma_invoice_intents (
  id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  quote_revision_id TEXT NOT NULL REFERENCES quote_revisions(id),
  quote_revision_hash TEXT NOT NULL,
  source_revision_json TEXT NOT NULL CHECK(json_valid(source_revision_json)),
  seller_identity_id TEXT NOT NULL REFERENCES seller_identity_versions(id),
  seller_version INTEGER NOT NULL CHECK(seller_version > 0),
  payment_instruction_id TEXT NOT NULL REFERENCES seller_payment_instruction_versions(id),
  payment_instruction_version INTEGER NOT NULL CHECK(payment_instruction_version > 0),
  payment_channel TEXT NOT NULL CHECK(payment_channel IN ('bank_transfer', 'paypal')),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  valid_until TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE proforma_invoices (
  id TEXT PRIMARY KEY NOT NULL REFERENCES proforma_invoice_intents(id),
  request_id TEXT NOT NULL REFERENCES customer_quote_requests(id),
  quote_revision_id TEXT NOT NULL REFERENCES quote_revisions(id),
  document_number TEXT NOT NULL UNIQUE,
  document_version INTEGER NOT NULL CHECK(document_version > 0),
  previous_pi_id TEXT REFERENCES proforma_invoices(id),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL,
  pdf_object_key TEXT NOT NULL UNIQUE,
  pdf_sha256 TEXT NOT NULL,
  pdf_byte_size INTEGER NOT NULL CHECK(pdf_byte_size > 0),
  pdf_page_count INTEGER NOT NULL CHECK(pdf_page_count > 0),
  pdf_renderer_version TEXT NOT NULL,
  payment_channel TEXT NOT NULL CHECK(payment_channel IN ('bank_transfer', 'paypal')),
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  UNIQUE(request_id, document_version),
  UNIQUE(request_id, id)
);
--> statement-breakpoint
CREATE TABLE proforma_invoice_heads (
  request_id TEXT PRIMARY KEY NOT NULL REFERENCES customer_quote_requests(id),
  pi_id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL CHECK(version > 0),
  FOREIGN KEY(request_id, pi_id) REFERENCES proforma_invoices(request_id, id)
);
--> statement-breakpoint
CREATE TRIGGER proforma_invoice_intents_no_update BEFORE UPDATE ON proforma_invoice_intents BEGIN SELECT RAISE(ABORT, 'PI intents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER proforma_invoice_intents_no_delete BEFORE DELETE ON proforma_invoice_intents BEGIN SELECT RAISE(ABORT, 'PI intents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER proforma_invoices_no_update BEFORE UPDATE ON proforma_invoices BEGIN SELECT RAISE(ABORT, 'PIs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER proforma_invoices_no_delete BEFORE DELETE ON proforma_invoices BEGIN SELECT RAISE(ABORT, 'PIs are immutable'); END;
--> statement-breakpoint
CREATE INDEX proforma_invoice_intents_request ON proforma_invoice_intents(request_id);
--> statement-breakpoint
UPDATE application_schema_state SET version=74, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
