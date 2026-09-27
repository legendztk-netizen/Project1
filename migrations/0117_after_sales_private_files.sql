CREATE TABLE after_sales_files (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('cancellation','case','inspection')),
  scope_id TEXT NOT NULL,
  uploader_role TEXT NOT NULL CHECK(uploader_role IN ('admin','customer')),
  uploader_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/png','image/jpeg')),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
  checksum TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL CHECK(visibility IN ('internal','shared','customer')),
  shared_by TEXT,
  shared_at TEXT,
  share_reason TEXT,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK((uploader_role='customer')=(visibility='customer')),
  CHECK((visibility='shared')=(shared_by IS NOT NULL AND shared_at IS NOT NULL
    AND length(trim(coalesce(share_reason,'')))>0))
);
--> statement-breakpoint
CREATE INDEX after_sales_files_scope ON after_sales_files(order_id,scope_kind,scope_id,created_at);
--> statement-breakpoint
CREATE TRIGGER after_sales_file_share_only
BEFORE UPDATE ON after_sales_files BEGIN
  SELECT CASE WHEN OLD.visibility!='internal' OR NEW.visibility!='shared'
    OR NEW.id!=OLD.id OR NEW.order_id!=OLD.order_id
    OR NEW.scope_kind!=OLD.scope_kind OR NEW.scope_id!=OLD.scope_id
    OR NEW.uploader_role!=OLD.uploader_role OR NEW.uploader_id!=OLD.uploader_id
    OR NEW.filename!=OLD.filename OR NEW.content_type!=OLD.content_type
    OR NEW.byte_size!=OLD.byte_size OR NEW.checksum!=OLD.checksum
    OR NEW.object_key!=OLD.object_key OR NEW.command_id!=OLD.command_id
    OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'After-sales files are immutable except an explicit share') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_file_no_delete
BEFORE DELETE ON after_sales_files BEGIN
  SELECT RAISE(ABORT,'After-sales evidence is retained');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=118,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
