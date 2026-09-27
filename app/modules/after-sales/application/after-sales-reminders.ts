/**
 * Internal-only overdue reminders. They never approve, decline or initiate
 * anything; repeated cron runs are idempotent through the notification key.
 */
export async function recordAfterSalesOverdueReminders(
  db: D1Database,
  scheduledAt: Date,
) {
  const at = scheduledAt.toISOString();
  const refunds = await db
    .prepare(
      `INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
       SELECT 'refund-overdue:'||a.id,'refund_initiation_overdue',a.id,?
       FROM after_sales_refund_authorizations a
       WHERE a.status='approved' AND a.deadline_at<?
         AND a.refund_cents>coalesce((SELECT sum(i.amount_cents)
           FROM after_sales_refund_initiations i WHERE i.authorization_id=a.id),0)
       ORDER BY a.deadline_at LIMIT 200`,
    )
    .bind(at, at)
    .run();
  const inspections = await db
    .prepare(
      `INSERT OR IGNORE INTO admin_notifications(id,kind,source_id,created_at)
       SELECT 'inspection-overdue:'||r.id,'return_inspection_overdue',r.id,?
       FROM after_sales_return_receipts r
       WHERE r.inspection_deadline_at<? AND NOT EXISTS(
         SELECT 1 FROM after_sales_return_decisions d WHERE d.receipt_id=r.id)
       ORDER BY r.inspection_deadline_at LIMIT 200`,
    )
    .bind(at, at)
    .run();
  return {
    refunds: refunds.meta.changes ?? 0,
    inspections: inspections.meta.changes ?? 0,
  };
}
