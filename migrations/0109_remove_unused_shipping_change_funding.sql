DROP TABLE order_shipping_change_funding_events;
--> statement-breakpoint
DROP TABLE order_shipping_change_funding;
--> statement-breakpoint
UPDATE application_schema_state SET version=110,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
