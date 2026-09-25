CREATE VIEW order_change_financial_contract AS
SELECT o.id AS order_id,o.pi_id,o.total_cents AS original_due_cents,
  coalesce((SELECT sum(e.adjustment_cents) FROM order_shipping_change_effective e
    WHERE e.order_id=o.id),0) AS adjustment_cents,
  coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e
    WHERE e.order_id=o.id AND e.adjustment_cents<0),0) AS authorized_credit_cents,
  coalesce((SELECT sum(r.due_cents-
    coalesce((SELECT sum(i.amount_cents) FROM order_shipping_change_refund_initiations i
      WHERE i.reservation_id=r.id),0))
    FROM order_shipping_change_refund_reservations r WHERE r.order_id=o.id),0)
    AS uninitiated_refund_cents
FROM confirmed_orders o;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_credit_limit
BEFORE INSERT ON order_shipping_change_effective
WHEN NEW.adjustment_cents<0 BEGIN
  SELECT CASE WHEN -NEW.adjustment_cents +
    coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e
      WHERE e.order_id=NEW.order_id AND e.adjustment_cents<0),0)
    > coalesce((SELECT total_cents FROM confirmed_orders WHERE id=NEW.order_id),0)
    THEN RAISE(ABORT,'Shipping credits exceed system-tracked original payment') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_change_refund_source_guard
BEFORE INSERT ON order_shipping_change_refund_initiations BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_shipping_change_refund_reservations r
    JOIN confirmed_orders o ON o.id=r.order_id
    JOIN pi_payment_accounts pay ON pay.pi_id=o.pi_id
    JOIN order_change_financial_contract contract ON contract.order_id=o.id
    WHERE r.id=NEW.reservation_id AND pay.confirmation_valid=1
      AND pay.amount_received_cents+pay.allocated_in_cents-
        pay.allocated_out_cents-pay.refunded_cents-
        (contract.original_due_cents-contract.authorized_credit_cents)
        >= NEW.amount_cents
  ) THEN RAISE(ABORT,'No verified original funds for shipping credit refund') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_change_refund_account_update
AFTER INSERT ON order_shipping_change_refund_initiations BEGIN
  UPDATE pi_payment_accounts SET refunded_cents=refunded_cents+NEW.amount_cents,
    version=version+1,updated_at=NEW.initiated_at
  WHERE pi_id=(SELECT o.pi_id FROM confirmed_orders o
    JOIN order_shipping_change_refund_reservations r ON r.order_id=o.id
    WHERE r.id=NEW.reservation_id);
END;
--> statement-breakpoint
CREATE TRIGGER order_change_refund_initiation_no_update
BEFORE UPDATE ON order_shipping_change_refund_initiations BEGIN
  SELECT RAISE(ABORT,'Refund initiation is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_change_refund_initiation_no_delete
BEFORE DELETE ON order_shipping_change_refund_initiations BEGIN
  SELECT RAISE(ABORT,'Refund initiation is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_change_reserved_fund_guard
BEFORE INSERT ON pi_fund_resolutions BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM pi_payment_accounts pay
    JOIN order_change_financial_contract contract ON contract.pi_id=pay.pi_id
    WHERE pay.pi_id=NEW.source_pi_id AND
      pay.amount_received_cents+pay.allocated_in_cents-
        pay.allocated_out_cents-pay.refunded_cents-pay.total_due_cents-
        contract.uninitiated_refund_cents<NEW.amount_cents
  ) THEN RAISE(ABORT,'Shipping refund reservation blocks source funds') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=109,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
