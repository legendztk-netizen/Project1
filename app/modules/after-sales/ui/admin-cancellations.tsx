import { usd } from "../domain/refund-calculation";
import { useState, type ReactNode } from "react";
import { Form } from "react-router";

import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type { CancellationRequestView } from "../application/cancellation-service";
import "../../shipment/ui/order-shipping-changes.css";
import { scopedField } from "../application/parse-after-sales-forms";
import { AdminActionDialog } from "./admin-action-dialog";
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

interface DecisionFormProps {
  request: CancellationRequestView;
  commandId: string;
  busy: boolean;
  intent?: string;
  children?: ReactNode;
}

export function AdminCancellationDecisionForm(props: DecisionFormProps) {
  if (props.request.status !== "pending_review") return null;
  return (
    <AdminActionDialog label="审核并作出取消决定" wide primary>
      <CancellationDecisionFields {...props} />
    </AdminActionDialog>
  );
}

function CancellationDecisionFields({
  request,
  commandId,
  busy,
  intent = "cancellation-resolve",
  children,
}: DecisionFormProps) {
  const [amounts, setAmounts] = useState({
    logistics: 0,
    tax: 0,
    thirdParty: 0,
  });
  const [responsibility, setResponsibility] = useState(
    request.kind === "exceptional" ? "" : "customer",
  );
  const [approved, setApproved] = useState(
    request.lines.reduce(
      (sum, line) => sum + (line.handedOff ? 0 : line.physicalQuantity),
      0,
    ),
  );
  const requested = request.lines.reduce(
    (sum, line) => sum + line.physicalQuantity,
    0,
  );
  const feeStep = request.kind === "exceptional" ? "03" : "02";
  return (
    <Form
      method="post"
      className="shipping-change-form cancellation-decision-form"
      onChange={(event) => {
        const form = new FormData(event.currentTarget);
        setResponsibility(String(form.get("responsibility") ?? "customer"));
        setAmounts({
          logistics: Number(form.get("logisticsUsd") || 0),
          tax: Number(form.get("taxUsd") || 0),
          thirdParty: Number(
            event.currentTarget.querySelector<HTMLInputElement>(
              '[name="thirdPartyUsd"]',
            )?.value || 0,
          ),
        });
        setApproved(
          request.lines.reduce(
            (sum, line) =>
              sum +
              Number(
                form.get(
                  scopedField("approve", line.lineId, line.shipmentId),
                ) || 0,
              ),
            0,
          ),
        );
      }}
    >
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="requestId" value={request.id} />
      <input type="hidden" name="expectedVersion" value={request.version} />
      <input type="hidden" name="commandId" value={commandId} />
      <p className="cancellation-form-intro">
        核实数量与工厂情况后填写处理说明。标有 * 的项目为必填。
      </p>
      <fieldset className="cancellation-form-section">
        <legend>
          <span className="cancellation-step">01</span>取消数量
        </legend>
        <p className="cancellation-help">
          填写批准取消的数量；剩余数量将被拒绝取消并恢复履约。全部拒绝请填 0。
        </p>
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
              <span className="cancellation-quantity-input">
                <small>批准数量 *</small>
                <input
                  type="number"
                  required
                  min={0}
                  max={line.handedOff ? 0 : line.physicalQuantity}
                  step={1}
                  defaultValue={line.handedOff ? 0 : line.physicalQuantity}
                  name={scopedField("approve", line.lineId, line.shipmentId)}
                  aria-label={`${line.displayName} 批准取消数量`}
                />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {children}
      <fieldset className="cancellation-form-section">
        <legend>
          <span className="cancellation-step">{feeStep}</span>责任与费用
        </legend>
        <p className="cancellation-help">
          商品退款按批准数量自动计算。以下仅填写额外退回或扣除的费用，无费用请留空或填
          0。
        </p>
        {request.kind === "exceptional" && (
          <label className="cancellation-responsibility">
            责任归属 *
            <select name="responsibility" required defaultValue="">
              <option value="" disabled>
                请选择责任归属
              </option>
              <option value="customer">客户要求取消</option>
              <option value="seller">卖方原因</option>
            </select>
            <small>
              {responsibility === "seller"
                ? "卖方原因不扣除第三方费用。"
                : "客户要求取消时，仅可扣除有凭证、不可退的第三方费用，无加价，需客户确认。"}
            </small>
          </label>
        )}
        <div className="cancellation-fee-grid">
          <div className="cancellation-fee-card">
            <label>
              可退回物流费用（USD）
              <input
                name="logisticsUsd"
                type="number"
                min="0"
                step="0.01"
                max={request.refundLimits.logisticsCents / 100}
                inputMode="decimal"
                placeholder="0.00"
              />
              <small>
                剩余可退物流费用上限：{usd(request.refundLimits.logisticsCents)}
              </small>
            </label>
            <label>
              物流核算说明{amounts.logistics > 0 ? " *" : "（选填）"}
              <input
                name="logisticsNote"
                required={amounts.logistics > 0}
                placeholder="内部记录，客户不可见"
              />
            </label>
            <p className="cancellation-help">
              按剩余履约重新核算，不按原运费比例分摊。上限已扣除已有退款和变更抵扣。
            </p>
          </div>
          <div className="cancellation-fee-card">
            <label>
              销售税调整（USD）
              <input
                name="taxUsd"
                type="number"
                min="0"
                step="0.01"
                max={request.refundLimits.taxCents / 100}
                inputMode="decimal"
                placeholder="0.00"
              />
              <small>
                剩余可退销售税上限：{usd(request.refundLimits.taxCents)}
              </small>
            </label>
            <label>
              税务依据{amounts.tax > 0 ? " *" : "（选填）"}
              <input
                name="taxNote"
                required={amounts.tax > 0}
                placeholder="内部记录，客户不可见"
              />
            </label>
            <p className="cancellation-help">
              按已接受的税务处理填写；未收取销售税请留空或填 0。
            </p>
          </div>
        </div>
        <fieldset
          className="cancellation-deduction"
          disabled={responsibility === "seller"}
        >
          <legend>
            第三方费用扣除{" "}
            <span className="cancellation-optional">无费用可跳过</span>
          </legend>
          <div className="shipping-change-fields">
            <label>
              不可退第三方费用（USD）
              <input
                name="thirdPartyUsd"
                disabled={responsibility === "seller"}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
              />
            </label>
            <label>
              费用凭证说明
              {amounts.thirdParty > 0 && responsibility !== "seller"
                ? " *"
                : "（选填）"}
              <input
                name="thirdPartyEvidence"
                disabled={responsibility === "seller"}
                required={amounts.thirdParty > 0 && responsibility !== "seller"}
                placeholder="向客户说明扣费项目及依据"
              />
            </label>
          </div>
          <p className="cancellation-help">
            {responsibility === "seller"
              ? "已选择卖方原因，此项不适用，不会扣费。"
              : "仅填写已发生且不可退的实际费用。说明对客户可见。"}
          </p>
        </fieldset>
      </fieldset>
      <fieldset className="cancellation-form-section">
        <legend>
          <span className="cancellation-step">
            {request.kind === "exceptional" ? "04" : "03"}
          </span>
          处理说明
        </legend>
        <label>
          处理原因 * <span className="cancellation-visibility">客户可见</span>
          <textarea
            name="customerReason"
            required
            rows={3}
            placeholder="说明批准或拒绝的原因，以及客户需要了解的费用。"
          />
        </label>
        <details className="cancellation-optional-details">
          <summary>添加内部备注（选填，客户不可见）</summary>
          <label>
            内部备注
            <textarea name="internalNote" rows={2} />
          </label>
        </details>
      </fieldset>
      <footer className="cancellation-form-footer">
        <div>
          <strong aria-live="polite">
            批准 {Number.isFinite(approved) ? approved : 0} / {requested}
            ，其余拒绝
          </strong>
          <small>保存后决定不可修改；不收取取消手续费。</small>
        </div>
        <button className="button button-primary" disabled={busy}>
          {busy ? "正在保存…" : "保存取消决定"}
        </button>
      </footer>
    </Form>
  );
}
