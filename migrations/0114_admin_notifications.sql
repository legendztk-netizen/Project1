CREATE TABLE admin_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('rfq_submitted','shipping_change_requested')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(kind,source_id)
);
--> statement-breakpoint
CREATE INDEX admin_notifications_created ON admin_notifications(created_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE admin_notification_reads (
  notification_id TEXT NOT NULL REFERENCES admin_notifications(id),
  admin_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY(notification_id,admin_id)
);
--> statement-breakpoint
CREATE TRIGGER admin_notifications_rfq_submitted AFTER INSERT ON customer_quote_requests BEGIN
  INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
  VALUES ('rfq:'||NEW.id,'rfq_submitted',NEW.id,NEW.submitted_at);
END;
--> statement-breakpoint
CREATE TRIGGER admin_notifications_shipping_change_requested AFTER INSERT ON order_shipping_change_requests BEGIN
  INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
  VALUES ('shipping-change:'||NEW.id,'shipping_change_requested',NEW.id,NEW.created_at);
END;
--> statement-breakpoint
INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
SELECT 'shipping-change:'||c.id,'shipping_change_requested',c.id,c.created_at
FROM order_shipping_change_requests c
WHERE c.status='pending_review';
--> statement-breakpoint
INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
SELECT 'rfq:'||r.id,'rfq_submitted',r.id,r.submitted_at
FROM customer_quote_requests r
WHERE NOT EXISTS(SELECT 1 FROM quote_revisions q WHERE q.request_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM quote_preparation_drafts d WHERE d.request_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM confirmed_orders o WHERE o.request_id=r.id);
--> statement-breakpoint
UPDATE application_schema_state SET version=115,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
