import type { ReactNode } from "react";
import { Form } from "react-router";

import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type { CancellationRequestView } from "../application/cancellation-service";
import "../../shipment/ui/order-shipping-changes.css";
import { readScopedFields, scopedField } from "./scoped-fields";
import "./after-sales.css";
import { RefundBreakdown, refundStatusLabel } from "./refund-breakdown";

const outcomeLabel: Record<string, string> = {
  approved: "全部批准",
  partially_approved: "部分批准",
  declined: "拒绝",
};

export const cancellationStatusLabel: Record<string, string> = {
  pending_review: "待审核（数量已锁定）",
  withdrawn: "客户已撤回",
  resolved: "已作出决定",
};

export const productClassLabel: Record<string, string> = {
  standard: "标准品",
  cut_hose: "按长度切割软管",
  made_to_order: "定制品",
};

export function AdminCancellationRequests({
  requests,
  renderActions,
}: {
  requests: CancellationRequestView[];
  renderActions?: (request: CancellationRequestView) => ReactNode;
}) {
  if (!requests.length) return <p>该订单暂无取消申请。</p>;
  return (
    <div className="shipping-change-history">
      {requests.map((request) => (
        <article key={request.id} className="shipping-change-record">
          <div className="shipping-change-record-heading">
            <strong>
              {request.kind === "standard" ? "标准品取消申请" : "特殊取消审核"}
              {request.origin === "support" ? "（客服发起）" : "（客户提交）"}
            </strong>
            <span>
              {cancellationStatusLabel[request.status] ?? request.status}
            </span>
          </div>
          {request.handoffConflict && (
            <p role="alert">
              <span className="after-sales-flag">交接冲突</span>{" "}
              部分申请数量所在批次已记录实际承运商交接，只能拒绝该部分；取消锁定仍由本申请保留，直至作出决定。
            </p>
          )}
          <p>提交时间：{formatPiDate(request.createdAt, "admin")}</p>
          <p>原因：{request.reason}</p>
          <table className="after-sales-table">
            <thead>
              <tr>
                <th>订单行</th>
                <th>批次</th>
                <th>数量</th>
                <th>锁定</th>
              </tr>
            </thead>
            <tbody>
              {request.lines.map((line) => (
                <tr key={`${line.lineId}:${line.shipmentId ?? ""}`}>
                  <td>
                    #{line.lineNumber} {line.displayName}
                    <br />
                    <small>
                      {line.sku} · {productClassLabel[line.productClass]}
                      {line.pieceLengthFt !== null
                        ? ` · 每段 ${line.pieceLengthFt} ft`
                        : ""}
                    </small>
                  </td>
                  <td>
                    {line.shipmentName ?? "未分配批次"}
                    {line.handedOff ? "（已交接）" : ""}
                  </td>
                  <td>{line.physicalQuantity}</td>
                  <td>{line.holdActive ? "锁定中" : "已释放"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>处理记录</summary>
            <ol>
              {request.events.map((event, index) => (
                <li key={`${event.kind}:${index}`}>
                  {formatPiDate(event.occurredAt, "admin")} ·{" "}
                  {event.kind === "submitted"
                    ? "提交"
                    : event.kind === "withdrawn"
                      ? "客户撤回"
                      : "作出决定"}
                </li>
              ))}
            </ol>
          </details>
          {request.resolution && (
            <div className="shipping-change-proposal">
              <h4>
                取消决定：{outcomeLabel[request.resolution.outcome]} ·{" "}
                {formatPiDate(request.resolution.decidedAt, "admin")}
              </h4>
              <p>客户可见说明：{request.resolution.customerReason}</p>
              {"internalNote" in request.resolution &&
                request.resolution.internalNote && (
                  <p>内部备注：{request.resolution.internalNote}</p>
                )}
              {"factoryEvidence" in request.resolution &&
                request.resolution.factoryEvidence && (
                  <p>
                    工厂实际信息：{request.resolution.factoryEvidence.status}
                    （来源：{request.resolution.factoryEvidence.source}
                    ，核实时间：
                    {formatPiDate(
                      request.resolution.factoryEvidence.reviewedAt,
                      "admin",
                    )}
                    ）
                  </p>
                )}
              <ul className="after-sales-line-list">
                {request.resolution.lines.map((line) => (
                  <li key={`${line.lineId}:${line.shipmentId ?? ""}`}>
                    {line.displayName}：批准取消 {line.approvedQuantity}，拒绝{" "}
                    {line.declinedQuantity}
                  </li>
                ))}
              </ul>
              {request.resolution.refunds.map((refund) => (
                <div key={refund.id}>
                  <p>
                    <strong>{refundStatusLabel(refund, "zh")}</strong>
                  </p>
                  <RefundBreakdown refund={refund} language="zh" />
                </div>
              ))}
            </div>
          )}
          {renderActions?.(request)}
        </article>
      ))}
    </div>
  );
}

export function AdminCancellationDecisionForm({
  request,
  commandId,
  busy,
  intent = "cancellation-resolve",
  children,
}: {
  request: CancellationRequestView;
  commandId: string;
  busy: boolean;
  intent?: string;
  children?: ReactNode;
}) {
  if (request.status !== "pending_review") return null;
  return (
    <details className="after-sales-decision">
      <summary>审核并作出取消决定</summary>
      <Form method="post" className="shipping-change-form">
        <input type="hidden" name="intent" value={intent} />
        <input type="hidden" name="requestId" value={request.id} />
        <input type="hidden" name="expectedVersion" value={request.version} />
        <input type="hidden" name="commandId" value={commandId} />
        <fieldset>
          <legend>逐行批准数量（其余数量拒绝并恢复履约）</legend>
          <div className="after-sales-quantity-list">
            {request.lines.map((line) => (
              <label
                key={`${line.lineId}:${line.shipmentId ?? ""}`}
                className="after-sales-quantity-row"
              >
                <span>
                  <strong>{line.displayName}</strong>
                  <small>
                    {line.shipmentName ?? "未分配批次"} · 申请{" "}
                    {line.physicalQuantity}
                    {line.handedOff ? " · 已交接，只能拒绝" : ""}
                  </small>
                </span>
                <input
                  type="number"
                  min={0}
                  max={line.handedOff ? 0 : line.physicalQuantity}
                  step={1}
                  defaultValue={line.handedOff ? 0 : line.physicalQuantity}
                  name={scopedField("approve", line.lineId, line.shipmentId)}
                  aria-label={`${line.displayName} 批准取消数量`}
                />
              </label>
            ))}
          </div>
        </fieldset>
        {children}
        <div className="shipping-change-fields">
          <label>
            可退回物流费用（USD）
            <input name="logisticsUsd" inputMode="decimal" placeholder="0.00" />
          </label>
          <label>
            物流核算说明（按剩余履约重新核算，勿按原运费比例分摊）
            <input name="logisticsNote" />
          </label>
          <label>
            销售税调整（USD）
            <input name="taxUsd" inputMode="decimal" placeholder="0.00" />
          </label>
          <label>
            税务依据（已接受的税务处理）
            <input name="taxNote" />
          </label>
          <label>
            已发生且不可退的第三方费用（USD）
            <input
              name="thirdPartyUsd"
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          <label>
            第三方费用凭证说明（无加价，需客户确认）
            <input name="thirdPartyEvidence" />
          </label>
        </div>
        <label>
          客户可见说明
          <textarea name="customerReason" required rows={2} />
        </label>
        <label>
          内部备注（客户不可见）
          <textarea name="internalNote" rows={2} />
        </label>
        <p>不收取取消手续费或任何加价；原 PI 与订单保持不变。</p>
        <button className="button button-primary" disabled={busy}>
          保存不可更改的取消决定
        </button>
      </Form>
    </details>
  );
}

export function readCancellationDecisions(form: FormData) {
  const decisions: Array<{
    lineId: string;
    shipmentId: string | null;
    approvedQuantity: number;
  }> = [];
  for (const { lineId, shipmentId, value } of readScopedFields(form, "approve"))
    decisions.push({ lineId, shipmentId, approvedQuantity: Number(value) });
  return decisions;
}
