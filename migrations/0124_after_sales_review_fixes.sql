-- Spec 7 review fixes: batch assertions for concurrent Shipment edits, PI
-- made-to-order acknowledgements in the standard-cancellation guard, a
-- Case-level cap on received quantities, release of closed Cases' unreceived
-- claims, refund holds for flagged decision revisions, and moving pre-Messages
-- Case replies into Messages.

-- Inserting a row aborts the whole batch. Commands add
-- `INSERT ... SELECT 1 WHERE <stale condition>` after a guarded write.
CREATE TABLE after_sales_batch_assertions (failed INTEGER);
--> statement-breakpoint
CREATE TRIGGER after_sales_batch_assertion_abort
BEFORE INSERT ON after_sales_batch_assertions BEGIN
  SELECT RAISE(ABORT,'Concurrent after-sales change; reload');
END;
--> statement-breakpoint
DROP TRIGGER order_cancellation_request_line_guard;
--> statement-breakpoint
CREATE TRIGGER order_cancellation_request_line_guard
BEFORE INSERT ON order_cancellation_request_lines BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM order_cancellation_requests request
    JOIN order_quantity_holds hold ON hold.id=NEW.hold_id
    WHERE request.id=NEW.request_id AND request.order_id=NEW.order_id
      AND request.status='pending_review'
      AND hold.active=1 AND hold.kind='cancellation'
      AND hold.order_id=NEW.order_id AND hold.line_id=NEW.line_id
      AND hold.shipment_id IS NEW.shipment_id
      AND hold.physical_quantity=NEW.physical_quantity
  ) THEN RAISE(ABORT,'Cancellation line requires its own active hold') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM order_cancellation_requests request
    JOIN confirmed_order_lines line
      ON line.order_id=NEW.order_id AND line.line_id=NEW.line_id
    WHERE request.id=NEW.request_id AND request.kind='standard'
      AND (line.line_kind!='standard'
        OR coalesce(json_extract(line.snapshot_json,'$.madeToOrder'),0)!=0)
  ) OR EXISTS(
    SELECT 1 FROM order_cancellation_requests request
    JOIN confirmed_orders o ON o.id=request.order_id
    JOIN json_each(o.snapshot_json,'$.conditions.madeToOrderAcknowledgements') ack
    WHERE request.id=NEW.request_id AND request.kind='standard'
      AND json_extract(ack.value,'$.lineId')=NEW.line_id
  ) THEN RAISE(ABORT,'Standard cancellation excludes made-to-order lines') END;
  SELECT CASE WHEN NEW.shipment_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM shipment_dispatch_quantities dispatched
    WHERE dispatched.shipment_id=NEW.shipment_id
  ) THEN RAISE(ABORT,'Handed-off quantities cannot be cancelled') END;
END;
--> statement-breakpoint
-- Receipts on an expired RA and on its reauthorization share the Case claim.
CREATE TRIGGER after_sales_receipt_line_case_cap
BEFORE INSERT ON after_sales_receipt_lines BEGIN
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(l.physical_quantity) FROM after_sales_receipt_lines l
      WHERE l.case_id=NEW.case_id AND l.line_id=NEW.line_id
        AND l.shipment_id=NEW.shipment_id),0)
    > coalesce((SELECT c.physical_quantity FROM after_sales_case_lines c
      WHERE c.case_id=NEW.case_id AND c.line_id=NEW.line_id
        AND c.shipment_id=NEW.shipment_id),0)
    THEN RAISE(ABORT,'Received quantity exceeds the claimed quantity') END;
