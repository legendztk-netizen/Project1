DROP TRIGGER shipment_packing_before_dispatch_insert;
--> statement-breakpoint
DROP TRIGGER shipment_packing_before_dispatch_update;
--> statement-breakpoint
UPDATE application_schema_state SET version=103,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
