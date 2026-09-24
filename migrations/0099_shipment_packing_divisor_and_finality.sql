ALTER TABLE shipment_packing_records ADD COLUMN dimensional_divisor_json TEXT
  CHECK(dimensional_divisor_json IS NULL OR json_valid(dimensional_divisor_json));
--> statement-breakpoint
CREATE TRIGGER shipment_packing_before_dispatch_insert
BEFORE INSERT ON shipment_packing_records
WHEN (SELECT status FROM order_shipments WHERE id=NEW.shipment_id)
  IN ('shipped','delivered')
BEGIN
  SELECT RAISE(ABORT,'Final packing cannot change after dispatch');
END;
--> statement-breakpoint
CREATE TRIGGER shipment_packing_before_dispatch_update
BEFORE UPDATE ON shipment_packing_records
WHEN (SELECT status FROM order_shipments WHERE id=NEW.shipment_id)
  IN ('shipped','delivered')
BEGIN
  SELECT RAISE(ABORT,'Final packing cannot change after dispatch');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=100,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
