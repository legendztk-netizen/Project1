export async function recordOverdueReadyScheduleReminders(
  db: D1Database,
  scheduledAt: Date,
) {
  const chinaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(scheduledAt)
    .reduce<Record<string, string>>((parts, part) => {
      parts[part.type] = part.value;
      return parts;
    }, {});
  const today = `${chinaDate.year}-${chinaDate.month}-${chinaDate.day}`;
  const result = await db
    .prepare(
      `INSERT INTO admin_audit_events
         (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
       SELECT 'shipment-ready-overdue:'||ready.shipment_id||':'||ready.current_estimate_date,
         'shipment.ready_date_overdue','confirmed_order',ready.order_id,'system',
         json_object('shipmentId',ready.shipment_id,
           'estimateDate',ready.current_estimate_date,
           'scheduleVersion',ready.version,
           'requestId','cron:shipment-ready-overdue:'||?,
           'ipAddress','system'),?
       FROM order_shipment_ready_schedules ready
       JOIN order_shipments shipment ON shipment.id=ready.shipment_id
       WHERE ready.current_estimate_date<?
         AND shipment.status IN ('planned','ready_to_ship')
         AND NOT EXISTS(SELECT 1 FROM admin_audit_events event
           WHERE event.id='shipment-ready-overdue:'||ready.shipment_id||':'||ready.current_estimate_date)
       ORDER BY ready.current_estimate_date,ready.shipment_id
       LIMIT 200`,
    )
    .bind(scheduledAt.toISOString(), scheduledAt.toISOString(), today)
    .run();
  return result.meta.changes ?? 0;
}
