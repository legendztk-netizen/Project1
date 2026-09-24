export function pendingShipmentAllocationStatement(
  db: D1Database,
  orderId: string,
  source: "accepted_structured" | "reviewed_mapping",
  commandId: string | null = null,
) {
  return db
    .prepare(
      `INSERT INTO order_shipment_allocations(shipment_id,order_id,line_id,physical_quantity)
       WITH candidate AS (
         SELECT s.id AS shipment_id,s.order_id,
           json_extract(a.value,'$.lineId') AS line_id,
           json_extract(a.value,'$.physicalQuantity') AS quantity,
           sum(json_extract(a.value,'$.physicalQuantity')) OVER (
             PARTITION BY s.order_id,json_extract(a.value,'$.lineId')
             ORDER BY s.sequence_number) AS cumulative
         FROM order_shipments s
         JOIN order_fulfillment_plans p ON p.order_id=s.order_id,
           json_each(s.accepted_terms_json,'$.allocations') a
         WHERE s.order_id=? AND p.source=?
           AND NOT EXISTS(SELECT 1 FROM order_shipment_allocations current
             WHERE current.shipment_id=s.id
               AND current.line_id=json_extract(a.value,'$.lineId'))
       )
       SELECT candidate.shipment_id,candidate.order_id,candidate.line_id,candidate.quantity
       FROM candidate JOIN confirmed_order_lines l
         ON l.order_id=candidate.order_id AND l.line_id=candidate.line_id
       WHERE (? IS NULL OR EXISTS(
           SELECT 1 FROM order_shipment_plan_commands WHERE id=?))
         AND NOT EXISTS(SELECT 1 FROM order_release_guards guard
           WHERE guard.order_id=candidate.order_id AND guard.held=1)
         AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
           WHERE hold.order_id=candidate.order_id AND hold.line_id=candidate.line_id
             AND hold.shipment_id=candidate.shipment_id AND hold.active=1)
         AND candidate.cumulative
           + coalesce((SELECT sum(current.physical_quantity)
             FROM order_shipment_allocations current
             WHERE current.order_id=candidate.order_id AND current.line_id=candidate.line_id),0)
           + coalesce((SELECT sum(hold.physical_quantity)
             FROM order_quantity_holds hold
             WHERE hold.order_id=candidate.order_id AND hold.line_id=candidate.line_id
               AND hold.active=1 AND hold.shipment_id IS NULL),0)
           <= CASE WHEN l.line_kind='length_based_hose'
             THEN json_extract(l.snapshot_json,'$.lengthOrder.pieceCount')
             ELSE json_extract(l.snapshot_json,'$.quantity') END
       ON CONFLICT(shipment_id,line_id) DO NOTHING`,
    )
    .bind(orderId, source, commandId, commandId);
}

