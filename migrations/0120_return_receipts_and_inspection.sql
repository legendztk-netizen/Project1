CREATE TABLE after_sales_return_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  ra_id TEXT NOT NULL REFERENCES after_sales_return_authorizations(id),
  case_id TEXT NOT NULL REFERENCES after_sales_cases(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  received_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(length(trim(source))>0),
  package_reference TEXT,
  excess_note TEXT,
  timeliness TEXT NOT NULL CHECK(timeliness IN ('timely','late')),
  late_review_note TEXT,
  late_reviewed_by TEXT,
  late_reviewed_at TEXT,
  inspection_deadline_date_et TEXT NOT NULL,
  inspection_deadline_at TEXT NOT NULL,
  calendar_version TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  CHECK(received_at<=recorded_at)
);
--> statement-breakpoint
CREATE INDEX after_sales_return_receipts_case ON after_sales_return_receipts(case_id,received_at);
--> statement-breakpoint
CREATE TRIGGER after_sales_return_receipt_guard
BEFORE INSERT ON after_sales_return_receipts BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_return_authorizations ra
    WHERE ra.id=NEW.ra_id AND ra.case_id=NEW.case_id AND ra.order_id=NEW.order_id
      AND ra.issued_at<=NEW.received_at
      AND ((NEW.timeliness='timely' AND NEW.received_at<=ra.arrival_deadline_at)
        OR (NEW.timeliness='late' AND NEW.received_at>ra.arrival_deadline_at)))
    THEN RAISE(ABORT,'Receipt timing must match its RA') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_receipt_late_review_only
BEFORE UPDATE ON after_sales_return_receipts BEGIN
  SELECT CASE WHEN OLD.timeliness!='late' OR OLD.late_reviewed_at IS NOT NULL
    OR NEW.late_reviewed_at IS NULL OR length(trim(coalesce(NEW.late_review_note,'')))=0
    OR NEW.late_reviewed_by IS NULL
    OR NEW.id!=OLD.id OR NEW.ra_id!=OLD.ra_id OR NEW.case_id!=OLD.case_id
    OR NEW.order_id!=OLD.order_id OR NEW.received_at!=OLD.received_at
    OR NEW.recorded_at!=OLD.recorded_at OR NEW.source!=OLD.source
    OR NEW.timeliness!=OLD.timeliness
    OR NEW.inspection_deadline_at!=OLD.inspection_deadline_at
    OR NEW.command_id!=OLD.command_id
    THEN RAISE(ABORT,'Receipt facts are immutable; only a late-arrival review may be added') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_receipt_no_delete
BEFORE DELETE ON after_sales_return_receipts BEGIN
  SELECT RAISE(ABORT,'Receipt history is immutable');
END;
--> statement-breakpoint
CREATE TABLE after_sales_receipt_lines (
  receipt_id TEXT NOT NULL REFERENCES after_sales_return_receipts(id),
  ra_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>0),
  PRIMARY KEY(receipt_id,line_id,shipment_id),
  FOREIGN KEY(ra_id,line_id,shipment_id)
    REFERENCES after_sales_ra_lines(ra_id,line_id,shipment_id)
);
--> statement-breakpoint
CREATE TRIGGER after_sales_receipt_line_guard
BEFORE INSERT ON after_sales_receipt_lines BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_return_receipts r
    WHERE r.id=NEW.receipt_id AND r.ra_id=NEW.ra_id AND r.case_id=NEW.case_id)
    THEN RAISE(ABORT,'Receipt line requires its receipt') END;
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(l.physical_quantity) FROM after_sales_receipt_lines l
      WHERE l.ra_id=NEW.ra_id AND l.line_id=NEW.line_id AND l.shipment_id=NEW.shipment_id),0)
    > (SELECT physical_quantity FROM after_sales_ra_lines
      WHERE ra_id=NEW.ra_id AND line_id=NEW.line_id AND shipment_id=NEW.shipment_id)
    THEN RAISE(ABORT,'Received quantity exceeds the authorized quantity') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_receipt_line_no_update
BEFORE UPDATE ON after_sales_receipt_lines BEGIN
  SELECT RAISE(ABORT,'Receipt lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_receipt_line_no_delete
BEFORE DELETE ON after_sales_receipt_lines BEGIN
  SELECT RAISE(ABORT,'Receipt lines are immutable');
END;
--> statement-breakpoint
DROP TRIGGER after_sales_ra_line_guard;
--> statement-breakpoint
CREATE TRIGGER after_sales_ra_line_guard
BEFORE INSERT ON after_sales_ra_lines BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_return_authorizations ra
    WHERE ra.id=NEW.ra_id AND ra.case_id=NEW.case_id AND ra.order_id=NEW.order_id)
    THEN RAISE(ABORT,'RA line requires its RA') END;
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(l.physical_quantity) FROM after_sales_ra_lines l
      JOIN after_sales_return_authorizations other ON other.id=l.ra_id
      JOIN after_sales_return_authorizations current ON current.id=NEW.ra_id
      WHERE l.case_id=NEW.case_id AND l.line_id=NEW.line_id
        AND l.shipment_id=NEW.shipment_id
        AND other.arrival_deadline_at>=current.issued_at),0) +
    coalesce((SELECT sum(r.physical_quantity) FROM after_sales_receipt_lines r
      JOIN after_sales_return_authorizations other ON other.id=r.ra_id
      JOIN after_sales_return_authorizations current ON current.id=NEW.ra_id
      WHERE r.case_id=NEW.case_id AND r.line_id=NEW.line_id
        AND r.shipment_id=NEW.shipment_id
        AND other.arrival_deadline_at<current.issued_at),0)
    > coalesce((SELECT c.physical_quantity FROM after_sales_case_lines c
      WHERE c.case_id=NEW.case_id AND c.line_id=NEW.line_id
        AND c.shipment_id=NEW.shipment_id),0)
    THEN RAISE(ABORT,'RA quantity exceeds the unauthorized claimed quantity') END;
