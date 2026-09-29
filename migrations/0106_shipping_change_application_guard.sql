CREATE TABLE order_shipping_change_allocation_edit_context (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES confirmed_orders(id),
  effective_change_id TEXT NOT NULL REFERENCES order_shipping_change_effective(id)
);
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_effective_guard
BEFORE INSERT ON order_shipping_change_effective BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_shipping_change_requests request
    JOIN order_shipping_change_proposals proposal
      ON proposal.id=request.current_proposal_id
    JOIN order_shipping_change_acceptances acceptance
      ON acceptance.proposal_id=proposal.id
    WHERE request.id=NEW.request_id AND request.order_id=NEW.order_id
      AND request.status='accepted' AND proposal.id=NEW.proposal_id
      AND proposal.proposal_hash=NEW.proposal_hash
      AND acceptance.proposal_hash=proposal.proposal_hash
      AND proposal.after_json=NEW.after_json
      AND proposal.before_json=NEW.before_json
      AND proposal.adjustment_cents=NEW.adjustment_cents
      AND proposal.expires_at>NEW.effective_at
  ) THEN RAISE(ABORT,'Current accepted Order Change Confirmation required') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM order_release_guards guard
    WHERE guard.order_id=NEW.order_id AND guard.held=1
  ) THEN RAISE(ABORT,'Payment review blocks shipping change') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM order_shipping_change_shipments affected
    LEFT JOIN order_shipments shipment ON shipment.id=affected.shipment_id
    LEFT JOIN order_shipping_change_active_shipments active
      ON active.shipment_id=affected.shipment_id
    WHERE affected.request_id=NEW.request_id
      AND (shipment.id IS NULL OR shipment.version!=affected.shipment_version
        OR shipment.status NOT IN ('planned','ready_to_ship')
        OR active.request_id IS NOT NEW.request_id
        OR EXISTS(SELECT 1 FROM shipment_dispatch_quantities dispatched
          WHERE dispatched.shipment_id=affected.shipment_id)
        OR EXISTS(SELECT 1 FROM order_quantity_holds hold
          WHERE hold.shipment_id=affected.shipment_id AND hold.active=1
            AND NOT EXISTS(SELECT 1 FROM order_shipping_change_hold_links link
              WHERE link.request_id=NEW.request_id AND link.hold_id=hold.id)))
  ) THEN RAISE(ABORT,'Affected shipments changed or remain held') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_allocation_context_guard
BEFORE INSERT ON order_shipping_change_allocation_edit_context BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_shipping_change_effective effective
    WHERE effective.id=NEW.effective_change_id AND effective.order_id=NEW.order_id
  ) THEN RAISE(ABORT,'Applied Order Change required') END;
END;
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
  ) THEN RAISE(ABORT,'Shipment allocation deletion requires an unheld versioned correction') END;
END;
--> statement-breakpoint
DROP TRIGGER order_shipment_allocation_guard;
--> statement-breakpoint
CREATE TRIGGER order_shipment_allocation_guard BEFORE INSERT ON order_shipment_allocations BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM order_release_guards guard
    WHERE guard.order_id=NEW.order_id AND guard.held=1)
    THEN RAISE(ABORT,'Payment review blocks new shipment allocation') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM order_shipments shipment
    WHERE shipment.id=NEW.shipment_id AND shipment.order_id=NEW.order_id
      AND (shipment.status='planned' OR (shipment.status='ready_to_ship'
        AND EXISTS(SELECT 1 FROM order_shipping_change_allocation_edit_context context
          JOIN order_shipping_change_effective effective
            ON effective.id=context.effective_change_id
          JOIN order_shipping_change_shipments affected
            ON affected.request_id=effective.request_id
              AND affected.shipment_id=NEW.shipment_id
          WHERE context.order_id=NEW.order_id))))
    THEN RAISE(ABORT,'Shipment allocation requires an eligible shipment') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM order_quantity_holds hold
    WHERE hold.shipment_id=NEW.shipment_id AND hold.active=1)
    THEN RAISE(ABORT,'Held shipment allocation cannot change') END;
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(a.physical_quantity) FROM order_shipment_allocations a
      WHERE a.order_id=NEW.order_id AND a.line_id=NEW.line_id),0) +
    coalesce((SELECT sum(h.physical_quantity) FROM order_quantity_holds h
      WHERE h.order_id=NEW.order_id AND h.line_id=NEW.line_id AND h.active=1 AND h.shipment_id IS NULL),0)
    > coalesce((SELECT CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END
       FROM confirmed_order_lines l WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Shipment allocation exceeds physical quantity') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=107,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
