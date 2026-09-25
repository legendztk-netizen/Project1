CREATE TABLE shipment_packing_records (
  shipment_id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  cartons_json TEXT NOT NULL CHECK(json_valid(cartons_json) AND json_type(cartons_json)='array'),
  notes TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE TABLE shipment_packing_commands (
  id TEXT PRIMARY KEY NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES shipment_packing_records(shipment_id),
  actor_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resulting_version INTEGER NOT NULL CHECK(resulting_version>0),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE shipment_documents (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('packing_list','readiness_evidence','inspection_evidence','customs_file','logistics_document')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=10485760),
  checksum TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('uploading','ready','failed')),
  visibility TEXT NOT NULL CHECK(visibility IN ('internal','customer_shared')),
  version INTEGER NOT NULL CHECK(version>0),
  uploaded_by TEXT NOT NULL,
  shared_by TEXT,
  shared_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(status='ready' OR visibility='internal'),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE INDEX shipment_documents_shipment ON shipment_documents(shipment_id,status,visibility,created_at);
--> statement-breakpoint
CREATE INDEX shipment_documents_recovery ON shipment_documents(status,created_at);
--> statement-breakpoint
CREATE TABLE shipment_document_changes (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES shipment_documents(id),
  actor_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resulting_version INTEGER NOT NULL CHECK(resulting_version>0),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER shipment_packing_record_update_guard BEFORE UPDATE ON shipment_packing_records BEGIN
  SELECT CASE WHEN NEW.shipment_id!=OLD.shipment_id OR NEW.order_id!=OLD.order_id
    OR NEW.version!=OLD.version+1
    THEN RAISE(ABORT,'Packing record requires a versioned edit') END;
END;
--> statement-breakpoint
CREATE TRIGGER shipment_documents_update_guard BEFORE UPDATE ON shipment_documents BEGIN
  SELECT CASE WHEN NEW.id!=OLD.id OR NEW.order_id!=OLD.order_id
    OR NEW.shipment_id!=OLD.shipment_id OR NEW.command_id!=OLD.command_id
    OR NEW.payload_hash!=OLD.payload_hash OR NEW.kind!=OLD.kind
    OR NEW.filename!=OLD.filename OR NEW.content_type!=OLD.content_type
    OR NEW.byte_size!=OLD.byte_size OR NEW.checksum!=OLD.checksum
    OR NEW.object_key!=OLD.object_key OR NEW.uploaded_by!=OLD.uploaded_by
    OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'Shipment file identity is immutable') END;
  SELECT CASE WHEN NOT (
      (OLD.status='uploading' AND NEW.status IN ('ready','failed')
        AND NEW.visibility='internal' AND NEW.version=OLD.version)
      OR (OLD.status='ready' AND NEW.status='ready'
        AND NEW.visibility!=OLD.visibility AND NEW.version=OLD.version+1)
    ) THEN RAISE(ABORT,'Invalid shipment file state transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER shipment_documents_no_delete BEFORE DELETE ON shipment_documents BEGIN
  SELECT RAISE(ABORT,'Shipment file history is immutable');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=98,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
