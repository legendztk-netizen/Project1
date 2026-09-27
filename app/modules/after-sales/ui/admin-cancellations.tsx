import type { ReactNode } from "react";

import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type { CancellationRequestView } from "../application/cancellation-service";
import "../../shipment/ui/order-shipping-changes.css";
import "./after-sales.css";

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
          {renderActions?.(request)}
        </article>
      ))}
    </div>
  );
}
