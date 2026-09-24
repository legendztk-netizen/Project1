import { Form } from "react-router";
import type { createShipmentMilestoneService } from "../application/shipment-milestone-service";
import "./shipment-documents.css";

type Milestone = Awaited<
  ReturnType<ReturnType<typeof createShipmentMilestoneService>["adminRead"]>
>[number];

export function AdminShipmentMilestones({
  milestones,
  commands,
  trackingCommands,
  heldShipmentIds,
  planReady,
  busy,
  error,
}: {
  milestones: Milestone[];
  commands: Record<string, Record<string, string>>;
  trackingCommands: Record<string, string>;
  heldShipmentIds: string[];
  planReady: boolean;
  busy: boolean;
  error?: string;
}) {
  return (
    <section className="shipment-milestones">
      <h3>备妥、发货与签收</h3>
      {error && <p role="alert">{error}</p>}
      <div className="shipment-milestone-list">
        {milestones.map((item) => {
          const held = heldShipmentIds.includes(item.shipmentId);
          const lateReport = "lateReport" in item ? item.lateReport : null;
          const base = (
            <>
              <input type="hidden" name="shipmentId" value={item.shipmentId} />
              <input
                type="hidden"
                name="expectedVersion"
                value={item.version}
              />
            </>
          );
          return (
            <article key={item.shipmentId}>
              <h4>{item.displayName}</h4>
              <p>
                {item.status === "planned"
                  ? "订单已确认 · 尚未核实备妥"
                  : item.status === "ready_to_ship"
                    ? "已核实备妥 · 待承运商交接"
                    : item.status === "shipped"
                      ? "已交接承运商"
                      : "已送达"}
              </p>
              {held && item.status !== "delivered" && (
                <p className="order-hold-notice">
                  当前有付款或数量限制，不能新放行该批次。
                </p>
              )}
              {item.status === "planned" && !lateReport && (
                <details>
                  <summary>核实备妥</summary>
                  <Form method="post" className="shipment-milestone-form">
                    {base}
                    <input
                      type="hidden"
                      name="intent"
                      value="milestone-ready"
                    />
                    <input
                      type="hidden"
                      name="commandId"
                      value={commands[item.shipmentId]?.ready}
                    />
                    {[
                      ["specificationsVerified", "已核对客户接受的规格"],
                      ["quantitiesVerified", "已核对本批实物数量"],
                      [
                        "offlinePreparationVerified",
                        "已核实线下备货及加工完成",
                      ],
                      ["requiredInspectionVerified", "已核实所需检验完成"],
                    ].map(([name, label]) => (
                      <label key={name} className="quote-confirmation">
                        <input type="checkbox" name={name} required /> {label}
                      </label>
                    ))}
                    <button
                      className="button button-primary"
                      disabled={busy || held || !planReady}
                    >
                      确认备妥并通知客户
                    </button>
                  </Form>
                </details>
              )}
              {item.status === "ready_to_ship" && !lateReport && (
                <details>
                  <summary>记录承运商交接</summary>
                  <Form method="post" className="shipment-milestone-form">
                    {base}
                    <input type="hidden" name="intent" value="milestone-ship" />
                    <input
                      type="hidden"
                      name="commandId"
                      value={commands[item.shipmentId]?.shipped}
                    />
                    <label>
                      实际交接时间（北京时间）
                      <input
                        type="datetime-local"
                        name="handoffLocal"
                        required
                      />
                    </label>
                    <label>
                      承运商
                      <input name="carrierName" maxLength={200} required />
                    </label>
                    <label>
                      交接凭据来源
                      <input name="source" maxLength={2000} required />
                    </label>
                    <button
                      className="button button-primary"
                      disabled={busy || held || !planReady}
                    >
                      确认发货并通知客户
                    </button>
                  </Form>
                </details>
              )}
              {["planned", "ready_to_ship"].includes(item.status) &&
                !lateReport && (
                  <details>
                    <summary>迟录已发生的承运商交接</summary>
                    <Form method="post" className="shipment-milestone-form">
                      {base}
                      <input
                        type="hidden"
                        name="intent"
                        value="milestone-report-late"
                      />
                      <input
                        type="hidden"
                        name="commandId"
                        value={commands[item.shipmentId]?.lateReport}
                      />
                      <label>
                        实际交接时间（北京时间）
                        <input
                          type="datetime-local"
                          name="handoffLocal"
                          required
                        />
                      </label>
                      <label>
                        承运商
                        <input name="carrierName" maxLength={200} required />
                      </label>
                      <label>
                        交接凭据来源
                        <input name="source" maxLength={2000} required />
                      </label>
                      <label>
                        迟录原因与冲突核查
                        <input
                          name="reason"
                          minLength={10}
                          maxLength={2000}
                          required
                        />
                      </label>
                      <button
                        className="button button-secondary"
                        disabled={busy}
                      >
                        只记录事实，待解除限制后归档
                      </button>
                    </Form>
                  </details>
                )}
              {lateReport && !lateReport.applied && (
                <div className="order-hold-notice">
                  <p>
                    迟录交接待核查：{lateReport.carrierName} ·{" "}
                    {lateReport.actualAt}
                  </p>
                  <p>
                    {lateReport.reason} ·{" "}
                    {lateReport.quantities
                      .map((line) => `${line.lineId}: ${line.physicalQuantity}`)
                      .join("; ")}
                  </p>
                  <Form method="post">
                    {base}
                    <input
                      type="hidden"
                      name="intent"
                      value="milestone-apply-late"
                    />
                    <input
                      type="hidden"
                      name="reportId"
                      value={lateReport.id}
                    />
                    <input
                      type="hidden"
                      name="commandId"
                      value={commands[item.shipmentId]?.lateApply}
                    />
                    <button
                      className="button button-primary"
                      disabled={busy || held || !planReady}
                    >
                      冲突已解除，归档实际交接并通知客户
                    </button>
                  </Form>
                </div>
              )}
              {item.status === "shipped" && (
                <details>
                  <summary>记录实际送达</summary>
                  <Form method="post" className="shipment-milestone-form">
                    {base}
                    <input
                      type="hidden"
                      name="intent"
                      value="milestone-deliver"
                    />
                    <input
                      type="hidden"
                      name="commandId"
                      value={commands[item.shipmentId]?.delivered}
                    />
                    <label>
                      实际送达日期
                      <input type="date" name="actualDate" required />
                    </label>
                    <label>
                      承运商或客户确认来源
                      <input name="source" maxLength={2000} required />
                    </label>
                    <button className="button button-primary" disabled={busy}>
                      确认送达并通知客户
                    </button>
                  </Form>
                </details>
              )}
              {item.status !== "planned" && (
                <details>
                  <summary>添加包裹追踪</summary>
                  <Form method="post" className="shipment-milestone-form">
                    {base}
                    <input type="hidden" name="intent" value="tracking-save" />
                    <input
                      type="hidden"
                      name="expectedTrackingVersion"
                      value="0"
                    />
                    <input
                      type="hidden"
                      name="commandId"
                      value={commands[item.shipmentId]?.tracking}
                    />
                    <label>
                      包裹名称
                      <input name="packageLabel" maxLength={200} required />
                    </label>
                    <label>
                      承运商
                      <input name="carrierName" maxLength={200} required />
                    </label>
                    <label>
                      追踪号码
                      <input name="trackingNumber" maxLength={200} />
                    </label>
                    <label>
                      承运商追踪链接
                      <input type="url" name="trackingUrl" />
                    </label>
                    <label>
                      预计送达日期（可选）
                      <input type="date" name="estimatedArrivalDate" />
                    </label>
                    <label>
                      记录来源
                      <input name="reason" maxLength={2000} required />
                    </label>
                    <button className="button button-secondary" disabled={busy}>
                      保存追踪信息
                    </button>
                  </Form>
                </details>
              )}
              {!!item.tracking.length && (
                <div className="shipment-tracking-list">
                  <h5>包裹追踪</h5>
                  {item.tracking.map((tracking) => (
                    <details key={tracking.id}>
                      <summary>
                        {tracking.packageLabel} · {tracking.carrierName} ·{" "}
                        {tracking.trackingNumber ?? "号码待补录"}
                      </summary>
                      <Form method="post" className="shipment-milestone-form">
                        {base}
                        <input
                          type="hidden"
                          name="intent"
                          value="tracking-save"
                        />
                        <input
                          type="hidden"
                          name="trackingId"
                          value={tracking.id}
                        />
                        <input
                          type="hidden"
                          name="expectedTrackingVersion"
                          value={"version" in tracking ? tracking.version : 0}
                        />
                        <input
                          type="hidden"
                          name="commandId"
                          value={trackingCommands[tracking.id]}
                        />
                        <label>
                          包裹名称
                          <input
                            name="packageLabel"
                            defaultValue={tracking.packageLabel}
                            required
                          />
                        </label>
                        <label>
                          承运商
                          <input
                            name="carrierName"
                            defaultValue={tracking.carrierName}
                            required
                          />
                        </label>
                        <label>
                          追踪号码
                          <input
                            name="trackingNumber"
                            defaultValue={tracking.trackingNumber ?? ""}
                          />
                        </label>
                        <label>
                          承运商追踪链接
                          <input
                            type="url"
                            name="trackingUrl"
                            defaultValue={tracking.trackingUrl ?? ""}
                          />
                        </label>
                        <label>
                          预计送达日期
                          <input
                            type="date"
                            name="estimatedArrivalDate"
                            defaultValue={tracking.estimatedArrivalDate ?? ""}
                          />
                        </label>
                        <label>
                          更正原因
                          <input name="reason" maxLength={2000} required />
                        </label>
                        <button
                          className="button button-secondary"
                          disabled={busy}
                        >
                          保存更正
                        </button>
                      </Form>
                    </details>
                  ))}
                </div>
              )}
              {item.events.length > 0 && (
                <ol className="shipment-milestone-history">
                  {item.events.map((event) => (
                    <li key={event.kind}>
                      {event.kind === "ready_to_ship"
                        ? "备妥"
                        : event.kind === "shipped"
                          ? "发货"
                          : "送达"}
                      {event.actualDate ? ` · ${event.actualDate}` : ""} ·
                      记录于 {event.recordedAt}
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
