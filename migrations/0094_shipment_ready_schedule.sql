CREATE TABLE china_fulfillment_calendar_versions (
  version INTEGER PRIMARY KEY NOT NULL CHECK(version>0),
  status TEXT NOT NULL CHECK(status IN ('draft','current','superseded')),
  coverage_from TEXT NOT NULL,
  coverage_through TEXT NOT NULL CHECK(coverage_through>=coverage_from),
  working_weekdays_json TEXT NOT NULL CHECK(json_valid(working_weekdays_json)),
  revision_reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX china_fulfillment_calendar_one_current
  ON china_fulfillment_calendar_versions(status) WHERE status='current';
--> statement-breakpoint
CREATE TABLE china_fulfillment_calendar_exceptions (
  version INTEGER NOT NULL REFERENCES china_fulfillment_calendar_versions(version),
  calendar_date TEXT NOT NULL,
  is_working INTEGER NOT NULL CHECK(is_working IN (0,1)),
  reason TEXT NOT NULL,
  PRIMARY KEY(version,calendar_date)
);
--> statement-breakpoint
CREATE TRIGGER china_calendar_exception_draft_insert BEFORE INSERT ON china_fulfillment_calendar_exceptions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM china_fulfillment_calendar_versions v
    WHERE v.version=NEW.version AND v.status='draft')
    THEN RAISE(ABORT,'Calendar exceptions require a draft version') END;
END;
--> statement-breakpoint
CREATE TRIGGER china_calendar_exception_draft_update BEFORE UPDATE ON china_fulfillment_calendar_exceptions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM china_fulfillment_calendar_versions v
    WHERE v.version=OLD.version AND v.status='draft')
    THEN RAISE(ABORT,'Confirmed calendar exceptions are immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER china_calendar_exception_draft_delete BEFORE DELETE ON china_fulfillment_calendar_exceptions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM china_fulfillment_calendar_versions v
    WHERE v.version=OLD.version AND v.status='draft')
    THEN RAISE(ABORT,'Confirmed calendar exceptions are immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER china_calendar_version_confirmed_guard BEFORE UPDATE ON china_fulfillment_calendar_versions BEGIN
  SELECT CASE WHEN OLD.status!='draft' AND
    (NEW.status!='superseded' OR OLD.status!='current'
      OR NEW.coverage_from!=OLD.coverage_from
      OR NEW.coverage_through!=OLD.coverage_through
      OR NEW.working_weekdays_json!=OLD.working_weekdays_json
      OR NEW.revision_reason!=OLD.revision_reason
      OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at
      OR NEW.confirmed_by IS NOT OLD.confirmed_by
      OR NEW.confirmed_at IS NOT OLD.confirmed_at)
    THEN RAISE(ABORT,'Confirmed calendar is immutable') END;
END;
--> statement-breakpoint
CREATE TABLE order_shipment_ready_schedules (
  shipment_id TEXT PRIMARY KEY NOT NULL REFERENCES order_shipments(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  accepted_basis_json TEXT CHECK(accepted_basis_json IS NULL OR json_valid(accepted_basis_json)),
  accepted_ready_date TEXT,
  accepted_calendar_version INTEGER REFERENCES china_fulfillment_calendar_versions(version),
  current_estimate_date TEXT,
  current_estimate_source TEXT CHECK(current_estimate_source IN ('accepted','operational','revised')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE TABLE order_shipment_ready_schedule_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES order_shipments(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  previous_date TEXT,
  new_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('operational','revised')),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  previous_version INTEGER NOT NULL CHECK(previous_version>0),
  resulting_version INTEGER NOT NULL CHECK(resulting_version=previous_version+1),
  occurred_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE INDEX order_shipment_ready_schedule_revisions_order
  ON order_shipment_ready_schedule_revisions(order_id,shipment_id,occurred_at);
--> statement-breakpoint
CREATE TRIGGER order_shipment_ready_schedule_revision_no_update BEFORE UPDATE ON order_shipment_ready_schedule_revisions BEGIN
  SELECT RAISE(ABORT,'Shipment date revision history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_shipment_ready_schedule_revision_no_delete BEFORE DELETE ON order_shipment_ready_schedule_revisions BEGIN
  SELECT RAISE(ABORT,'Shipment date revision history is immutable');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=95,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
