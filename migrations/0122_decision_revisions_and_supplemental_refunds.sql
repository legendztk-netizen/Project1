CREATE TABLE after_sales_decision_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  decision_id TEXT NOT NULL REFERENCES after_sales_return_decisions(id),
  revision_number INTEGER NOT NULL CHECK(revision_number>0),
  case_id TEXT NOT NULL REFERENCES after_sales_cases(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('approved','partially_approved','declined')),
  customer_reason TEXT NOT NULL CHECK(length(trim(customer_reason))>0),
  previous_json TEXT NOT NULL CHECK(json_valid(previous_json)),
  new_json TEXT NOT NULL CHECK(json_valid(new_json)),
  financial_effect TEXT NOT NULL CHECK(financial_effect IN ('replaced','supplemental','none','flagged')),
  authorization_id TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  UNIQUE(decision_id,revision_number)
);
--> statement-breakpoint
CREATE TRIGGER after_sales_decision_revision_sequence
BEFORE INSERT ON after_sales_decision_revisions BEGIN
  SELECT CASE WHEN NEW.revision_number!=1+coalesce((SELECT max(revision_number)
      FROM after_sales_decision_revisions WHERE decision_id=NEW.decision_id),0)
    OR NOT EXISTS(SELECT 1 FROM after_sales_return_decisions d
      WHERE d.id=NEW.decision_id AND d.case_id=NEW.case_id AND d.order_id=NEW.order_id)
    THEN RAISE(ABORT,'Decision revision is out of sequence') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_decision_revision_no_update
BEFORE UPDATE ON after_sales_decision_revisions BEGIN
  SELECT RAISE(ABORT,'Decision revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_decision_revision_no_delete
BEFORE DELETE ON after_sales_decision_revisions BEGIN
  SELECT RAISE(ABORT,'Decision revisions are append-only');
END;
--> statement-breakpoint
CREATE TABLE after_sales_decision_revision_lines (
  revision_id TEXT NOT NULL REFERENCES after_sales_decision_revisions(id),
  line_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  approved_quantity INTEGER NOT NULL CHECK(approved_quantity>=0),
  PRIMARY KEY(revision_id,line_id,shipment_id)
);
--> statement-breakpoint
CREATE TRIGGER after_sales_decision_revision_line_gate
BEFORE INSERT ON after_sales_decision_revision_lines BEGIN
  SELECT CASE WHEN NEW.approved_quantity > coalesce((SELECT i.inspected_quantity
    FROM after_sales_decision_revisions r
    JOIN after_sales_return_decisions d ON d.id=r.decision_id
    JOIN after_sales_inspection_items i ON i.receipt_id=d.receipt_id
      AND i.line_id=NEW.line_id AND i.shipment_id=NEW.shipment_id
    WHERE r.id=NEW.revision_id),0)
    THEN RAISE(ABORT,'Return Inspection Gate: revision cannot approve uninspected units') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_decision_revision_line_no_update
BEFORE UPDATE ON after_sales_decision_revision_lines BEGIN
  SELECT RAISE(ABORT,'Decision revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_decision_revision_line_no_delete
BEFORE DELETE ON after_sales_decision_revision_lines BEGIN
  SELECT RAISE(ABORT,'Decision revisions are append-only');
END;
--> statement-breakpoint
DROP TRIGGER after_sales_return_refund_gate;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_refund_gate
BEFORE INSERT ON after_sales_refund_authorizations WHEN NEW.source_kind IN ('return','supplemental') BEGIN
  SELECT CASE WHEN NEW.source_kind='return' AND NOT EXISTS(
      SELECT 1 FROM after_sales_return_decisions d
      WHERE d.id=NEW.source_id AND d.order_id=NEW.order_id AND d.outcome!='declined')
    AND NOT EXISTS(SELECT 1 FROM after_sales_decision_revisions r
      WHERE r.id=NEW.source_id AND r.order_id=NEW.order_id AND r.outcome!='declined')
    THEN RAISE(ABORT,'Return Inspection Gate: refund requires an inspected return decision') END;
  SELECT CASE WHEN NEW.source_kind='supplemental' AND (NOT EXISTS(
      SELECT 1 FROM after_sales_decision_revisions r
      WHERE r.id=NEW.source_id AND r.order_id=NEW.order_id AND r.outcome!='declined')
    OR NOT EXISTS(SELECT 1 FROM after_sales_refund_authorizations prior
      WHERE prior.id=NEW.previous_authorization_id AND prior.order_id=NEW.order_id
        AND EXISTS(SELECT 1 FROM after_sales_refund_initiations i
          WHERE i.authorization_id=prior.id)))
    THEN RAISE(ABORT,'Supplemental Refund requires a revision and an initiated prior refund') END;
END;
--> statement-breakpoint
DROP TRIGGER after_sales_return_credit_gate;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_credit_gate
BEFORE INSERT ON after_sales_refund_line_credits
WHEN EXISTS(SELECT 1 FROM after_sales_refund_authorizations a
  WHERE a.id=NEW.authorization_id AND a.source_kind IN ('return','supplemental')) BEGIN
  SELECT CASE WHEN NEW.physical_quantity > coalesce((SELECT sum(i.approved_quantity)
      FROM after_sales_refund_authorizations a
      JOIN after_sales_return_decisions d ON d.id=a.source_id
      JOIN after_sales_inspection_items i ON i.receipt_id=d.receipt_id
      WHERE a.id=NEW.authorization_id AND i.line_id=NEW.line_id),
    (SELECT sum(l.approved_quantity) FROM after_sales_refund_authorizations a
      JOIN after_sales_decision_revision_lines l ON l.revision_id=a.source_id
      WHERE a.id=NEW.authorization_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Return Inspection Gate: only received and approved units may be refunded') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=123,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
