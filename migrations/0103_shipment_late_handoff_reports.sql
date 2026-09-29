CREATE TABLE shipment_late_handoff_reports (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL UNIQUE,
  expected_shipment_version INTEGER NOT NULL CHECK(expected_shipment_version>0),
  reported_status TEXT NOT NULL CHECK(reported_status IN ('planned','ready_to_ship')),
  actual_at TEXT NOT NULL,
  actual_date TEXT NOT NULL,
  carrier_name TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  quantities_json TEXT NOT NULL CHECK(json_valid(quantities_json)),
  actor_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE TRIGGER shipment_late_handoff_no_update BEFORE UPDATE ON shipment_late_handoff_reports BEGIN
  SELECT RAISE(ABORT,'Late handoff report is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER shipment_late_handoff_no_delete BEFORE DELETE ON shipment_late_handoff_reports BEGIN
  SELECT RAISE(ABORT,'Late handoff report is immutable');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=104,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
