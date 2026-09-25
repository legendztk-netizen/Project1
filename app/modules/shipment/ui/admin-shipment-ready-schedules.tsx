import { Temporal } from "@js-temporal/polyfill";
import { Form } from "react-router";
import type { createShipmentReadyScheduleService } from "../application/shipment-ready-schedule-service";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import "./shipment-documents.css";

export type AdminSchedule = Awaited<
  ReturnType<ReturnType<typeof createShipmentReadyScheduleService>["adminRead"]>
>[number];

export function acceptedBasis(schedule: AdminSchedule) {
  if (schedule.fromOrderChange)
    return "此批次来自客户已接受的订单变更；原 PI 未修改。";
  if (schedule.acceptedBasis?.kind === "fixed_date")
    return `客户已接受固定日期 ${schedule.acceptedBasis.readyDate}`;
  if (schedule.acceptedBasis?.kind === "china_business_days")
    return `客户已接受：订单确认后 ${schedule.acceptedBasis.days} 个中国履约工作日`;
  return "旧订单未记录结构化约定日期；请核对原 PI 后记录当前运营预计。";
}

export function scheduleState(schedule: AdminSchedule) {
  const todayInChina = Temporal.Now.plainDateISO("Asia/Shanghai").toString();
  const editable = ["planned", "ready_to_ship"].includes(
    schedule.shipmentStatus,
  );
  const unresolved =
    schedule.acceptedBasis?.kind === "china_business_days" &&
    !schedule.acceptedReadyDate;
  return {
    editable,
    unresolved,
    overdue:
      editable &&
      schedule.currentEstimateDate !== null &&
      schedule.currentEstimateDate < todayInChina,
    missedFixedDate:
      schedule.acceptedBasis?.kind === "fixed_date" &&
      !!schedule.acceptedReadyDate &&
      !schedule.currentEstimateDate,
  };
}

function ScheduleHidden({
  schedule,
  commandId,
}: {
  schedule: AdminSchedule;
  commandId?: string;
}) {
  return (
    <>
      <input type="hidden" name="shipmentId" value={schedule.shipmentId} />
      <input type="hidden" name="expectedVersion" value={schedule.version} />
      <input
        type="hidden"
        name="expectedShipmentVersion"
        value={schedule.shipmentVersion}
      />
      <input type="hidden" name="commandId" value={commandId} />
    </>
  );
}

export function ReadyDateSummary({ schedule }: { schedule: AdminSchedule }) {
  return (
    <>
      <strong>{schedule.currentEstimateDate ?? "待核对"}</strong>
      {schedule.fromOrderChange &&
        schedule.currentEstimateSource === "operational" &&
        " · 订单变更首次约定日期"}
      {!schedule.fromOrderChange &&
        schedule.currentEstimateSource === "operational" &&
        " · 后补运营预计，非原 PI 承诺"}
      {schedule.currentEstimateSource === "revised" && " · 已修订"}
    </>
  );
}

export function ReadyDateNotices({
  schedule,
  onOpenCalendar,
}: {
  schedule: AdminSchedule;
  onOpenCalendar?: () => void;
}) {
  const { overdue, unresolved, missedFixedDate } = scheduleState(schedule);
  return (
    <>
      {overdue && (
        <p className="order-hold-notice" role="status">
          内部提醒：预计备妥日期已过，请核对实际进度并在必要时修订日期。客户状态不会自动变化。
        </p>
      )}
      {unresolved && (
        <div className="order-hold-notice" role="status">
          <p>
            约定为订单确认后{" "}
            {schedule.acceptedBasis?.kind === "china_business_days"
              ? schedule.acceptedBasis.days
              : ""}{" "}
            个中国工作日，但中国履约日历尚未覆盖这段时间，无法算出具体日期。
            请发布覆盖到位的日历，再点“按已发布日历落实约定日期”。
          </p>
          {onOpenCalendar && (
            <button
              type="button"
              className="button button-secondary"
              onClick={onOpenCalendar}
            >
              打开中国履约日历
            </button>
          )}
        </div>
      )}
      {missedFixedDate && (
        <p className="order-hold-notice" role="status">
          原固定日期在订单确认时已过。原承诺保留，须核实后填写新的当前预计日期并通知客户。
        </p>
      )}
    </>
  );
}

export function ResolveReadyDateForm({
  schedule,
  commandId,
  disabled,
}: {
  schedule: AdminSchedule;
  commandId?: string;
  disabled: boolean;
}) {
  return (
    <Form method="post" className="shipment-inline-form">
      <ScheduleHidden schedule={schedule} commandId={commandId} />
      <input type="hidden" name="intent" value="schedule-resolve" />
      <button className="button button-secondary" disabled={disabled}>
        按已发布日历落实约定日期
      </button>
    </Form>
  );
}

export function ReviseReadyDateForm({
  schedule,
  commandId,
  disabled,
}: {
  schedule: AdminSchedule;
  commandId?: string;
  disabled: boolean;
}) {
  return (
    <Form method="post" className="shipment-milestone-form">
      <ScheduleHidden schedule={schedule} commandId={commandId} />
      <input type="hidden" name="intent" value="schedule-revise" />
      <p className="shipment-form-note">
        {acceptedBasis(schedule)}
        {schedule.acceptedReadyDate &&
          ` · 原约定计算日期 ${schedule.acceptedReadyDate}`}
      </p>
      <label>
        新日期
        <input type="date" name="newDate" required />
      </label>
      <label>
        客户可见的修订原因
        <input type="text" name="reason" maxLength={2000} required />
      </label>
      <button className="button button-primary" disabled={disabled}>
        保存并通知客户
      </button>
    </Form>
  );
}

export function ReadyDateHistory({ schedule }: { schedule: AdminSchedule }) {
  return (
    <>
      <p>{acceptedBasis(schedule)}</p>
      {schedule.acceptedReadyDate && (
        <p>
          原约定计算日期：{schedule.acceptedReadyDate}
          {schedule.acceptedCalendarVersion &&
            ` · 日历版本 ${schedule.acceptedCalendarVersion}`}
        </p>
      )}
      {schedule.history.length > 0 && (
        <ol className="shipment-milestone-history">
          {schedule.history.map((revision) => (
            <li key={revision.id}>
              {formatPiDate(revision.occurredAt, "admin")} ·{" "}
              {revision.previousDate ?? "未记录"} → {revision.newDate} ·{" "}
              {revision.reason} · {revision.actorId}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
