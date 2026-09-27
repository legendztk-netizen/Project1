CREATE TABLE after_sales_cases (
  id TEXT PRIMARY KEY NOT NULL,
  case_number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  profile_id TEXT NOT NULL REFERENCES customer_profiles(id),
  reason TEXT NOT NULL CHECK(reason IN ('convenience_return','wrong_item','damaged','nonconforming','other')),
  description TEXT NOT NULL CHECK(length(trim(description))>0),
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  submission_command_id TEXT NOT NULL UNIQUE,
  submission_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX after_sales_cases_order ON after_sales_cases(order_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX after_sales_cases_status ON after_sales_cases(status,updated_at DESC,id DESC);
--> statement-breakpoint
CREATE TRIGGER after_sales_case_update_guard
BEFORE UPDATE ON after_sales_cases BEGIN
  SELECT CASE WHEN NEW.version!=OLD.version+1
    OR NEW.id!=OLD.id OR NEW.case_number!=OLD.case_number OR NEW.order_id!=OLD.order_id
    OR NEW.profile_id!=OLD.profile_id OR NEW.reason!=OLD.reason
    OR NEW.description!=OLD.description OR NEW.policy_version!=OLD.policy_version
    OR NEW.submission_command_id!=OLD.submission_command_id
    OR NEW.submission_hash!=OLD.submission_hash OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'After-sales Case facts are immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_case_no_delete
BEFORE DELETE ON after_sales_cases BEGIN
  SELECT RAISE(ABORT,'After-sales Case history is immutable');
END;
--> statement-breakpoint
CREATE TABLE after_sales_case_lines (
  case_id TEXT NOT NULL REFERENCES after_sales_cases(id),
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>0),
  product_class TEXT NOT NULL CHECK(product_class IN ('standard','cut_hose','made_to_order')),
  delivered_date_et TEXT NOT NULL,
  convenience_cutoff_at TEXT,
  line_facts_json TEXT NOT NULL CHECK(json_valid(line_facts_json)),
  PRIMARY KEY(case_id,line_id,shipment_id),
  FOREIGN KEY(order_id,line_id) REFERENCES confirmed_order_lines(order_id,line_id),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE INDEX after_sales_case_lines_scope ON after_sales_case_lines(order_id,line_id,shipment_id);
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
    coalesce((SELECT sum(l.physical_quantity) FROM after_sales_case_lines l
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
CREATE TRIGGER after_sales_case_line_no_update
BEFORE UPDATE ON after_sales_case_lines BEGIN
  SELECT RAISE(ABORT,'Case lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_case_line_no_delete
BEFORE DELETE ON after_sales_case_lines BEGIN
  SELECT RAISE(ABORT,'Case lines are immutable');
END;
--> statement-breakpoint
CREATE TABLE after_sales_case_messages (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL REFERENCES after_sales_cases(id),
  author_role TEXT NOT NULL CHECK(author_role IN ('customer','admin','system')),
  author_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK(visibility IN ('customer','internal')),
  kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message','event')),
  body TEXT NOT NULL CHECK(length(trim(body))>0),
  created_at TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_hash TEXT NOT NULL,
  CHECK(author_role='admin' OR visibility='customer')
);
--> statement-breakpoint
CREATE INDEX after_sales_case_messages_case ON after_sales_case_messages(case_id,created_at);
--> statement-breakpoint
CREATE TRIGGER after_sales_case_message_no_update
BEFORE UPDATE ON after_sales_case_messages BEGIN
  SELECT RAISE(ABORT,'Case conversation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER after_sales_case_message_no_delete
BEFORE DELETE ON after_sales_case_messages BEGIN
  SELECT RAISE(ABORT,'Case conversation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER admin_notifications_after_sales_case_opened
AFTER INSERT ON after_sales_cases BEGIN
  INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
  VALUES ('after-sales-case:'||NEW.id,'after_sales_case_opened',NEW.id,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER admin_notifications_after_sales_customer_reply
AFTER INSERT ON after_sales_case_messages
WHEN NEW.author_role='customer' AND NEW.kind='message' BEGIN
  INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
  VALUES ('after-sales-reply:'||NEW.id,'after_sales_customer_reply',NEW.id,NEW.created_at);
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=119,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
