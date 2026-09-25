CREATE TABLE order_shipping_change_requests (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  kind TEXT NOT NULL CHECK(kind IN ('delivery_address','shipping_plan')),
  status TEXT NOT NULL CHECK(status IN ('pending_review','proposed','accepted','effective','withdrawn','declined')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  requested_json TEXT NOT NULL CHECK(json_valid(requested_json)),
  current_proposal_id TEXT,
  submission_command_id TEXT NOT NULL UNIQUE,
  submission_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX order_shipping_change_requests_order ON order_shipping_change_requests(order_id,created_at DESC);
--> statement-breakpoint
CREATE TABLE order_shipping_change_shipments (
  request_id TEXT NOT NULL REFERENCES order_shipping_change_requests(id),
  order_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  shipment_version INTEGER NOT NULL CHECK(shipment_version>0),
  quantities_json TEXT NOT NULL CHECK(json_valid(quantities_json)),
  PRIMARY KEY(request_id,shipment_id),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE TABLE order_shipping_change_active_shipments (
  shipment_id TEXT PRIMARY KEY NOT NULL REFERENCES order_shipments(id),
  request_id TEXT NOT NULL REFERENCES order_shipping_change_requests(id)
);
--> statement-breakpoint
CREATE TABLE order_shipping_change_hold_links (
  request_id TEXT NOT NULL REFERENCES order_shipping_change_requests(id),
  hold_id TEXT NOT NULL UNIQUE REFERENCES order_quantity_holds(id),
  PRIMARY KEY(request_id,hold_id)
);
--> statement-breakpoint
CREATE TABLE order_shipping_change_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES order_shipping_change_requests(id),
  version INTEGER NOT NULL CHECK(version>0),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  adjustment_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  proposal_hash TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE(request_id,version)
);
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_proposal_no_update BEFORE UPDATE ON order_shipping_change_proposals BEGIN
  SELECT RAISE(ABORT,'Order Change Confirmation is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_proposal_no_delete BEFORE DELETE ON order_shipping_change_proposals BEGIN
  SELECT RAISE(ABORT,'Order Change Confirmation is immutable');
END;
--> statement-breakpoint
CREATE TABLE order_shipping_change_acceptances (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES order_shipping_change_requests(id),
  proposal_id TEXT NOT NULL UNIQUE REFERENCES order_shipping_change_proposals(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  proposal_hash TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_acceptance_no_update BEFORE UPDATE ON order_shipping_change_acceptances BEGIN
  SELECT RAISE(ABORT,'Order Change acceptance is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_acceptance_no_delete BEFORE DELETE ON order_shipping_change_acceptances BEGIN
  SELECT RAISE(ABORT,'Order Change acceptance is immutable');
END;
--> statement-breakpoint
CREATE TABLE order_shipping_change_funding (
  proposal_id TEXT PRIMARY KEY NOT NULL REFERENCES order_shipping_change_proposals(id),
  due_cents INTEGER NOT NULL CHECK(due_cents>0),
  received_cents INTEGER NOT NULL DEFAULT 0 CHECK(received_cents>=0),
  actual_channel TEXT CHECK(actual_channel IN ('bank_transfer','paypal')),
  cleared INTEGER NOT NULL DEFAULT 0 CHECK(cleared IN (0,1)),
  disputed INTEGER NOT NULL DEFAULT 0 CHECK(disputed IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE order_shipping_change_funding_events (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES order_shipping_change_proposals(id),
  kind TEXT NOT NULL CHECK(kind IN ('receipt','cleared','corrected','review_resolved')),
  previous_cents INTEGER NOT NULL CHECK(previous_cents>=0),
  resulting_cents INTEGER NOT NULL CHECK(resulting_cents>=0),
  actual_channel TEXT NOT NULL CHECK(actual_channel IN ('bank_transfer','paypal')),
  external_reference TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_funding_event_no_update BEFORE UPDATE ON order_shipping_change_funding_events BEGIN
  SELECT RAISE(ABORT,'Order Change funding evidence is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_funding_event_no_delete BEFORE DELETE ON order_shipping_change_funding_events BEGIN
  SELECT RAISE(ABORT,'Order Change funding evidence is immutable');
END;
--> statement-breakpoint
CREATE TABLE order_shipping_change_effective (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  request_id TEXT NOT NULL UNIQUE REFERENCES order_shipping_change_requests(id),
  proposal_id TEXT NOT NULL UNIQUE REFERENCES order_shipping_change_proposals(id),
  proposal_hash TEXT NOT NULL,
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  adjustment_cents INTEGER NOT NULL,
  effective_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_effective_no_update BEFORE UPDATE ON order_shipping_change_effective BEGIN
  SELECT RAISE(ABORT,'Effective Order Change is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_effective_no_delete BEFORE DELETE ON order_shipping_change_effective BEGIN
  SELECT RAISE(ABORT,'Effective Order Change is immutable');
END;
--> statement-breakpoint
CREATE TABLE order_shipping_change_refund_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  effective_change_id TEXT NOT NULL UNIQUE REFERENCES order_shipping_change_effective(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  due_cents INTEGER NOT NULL CHECK(due_cents>0),
  reserved_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE order_shipping_change_refund_initiations (
  id TEXT PRIMARY KEY NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES order_shipping_change_refund_reservations(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  external_reference TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  initiated_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_refund_initiation_guard BEFORE INSERT ON order_shipping_change_refund_initiations BEGIN
  SELECT CASE WHEN NEW.amount_cents + coalesce((SELECT sum(i.amount_cents)
      FROM order_shipping_change_refund_initiations i WHERE i.reservation_id=NEW.reservation_id),0)
      > coalesce((SELECT r.due_cents FROM order_shipping_change_refund_reservations r
        WHERE r.id=NEW.reservation_id),0)
    THEN RAISE(ABORT,'Refund initiation exceeds reserved entitlement') END;
END;
--> statement-breakpoint
CREATE TABLE order_shipping_change_reverification (
  shipment_id TEXT PRIMARY KEY NOT NULL REFERENCES order_shipments(id),
  effective_change_id TEXT NOT NULL REFERENCES order_shipping_change_effective(id),
  required_at TEXT NOT NULL,
  verified_at TEXT,
  verified_by TEXT,
  verification_json TEXT CHECK(verification_json IS NULL OR json_valid(verification_json))
);
--> statement-breakpoint
CREATE TABLE order_shipping_change_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES order_shipping_change_requests(id),
  kind TEXT NOT NULL CHECK(kind IN ('submitted','proposed','accepted','applied','withdrawn','declined','expired','funding_review')),
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_event_no_update BEFORE UPDATE ON order_shipping_change_events BEGIN
  SELECT RAISE(ABORT,'Order Change history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_event_no_delete BEFORE DELETE ON order_shipping_change_events BEGIN
  SELECT RAISE(ABORT,'Order Change history is immutable');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=105,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
