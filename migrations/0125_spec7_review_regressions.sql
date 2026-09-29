-- Permission forms carry a version so concurrent saves cannot merge grants.
ALTER TABLE admin_identities ADD COLUMN permissions_version INTEGER NOT NULL DEFAULT 0 CHECK(permissions_version>=0);
--> statement-breakpoint
CREATE TABLE admin_permission_write_assertions(failed INTEGER);
--> statement-breakpoint
CREATE TRIGGER admin_permission_write_assertion_abort
BEFORE INSERT ON admin_permission_write_assertions BEGIN
  SELECT RAISE(ABORT,'Concurrent permission change; reload');
END;
--> statement-breakpoint
-- Record observed messages, not their send-start timestamps. Backfill only
-- existing messages covered by the former cursor; later inserts stay unread.
CREATE TABLE message_reads (
  message_id TEXT NOT NULL REFERENCES quote_conversation_messages(id),
  reader_role TEXT NOT NULL CHECK(reader_role IN ('customer','admin')),
  reader_id TEXT NOT NULL CHECK(length(trim(reader_id))>0),
  PRIMARY KEY(message_id,reader_role,reader_id)
);
--> statement-breakpoint
INSERT INTO message_reads(message_id,reader_role,reader_id)
SELECT m.id,r.reader_role,r.reader_id FROM message_thread_reads r
JOIN quote_conversation_messages m ON m.request_id=r.request_id
WHERE m.created_at<=r.last_read_at;
--> statement-breakpoint
-- Separate the frozen obligation from current approval status: a replacement
-- can require customer reconfirmation without losing its existing deadline.
ALTER TABLE after_sales_refund_authorizations ADD COLUMN commitment_json TEXT
  CHECK(commitment_json IS NULL OR json_valid(commitment_json));
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_commitment_immutable
BEFORE UPDATE OF commitment_json ON after_sales_refund_authorizations
WHEN OLD.commitment_json IS NOT NULL AND NEW.commitment_json IS NOT OLD.commitment_json BEGIN
  SELECT RAISE(ABORT,'The original refund commitment is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_original_logistics_credit_limit
BEFORE INSERT ON after_sales_refund_authorizations BEGIN
  SELECT CASE WHEN NEW.logistics_cents +
    coalesce((SELECT sum(a.logistics_cents) FROM after_sales_effective_refund_authorizations a
      WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e
      WHERE e.order_id=NEW.order_id AND e.adjustment_cents<0),0)
    > coalesce((SELECT coalesce(json_extract(o.snapshot_json,'$.terms.charges.freight'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.insurance'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.dutiesImport'),0)
      FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Logistics credits exceed original logistics charges') END;
END;
--> statement-breakpoint
-- Enforce the same entitlement when the shipping credit is written second.
CREATE TRIGGER shipping_change_after_sales_credit_limit
BEFORE INSERT ON order_shipping_change_effective WHEN NEW.adjustment_cents<0 BEGIN
  SELECT CASE WHEN -NEW.adjustment_cents +
    coalesce((SELECT sum(a.logistics_cents) FROM after_sales_effective_refund_authorizations a
      WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e
      WHERE e.order_id=NEW.order_id AND e.adjustment_cents<0),0)
    > coalesce((SELECT coalesce(json_extract(o.snapshot_json,'$.terms.charges.freight'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.insurance'),0)
        +coalesce(json_extract(o.snapshot_json,'$.terms.charges.dutiesImport'),0)
      FROM confirmed_orders o WHERE o.id=NEW.order_id),0)
    THEN RAISE(ABORT,'Logistics credits exceed original logistics charges') END;
  SELECT CASE WHEN -NEW.adjustment_cents +
    coalesce((SELECT sum(a.refund_cents) FROM after_sales_effective_refund_authorizations a
      WHERE a.order_id=NEW.order_id),0) +
    coalesce((SELECT sum(-e.adjustment_cents) FROM order_shipping_change_effective e
      WHERE e.order_id=NEW.order_id AND e.adjustment_cents<0),0)
    > coalesce((SELECT total_cents FROM confirmed_orders WHERE id=NEW.order_id),0)
    THEN RAISE(ABORT,'Refunds exceed the system-tracked original payment') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=126,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
