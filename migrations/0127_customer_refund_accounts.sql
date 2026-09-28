-- Customer-provided bank details are encrypted. Public summaries contain only a mask.
CREATE TABLE after_sales_customer_bank_accounts (
  id TEXT PRIMARY KEY NOT NULL REFERENCES after_sales_refund_destinations(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  version INTEGER NOT NULL CHECK(version>0),
  protected_details TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  UNIQUE(order_id,version)
);
--> statement-breakpoint
CREATE TRIGGER customer_bank_account_guard
BEFORE INSERT ON after_sales_customer_bank_accounts BEGIN
  SELECT CASE WHEN NEW.version != coalesce((SELECT max(version) FROM after_sales_customer_bank_accounts WHERE order_id=NEW.order_id),0)+1
    OR NOT EXISTS(SELECT 1 FROM after_sales_refund_destinations d WHERE d.id=NEW.id AND d.order_id=NEW.order_id AND d.channel='bank_transfer')
    THEN RAISE(ABORT,'Refund account changed; reload') END;
END;
--> statement-breakpoint
CREATE TRIGGER customer_bank_account_no_update
BEFORE UPDATE ON after_sales_customer_bank_accounts BEGIN
  SELECT RAISE(ABORT,'Refund accounts are versioned by replacement');
END;
--> statement-breakpoint
CREATE TRIGGER customer_bank_account_no_delete
BEFORE DELETE ON after_sales_customer_bank_accounts BEGIN
  SELECT RAISE(ABORT,'Refund account history is retained');
END;
--> statement-breakpoint
-- An old page must not record a transfer to a superseded customer account.
CREATE TRIGGER refund_latest_customer_account
BEFORE INSERT ON after_sales_refund_initiations BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM after_sales_customer_bank_accounts a
    WHERE a.id=NEW.destination_id AND a.version < (SELECT max(version) FROM after_sales_customer_bank_accounts WHERE order_id=a.order_id))
    THEN RAISE(ABORT,'Refund account changed; reload') END;
END;
--> statement-breakpoint
CREATE TRIGGER shipping_refund_latest_customer_account
BEFORE INSERT ON order_shipping_change_refund_initiation_details BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM after_sales_customer_bank_accounts a
    WHERE a.id=NEW.destination_id AND a.version < (SELECT max(version) FROM after_sales_customer_bank_accounts WHERE order_id=a.order_id))
    THEN RAISE(ABORT,'Refund account changed; reload') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=128,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
