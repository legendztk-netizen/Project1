CREATE TABLE after_sales_refund_destinations (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  purchasing_context_id TEXT NOT NULL REFERENCES customer_purchasing_contexts(id),
  channel TEXT NOT NULL CHECK(channel IN ('bank_transfer','paypal')),
  kind TEXT NOT NULL CHECK(kind IN ('original_channel','alternative')),
  label TEXT NOT NULL CHECK(length(trim(label))>0),
  holder_name TEXT NOT NULL CHECK(length(trim(holder_name))>0),
  institution TEXT NOT NULL CHECK(length(trim(institution))>0),
  account_last4 TEXT CHECK(account_last4 IS NULL OR account_last4 GLOB '[0-9A-Za-z][0-9A-Za-z][0-9A-Za-z][0-9A-Za-z]'),
  same_purchasing_context INTEGER NOT NULL CHECK(same_purchasing_context IN (0,1)),
  verification_evidence TEXT NOT NULL CHECK(length(trim(verification_evidence))>0),
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  CHECK(kind='alternative' OR same_purchasing_context=1)
);
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_destination_guard
BEFORE INSERT ON after_sales_refund_destinations BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM confirmed_orders o
    WHERE o.id=NEW.order_id AND o.purchasing_context_id=NEW.purchasing_context_id)
    THEN RAISE(ABORT,'Destination must belong to the Order Purchasing Context') END;
  SELECT CASE WHEN NEW.kind='original_channel' AND NOT EXISTS(
    SELECT 1 FROM confirmed_orders o
    JOIN pi_payment_confirmations c ON c.id=o.confirmation_id
    WHERE o.id=NEW.order_id AND c.actual_channel=NEW.channel)
    THEN RAISE(ABORT,'Original-channel destination must match the actual receipt channel') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_destination_no_update
BEFORE UPDATE ON after_sales_refund_destinations BEGIN
  SELECT RAISE(ABORT,'Refund destinations are versioned by replacement');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_destination_no_delete
BEFORE DELETE ON after_sales_refund_destinations BEGIN
  SELECT RAISE(ABORT,'Refund destinations are retained');
END;
--> statement-breakpoint
CREATE TABLE after_sales_destination_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  destination_id TEXT NOT NULL REFERENCES after_sales_refund_destinations(id),
  refund_kind TEXT NOT NULL CHECK(refund_kind IN ('after_sales','shipping')),
  refund_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  approved_by TEXT NOT NULL,
  approver_account_type TEXT NOT NULL CHECK(approver_account_type='owner'),
  approved_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  UNIQUE(destination_id,refund_kind,refund_id)
);
--> statement-breakpoint
CREATE TRIGGER after_sales_destination_approval_owner
BEFORE INSERT ON after_sales_destination_approvals BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_refund_destinations d
    WHERE d.id=NEW.destination_id AND d.kind='alternative')
    THEN RAISE(ABORT,'Approval applies to an alternative destination') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_destination_approval_no_update
BEFORE UPDATE ON after_sales_destination_approvals BEGIN
  SELECT RAISE(ABORT,'Destination approvals are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_destination_approval_no_delete
BEFORE DELETE ON after_sales_destination_approvals BEGIN
  SELECT RAISE(ABORT,'Destination approvals are immutable');
END;
--> statement-breakpoint
ALTER TABLE after_sales_refund_initiations ADD COLUMN reason TEXT;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_initiation_guard
BEFORE INSERT ON after_sales_refund_initiations BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_refund_authorizations a
    WHERE a.id=NEW.authorization_id AND a.order_id=NEW.order_id AND a.status='approved')
    THEN RAISE(ABORT,'Only an approved refund can be initiated') END;
  SELECT CASE WHEN NEW.amount_cents + coalesce((SELECT sum(i.amount_cents)
      FROM after_sales_refund_initiations i WHERE i.authorization_id=NEW.authorization_id),0)
    > (SELECT refund_cents FROM after_sales_refund_authorizations WHERE id=NEW.authorization_id)
    THEN RAISE(ABORT,'Refund initiation exceeds the authorized amount') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_refund_destinations d
      WHERE d.id=NEW.destination_id AND d.order_id=NEW.order_id AND d.channel=NEW.channel
        AND (d.kind='original_channel' OR EXISTS(SELECT 1 FROM after_sales_destination_approvals ap
          WHERE ap.destination_id=d.id AND ap.refund_kind='after_sales'
            AND ap.refund_id=NEW.authorization_id)))
    THEN RAISE(ABORT,'A verified destination (or Owner-approved alternative) is required') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM confirmed_orders o
    JOIN pi_payment_accounts pay ON pay.pi_id=o.pi_id
    JOIN order_change_financial_contract contract ON contract.order_id=o.id
    WHERE o.id=NEW.order_id AND pay.confirmation_valid=1
      AND pay.amount_received_cents+pay.allocated_in_cents-
        pay.allocated_out_cents-pay.refunded_cents-
        (contract.original_due_cents-contract.authorized_credit_cents)
        >= NEW.amount_cents
  ) THEN RAISE(ABORT,'No verified original funds for this refund') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_initiation_account_update
AFTER INSERT ON after_sales_refund_initiations BEGIN
  UPDATE pi_payment_accounts SET refunded_cents=refunded_cents+NEW.amount_cents,
    version=version+1,updated_at=NEW.recorded_at
  WHERE pi_id=(SELECT pi_id FROM confirmed_orders WHERE id=NEW.order_id);
END;
--> statement-breakpoint
CREATE TABLE order_shipping_change_refund_initiation_details (
  initiation_id TEXT PRIMARY KEY NOT NULL REFERENCES order_shipping_change_refund_initiations(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  channel TEXT NOT NULL CHECK(channel IN ('bank_transfer','paypal')),
  destination_id TEXT NOT NULL REFERENCES after_sales_refund_destinations(id),
  initiated_date_et TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_refund_initiation_detail_guard
BEFORE INSERT ON order_shipping_change_refund_initiation_details BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_refund_destinations d
      JOIN order_shipping_change_refund_initiations i ON i.id=NEW.initiation_id
      WHERE d.id=NEW.destination_id AND d.order_id=NEW.order_id AND d.channel=NEW.channel
        AND (d.kind='original_channel' OR EXISTS(SELECT 1 FROM after_sales_destination_approvals ap
          WHERE ap.destination_id=d.id AND ap.refund_kind='shipping'
            AND ap.refund_id=i.reservation_id)))
    THEN RAISE(ABORT,'A verified destination (or Owner-approved alternative) is required') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_shipping_change_refund_initiation_detail_immutable
BEFORE UPDATE ON order_shipping_change_refund_initiation_details BEGIN
  SELECT RAISE(ABORT,'Refund initiation is immutable');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=122,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
