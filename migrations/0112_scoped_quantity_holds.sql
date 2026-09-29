CREATE TRIGGER order_quantity_hold_requires_shipment_after_allocation
BEFORE INSERT ON order_quantity_holds
WHEN NEW.active=1 AND NEW.shipment_id IS NULL BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM order_shipment_allocations allocation
    WHERE allocation.order_id=NEW.order_id AND allocation.line_id=NEW.line_id
  ) THEN RAISE(ABORT,'Allocated quantity hold requires a Shipment') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=113,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