END;
--> statement-breakpoint
-- An open Case holds its whole claim; a closed Case keeps only what was
-- actually received, so a later report can cover the rest.
DROP TRIGGER after_sales_case_line_guard;
--> statement-breakpoint
CREATE TRIGGER after_sales_case_line_guard
BEFORE INSERT ON after_sales_case_lines BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_cases c
    WHERE c.id=NEW.case_id AND c.order_id=NEW.order_id AND c.status='open')
    THEN RAISE(ABORT,'Case line requires its open Case') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM shipment_milestone_events e
    WHERE e.shipment_id=NEW.shipment_id AND e.order_id=NEW.order_id
      AND e.kind='delivered' AND e.actual_date=NEW.delivered_date_et)
    THEN RAISE(ABORT,'Actual delivery is required for an after-sales claim') END;
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(CASE WHEN c.status='open' THEN l.physical_quantity
        ELSE min(l.physical_quantity,coalesce((SELECT sum(r.physical_quantity)
          FROM after_sales_receipt_lines r WHERE r.case_id=l.case_id
            AND r.line_id=l.line_id AND r.shipment_id=l.shipment_id),0)) END)
      FROM after_sales_case_lines l JOIN after_sales_cases c ON c.id=l.case_id
      WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id
        AND l.shipment_id=NEW.shipment_id),0)
    > coalesce((SELECT sum(d.physical_quantity) FROM shipment_dispatch_quantities d
      WHERE d.shipment_id=NEW.shipment_id AND d.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Claimed quantity exceeds delivered quantity') END;
  SELECT CASE WHEN (SELECT reason FROM after_sales_cases WHERE id=NEW.case_id)='convenience_return'
    AND (NEW.product_class!='standard' OR NEW.convenience_cutoff_at IS NULL)
    THEN RAISE(ABORT,'Convenience return excludes made-to-order and cut products') END;
END;
--> statement-breakpoint
-- A flagged decision revision holds the uninitiated remainder of the
-- existing refund until a later revision settles it.
CREATE TABLE after_sales_refund_holds (
  authorization_id TEXT NOT NULL REFERENCES after_sales_refund_authorizations(id),
  revision_id TEXT NOT NULL REFERENCES after_sales_decision_revisions(id),
  created_at TEXT NOT NULL,
  released_revision_id TEXT REFERENCES after_sales_decision_revisions(id),
  released_at TEXT,
  PRIMARY KEY(authorization_id,revision_id),
  CHECK((released_revision_id IS NULL)=(released_at IS NULL))
);
--> statement-breakpoint
CREATE INDEX after_sales_refund_holds_active
ON after_sales_refund_holds(authorization_id) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_hold_release_only
BEFORE UPDATE ON after_sales_refund_holds BEGIN
  SELECT CASE WHEN OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
    OR NEW.authorization_id!=OLD.authorization_id OR NEW.revision_id!=OLD.revision_id
    OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'A refund hold is released once') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_hold_no_delete
BEFORE DELETE ON after_sales_refund_holds BEGIN
  SELECT RAISE(ABORT,'Refund hold history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_refund_initiation_hold
BEFORE INSERT ON after_sales_refund_initiations BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM after_sales_refund_holds h
    WHERE h.authorization_id=NEW.authorization_id AND h.released_at IS NULL)
    THEN RAISE(ABORT,'Refund is on hold pending the revised decision review') END;
END;
--> statement-breakpoint
-- Pre-Messages Case replies continue in Messages, labelled with their Case;
-- Admin-only replies become internal notes on the Case.
INSERT OR IGNORE INTO quote_conversations(request_id,created_at)
SELECT o.request_id,min(m.created_at)
FROM after_sales_case_messages m
JOIN after_sales_cases c ON c.id=m.case_id
JOIN confirmed_orders o ON o.id=c.order_id
WHERE m.kind='message' AND m.visibility='customer'
GROUP BY o.request_id;
--> statement-breakpoint
INSERT OR IGNORE INTO quote_conversation_messages
  (id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,
   source,delivery_state)
SELECT 'case-message:'||m.id,o.request_id,
  CASE WHEN m.author_role='customer' THEN 'customer' ELSE 'admin' END,
  m.author_id,substr(m.body,1,10000),m.created_at,'case-message:'||m.command_id,
  m.command_hash,'website','available'
FROM after_sales_case_messages m
JOIN after_sales_cases c ON c.id=m.case_id
JOIN confirmed_orders o ON o.id=c.order_id
WHERE m.kind='message' AND m.visibility='customer';
--> statement-breakpoint
INSERT OR IGNORE INTO message_case_topics(message_id,case_id)
SELECT 'case-message:'||m.id,m.case_id
FROM after_sales_case_messages m
WHERE m.kind='message' AND m.visibility='customer';
--> statement-breakpoint
INSERT OR IGNORE INTO message_internal_notes
  (id,request_id,case_id,admin_id,body,created_at,command_id,command_hash)
SELECT 'case-note:'||m.id,o.request_id,m.case_id,m.author_id,
  substr(m.body,1,5000),m.created_at,'case-note:'||m.command_id,m.command_hash
FROM after_sales_case_messages m
JOIN after_sales_cases c ON c.id=m.case_id
JOIN confirmed_orders o ON o.id=c.order_id
WHERE m.kind='message' AND m.visibility='internal';
--> statement-breakpoint
UPDATE application_schema_state SET version=125,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
