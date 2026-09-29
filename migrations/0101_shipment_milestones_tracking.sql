CREATE TABLE shipment_milestone_events (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('ready_to_ship','shipped','delivered')),
  actual_date TEXT,
  actual_at TEXT,
  recorded_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  previous_version INTEGER NOT NULL CHECK(previous_version>0),
  resulting_version INTEGER NOT NULL CHECK(resulting_version=previous_version+1),
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  command_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  UNIQUE(shipment_id,kind),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE TRIGGER shipment_milestone_no_update BEFORE UPDATE ON shipment_milestone_events BEGIN
  SELECT RAISE(ABORT,'Shipment milestones are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER shipment_milestone_no_delete BEFORE DELETE ON shipment_milestone_events BEGIN
  SELECT RAISE(ABORT,'Shipment milestones are immutable');
END;
--> statement-breakpoint
CREATE TABLE shipment_dispatch_quantities (
  order_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>0),
  event_id TEXT NOT NULL REFERENCES shipment_milestone_events(id),
  PRIMARY KEY(shipment_id,line_id),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id),
  FOREIGN KEY(shipment_id,line_id) REFERENCES order_shipment_allocations(shipment_id,line_id)
);
--> statement-breakpoint
CREATE TRIGGER shipment_dispatch_quantity_guard BEFORE INSERT ON shipment_dispatch_quantities BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_shipment_allocations a JOIN order_shipments s ON s.id=a.shipment_id
    WHERE a.shipment_id=NEW.shipment_id AND a.order_id=NEW.order_id
      AND a.line_id=NEW.line_id AND a.physical_quantity=NEW.physical_quantity
      AND s.status IN ('shipped','delivered')
  ) THEN RAISE(ABORT,'Dispatch must match the allocated physical quantity') END;
END;
--> statement-breakpoint
CREATE TRIGGER shipment_dispatch_quantity_no_update BEFORE UPDATE ON shipment_dispatch_quantities BEGIN
  SELECT RAISE(ABORT,'Dispatched quantity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER shipment_dispatch_quantity_no_delete BEFORE DELETE ON shipment_dispatch_quantities BEGIN
  SELECT RAISE(ABORT,'Dispatched quantity is immutable');
END;
--> statement-breakpoint
CREATE TABLE shipment_package_tracking (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  package_label TEXT NOT NULL,
  carrier_name TEXT NOT NULL,
  tracking_number TEXT,
  tracking_url TEXT,
  estimated_arrival_date TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE INDEX shipment_package_tracking_shipment ON shipment_package_tracking(shipment_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER shipment_package_tracking_no_delete BEFORE DELETE ON shipment_package_tracking BEGIN
  SELECT RAISE(ABORT,'Tracking history cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER shipment_package_tracking_update_guard BEFORE UPDATE ON shipment_package_tracking BEGIN
  SELECT CASE WHEN NEW.version!=OLD.version+1 OR NEW.id!=OLD.id
    OR NEW.order_id!=OLD.order_id OR NEW.shipment_id!=OLD.shipment_id
    OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'Tracking correction requires a new version') END;
END;
--> statement-breakpoint
CREATE TABLE shipment_package_tracking_events (
  id TEXT PRIMARY KEY NOT NULL,
  tracking_id TEXT NOT NULL REFERENCES shipment_package_tracking(id),
  order_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  previous_version INTEGER NOT NULL CHECK(previous_version>=0),
  resulting_version INTEGER NOT NULL CHECK(resulting_version=previous_version+1),
  reason TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TRIGGER shipment_tracking_event_no_update BEFORE UPDATE ON shipment_package_tracking_events BEGIN
  SELECT RAISE(ABORT,'Tracking audit is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER shipment_tracking_event_no_delete BEFORE DELETE ON shipment_package_tracking_events BEGIN
  SELECT RAISE(ABORT,'Tracking audit is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_shipment_status_transition_guard BEFORE UPDATE OF status ON order_shipments
WHEN NEW.status!=OLD.status BEGIN
  SELECT CASE WHEN NOT (
    (OLD.status='planned' AND NEW.status IN ('ready_to_ship','shipped')) OR
    (OLD.status='ready_to_ship' AND NEW.status='shipped') OR
    (OLD.status='shipped' AND NEW.status='delivered')
  ) OR NEW.version!=OLD.version+1
    THEN RAISE(ABORT,'Invalid shipment milestone transition') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=102,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
