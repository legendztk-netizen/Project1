DROP TRIGGER order_shipping_change_effective_guard;
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
      AND acceptance.accepted_at<=proposal.expires_at
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
UPDATE application_schema_state SET version=111,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
