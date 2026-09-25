import type { ProformaInvoiceSnapshot } from "../../proforma-invoice/domain/proforma-invoice";
import { createChinaCalendarService } from "../application/china-calendar-service";
import {
  committedReadyDate,
  initialEstimatedReadyDate,
  validatedReadySchedule,
} from "../domain/ready-schedule";

export async function shipmentReadyScheduleInitializationStatement(
  db: D1Database,
  input: {
    piId: string;
    orderId: string;
    confirmedAt: string;
    now: string;
  },
): Promise<D1PreparedStatement> {
  const existing = await db
    .prepare("SELECT confirmed_at FROM confirmed_orders WHERE id=?")
    .bind(input.orderId)
    .first<{ confirmed_at: string }>();
  const confirmedAt = existing?.confirmed_at ?? input.confirmedAt;
  const pi = await db
    .prepare("SELECT snapshot_json FROM proforma_invoices WHERE id=?")
    .bind(input.piId)
    .first<{ snapshot_json: string }>();
  if (!pi) throw new Response("PI not found", { status: 404 });
  const snapshot = JSON.parse(pi.snapshot_json) as ProformaInvoiceSnapshot;
  const calendar = await createChinaCalendarService(db).read();
  const dates = (snapshot.terms.shipmentGroups ?? []).map((group) => {
    if (!group.readySchedule)
      return { id: group.id, date: null, version: null };
    const basis = validatedReadySchedule(group.readySchedule);
    if (basis.kind === "china_business_days" && !calendar)
      return { id: group.id, date: null, version: null };
    try {
      const computed = committedReadyDate(confirmedAt, basis, calendar);
      return {
        id: group.id,
        date: computed.date,
        version: computed.calendarVersion,
        currentDate: initialEstimatedReadyDate(
          computed.date,
          basis,
          confirmedAt,
        ),
      };
    } catch (error) {
      if (
        basis.kind === "china_business_days" &&
        error instanceof Error &&
        /calendar coverage/i.test(error.message)
      )
        return { id: group.id, date: null, version: null };
      throw error;
    }
  });
  return db
    .prepare(
      `INSERT INTO order_shipment_ready_schedules
       (shipment_id,order_id,accepted_basis_json,accepted_ready_date,
         accepted_calendar_version,current_estimate_date,current_estimate_source,
         created_at,updated_at)
       SELECT s.id,s.order_id,
         json_extract(s.accepted_terms_json,'$.readySchedule'),
         json_extract(computed.value,'$.date'),
         json_extract(computed.value,'$.version'),
         json_extract(computed.value,'$.currentDate'),
         CASE WHEN json_extract(computed.value,'$.currentDate') IS NOT NULL
           THEN 'accepted' ELSE NULL END,?,?
       FROM order_shipments s
       LEFT JOIN json_each(?) computed
         ON json_extract(computed.value,'$.id')=s.group_key
       WHERE s.order_id=?
       ON CONFLICT(shipment_id) DO NOTHING`,
    )
    .bind(input.now, input.now, JSON.stringify(dates), input.orderId);
}
