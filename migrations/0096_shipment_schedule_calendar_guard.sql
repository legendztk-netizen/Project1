CREATE TRIGGER order_shipment_schedule_calendar_guard
BEFORE INSERT ON order_shipment_ready_schedules BEGIN
  SELECT CASE WHEN NEW.accepted_calendar_version IS NOT NULL AND
    NOT EXISTS(SELECT 1 FROM china_fulfillment_calendar_versions calendar
      WHERE calendar.version=NEW.accepted_calendar_version AND calendar.status='current')
    THEN RAISE(ABORT,'China fulfillment calendar changed during Order confirmation') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=97,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
