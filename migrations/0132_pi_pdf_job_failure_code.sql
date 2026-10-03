-- A PI PDF job that can never succeed (the quote, seller or payment instructions
-- changed after issue, another PI was published, or the PI became invalid) fails
-- on its first attempt instead of retrying, and records why so the admin pages
-- ask for a new PI instead of offering a retry. Transient failures stay NULL.
ALTER TABLE proforma_invoice_pdf_jobs ADD COLUMN failure_code TEXT
  CHECK(failure_code IS NULL OR failure_code IN ('inputs_changed','invalid'));
--> statement-breakpoint
UPDATE application_schema_state SET version=133,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
