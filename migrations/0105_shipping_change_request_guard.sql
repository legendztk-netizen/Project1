CREATE TRIGGER order_shipping_change_active_guard
BEFORE INSERT ON order_shipping_change_active_shipments BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_shipping_change_requests request
    JOIN order_shipping_change_shipments affected
      ON affected.request_id=request.id
    JOIN order_shipments shipment
      ON shipment.id=affected.shipment_id AND shipment.order_id=request.order_id
    WHERE request.id=NEW.request_id AND affected.shipment_id=NEW.shipment_id
      AND request.status='pending_review'
      AND shipment.version=affected.shipment_version
      AND shipment.status IN ('planned','ready_to_ship')
      AND NOT EXISTS(SELECT 1 FROM shipment_dispatch_quantities dispatched
        WHERE dispatched.shipment_id=shipment.id)
  ) THEN RAISE(ABORT,'Shipping change requires a current unshipped shipment') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=106,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
