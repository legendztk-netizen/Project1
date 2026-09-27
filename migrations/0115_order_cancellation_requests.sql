PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE admin_identity_permissions (
  admin_id TEXT NOT NULL REFERENCES admin_identities(id),
  permission TEXT NOT NULL CHECK(permission IN ('after_sales.review','after_sales.refund')),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY(admin_id,permission)
);
--> statement-breakpoint
CREATE TABLE admin_notifications_next (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('rfq_submitted','shipping_change_requested',
    'cancellation_requested','after_sales_case_opened','after_sales_customer_reply',
    'return_inspection_overdue','refund_initiation_overdue')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(kind,source_id)
);
--> statement-breakpoint
INSERT INTO admin_notifications_next(id,kind,source_id,created_at)
SELECT id,kind,source_id,created_at FROM admin_notifications;
--> statement-breakpoint
DROP TRIGGER admin_notifications_rfq_submitted;
--> statement-breakpoint
DROP TRIGGER admin_notifications_shipping_change_requested;
--> statement-breakpoint
DROP TABLE admin_notifications;
--> statement-breakpoint
ALTER TABLE admin_notifications_next RENAME TO admin_notifications;
--> statement-breakpoint
CREATE INDEX admin_notifications_created ON admin_notifications(created_at DESC,id DESC);
--> statement-breakpoint
CREATE TRIGGER admin_notifications_rfq_submitted AFTER INSERT ON customer_quote_requests BEGIN
  INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
  VALUES ('rfq:'||NEW.id,'rfq_submitted',NEW.id,NEW.submitted_at);
END;
--> statement-breakpoint
CREATE TRIGGER admin_notifications_shipping_change_requested AFTER INSERT ON order_shipping_change_requests BEGIN
  INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
  VALUES ('shipping-change:'||NEW.id,'shipping_change_requested',NEW.id,NEW.created_at);
END;
--> statement-breakpoint
CREATE TABLE order_cancellation_requests (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  kind TEXT NOT NULL CHECK(kind IN ('standard','exceptional')),
  origin TEXT NOT NULL CHECK(origin IN ('customer','support')),
  status TEXT NOT NULL CHECK(status IN ('pending_review','withdrawn','resolved')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  profile_id TEXT REFERENCES customer_profiles(id),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  submission_command_id TEXT NOT NULL UNIQUE,
  submission_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((origin='customer' AND profile_id IS NOT NULL AND kind='standard') OR origin='support')
);
--> statement-breakpoint
CREATE INDEX order_cancellation_requests_order ON order_cancellation_requests(order_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX order_cancellation_requests_status ON order_cancellation_requests(status,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE order_cancellation_request_lines (
  request_id TEXT NOT NULL REFERENCES order_cancellation_requests(id),
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  shipment_id TEXT,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>0),
  hold_id TEXT NOT NULL UNIQUE REFERENCES order_quantity_holds(id),
  PRIMARY KEY(request_id,hold_id),
  FOREIGN KEY(order_id,line_id) REFERENCES confirmed_order_lines(order_id,line_id),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX order_cancellation_request_line_scope
ON order_cancellation_request_lines(request_id,line_id,coalesce(shipment_id,''));
--> statement-breakpoint
CREATE TRIGGER order_cancellation_request_line_guard
BEFORE INSERT ON order_cancellation_request_lines BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_cancellation_requests request
    JOIN order_quantity_holds hold ON hold.id=NEW.hold_id
    WHERE request.id=NEW.request_id AND request.order_id=NEW.order_id
      AND request.status='pending_review'
      AND hold.active=1 AND hold.kind='cancellation'
      AND hold.order_id=NEW.order_id AND hold.line_id=NEW.line_id
      AND hold.shipment_id IS NEW.shipment_id
      AND hold.physical_quantity=NEW.physical_quantity
  ) THEN RAISE(ABORT,'Cancellation line requires its own active hold') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM order_cancellation_requests request
    JOIN confirmed_order_lines line
      ON line.order_id=NEW.order_id AND line.line_id=NEW.line_id
    WHERE request.id=NEW.request_id AND request.kind='standard'
      AND (line.line_kind!='standard'
        OR coalesce(json_extract(line.snapshot_json,'$.madeToOrder'),0)!=0)
  ) THEN RAISE(ABORT,'Standard cancellation excludes made-to-order lines') END;
  SELECT CASE WHEN NEW.shipment_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM shipment_dispatch_quantities dispatched
    WHERE dispatched.shipment_id=NEW.shipment_id
  ) THEN RAISE(ABORT,'Handed-off quantities cannot be cancelled') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_cancellation_request_line_no_update
BEFORE UPDATE ON order_cancellation_request_lines BEGIN
  SELECT RAISE(ABORT,'Cancellation request lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_cancellation_request_line_no_delete
BEFORE DELETE ON order_cancellation_request_lines BEGIN
  SELECT RAISE(ABORT,'Cancellation request lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_cancellation_request_status_guard
BEFORE UPDATE ON order_cancellation_requests BEGIN
  SELECT CASE WHEN OLD.status!='pending_review'
    OR NEW.status NOT IN ('withdrawn','resolved')
    OR NEW.version!=OLD.version+1
    OR NEW.id!=OLD.id OR NEW.order_id!=OLD.order_id OR NEW.kind!=OLD.kind
    OR NEW.origin!=OLD.origin OR NEW.profile_id IS NOT OLD.profile_id
    OR NEW.actor_id!=OLD.actor_id OR NEW.reason!=OLD.reason
    OR NEW.submission_command_id!=OLD.submission_command_id
    OR NEW.submission_hash!=OLD.submission_hash OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'Cancellation request may only be closed once') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_cancellation_request_no_delete
BEFORE DELETE ON order_cancellation_requests BEGIN
  SELECT RAISE(ABORT,'Cancellation request history is immutable');
END;
--> statement-breakpoint
CREATE TABLE order_cancellation_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES order_cancellation_requests(id),
  kind TEXT NOT NULL CHECK(kind IN ('submitted','withdrawn','resolved')),
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE INDEX order_cancellation_events_request ON order_cancellation_events(request_id,occurred_at);
--> statement-breakpoint
CREATE TRIGGER order_cancellation_event_no_update
BEFORE UPDATE ON order_cancellation_events BEGIN
  SELECT RAISE(ABORT,'Cancellation history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_cancellation_event_no_delete
BEFORE DELETE ON order_cancellation_events BEGIN
  SELECT RAISE(ABORT,'Cancellation history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER admin_notifications_cancellation_requested
AFTER INSERT ON order_cancellation_requests WHEN NEW.origin='customer' BEGIN
  INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
  VALUES ('cancellation:'||NEW.id,'cancellation_requested',NEW.id,NEW.created_at);
END;
--> statement-breakpoint
CREATE TABLE after_sales_migration_fk_check (violations INTEGER NOT NULL CHECK(violations=0));
--> statement-breakpoint
INSERT INTO after_sales_migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE after_sales_migration_fk_check;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
--> statement-breakpoint
UPDATE application_schema_state SET version=116,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
