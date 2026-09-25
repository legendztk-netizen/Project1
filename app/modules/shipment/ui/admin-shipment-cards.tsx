import { useEffect, useRef, useState } from "react";
import { Link, useNavigation } from "react-router";
import { FileText, Package, Plus } from "lucide-react";
import {
  AdminShipmentPlanReview,
  planMappingState,
  type AdminPlan,
} from "./admin-shipment-plan";
import {
  ReadyDateHistory,
  ReadyDateNotices,
  ReadyDateSummary,
  ResolveReadyDateForm,
  ReviseReadyDateForm,
  scheduleState,
  type AdminSchedule,
} from "./admin-shipment-ready-schedules";
import {
  adminLateReport,
  LateHandoffForm,
  LateReportPending,
  MarkDeliveredForm,
  MarkReadyForm,
  MarkShippedForm,
  MilestoneHistory,
  TrackingForm,
  type AdminMilestone,
} from "./admin-shipment-milestones";
import { ShipmentActionDialog } from "./shipment-action-dialog";
import { AdminShipmentDocumentsDialog } from "./admin-shipment-documents-dialog";
import { AdminChinaCalendarDialog } from "./admin-china-calendar-dialog";
import { completedStage, formatPhysicalQuantity } from "./shipment-display";
import { ShipmentStepper } from "./shipment-stepper";

const stageLabels = ["订单已确认", "备妥", "已发货", "已送达"] as const;
const statusLabels = {
  planned: "待备妥",
  ready_to_ship: "已备妥 · 待发货",
  shipped: "已发货 · 待送达",
  delivered: "已送达",
} as const;

type Panel = {
  kind: "ready" | "ship" | "deliver" | "late" | "date" | "tracking";
  shipmentId: string;
  trackingId?: string;
} | null;

const panelTitles = {
  ready: "核实备妥",
  ship: "记录承运商交接",
  deliver: "记录实际送达",
  late: "迟录已发生的承运商交接",
  date: "修订预计备妥日期",
  tracking: "包裹追踪",
} as const;

const panelDescriptions: Partial<Record<keyof typeof panelTitles, string>> = {
  ready:
    "请先在线下核对规格、数量、备货和检验。确认后客户会收到“Ready to Ship”通知，无需客户操作。",
  ship: "记录实际交接给承运商的时间和凭据。追踪号可以之后再补录。",
  deliver: "根据承运商信息或客户确认记录实际送达日期。",
  date: "新日期和原因会通知客户，不会改动 PI 或价格。",
};

