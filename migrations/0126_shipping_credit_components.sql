-- Accepted Order Change credits distinguish originally paid Sales Tax from
-- original logistics. Existing unclassified freight credits retain their meaning.
CREATE VIEW order_shipping_change_credit_components AS
SELECT e.order_id,e.id AS effective_change_id,
  coalesce(json_extract(e.after_json,'$.creditAllocation.logisticsCents'),-e.adjustment_cents) AS logistics_cents,
  coalesce(json_extract(e.after_json,'$.creditAllocation.taxCents'),0) AS tax_cents
FROM order_shipping_change_effective e WHERE e.adjustment_cents<0;
--> statement-breakpoint
DROP TRIGGER after_sales_original_logistics_credit_limit;
--> statement-breakpoint
DROP TRIGGER shipping_change_after_sales_credit_limit;
--> statement-breakpoint
CREATE TRIGGER after_sales_order_change_credit_limits
BEFORE INSERT ON after_sales_refund_authorizations BEGIN
  SELECT CASE WHEN NEW.logistics_cents +
    coalesce((SELECT sum(a.logistics_cents) FROM after_sales_effective_refund_authorizations a WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(c.logistics_cents) FROM order_shipping_change_credit_components c WHERE c.order_id=NEW.order_id),0)
    > coalesce((SELECT coalesce(json_extract(o.snapshot_json,'$.terms.charges.freight'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.insurance'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.dutiesImport'),0)
      FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Logistics credits exceed original logistics charges') END;
  SELECT CASE WHEN NEW.tax_cents +
    coalesce((SELECT sum(a.tax_cents) FROM after_sales_effective_refund_authorizations a WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(c.tax_cents) FROM order_shipping_change_credit_components c WHERE c.order_id=NEW.order_id),0)
    > coalesce((SELECT json_extract(o.snapshot_json,'$.terms.charges.salesTax') FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Tax credits exceed original Sales Tax') END;
END;
--> statement-breakpoint
CREATE TRIGGER shipping_change_after_sales_credit_limit
BEFORE INSERT ON order_shipping_change_effective WHEN NEW.adjustment_cents<0 BEGIN
  SELECT CASE WHEN json_type(NEW.after_json,'$.creditAllocation') IS NOT NULL AND (
    json_type(NEW.after_json,'$.creditAllocation.logisticsCents') IS NOT 'integer'
    OR json_type(NEW.after_json,'$.creditAllocation.taxCents') IS NOT 'integer'
    OR json_extract(NEW.after_json,'$.creditAllocation.logisticsCents')<0
    OR json_extract(NEW.after_json,'$.creditAllocation.taxCents')<0
    OR json_extract(NEW.after_json,'$.creditAllocation.logisticsCents')+
       json_extract(NEW.after_json,'$.creditAllocation.taxCents')!=-NEW.adjustment_cents)
    THEN RAISE(ABORT,'Credit components must equal the accepted adjustment') END;
  SELECT CASE WHEN coalesce(json_extract(NEW.after_json,'$.creditAllocation.logisticsCents'),-NEW.adjustment_cents) +
    coalesce((SELECT sum(a.logistics_cents) FROM after_sales_effective_refund_authorizations a WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(c.logistics_cents) FROM order_shipping_change_credit_components c WHERE c.order_id=NEW.order_id),0)
    > coalesce((SELECT coalesce(json_extract(o.snapshot_json,'$.terms.charges.freight'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.insurance'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.dutiesImport'),0)
      FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Logistics credits exceed original logistics charges') END;
  SELECT CASE WHEN coalesce(json_extract(NEW.after_json,'$.creditAllocation.taxCents'),0) +
    coalesce((SELECT sum(a.tax_cents) FROM after_sales_effective_refund_authorizations a WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(c.tax_cents) FROM order_shipping_change_credit_components c WHERE c.order_id=NEW.order_id),0)
    > coalesce((SELECT json_extract(o.snapshot_json,'$.terms.charges.salesTax') FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Tax credits exceed original Sales Tax') END;
  SELECT CASE WHEN -NEW.adjustment_cents +
    coalesce((SELECT sum(a.refund_cents) FROM after_sales_effective_refund_authorizations a WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e WHERE e.order_id=NEW.order_id AND e.adjustment_cents<0),0)
    > coalesce((SELECT total_cents FROM confirmed_orders WHERE id=NEW.order_id),0)
    THEN RAISE(ABORT,'Refunds exceed the system-tracked original payment') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=127,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
