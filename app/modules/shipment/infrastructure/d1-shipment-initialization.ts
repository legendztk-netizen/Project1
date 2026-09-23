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
           CASE WHEN json_array_length(o.snapshot_json,'$.terms.shipmentGroups')>0 THEN 'ready'
             WHEN json_extract(o.snapshot_json,'$.terms.shipmentMode')='together'
               AND NOT EXISTS(SELECT 1 FROM confirmed_order_lines l WHERE l.order_id=o.id
                 AND (typeof(${physicalQuantitySql("l")})!='integer' OR ${physicalQuantitySql("l")}<=0))
             THEN 'ready' ELSE 'review' END,
           CASE WHEN json_array_length(o.snapshot_json,'$.terms.shipmentGroups')>0 THEN 'accepted_structured'
             WHEN json_extract(o.snapshot_json,'$.terms.shipmentMode')='together'
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
         WHERE o.id=? AND p.status='ready' AND p.source='accepted_structured'
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
         WHERE o.id=? AND p.status='ready' AND p.source='accepted_together'
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(now, now, orderId),
    db
      .prepare(
        `INSERT INTO order_shipment_allocations(shipment_id,order_id,line_id,physical_quantity)
         SELECT s.id,s.order_id,json_extract(a.value,'$.lineId'),
           json_extract(a.value,'$.physicalQuantity')
         FROM order_shipments s
         JOIN order_fulfillment_plans p ON p.order_id=s.order_id,
           json_each(s.accepted_terms_json,'$.allocations') a
         WHERE s.order_id=? AND p.source='accepted_structured'
         ON CONFLICT(shipment_id,line_id) DO NOTHING`,
      )
      .bind(orderId),
    db
      .prepare(
        `INSERT INTO order_shipment_allocations(shipment_id,order_id,line_id,physical_quantity)
         SELECT s.id,l.order_id,l.line_id,${physicalQuantitySql("l")}
         FROM confirmed_order_lines l JOIN order_shipments s
           ON s.order_id=l.order_id AND s.group_key='together'
         JOIN order_fulfillment_plans p ON p.order_id=l.order_id
         WHERE l.order_id=? AND p.source='accepted_together'
         ON CONFLICT(shipment_id,line_id) DO NOTHING`,
      )
      .bind(orderId),
  ];
}
