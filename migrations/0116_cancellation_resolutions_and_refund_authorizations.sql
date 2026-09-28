CREATE TABLE order_cancellation_resolutions (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE REFERENCES order_cancellation_requests(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('approved','partially_approved','declined')),
  customer_reason TEXT NOT NULL CHECK(length(trim(customer_reason))>0),
  internal_note TEXT,
  lines_json TEXT NOT NULL CHECK(json_valid(lines_json)),
  financial_json TEXT NOT NULL CHECK(json_valid(financial_json)),
  factory_evidence_json TEXT CHECK(factory_evidence_json IS NULL OR json_valid(factory_evidence_json)),
  refund_authorization_id TEXT,
  actor_id TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER order_cancellation_resolution_no_update
BEFORE UPDATE ON order_cancellation_resolutions BEGIN
  SELECT RAISE(ABORT,'Cancellation Resolution is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_cancellation_resolution_no_delete
BEFORE DELETE ON order_cancellation_resolutions BEGIN
  SELECT RAISE(ABORT,'Cancellation Resolution is immutable');
END;
--> statement-breakpoint
CREATE TABLE order_cancelled_quantities (
  resolution_id TEXT NOT NULL REFERENCES order_cancellation_resolutions(id),
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  shipment_id TEXT,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>0),
  FOREIGN KEY(order_id,line_id) REFERENCES confirmed_order_lines(order_id,line_id),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX order_cancelled_quantities_scope
ON order_cancelled_quantities(resolution_id,line_id,coalesce(shipment_id,''));
--> statement-breakpoint
CREATE INDEX order_cancelled_quantities_line ON order_cancelled_quantities(order_id,line_id);
--> statement-breakpoint
CREATE TRIGGER order_cancelled_quantity_guard
BEFORE INSERT ON order_cancelled_quantities BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_cancellation_resolutions resolution
    JOIN order_cancellation_request_lines line
      ON line.request_id=resolution.request_id AND line.line_id=NEW.line_id
      AND line.shipment_id IS NEW.shipment_id
    WHERE resolution.id=NEW.resolution_id AND resolution.order_id=NEW.order_id
      AND line.physical_quantity>=NEW.physical_quantity
  ) THEN RAISE(ABORT,'Cancelled quantity exceeds the request') END;
  SELECT CASE WHEN NEW.shipment_id IS NOT NULL AND (
    EXISTS(SELECT 1 FROM shipment_dispatch_quantities d WHERE d.shipment_id=NEW.shipment_id)
    OR NOT EXISTS(SELECT 1 FROM order_shipments s WHERE s.id=NEW.shipment_id
      AND s.status IN ('planned','ready_to_ship'))
  ) THEN RAISE(ABORT,'Handed-off quantities cannot be cancelled') END;
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(c.physical_quantity) FROM order_cancelled_quantities c
      WHERE c.order_id=NEW.order_id AND c.line_id=NEW.line_id),0)
    > coalesce((SELECT CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END
       FROM confirmed_order_lines l WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Cancelled quantity exceeds purchased quantity') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_cancelled_quantity_no_update
BEFORE UPDATE ON order_cancelled_quantities BEGIN
  SELECT RAISE(ABORT,'Cancelled quantities are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_cancelled_quantity_no_delete
BEFORE DELETE ON order_cancelled_quantities BEGIN
  SELECT RAISE(ABORT,'Cancelled quantities are immutable');
END;
--> statement-breakpoint
CREATE TABLE order_cancellation_allocation_edit_context (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES confirmed_orders(id),
  resolution_id TEXT NOT NULL REFERENCES order_cancellation_resolutions(id)
);
--> statement-breakpoint
DROP TRIGGER order_shipment_allocation_no_delete;
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
  ) AND NOT EXISTS(
    SELECT 1 FROM order_shipping_change_allocation_edit_context context
    JOIN order_shipping_change_effective effective
      ON effective.id=context.effective_change_id
    JOIN order_shipping_change_shipments affected
      ON affected.request_id=effective.request_id
       AND affected.shipment_id=OLD.shipment_id
    JOIN order_shipments shipment ON shipment.id=OLD.shipment_id
    WHERE context.order_id=OLD.order_id
      AND shipment.status IN ('planned','ready_to_ship')
      AND NOT EXISTS(SELECT 1 FROM order_release_guards guard
        WHERE guard.order_id=OLD.order_id AND guard.held=1)
      AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
        WHERE hold.shipment_id=OLD.shipment_id AND hold.active=1)
  ) AND NOT EXISTS(
    SELECT 1 FROM order_cancellation_allocation_edit_context context
    JOIN order_cancelled_quantities cancelled
      ON cancelled.resolution_id=context.resolution_id
      AND cancelled.shipment_id=OLD.shipment_id AND cancelled.line_id=OLD.line_id
    JOIN order_shipments shipment ON shipment.id=OLD.shipment_id
    WHERE context.order_id=OLD.order_id
      AND shipment.status IN ('planned','ready_to_ship')
      AND NOT EXISTS(SELECT 1 FROM shipment_dispatch_quantities d
        WHERE d.shipment_id=OLD.shipment_id)
  ) THEN RAISE(ABORT,'Shipment allocation deletion requires an unheld versioned correction') END;
END;
--> statement-breakpoint
DROP TRIGGER order_shipment_allocation_guard;
--> statement-breakpoint
CREATE TRIGGER order_shipment_allocation_guard BEFORE INSERT ON order_shipment_allocations BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM order_release_guards guard
    WHERE guard.order_id=NEW.order_id AND guard.held=1)
    AND NOT EXISTS(SELECT 1 FROM order_cancellation_allocation_edit_context context
      WHERE context.order_id=NEW.order_id)
    THEN RAISE(ABORT,'Payment review blocks new shipment allocation') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM order_shipments shipment
    WHERE shipment.id=NEW.shipment_id AND shipment.order_id=NEW.order_id
      AND (shipment.status='planned' OR (shipment.status='ready_to_ship'
        AND (EXISTS(SELECT 1 FROM order_shipping_change_allocation_edit_context context
          JOIN order_shipping_change_effective effective
            ON effective.id=context.effective_change_id
          JOIN order_shipping_change_shipments affected
            ON affected.request_id=effective.request_id
              AND affected.shipment_id=NEW.shipment_id
          WHERE context.order_id=NEW.order_id)
        OR EXISTS(SELECT 1 FROM order_cancellation_allocation_edit_context context
          JOIN order_cancelled_quantities cancelled
            ON cancelled.resolution_id=context.resolution_id
            AND cancelled.shipment_id=NEW.shipment_id AND cancelled.line_id=NEW.line_id
          WHERE context.order_id=NEW.order_id)))))
    THEN RAISE(ABORT,'Shipment allocation requires an eligible shipment') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM order_quantity_holds hold
    WHERE hold.shipment_id=NEW.shipment_id AND hold.active=1)
    AND NOT EXISTS(SELECT 1 FROM order_cancellation_allocation_edit_context context
      JOIN order_cancelled_quantities cancelled
        ON cancelled.resolution_id=context.resolution_id
        AND cancelled.shipment_id=NEW.shipment_id AND cancelled.line_id=NEW.line_id
      WHERE context.order_id=NEW.order_id
        AND NEW.physical_quantity>=coalesce((SELECT sum(h.physical_quantity)
          FROM order_quantity_holds h WHERE h.shipment_id=NEW.shipment_id
            AND h.line_id=NEW.line_id AND h.active=1),0))
    THEN RAISE(ABORT,'Held shipment allocation cannot change') END;
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(a.physical_quantity) FROM order_shipment_allocations a
      WHERE a.order_id=NEW.order_id AND a.line_id=NEW.line_id),0) +
    coalesce((SELECT sum(h.physical_quantity) FROM order_quantity_holds h
      WHERE h.order_id=NEW.order_id AND h.line_id=NEW.line_id AND h.active=1 AND h.shipment_id IS NULL),0) +
    coalesce((SELECT sum(c.physical_quantity) FROM order_cancelled_quantities c
      WHERE c.order_id=NEW.order_id AND c.line_id=NEW.line_id),0)
    > coalesce((SELECT CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END
       FROM confirmed_order_lines l WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Shipment allocation exceeds physical quantity') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_cancellation_hold_excludes_cancelled
BEFORE INSERT ON order_quantity_holds WHEN NEW.active=1 AND NEW.shipment_id IS NULL BEGIN
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(h.physical_quantity) FROM order_quantity_holds h
      WHERE h.order_id=NEW.order_id AND h.line_id=NEW.line_id AND h.active=1),0) +
    coalesce((SELECT sum(c.physical_quantity) FROM order_cancelled_quantities c
      WHERE c.order_id=NEW.order_id AND c.line_id=NEW.line_id),0)
    > coalesce((SELECT CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END
       FROM confirmed_order_lines l WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Quantity hold exceeds remaining purchased quantity') END;
END;
--> statement-breakpoint
CREATE TABLE after_sales_refund_authorizations (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('cancellation','return','supplemental')),
  source_id TEXT NOT NULL,
  responsibility TEXT NOT NULL CHECK(responsibility IN ('customer','seller')),
  merchandise_cents INTEGER NOT NULL DEFAULT 0 CHECK(merchandise_cents>=0),
  logistics_cents INTEGER NOT NULL DEFAULT 0 CHECK(logistics_cents>=0),
  seller_logistics_cents INTEGER NOT NULL DEFAULT 0 CHECK(seller_logistics_cents>=0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK(tax_cents>=0),
  service_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(service_fee_cents>=0),
  restocking_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(restocking_fee_cents>=0),
  third_party_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(third_party_cost_cents>=0),
  refund_cents INTEGER NOT NULL CHECK(refund_cents>0),
  third_party_cost_evidence TEXT,
  status TEXT NOT NULL CHECK(status IN ('awaiting_customer_confirmation','approved','disputed','superseded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  supersedes_id TEXT REFERENCES after_sales_refund_authorizations(id),
  previous_authorization_id TEXT REFERENCES after_sales_refund_authorizations(id),
  approved_at TEXT,
  deadline_date_et TEXT,
  deadline_at TEXT,
  calendar_version TEXT,
  customer_response_at TEXT,
  customer_response_by TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  CHECK(refund_cents=merchandise_cents+logistics_cents+seller_logistics_cents+tax_cents
    +service_fee_cents-restocking_fee_cents-third_party_cost_cents),
  CHECK(responsibility='customer' OR (restocking_fee_cents=0 AND third_party_cost_cents=0)),
  CHECK(third_party_cost_cents=0 OR length(trim(coalesce(third_party_cost_evidence,'')))>0),
  CHECK((status='approved')=(approved_at IS NOT NULL AND deadline_at IS NOT NULL)
    OR status='superseded')
);
--> statement-breakpoint
CREATE INDEX after_sales_refund_authorizations_order ON after_sales_refund_authorizations(order_id,created_at);
--> statement-breakpoint
CREATE INDEX after_sales_refund_authorizations_source ON after_sales_refund_authorizations(source_kind,source_id);
--> statement-breakpoint
CREATE INDEX after_sales_refund_authorizations_due ON after_sales_refund_authorizations(status,deadline_at);
--> statement-breakpoint
CREATE TABLE after_sales_refund_line_credits (
  authorization_id TEXT NOT NULL REFERENCES after_sales_refund_authorizations(id),
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>=0),
  merchandise_cents INTEGER NOT NULL CHECK(merchandise_cents>=0),
  PRIMARY KEY(authorization_id,line_id),
  FOREIGN KEY(order_id,line_id) REFERENCES confirmed_order_lines(order_id,line_id)
);
--> statement-breakpoint
CREATE VIEW after_sales_effective_refund_authorizations AS
SELECT * FROM after_sales_refund_authorizations WHERE status!='superseded';
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_line_credit_guard
BEFORE INSERT ON after_sales_refund_line_credits BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_refund_authorizations a
    WHERE a.id=NEW.authorization_id AND a.order_id=NEW.order_id AND a.status!='superseded')
    THEN RAISE(ABORT,'Line credit requires its effective authorization') END;
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(c.physical_quantity) FROM after_sales_refund_line_credits c
      JOIN after_sales_effective_refund_authorizations a ON a.id=c.authorization_id
      WHERE c.order_id=NEW.order_id AND c.line_id=NEW.line_id),0)
    > coalesce((SELECT CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END
       FROM confirmed_order_lines l WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Refunded quantity exceeds purchased quantity') END;
  SELECT CASE WHEN NEW.merchandise_cents +
    coalesce((SELECT sum(c.merchandise_cents) FROM after_sales_refund_line_credits c
      JOIN after_sales_effective_refund_authorizations a ON a.id=c.authorization_id
      WHERE c.order_id=NEW.order_id AND c.line_id=NEW.line_id),0)
    > coalesce((SELECT json_extract(l.snapshot_json,'$.totals.totalCents')
       FROM confirmed_order_lines l WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Merchandise refund exceeds the discounted line amount') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_line_credit_no_update
BEFORE UPDATE ON after_sales_refund_line_credits BEGIN
  SELECT RAISE(ABORT,'Refund line credits are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_line_credit_no_delete
BEFORE DELETE ON after_sales_refund_line_credits BEGIN
  SELECT RAISE(ABORT,'Refund line credits are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_authorization_guard
BEFORE INSERT ON after_sales_refund_authorizations BEGIN
  SELECT CASE WHEN NEW.status='superseded' OR NEW.version!=1
    THEN RAISE(ABORT,'New refund authorization must be effective') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM confirmed_orders o
    JOIN pi_payment_accounts pay ON pay.pi_id=o.pi_id
    WHERE o.id=NEW.order_id AND pay.confirmation_valid=1 AND pay.receipt_history_known=1
      AND NOT EXISTS(SELECT 1 FROM order_release_guards g WHERE g.order_id=o.id AND g.held=1)
      AND NOT EXISTS(SELECT 1 FROM pi_payment_disputes d WHERE d.pi_id=o.pi_id AND d.active=1)
  ) THEN RAISE(ABORT,'Verified original funds required for refund authorization') END;
  SELECT CASE WHEN NEW.refund_cents +
    coalesce((SELECT sum(a.refund_cents) FROM after_sales_effective_refund_authorizations a
      WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e
      WHERE e.order_id=NEW.order_id AND e.adjustment_cents<0),0)
    > coalesce((SELECT total_cents FROM confirmed_orders WHERE id=NEW.order_id),0)
    THEN RAISE(ABORT,'Refunds exceed the system-tracked original payment') END;
  SELECT CASE WHEN NEW.logistics_cents +
    coalesce((SELECT sum(a.logistics_cents) FROM after_sales_effective_refund_authorizations a
      WHERE a.order_id=NEW.order_id),0)
    > coalesce((SELECT coalesce(json_extract(o.snapshot_json,'$.terms.charges.freight'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.insurance'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.dutiesImport'),0)
      FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Logistics refund exceeds original logistics charges') END;
  SELECT CASE WHEN NEW.tax_cents +
    coalesce((SELECT sum(a.tax_cents) FROM after_sales_effective_refund_authorizations a
      WHERE a.order_id=NEW.order_id),0)
    > coalesce((SELECT coalesce(json_extract(o.snapshot_json,'$.terms.charges.salesTax'),0)
      FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Tax refund exceeds accepted Sales Tax') END;
  SELECT CASE WHEN NEW.service_fee_cents +
    coalesce((SELECT sum(a.service_fee_cents) FROM after_sales_effective_refund_authorizations a
      WHERE a.order_id=NEW.order_id),0)
    > coalesce((SELECT coalesce(json_extract(o.snapshot_json,'$.terms.charges.cuttingLabeling'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.assemblyService'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.protectionService'),0)
      FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Service fee refund exceeds accepted service charges') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_authorization_transition
BEFORE UPDATE ON after_sales_refund_authorizations BEGIN
  SELECT CASE WHEN NEW.version!=OLD.version+1
    OR NOT ((OLD.status='awaiting_customer_confirmation' AND NEW.status IN ('approved','disputed','superseded'))
      OR (OLD.status='disputed' AND NEW.status IN ('approved','superseded'))
      OR (OLD.status='approved' AND NEW.status='superseded'))
    OR NEW.id!=OLD.id OR NEW.order_id!=OLD.order_id OR NEW.source_kind!=OLD.source_kind
    OR NEW.source_id!=OLD.source_id OR NEW.responsibility!=OLD.responsibility
    OR NEW.merchandise_cents!=OLD.merchandise_cents OR NEW.logistics_cents!=OLD.logistics_cents
    OR NEW.seller_logistics_cents!=OLD.seller_logistics_cents OR NEW.tax_cents!=OLD.tax_cents
    OR NEW.service_fee_cents!=OLD.service_fee_cents
    OR NEW.restocking_fee_cents!=OLD.restocking_fee_cents
    OR NEW.third_party_cost_cents!=OLD.third_party_cost_cents
    OR NEW.refund_cents!=OLD.refund_cents OR NEW.command_id!=OLD.command_id
    OR NEW.created_at!=OLD.created_at OR NEW.actor_id!=OLD.actor_id
    OR (OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT OLD.approved_at)
    OR (OLD.deadline_at IS NOT NULL AND NEW.deadline_at IS NOT OLD.deadline_at)
    THEN RAISE(ABORT,'Refund authorization amounts are immutable') END;
  SELECT CASE WHEN NEW.status='superseded' AND EXISTS(
    SELECT 1 FROM after_sales_refund_initiations i WHERE i.authorization_id=OLD.id)
    THEN RAISE(ABORT,'An initiated refund cannot be superseded') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_authorization_no_delete
BEFORE DELETE ON after_sales_refund_authorizations BEGIN
  SELECT RAISE(ABORT,'Refund authorization history is immutable');
END;
--> statement-breakpoint
CREATE TABLE after_sales_refund_initiations (
  id TEXT PRIMARY KEY NOT NULL,
  authorization_id TEXT NOT NULL REFERENCES after_sales_refund_authorizations(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  channel TEXT NOT NULL CHECK(channel IN ('bank_transfer','paypal')),
  initiated_date_et TEXT NOT NULL,
  external_reference TEXT NOT NULL CHECK(length(trim(external_reference))>0),
  destination_id TEXT,
  actor_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE INDEX after_sales_refund_initiations_authorization ON after_sales_refund_initiations(authorization_id);
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_initiation_no_update
BEFORE UPDATE ON after_sales_refund_initiations BEGIN
  SELECT RAISE(ABORT,'Refund initiation is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_initiation_no_delete
BEFORE DELETE ON after_sales_refund_initiations BEGIN
  SELECT RAISE(ABORT,'Refund initiation is immutable');
END;
--> statement-breakpoint
CREATE TABLE after_sales_refund_events (
  id TEXT PRIMARY KEY NOT NULL,
  authorization_id TEXT NOT NULL REFERENCES after_sales_refund_authorizations(id),
  kind TEXT NOT NULL CHECK(kind IN ('authorized','customer_confirmed','customer_disputed','superseded','initiated')),
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE INDEX after_sales_refund_events_authorization ON after_sales_refund_events(authorization_id,occurred_at);
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_event_no_update
BEFORE UPDATE ON after_sales_refund_events BEGIN
  SELECT RAISE(ABORT,'Refund history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_event_no_delete
BEFORE DELETE ON after_sales_refund_events BEGIN
  SELECT RAISE(ABORT,'Refund history is immutable');
END;
--> statement-breakpoint
DROP VIEW order_change_financial_contract;
--> statement-breakpoint
CREATE VIEW order_change_financial_contract AS
SELECT o.id AS order_id,o.pi_id,o.total_cents AS original_due_cents,
  coalesce((SELECT sum(e.adjustment_cents) FROM order_shipping_change_effective e
    WHERE e.order_id=o.id),0) AS adjustment_cents,
  coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e
    WHERE e.order_id=o.id AND e.adjustment_cents<0),0)
  + coalesce((SELECT sum(a.refund_cents) FROM after_sales_effective_refund_authorizations a
    WHERE a.order_id=o.id),0) AS authorized_credit_cents,
  coalesce((SELECT sum(r.due_cents-
    coalesce((SELECT sum(i.amount_cents) FROM order_shipping_change_refund_initiations i
      WHERE i.reservation_id=r.id),0))
    FROM order_shipping_change_refund_reservations r WHERE r.order_id=o.id),0)
  + coalesce((SELECT sum(a.refund_cents-
    coalesce((SELECT sum(i.amount_cents) FROM after_sales_refund_initiations i
      WHERE i.authorization_id=a.id),0))
    FROM after_sales_effective_refund_authorizations a
    WHERE a.order_id=o.id),0) AS uninitiated_refund_cents
FROM confirmed_orders o;
--> statement-breakpoint
DROP TRIGGER order_shipping_change_credit_limit;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_credit_limit
BEFORE INSERT ON order_shipping_change_effective
WHEN NEW.adjustment_cents<0 BEGIN
  SELECT CASE WHEN -NEW.adjustment_cents +
    coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e
      WHERE e.order_id=NEW.order_id AND e.adjustment_cents<0),0) +
    coalesce((SELECT sum(a.refund_cents) FROM after_sales_effective_refund_authorizations a
      WHERE a.order_id=NEW.order_id),0)
    > coalesce((SELECT total_cents FROM confirmed_orders WHERE id=NEW.order_id),0)
    THEN RAISE(ABORT,'Shipping credits exceed system-tracked original payment') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=117,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
