DROP TRIGGER shipment_documents_update_guard;
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
        AND NEW.visibility='internal' AND NEW.version=OLD.version
        AND NEW.object_cleaned_at IS NULL)
      OR (OLD.status='ready' AND NEW.status='ready'
        AND NEW.visibility!=OLD.visibility AND NEW.version=OLD.version+1
        AND NEW.object_cleaned_at IS NULL)
      OR (OLD.status='failed' AND NEW.status='failed'
        AND NEW.visibility='internal' AND NEW.version=OLD.version
        AND NEW.object_cleaned_at IS NOT NULL
        AND (OLD.object_cleaned_at IS NULL
          OR NEW.object_cleaned_at>OLD.object_cleaned_at))
    ) THEN RAISE(ABORT,'Invalid shipment file state transition') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=101,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
