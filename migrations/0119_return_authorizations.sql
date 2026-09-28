CREATE TABLE after_sales_return_authorizations (
  id TEXT PRIMARY KEY NOT NULL,
  ra_number TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL REFERENCES after_sales_cases(id),
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  location_id TEXT NOT NULL,
  location_snapshot_json TEXT NOT NULL CHECK(json_valid(location_snapshot_json)),
  instructions TEXT NOT NULL CHECK(length(trim(instructions))>0),
  issued_at TEXT NOT NULL,
  arrival_deadline_date_et TEXT NOT NULL,
  arrival_deadline_at TEXT NOT NULL,
  previous_ra_id TEXT REFERENCES after_sales_return_authorizations(id),
  review_note TEXT,
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  CHECK(previous_ra_id IS NULL OR length(trim(coalesce(review_note,'')))>0)
);
--> statement-breakpoint
CREATE INDEX after_sales_return_authorizations_case ON after_sales_return_authorizations(case_id,issued_at);
--> statement-breakpoint
CREATE TRIGGER after_sales_return_authorization_guard
BEFORE INSERT ON after_sales_return_authorizations BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM after_sales_cases c
    WHERE c.id=NEW.case_id AND c.order_id=NEW.order_id AND c.status='open')
    THEN RAISE(ABORT,'RA requires an open After-sales Case') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM seller_return_locations l
    WHERE l.id=NEW.location_id
      AND json_extract(NEW.location_snapshot_json,'$.address')=l.address
      AND json_extract(NEW.location_snapshot_json,'$.phone')=l.phone)
    THEN RAISE(ABORT,'RA must freeze the current maintained Return Location') END;
  SELECT CASE WHEN NEW.previous_ra_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM after_sales_return_authorizations p
    WHERE p.id=NEW.previous_ra_id AND p.case_id=NEW.case_id
      AND p.arrival_deadline_at<NEW.issued_at)
    THEN RAISE(ABORT,'Reauthorization follows an expired RA of the same Case') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_authorization_no_update
BEFORE UPDATE ON after_sales_return_authorizations BEGIN
  SELECT RAISE(ABORT,'Issued RA is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_return_authorization_no_delete
BEFORE DELETE ON after_sales_return_authorizations BEGIN
  SELECT RAISE(ABORT,'Issued RA is immutable');
END;
--> statement-breakpoint
CREATE TABLE after_sales_ra_lines (
  ra_id TEXT NOT NULL REFERENCES after_sales_return_authorizations(id),
  case_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>0),
  PRIMARY KEY(ra_id,line_id,shipment_id),
  FOREIGN KEY(case_id,line_id,shipment_id)
    REFERENCES after_sales_case_lines(case_id,line_id,shipment_id)
);
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
        AND other.arrival_deadline_at>=current.issued_at),0)
    > coalesce((SELECT c.physical_quantity FROM after_sales_case_lines c
      WHERE c.case_id=NEW.case_id AND c.line_id=NEW.line_id
        AND c.shipment_id=NEW.shipment_id),0)
    THEN RAISE(ABORT,'RA quantity exceeds the unauthorized claimed quantity') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_ra_line_no_update
BEFORE UPDATE ON after_sales_ra_lines BEGIN
  SELECT RAISE(ABORT,'RA lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_ra_line_no_delete
BEFORE DELETE ON after_sales_ra_lines BEGIN
  SELECT RAISE(ABORT,'RA lines are immutable');
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=120,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
