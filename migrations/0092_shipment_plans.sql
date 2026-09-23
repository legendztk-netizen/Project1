CREATE TABLE order_fulfillment_plans (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES confirmed_orders(id),
  status TEXT NOT NULL CHECK(status IN ('ready','review')),
  source TEXT NOT NULL CHECK(source IN ('accepted_structured','accepted_together','historical_review','reviewed_mapping')),
  source_text TEXT NOT NULL,
  review_note TEXT,
  reviewed_by TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE order_shipments (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  group_key TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK(sequence_number>0),
  display_name TEXT NOT NULL,
  accepted_terms_json TEXT NOT NULL CHECK(json_valid(accepted_terms_json)),
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','ready_to_ship','shipped','delivered')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id,id),
  UNIQUE(order_id,group_key),
  UNIQUE(order_id,sequence_number)
);
--> statement-breakpoint
CREATE TABLE order_shipment_allocations (
  shipment_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>0),
  PRIMARY KEY(shipment_id,line_id),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id),
  FOREIGN KEY(order_id,line_id) REFERENCES confirmed_order_lines(order_id,line_id)
);
--> statement-breakpoint
CREATE TABLE order_quantity_holds (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  shipment_id TEXT,
  physical_quantity INTEGER NOT NULL CHECK(physical_quantity>0),
  kind TEXT NOT NULL CHECK(kind IN ('shipping_change','cancellation','after_sales')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(order_id,line_id) REFERENCES confirmed_order_lines(order_id,line_id),
  FOREIGN KEY(order_id,shipment_id) REFERENCES order_shipments(order_id,id)
);
--> statement-breakpoint
CREATE TABLE order_shipment_plan_commands (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES confirmed_orders(id),
  actor_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resulting_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX order_shipments_order ON order_shipments(order_id,sequence_number);
--> statement-breakpoint
CREATE INDEX order_shipment_allocations_line ON order_shipment_allocations(order_id,line_id);
--> statement-breakpoint
CREATE INDEX order_quantity_holds_active ON order_quantity_holds(order_id,line_id,active);
--> statement-breakpoint
CREATE TRIGGER order_shipment_allocation_guard BEFORE INSERT ON order_shipment_allocations BEGIN
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(a.physical_quantity) FROM order_shipment_allocations a
      WHERE a.order_id=NEW.order_id AND a.line_id=NEW.line_id),0) +
    coalesce((SELECT sum(h.physical_quantity) FROM order_quantity_holds h
      WHERE h.order_id=NEW.order_id AND h.line_id=NEW.line_id AND h.active=1 AND h.shipment_id IS NULL),0)
    > coalesce((SELECT CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END
       FROM confirmed_order_lines l WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Shipment allocation exceeds physical quantity') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_quantity_hold_guard BEFORE INSERT ON order_quantity_holds BEGIN
  SELECT CASE WHEN NEW.physical_quantity +
    coalesce((SELECT sum(h.physical_quantity) FROM order_quantity_holds h
      WHERE h.order_id=NEW.order_id AND h.line_id=NEW.line_id AND h.active=1),0)
    > coalesce((SELECT CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END
       FROM confirmed_order_lines l WHERE l.order_id=NEW.order_id AND l.line_id=NEW.line_id),0)
    THEN RAISE(ABORT,'Quantity hold exceeds purchased physical quantity') END;
END;
--> statement-breakpoint
INSERT INTO order_fulfillment_plans(order_id,status,source,source_text,version,created_at,updated_at)
SELECT o.id,
  CASE WHEN json_extract(o.snapshot_json,'$.terms.shipmentMode')='together'
    AND NOT EXISTS(SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=o.id
      AND (typeof(CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END)!='integer'
        OR coalesce(CASE WHEN l.line_kind='length_based_hose'
          THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
          ELSE json_extract(l.snapshot_json,'$.quantity') END,0)<=0))
    THEN 'ready' ELSE 'review' END,
  CASE WHEN json_extract(o.snapshot_json,'$.terms.shipmentMode')='together'
    AND NOT EXISTS(SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=o.id
      AND (typeof(CASE WHEN l.line_kind='length_based_hose'
        THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
        ELSE json_extract(l.snapshot_json,'$.quantity') END)!='integer'
        OR coalesce(CASE WHEN l.line_kind='length_based_hose'
          THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
          ELSE json_extract(l.snapshot_json,'$.quantity') END,0)<=0))
    THEN 'accepted_together' ELSE 'historical_review' END,
  coalesce(json_extract(o.snapshot_json,'$.terms.splitPlan'),''),1,o.confirmed_at,o.confirmed_at
FROM confirmed_orders o
WHERE 1=1
ON CONFLICT(order_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO order_shipments(id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
SELECT 'shipment:'||o.id||':together',o.id,'together',1,'Ship together',
  json_object('id','together','label','Ship together',
    'freightCents',json_extract(o.snapshot_json,'$.terms.charges.freight'),
    'insuranceCents',json_extract(o.snapshot_json,'$.terms.charges.insurance'),
    'dutiesImportCents',json_extract(o.snapshot_json,'$.terms.charges.dutiesImport'),
    'transportMethod',json_extract(o.snapshot_json,'$.terms.transportMethod'),
    'incoterm',json_extract(o.snapshot_json,'$.terms.incoterm'),
    'namedPlace',json_extract(o.snapshot_json,'$.terms.namedPlace')),
  o.confirmed_at,o.confirmed_at
FROM confirmed_orders o JOIN order_fulfillment_plans p ON p.order_id=o.id
WHERE p.status='ready' AND p.source='accepted_together'
ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO order_shipment_allocations(shipment_id,order_id,line_id,physical_quantity)
SELECT s.id,l.order_id,l.line_id,
  CASE WHEN l.line_kind='length_based_hose'
    THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
    ELSE json_extract(l.snapshot_json,'$.quantity') END
FROM confirmed_order_lines l JOIN order_shipments s ON s.order_id=l.order_id AND s.group_key='together'
ON CONFLICT(shipment_id,line_id) DO NOTHING;
--> statement-breakpoint
UPDATE application_schema_state SET version=93,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
