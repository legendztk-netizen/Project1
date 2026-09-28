import { refundInitiationDeadline } from "../domain/return-policy";

/**
 * Internal-only overdue reminders. They never approve, decline or initiate
 * anything; repeated cron runs are idempotent through the notification key.
 * Each query skips records already reminded and runs in batches until no
 * overdue record is left, so a large backlog cannot hide overdue items.
 */
export async function recordAfterSalesOverdueReminders(
  db: D1Database,
  scheduledAt: Date,
  options: { batchSize?: number } = {},
) {
  const batchSize = options.batchSize ?? 200;
  const at = scheduledAt.toISOString();
  const drain = async (statement: D1PreparedStatement) => {
    let total = 0;
    for (;;) {
      const changes = (await statement.run()).meta.changes ?? 0;
      total += changes;
      if (changes < batchSize) return total;
    }
  };
  const refunds = await drain(
    db
      .prepare(
        `INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
         SELECT 'refund-overdue:'||a.id,'refund_initiation_overdue',a.id,?
         FROM after_sales_refund_authorizations a
         WHERE a.status='approved' AND a.deadline_at<?
           AND a.refund_cents>coalesce((SELECT sum(i.amount_cents)
             FROM after_sales_refund_initiations i WHERE i.authorization_id=a.id),0)
           AND NOT EXISTS(SELECT 1 FROM admin_notifications n
             WHERE n.id='refund-overdue:'||a.id)
         ORDER BY a.deadline_at LIMIT ?`,
      )
      .bind(at, at, batchSize),
  );
  const inspections = await drain(
    db
      .prepare(
        `INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
         SELECT 'inspection-overdue:'||r.id,'return_inspection_overdue',r.id,?
         FROM after_sales_return_receipts r
         WHERE r.inspection_deadline_at<? AND NOT EXISTS(
           SELECT 1 FROM after_sales_return_decisions d WHERE d.receipt_id=r.id)
           AND NOT EXISTS(SELECT 1 FROM admin_notifications n
             WHERE n.id='inspection-overdue:'||r.id)
         ORDER BY r.inspection_deadline_at LIMIT ?`,
      )
      .bind(at, at, batchSize),
  );
  // Spec 6 shipping-change refunds keep their original reservation date. The
  // business-day deadline only grows with the reservation time, so reading
  // oldest first can stop at the first reservation that is not yet overdue.
  let reservations = 0;
  for (;;) {
    const rows = (
      await db
        .prepare(
          `SELECT r.id,r.reserved_at FROM order_shipping_change_refund_reservations r
           WHERE r.due_cents>coalesce((SELECT sum(i.amount_cents)
             FROM order_shipping_change_refund_initiations i WHERE i.reservation_id=r.id),0)
             AND NOT EXISTS(SELECT 1 FROM admin_notifications n
               WHERE n.kind='refund_initiation_overdue' AND n.source_id=r.id)
           ORDER BY r.reserved_at,r.id LIMIT ?`,
        )
        .bind(batchSize)
        .all<{ id: string; reserved_at: string }>()
    ).results;
    const overdue = rows.filter(
      (row) => refundInitiationDeadline(row.reserved_at).at < at,
    );
    if (overdue.length)
      await db.batch(
        overdue.map((row) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
               VALUES (?,'refund_initiation_overdue',?,?)`,
            )
            .bind(`shipping-refund-overdue:${row.id}`, row.id, at),
        ),
      );
    reservations += overdue.length;
    if (overdue.length < batchSize) break;
  }
  return { refunds: refunds + reservations, inspections };
}
