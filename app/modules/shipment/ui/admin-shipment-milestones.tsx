import { Form } from "react-router";
import type { createShipmentMilestoneService } from "../application/shipment-milestone-service";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import "./shipment-documents.css";

export type AdminMilestone = Awaited<
  ReturnType<ReturnType<typeof createShipmentMilestoneService>["adminRead"]>
>[number];
export type AdminTracking = AdminMilestone["tracking"][number];

export function adminLateReport(item: AdminMilestone) {
  return "lateReport" in item ? item.lateReport : null;
}

function Base({ item }: { item: AdminMilestone }) {
  return (
    <>
      <input type="hidden" name="shipmentId" value={item.shipmentId} />
      <input type="hidden" name="expectedVersion" value={item.version} />
    </>
  );
}

export function MarkReadyForm({
  item,
  commandId,
  disabled,
}: {
  item: AdminMilestone;
  commandId?: string;
  disabled: boolean;
}) {
  return (
    <Form method="post" className="shipment-milestone-form">
      <Base item={item} />
      <input type="hidden" name="intent" value="milestone-ready" />
      <input type="hidden" name="commandId" value={commandId} />
      {[
        ["specificationsVerified", "已核对客户接受的规格"],
        ["quantitiesVerified", "已核对本批实物数量"],
        ["offlinePreparationVerified", "已核实线下备货及加工完成"],
        ["requiredInspectionVerified", "已核实所需检验完成"],
      ].map(([name, label]) => (
        <label key={name} className="quote-confirmation">
          <input type="checkbox" name={name} required /> {label}
        </label>
      ))}
      <button className="button button-primary" disabled={disabled}>
        确认备妥并通知客户
      </button>
    </Form>
  );
}

export function MarkShippedForm({
  item,
  commandId,
  disabled,
}: {
  item: AdminMilestone;
  commandId?: string;
  disabled: boolean;
}) {
  return (
    <Form method="post" className="shipment-milestone-form">
      <Base item={item} />
      <input type="hidden" name="intent" value="milestone-ship" />
      <input type="hidden" name="commandId" value={commandId} />
      <label>
        实际交接时间（北京时间）
        <input type="datetime-local" name="handoffLocal" required />
      </label>
      <label>
        承运商
        <input
          name="carrierName"
          maxLength={200}
          placeholder="例如：DHL Express"
          required
        />
      </label>
      <label>
        交接凭据来源
        <input
          name="source"
          maxLength={2000}
          placeholder="例如：揽收单号、签收记录或截图"
          required
        />
      </label>
      <button className="button button-primary" disabled={disabled}>
        确认发货并通知客户
      </button>
    </Form>
  );
}

export function LateHandoffForm({
  item,
  commandId,
  disabled,
}: {
  item: AdminMilestone;
  commandId?: string;
  disabled: boolean;
}) {
  return (
    <>
      <p className="order-hold-notice">
        仅适用于整批已交接且凭据覆盖本批全部分配数量。若只交接部分数量，暂勿归档整批；保留异常并核对实际批次。
      </p>
      <Form method="post" className="shipment-milestone-form">
        <Base item={item} />
        <input type="hidden" name="intent" value="milestone-report-late" />
        <input type="hidden" name="commandId" value={commandId} />
        <label>
          实际交接时间（北京时间）
          <input type="datetime-local" name="handoffLocal" required />
        </label>
        <label>
          承运商
          <input
            name="carrierName"
            maxLength={200}
            placeholder="例如：DHL Express"
            required
          />
        </label>
        <label>
          交接凭据来源
          <input
            name="source"
            maxLength={2000}
            placeholder="例如：揽收单号、签收记录或截图"
            required
          />
        </label>
        <label>
          迟录原因与冲突核查
          <input
            name="reason"
            maxLength={2000}
            placeholder="说明为何迟录"
            required
          />
        </label>
        <button className="button button-secondary" disabled={disabled}>
          保存实际交接凭据
        </button>
      </Form>
    </>
  );
}

