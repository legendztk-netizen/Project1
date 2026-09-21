CREATE TABLE proforma_invoice_pdf_jobs (
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES proforma_invoice_intents(command_id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  lease_token TEXT,
  lease_until TEXT,
  next_attempt_at TEXT NOT NULL,
  completed_at TEXT
);
--> statement-breakpoint
INSERT INTO proforma_invoice_pdf_jobs(command_id,state,next_attempt_at,completed_at)
SELECT i.command_id,CASE WHEN p.id IS NULL THEN 'pending' ELSE 'completed' END,
  i.issued_at,CASE WHEN p.id IS NULL THEN NULL ELSE p.issued_at END
FROM proforma_invoice_intents i LEFT JOIN proforma_invoices p ON p.id=i.id;
--> statement-breakpoint
CREATE TRIGGER proforma_invoice_enqueue_pdf AFTER INSERT ON proforma_invoice_intents
BEGIN
  INSERT INTO proforma_invoice_pdf_jobs(command_id,next_attempt_at) VALUES(NEW.command_id,NEW.issued_at);
END;
--> statement-breakpoint
CREATE INDEX proforma_invoice_pdf_jobs_due ON proforma_invoice_pdf_jobs(state,next_attempt_at);
--> statement-breakpoint
UPDATE application_schema_state SET version=76, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
