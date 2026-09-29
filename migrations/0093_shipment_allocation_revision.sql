CREATE TABLE order_shipment_allocation_edit_context (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES confirmed_orders(id),
  command_id TEXT NOT NULL REFERENCES order_shipment_plan_commands(id),
  plan_version INTEGER NOT NULL CHECK(plan_version>0)
);
--> statement-breakpoint
CREATE TRIGGER order_shipment_allocation_no_delete BEFORE DELETE ON order_shipment_allocations BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_shipment_allocation_edit_context context
    JOIN order_fulfillment_plans plan ON plan.order_id=context.order_id
    WHERE context.order_id=OLD.order_id AND plan.version=context.plan_version
      AND plan.source='reviewed_mapping'
      AND NOT EXISTS(SELECT 1 FROM order_shipments shipment
        WHERE shipment.order_id=OLD.order_id AND shipment.status!='planned')
      AND NOT EXISTS(SELECT 1 FROM order_release_guards guard
        WHERE guard.order_id=OLD.order_id AND guard.held=1)
      AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
        WHERE hold.order_id=OLD.order_id AND hold.line_id=OLD.line_id AND hold.active=1)
  ) THEN RAISE(ABORT,'Shipment allocation deletion requires an unheld versioned correction') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=94,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
