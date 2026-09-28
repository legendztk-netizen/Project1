-- The encrypted account store also accepts customer-provided PayPal accounts.
DROP TRIGGER customer_bank_account_guard;
--> statement-breakpoint
CREATE TRIGGER customer_bank_account_guard
BEFORE INSERT ON after_sales_customer_bank_accounts BEGIN
  SELECT CASE WHEN NEW.version != coalesce((SELECT max(version) FROM after_sales_customer_bank_accounts WHERE order_id=NEW.order_id),0)+1
    OR NOT EXISTS(SELECT 1 FROM after_sales_refund_destinations d WHERE d.id=NEW.id AND d.order_id=NEW.order_id AND d.channel IN ('bank_transfer','paypal'))
    THEN RAISE(ABORT,'Refund account changed; reload') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=129,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