export function shipmentInitializationStatements(
  db: D1Database,
  orderId: string,
  now: string,
) {
  const physicalQuantitySql = (alias: string) =>
    `CASE WHEN ${alias}.line_kind='length_based_hose'
      THEN json_extract(${alias}.snapshot_json,'$.lengthOrder.pieceCount')
      ELSE json_extract(${alias}.snapshot_json,'$.quantity') END`;
  return [
    db
      .prepare(
        `INSERT INTO order_fulfillment_plans(order_id,status,source,source_text,created_at,updated_at)
         SELECT o.id,
           CASE WHEN NOT EXISTS(SELECT 1 FROM order_release_guards guard
               WHERE guard.order_id=o.id AND guard.held=1)
             AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
               WHERE hold.order_id=o.id AND hold.active=1)
             AND json_array_length(o.snapshot_json,'$.terms.shipmentGroups')>0 THEN 'ready'
             WHEN json_extract(o.snapshot_json,'$.terms.shipmentMode')='together'
               AND NOT EXISTS(SELECT 1 FROM order_release_guards guard
                 WHERE guard.order_id=o.id AND guard.held=1)
               AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
                 WHERE hold.order_id=o.id AND hold.active=1)
               AND EXISTS(SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=o.id)
               AND NOT EXISTS(SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=o.id
                 AND (typeof(${physicalQuantitySql("l")})!='integer' OR ${physicalQuantitySql("l")}<=0))
             THEN 'ready' ELSE 'review' END,
           CASE WHEN json_array_length(o.snapshot_json,'$.terms.shipmentGroups')>0 THEN 'accepted_structured'
             WHEN json_extract(o.snapshot_json,'$.terms.shipmentMode')='together'
               AND EXISTS(SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=o.id)
               AND NOT EXISTS(SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=o.id
                 AND (typeof(${physicalQuantitySql("l")})!='integer' OR ${physicalQuantitySql("l")}<=0))
             THEN 'accepted_together' ELSE 'historical_review' END,
           coalesce(json_extract(o.snapshot_json,'$.terms.splitPlan'),''),?,?
         FROM confirmed_orders o WHERE o.id=? ON CONFLICT(order_id) DO NOTHING`,
      )
      .bind(now, now, orderId),
    db
      .prepare(
        `INSERT INTO order_shipments(id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
         SELECT 'shipment:'||o.id||':'||json_extract(g.value,'$.id'),o.id,
           json_extract(g.value,'$.id'),CAST(g.key AS INTEGER)+1,
           json_extract(g.value,'$.label'),g.value,?,?
         FROM confirmed_orders o
         JOIN order_fulfillment_plans p ON p.order_id=o.id
         JOIN json_each(o.snapshot_json,'$.terms.shipmentGroups') g
         WHERE o.id=? AND p.source='accepted_structured'
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(now, now, orderId),
    db
      .prepare(
        `INSERT INTO order_shipments(id,order_id,group_key,sequence_number,display_name,accepted_terms_json,created_at,updated_at)
         SELECT 'shipment:'||o.id||':together',o.id,'together',1,'Ship together',
           json_object('id','together','label','Ship together',
             'freightCents',json_extract(o.snapshot_json,'$.terms.charges.freight'),
             'insuranceCents',json_extract(o.snapshot_json,'$.terms.charges.insurance'),
             'dutiesImportCents',json_extract(o.snapshot_json,'$.terms.charges.dutiesImport'),
             'transportMethod',json_extract(o.snapshot_json,'$.terms.transportMethod'),
             'incoterm',json_extract(o.snapshot_json,'$.terms.incoterm'),
             'namedPlace',json_extract(o.snapshot_json,'$.terms.namedPlace')),
           ?,?
         FROM confirmed_orders o JOIN order_fulfillment_plans p ON p.order_id=o.id
         WHERE o.id=? AND p.source='accepted_together'
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(now, now, orderId),
    pendingShipmentAllocationStatement(db, orderId, "accepted_structured"),
    db
      .prepare(
        `INSERT INTO order_shipment_allocations(shipment_id,order_id,line_id,physical_quantity)
         SELECT s.id,l.order_id,l.line_id,${physicalQuantitySql("l")}
         FROM confirmed_order_lines l JOIN order_shipments s
           ON s.order_id=l.order_id AND s.group_key='together'
         JOIN order_fulfillment_plans p ON p.order_id=l.order_id
         WHERE l.order_id=? AND p.source='accepted_together'
           AND NOT EXISTS(SELECT 1 FROM order_release_guards guard
             WHERE guard.order_id=l.order_id AND guard.held=1)
           AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
             WHERE hold.order_id=l.order_id AND hold.line_id=l.line_id AND hold.active=1)
         ON CONFLICT(shipment_id,line_id) DO NOTHING`,
      )
      .bind(orderId),
    db
      .prepare(
        `UPDATE order_fulfillment_plans SET status='ready',version=version+1,updated_at=?
         WHERE order_id=? AND status='review'
           AND source IN ('accepted_structured','accepted_together')
           AND NOT EXISTS(SELECT 1 FROM order_release_guards guard
             WHERE guard.order_id=? AND guard.held=1)
           AND NOT EXISTS(SELECT 1 FROM order_quantity_holds hold
             WHERE hold.order_id=? AND hold.active=1)
           AND EXISTS(SELECT 1 FROM order_shipments shipment WHERE shipment.order_id=?)
           AND NOT EXISTS(SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=?
             AND coalesce((SELECT sum(a.physical_quantity)
               FROM order_shipment_allocations a
               WHERE a.order_id=l.order_id AND a.line_id=l.line_id),0)
               != ${physicalQuantitySql("l")})`,
      )
      .bind(now, orderId, orderId, orderId, orderId, orderId),
    db
      .prepare(
        `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
         SELECT 'shipment-plan-resumed:'||?, 'shipment.plan_resumed','confirmed_order',?,
           'system',json_object('source','accepted_order','reason','holds_resolved'),?
         WHERE changes()=1 ON CONFLICT(id) DO NOTHING`,
      )
      .bind(orderId, orderId, now),
  ];
}