END;
--> statement-breakpoint
CREATE TABLE after_sales_inspection_items (
  receipt_id TEXT NOT NULL REFERENCES after_sales_return_receipts(id),
  line_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  inspected_quantity INTEGER NOT NULL CHECK(inspected_quantity>0),
  approved_quantity INTEGER NOT NULL CHECK(approved_quantity>=0 AND approved_quantity<=inspected_quantity),
  conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)),
  PRIMARY KEY(receipt_id,line_id,shipment_id),
  FOREIGN KEY(receipt_id,line_id,shipment_id)
    REFERENCES after_sales_receipt_lines(receipt_id,line_id,shipment_id)
);
--> statement-breakpoint
CREATE TRIGGER after_sales_inspection_item_guard
BEFORE INSERT ON after_sales_inspection_items BEGIN
  SELECT CASE WHEN NEW.inspected_quantity!=(SELECT physical_quantity
    FROM after_sales_receipt_lines WHERE receipt_id=NEW.receipt_id
      AND line_id=NEW.line_id AND shipment_id=NEW.shipment_id)
    THEN RAISE(ABORT,'Inspect every received unit of the line') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM after_sales_return_receipts r
    WHERE r.id=NEW.receipt_id AND r.timeliness='late' AND r.late_reviewed_at IS NULL)
    THEN RAISE(ABORT,'A late arrival needs an explicit review before inspection') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_inspection_item_no_update
BEFORE UPDATE ON after_sales_inspection_items BEGIN
  SELECT RAISE(ABORT,'Inspection records are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_inspection_item_no_delete
BEFORE DELETE ON after_sales_inspection_items BEGIN
  SELECT RAISE(ABORT,'Inspection records are immutable');
END;
--> statement-breakpoint
CREATE TABLE after_sales_return_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE REFERENCES after_sales_return_receipts(id),
  case_id TEXT NOT NULL REFERENCES after_sales_cases(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('approved','partially_approved','declined')),
  responsibility TEXT NOT NULL CHECK(responsibility IN ('customer','seller')),
  remedy TEXT NOT NULL CHECK(remedy IN ('refund','replacement','none')),
  customer_reason TEXT,
  internal_note TEXT,
  lines_json TEXT NOT NULL CHECK(json_valid(lines_json)),
  financial_json TEXT NOT NULL CHECK(json_valid(financial_json)),
  replacement_json TEXT CHECK(replacement_json IS NULL OR json_valid(replacement_json)),
  refund_authorization_id TEXT,
  decided_at TEXT NOT NULL,
  inspection_deadline_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  CHECK(outcome='approved' OR length(trim(coalesce(customer_reason,'')))>0),
  CHECK((remedy='replacement')=(replacement_json IS NOT NULL))
);
--> statement-breakpoint
CREATE TRIGGER after_sales_return_decision_guard
BEFORE INSERT ON after_sales_return_decisions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_return_receipts r
    WHERE r.id=NEW.receipt_id AND r.case_id=NEW.case_id AND r.order_id=NEW.order_id)
    OR NOT EXISTS(SELECT 1 FROM after_sales_inspection_items i WHERE i.receipt_id=NEW.receipt_id)
    OR EXISTS(SELECT 1 FROM after_sales_receipt_lines l WHERE l.receipt_id=NEW.receipt_id
      AND NOT EXISTS(SELECT 1 FROM after_sales_inspection_items i
        WHERE i.receipt_id=l.receipt_id AND i.line_id=l.line_id AND i.shipment_id=l.shipment_id))
    THEN RAISE(ABORT,'Return Inspection Gate: receipt and complete inspection required') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_decision_no_update
BEFORE UPDATE ON after_sales_return_decisions BEGIN
  SELECT RAISE(ABORT,'Return decisions are immutable; append a revision');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_decision_no_delete
BEFORE DELETE ON after_sales_return_decisions BEGIN
  SELECT RAISE(ABORT,'Return decisions are immutable; append a revision');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_refund_gate
BEFORE INSERT ON after_sales_refund_authorizations WHEN NEW.source_kind='return' BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_return_decisions d
    WHERE d.id=NEW.source_id AND d.order_id=NEW.order_id AND d.outcome!='declined')
    THEN RAISE(ABORT,'Return Inspection Gate: refund requires an inspected return decision') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_credit_gate
BEFORE INSERT ON after_sales_refund_line_credits
WHEN EXISTS(SELECT 1 FROM after_sales_refund_authorizations a
  WHERE a.id=NEW.authorization_id AND a.source_kind='return') BEGIN
  SELECT CASE WHEN NEW.physical_quantity > coalesce((SELECT sum(i.approved_quantity)
    FROM after_sales_refund_authorizations a
    JOIN after_sales_return_decisions d ON d.id=a.source_id
    JOIN after_sales_inspection_items i ON i.receipt_id=d.receipt_id
    WHERE a.id=NEW.authorization_id AND i.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Return Inspection Gate: only received and approved units may be refunded') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=121,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
