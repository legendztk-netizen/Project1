import { Temporal } from "@js-temporal/polyfill";
import { Form, Link } from "react-router";
import type { createShipmentReadyScheduleService } from "../application/shipment-ready-schedule-service";
import "./shipment-documents.css";

type Schedule = Awaited<
  ReturnType<ReturnType<typeof createShipmentReadyScheduleService>["adminRead"]>
>[number];

function acceptedBasis(schedule: Schedule) {
  if (schedule.acceptedBasis?.kind === "fixed_date")
    return `客户已接受固定日期 ${schedule.acceptedBasis.readyDate}`;
  if (schedule.acceptedBasis?.kind === "china_business_days")
    return `客户已接受：订单确认后 ${schedule.acceptedBasis.days} 个中国履约工作日`;
  return "旧订单未记录结构化约定日期；请核对原 PI 后记录当前运营预计。";
}

export function AdminShipmentReadySchedules({
  schedules,
  commandIds,
  busy,
  error,
}: {
  schedules: Schedule[];
  commandIds: Record<string, string>;
  busy: boolean;
  error?: string;
}) {
  if (!schedules.length) return null;
  const todayInChina = Temporal.Now.plainDateISO("Asia/Shanghai").toString();
  return (
    <section className="shipment-ready-schedules">
      <h3>预计备妥日期</h3>
      <p>
        日期以客户已接受的依据和已发布中国履约日历为准。日历修订不会自动更改已有承诺。
      </p>
      <Link to="/admin/china-calendar">管理中国履约日历</Link>
      {error && <p role="alert">{error}</p>}
      <div className="shipment-schedule-list">
        {schedules.map((schedule) => {
          const editable = ["planned", "ready_to_ship"].includes(
            schedule.shipmentStatus,
          );
          const unresolved =
            schedule.acceptedBasis?.kind === "china_business_days" &&
            !schedule.acceptedReadyDate;
          const overdue =
            editable &&
            schedule.currentEstimateDate !== null &&
            schedule.currentEstimateDate < todayInChina;
          const hidden = (
            <>
              <input
                type="hidden"
                name="shipmentId"
                value={schedule.shipmentId}
              />
              <input
                type="hidden"
                name="expectedVersion"
                value={schedule.version}
              />
              <input
                type="hidden"
                name="expectedShipmentVersion"
                value={schedule.shipmentVersion}
              />
              <input
                type="hidden"
                name="commandId"
                value={commandIds[schedule.shipmentId]}
              />
            </>
          );
          return (
            <article key={schedule.shipmentId}>
              <h4>{schedule.displayName}</h4>
              <p>{acceptedBasis(schedule)}</p>
              {schedule.acceptedReadyDate && (
                <p>
                  原约定计算日期：{schedule.acceptedReadyDate}
                  {schedule.acceptedCalendarVersion &&
                    ` · 日历版本 ${schedule.acceptedCalendarVersion}`}
                </p>
              )}
              <p>
                当前预计备妥日期：
                <strong>{schedule.currentEstimateDate ?? "待核对"}</strong>
                {schedule.currentEstimateSource === "operational" &&
                  " · 后补运营预计，非原 PI 承诺"}
                {schedule.currentEstimateSource === "revised" && " · 已修订"}
              </p>
              {overdue && (
                <p className="order-hold-notice" role="status">
                  内部提醒：预计备妥日期已过，请核对实际进度并在必要时修订日期。客户状态不会自动变化。
                </p>
              )}
              {unresolved && (
                <p role="status">
                  约定天数已保留，但日历覆盖尚未落实；不能推定具体日期。
                </p>
              )}
              {unresolved && editable && (
                <Form method="post" className="shipment-schedule-actions">
                  {hidden}
                  <input type="hidden" name="intent" value="schedule-resolve" />
                  <button className="button button-primary" disabled={busy}>
                    按已发布日历落实约定日期
                  </button>
                </Form>
              )}
              {!unresolved && editable && (
                <details>
                  <summary>修订当前预计日期</summary>
                  <Form method="post" className="shipment-schedule-actions">
                    {hidden}
                    <input
                      type="hidden"
                      name="intent"
                      value="schedule-revise"
                    />
                    <label>
                      新日期
                      <input type="date" name="newDate" required />
                    </label>
                    <label>
                      客户可见的修订原因
                      <input
                        type="text"
                        name="reason"
                        minLength={10}
                        maxLength={2000}
                        required
                      />
                    </label>
                    <button className="button button-primary" disabled={busy}>
                      保存并通知客户
                    </button>
                  </Form>
                </details>
              )}
              {schedule.history.length > 0 && (
                <details>
                  <summary>
                    查看日期修订记录（{schedule.history.length}）
                  </summary>
                  <ol>
                    {schedule.history.map((revision) => (
                      <li key={revision.id}>
                        {revision.occurredAt} ·{" "}
                        {revision.previousDate ?? "未记录"} → {revision.newDate}{" "}
                        · {revision.reason} · {revision.actorId}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