export function AdminShipmentCards({
  plan,
  schedules,
  milestones,
  milestoneCommands,
  trackingCommands,
  scheduleCommandIds,
  planCommandId,
  actionData,
  onReviewChanges,
}: {
  plan: AdminPlan;
  schedules: AdminSchedule[];
  milestones: AdminMilestone[];
  milestoneCommands: Record<string, Record<string, string>>;
  trackingCommands: Record<string, string>;
  scheduleCommandIds: Record<string, string>;
  planCommandId: string;
  actionData?: { error?: string };
  onReviewChanges: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [documentsShipment, setDocumentsShipment] = useState<
    AdminPlan["shipments"][number] | null
  >(null);
  const actionAtOpen = useRef(actionData);
  const submitted = useRef(false);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const planReady = plan.status === "ready";
  const { canMap, canRevise } = planMappingState(plan);
  const mappingFormShown = canMap || canRevise;
  useEffect(() => {
    if (navigation.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (!actionData?.error) setPanel(null);
  }, [navigation.state, actionData]);
  function open(next: NonNullable<Panel>) {
    actionAtOpen.current = actionData;
    setPanel(next);
  }
  const panelItem = panel
    ? milestones.find((item) => item.shipmentId === panel.shipmentId)
    : undefined;
  const panelSchedule = panel
    ? schedules.find((item) => item.shipmentId === panel.shipmentId)
    : undefined;
  const panelTracking = panelItem?.tracking.find(
    (record) => record.id === panel?.trackingId,
  );
  const commands = panel ? milestoneCommands[panel.shipmentId] : undefined;
  return (
    <div className="order-shipment-workspace">
      <div className="order-shipment-summary">
        <strong>
          {plan.status === "review"
            ? "分批计划待核对"
            : `共 ${plan.shipments.length} 批发货`}
          <span> · 计划版本 {plan.version}</span>
        </strong>
      </div>
      {!panel && !mappingFormShown && actionData?.error && (
        <p role="alert">{actionData.error}</p>
      )}
      <AdminShipmentPlanReview
        plan={plan}
        commandId={planCommandId}
        busy={busy}
        error={panel || !mappingFormShown ? undefined : actionData?.error}
      />
      {plan.shipments.map((shipment) => {
        const item = milestones.find((row) => row.shipmentId === shipment.id);
        const schedule = schedules.find(
          (row) => row.shipmentId === shipment.id,
        );
        const status = item?.status ?? "planned";
        const lateReport = item ? adminLateReport(item) : null;
        const lateReportPending = !!lateReport && !lateReport.applied;
        const reverifyPending =
          !!item &&
          "revisedReadyReview" in item &&
          !!item.revisedReadyReview &&
          !item.revisedReadyReview.verifiedAt;
        const releaseBlocked = shipment.held || !planReady;
        const blockedReason = !planReady
          ? "分批计划核对完成后才能放行。"
          : "当前有付款或数量限制，不能新放行该批次。";
        const dateState = schedule ? scheduleState(schedule) : null;
        const commandSet = milestoneCommands[shipment.id];
        return (
          <article
            key={shipment.id}
            className="shipment-card"
            aria-labelledby={`shipment-${shipment.id}`}
          >
            <header className="shipment-card-heading">
              <div>
                <h3 id={`shipment-${shipment.id}`}>
                  第 {shipment.sequenceNumber} 批 · {shipment.displayName}
                </h3>
                <p>
                  {shipment.incoterm} · {shipment.namedPlace} ·{" "}
                  {shipment.transportMethod}
                </p>
              </div>
              <span
                className={`orders-status ${shipment.held && status !== "delivered" ? "hold" : ""}`}
              >
                {shipment.held && status !== "delivered"
                  ? "暂缓放行"
                  : statusLabels[status]}
              </span>
            </header>
            <ShipmentStepper
              labels={stageLabels}
              completed={completedStage(status)}
            />
            {item && (
              <div className="shipment-next-step">
                {lateReportPending ? (
                  <LateReportPending
                    item={item}
                    commandId={commandSet?.lateApply}
                    disabled={busy}
                  />
                ) : reverifyPending ? (
                  <>
                    <div>
                      <strong>下一步：变更后重新核实备妥</strong>
                      <p>
                        客户接受的发货变更已生效，需重新核实后才能交接承运商。
                      </p>
                    </div>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={onReviewChanges}
                    >
                      去变更申请处理
                    </button>
                  </>
                ) : status === "delivered" ? (
                  <div>
                    <strong>本批已完成</strong>
                    <p>送达已记录。</p>
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>
                        {status === "planned"
                          ? "下一步：核实备妥"
                          : status === "ready_to_ship"
                            ? "下一步：记录承运商交接"
                            : "下一步：记录实际送达"}
                      </strong>
                      <p>
                        {status !== "shipped" && releaseBlocked
                          ? blockedReason
                          : status === "planned"
                            ? "线下核对规格、数量、备货与检验后确认。"
                            : status === "ready_to_ship"
                              ? "货物交给承运商后，记录交接时间和凭据。"
                              : "承运商或客户确认送达后记录。"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={
                        busy || (status !== "shipped" && releaseBlocked)
                      }
                      onClick={() =>
                        open({
                          kind:
                            status === "planned"
                              ? "ready"
                              : status === "ready_to_ship"
                                ? "ship"
                                : "deliver",
                          shipmentId: shipment.id,
                        })
                      }
                    >
                      {status === "planned"
                        ? "核实备妥"
                        : status === "ready_to_ship"
                          ? "记录发货"
                          : "记录送达"}
                    </button>
                  </>
                )}
              </div>
            )}
            {schedule && ["planned", "ready_to_ship"].includes(status) && (
              <div className="shipment-card-row">
                <span className="shipment-card-label">预计备妥</span>
                <span>
                  <ReadyDateSummary schedule={schedule} />
                </span>
                {dateState?.editable && dateState.unresolved && (
                  <ResolveReadyDateForm
                    schedule={schedule}
                    commandId={scheduleCommandIds[shipment.id]}
                    disabled={busy}
                  />
                )}
                {dateState?.editable && !dateState.unresolved && (
                  <button
                    type="button"
                    className="shipment-link-button"
                    onClick={() =>
                      open({ kind: "date", shipmentId: shipment.id })
                    }
                  >
                    修改日期
                  </button>
                )}
              </div>
            )}
            {schedule && (
              <ReadyDateNotices
                schedule={schedule}
                onOpenCalendar={() => setCalendarOpen(true)}
              />
            )}
            <div className="shipment-card-row shipment-card-items">
              <span className="shipment-card-label">商品</span>
              <ul>
                {shipment.allocations.map((allocation) => (
                  <li key={allocation.lineId}>
                    <span>
                      {allocation.displayName} · {allocation.sku}
                    </span>
                    <strong>{formatPhysicalQuantity(allocation, "zh")}</strong>
                  </li>
                ))}
              </ul>
            </div>
            {shipment.quotedAllocations.length >
              shipment.allocations.length && (
              <p className="shipment-card-note">
                部分约定数量仍待解除锁定并完成分配。
              </p>
            )}
            <p className="shipment-card-note">
              {shipment.groupKey.startsWith("change:")
                ? "原 PI 分摊运费"
                : "本批运费"}{" "}
              USD {(shipment.freightCents / 100).toFixed(2)} · 保险 USD{" "}
              {(shipment.insuranceCents / 100).toFixed(2)} · 进口费用 USD{" "}
              {(shipment.dutiesImportCents / 100).toFixed(2)}
              {shipment.groupKey.startsWith("change:") &&
                " · 订单变更价款单独记载，不计入原 PI 分摊。"}
            </p>
            {item && status !== "planned" && (
              <div className="shipment-card-row">
                <span className="shipment-card-label">包裹追踪</span>
                {item.tracking.length ? (
                  <ul className="shipment-card-tracking">
                    {item.tracking.map((record) => (
                      <li key={record.id}>
                        <span>
                          {record.packageLabel} · {record.carrierName} ·{" "}
                          {record.trackingNumber ?? "号码待补录"}
                        </span>
                        <button
                          type="button"
                          className="shipment-link-button"
                          onClick={() =>
                            open({
                              kind: "tracking",
                              shipmentId: shipment.id,
                              trackingId: record.id,
                            })
                          }
                        >
                          更正
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="shipment-card-muted">待补录</span>
                )}
                <button
                  type="button"
                  className="shipment-link-button"
                  onClick={() =>
                    open({ kind: "tracking", shipmentId: shipment.id })
                  }
                >
                  <Plus size={15} aria-hidden="true" /> 添加包裹
                </button>
              </div>
            )}
            <footer className="shipment-card-footer">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setDocumentsShipment(shipment)}
              >
                <Package size={16} aria-hidden="true" /> 装箱与文件
              </button>
              <details className="shipment-card-more">
                <summary>日期依据、节点记录与例外操作</summary>
                {schedule && <ReadyDateHistory schedule={schedule} />}
                {item && <MilestoneHistory item={item} />}
                {item &&
                  ["planned", "ready_to_ship"].includes(status) &&
                  !lateReport && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() =>
                        open({ kind: "late", shipmentId: shipment.id })
                      }
                    >
                      <FileText size={16} aria-hidden="true" />{" "}
                      迟录已发生的承运商交接
                    </button>
                  )}
              </details>
            </footer>
          </article>
        );
      })}
      {calendarOpen && (
        <AdminChinaCalendarDialog onClose={() => setCalendarOpen(false)} />
      )}
      {documentsShipment && (
        <AdminShipmentDocumentsDialog
          orderId={plan.orderId}
          shipmentId={documentsShipment.id}
          title={`装箱与文件 · 第 ${documentsShipment.sequenceNumber} 批 · ${documentsShipment.displayName}`}
          onClose={() => setDocumentsShipment(null)}
        />
      )}
      {panel && panelItem && (
        <ShipmentActionDialog
          key={`${panel.kind}:${panel.shipmentId}:${panel.trackingId ?? ""}`}
          title={`${panelTitles[panel.kind]} · ${panelItem.displayName}`}
          description={panelDescriptions[panel.kind]}
          error={
            actionData !== actionAtOpen.current ? actionData?.error : undefined
          }
          onClose={() => setPanel(null)}
          onSubmitted={() => {
            submitted.current = true;
          }}
        >
          {panel.kind === "ready" && (
            <MarkReadyForm
              item={panelItem}
              commandId={commands?.ready}
              disabled={busy}
            />
          )}
          {panel.kind === "ship" && (
            <MarkShippedForm
              item={panelItem}
              commandId={commands?.shipped}
              disabled={busy}
            />
          )}
          {panel.kind === "deliver" && (
            <MarkDeliveredForm
              item={panelItem}
              commandId={commands?.delivered}
              disabled={busy}
            />
          )}
          {panel.kind === "late" && (
            <LateHandoffForm
              item={panelItem}
              commandId={commands?.lateReport}
              disabled={busy}
            />
          )}
          {panel.kind === "tracking" && (
            <TrackingForm
              item={panelItem}
              tracking={panelTracking}
              commandId={
                panelTracking
                  ? trackingCommands[panelTracking.id]
                  : commands?.tracking
              }
              disabled={busy}
            />
          )}
          {panel.kind === "date" && panelSchedule && (
            <ReviseReadyDateForm
              schedule={panelSchedule}
              commandId={scheduleCommandIds[panel.shipmentId]}
              disabled={busy}
            />
          )}
        </ShipmentActionDialog>
      )}
    </div>
  );
}
