CREATE TRIGGER order_shipping_change_proposal_current_guard
BEFORE INSERT ON order_shipping_change_proposals BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_shipping_change_requests request
    WHERE request.id=NEW.request_id AND request.status='proposed'
      AND request.current_proposal_id=NEW.id
  ) THEN RAISE(ABORT,'Proposal does not match the current change request') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_effective_schedule_guard
BEFORE INSERT ON order_shipping_change_effective BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM json_each(NEW.before_json,'$.shipments') previous
    LEFT JOIN order_shipment_ready_schedules schedule
      ON schedule.shipment_id=json_extract(previous.value,'$.shipmentId')
    WHERE schedule.version IS NOT json_extract(previous.value,'$.scheduleVersion')
      OR schedule.current_estimate_date IS NOT json_extract(previous.value,'$.readyDate')
  ) THEN RAISE(ABORT,'Shipment ready estimate changed after proposal') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=108,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