export function LateReportPending({
  item,
  commandId,
  disabled,
}: {
  item: AdminMilestone;
  commandId?: string;
  disabled: boolean;
}) {
  const lateReport = adminLateReport(item);
  if (!lateReport || lateReport.applied) return null;
  return (
    <div className="order-hold-notice">
      <p>
        迟录交接待核查：{lateReport.carrierName} ·{" "}
        {formatPiDate(lateReport.actualAt, "admin")}
      </p>
      <p>
        {lateReport.reason} ·{" "}
        {lateReport.quantities
          .map((line) => `${line.lineId}: ${line.physicalQuantity}`)
          .join("; ")}
      </p>
      <p>归档前请确认以上数量已全部实际交接承运商。</p>
      <Form method="post">
        <Base item={item} />
        <input type="hidden" name="intent" value="milestone-apply-late" />
        <input type="hidden" name="reportId" value={lateReport.id} />
        <input type="hidden" name="commandId" value={commandId} />
        <button className="button button-primary" disabled={disabled}>
          归档实际交接并通知客户（不解除限制）
        </button>
      </Form>
    </div>
  );
}

export function MarkDeliveredForm({
  item,
  commandId,
  disabled,
}: {
  item: AdminMilestone;
  commandId?: string;
  disabled: boolean;
}) {
  return (
    <Form method="post" className="shipment-milestone-form">
      <Base item={item} />
      <input type="hidden" name="intent" value="milestone-deliver" />
      <input type="hidden" name="commandId" value={commandId} />
      <label>
        实际送达日期
        <input type="date" name="actualDate" required />
      </label>
      <label>
        承运商或客户确认来源
        <input
          name="source"
          maxLength={2000}
          placeholder="例如：揽收单号、签收记录或截图"
          required
        />
      </label>
      <button className="button button-primary" disabled={disabled}>
        确认送达并通知客户
      </button>
    </Form>
  );
}

export function TrackingForm({
  item,
  tracking,
  commandId,
  disabled,
}: {
  item: AdminMilestone;
  tracking?: AdminTracking;
  commandId?: string;
  disabled: boolean;
}) {
  return (
    <Form method="post" className="shipment-milestone-form">
      <Base item={item} />
      <input type="hidden" name="intent" value="tracking-save" />
      {tracking && (
        <input type="hidden" name="trackingId" value={tracking.id} />
      )}
      <input
        type="hidden"
        name="expectedTrackingVersion"
        value={tracking && "version" in tracking ? tracking.version : 0}
      />
      <input type="hidden" name="commandId" value={commandId} />
      <label>
        包裹名称
        <input
          name="packageLabel"
          maxLength={200}
          placeholder="例如：第 1 箱"
          defaultValue={tracking?.packageLabel}
          required
        />
      </label>
      <label>
        承运商
        <input
          name="carrierName"
          maxLength={200}
          placeholder="例如：DHL Express"
          defaultValue={tracking?.carrierName}
          required
        />
      </label>
      <label>
        追踪号码
        <input
          name="trackingNumber"
          maxLength={200}
          defaultValue={tracking?.trackingNumber ?? ""}
        />
      </label>
      <label>
        承运商追踪链接
        <input
          type="url"
          name="trackingUrl"
          pattern="https://.+"
          title="请填写以 https:// 开头的公开网址"
          placeholder="https://"
          defaultValue={tracking?.trackingUrl ?? ""}
        />
      </label>
      <label>
        预计送达日期（可选）
        <input
          type="date"
          name="estimatedArrivalDate"
          defaultValue={tracking?.estimatedArrivalDate ?? ""}
        />
      </label>
      <label>
        {tracking ? "更正原因" : "记录来源"}
        <input
          name="reason"
          maxLength={2000}
          placeholder="例如：承运商面单"
          required
        />
      </label>
      <button className="button button-secondary" disabled={disabled}>
        {tracking ? "保存更正" : "保存追踪信息"}
      </button>
    </Form>
  );
}

export function MilestoneHistory({ item }: { item: AdminMilestone }) {
  if (!item.events.length) return null;
  return (
    <ol className="shipment-milestone-history">
      {item.events.map((event) => (
        <li key={event.kind}>
          {event.kind === "ready_to_ship"
            ? "备妥"
            : event.kind === "shipped"
              ? "发货"
              : "送达"}
          {event.actualDate ? ` · ${event.actualDate}` : ""} · 记录于{" "}
          {formatPiDate(event.recordedAt, "admin")}
        </li>
      ))}
    </ol>
  );
}
