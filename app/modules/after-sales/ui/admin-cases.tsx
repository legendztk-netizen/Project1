import type { ReactNode } from "react";
import { Form } from "react-router";

import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type { AfterSalesFileView } from "../application/after-sales-files";
import type { CaseReason, CaseView } from "../application/case-service";
import { productClassLabel } from "./admin-cancellations";
import { AdminEvidenceFiles } from "./admin-exceptional";
import "../../shipment/ui/order-shipping-changes.css";
import "./after-sales.css";

export const adminCaseReasonLabel: Record<CaseReason, string> = {
  convenience_return: "客户选择退货（未使用）",
  wrong_item: "错发商品",
  damaged: "运输损坏",
  nonconforming: "疑似不合格品 / 与规格不符",
  other: "其他问题",
};

export function AdminCases({
  cases,
  orderId,
  files,
  commandId,
  busy,
  renderActions,
}: {
  cases: CaseView[];
  orderId: string;
  files: AfterSalesFileView[];
  commandId: string;
  busy: boolean;
  renderActions?: (item: CaseView) => ReactNode;
}) {
  if (!cases.length) return <p>该订单暂无售后案件。</p>;
  return (
    <div className="shipping-change-history">
      {cases.map((item) => (
        <article key={item.id} className="shipping-change-record">
          <div className="shipping-change-record-heading">
            <strong>
              售后案件 {item.caseNumber} · {adminCaseReasonLabel[item.reason]}
            </strong>
            <span>{item.status === "open" ? "处理中" : "已关闭"}</span>
          </div>
          <p>
            提交时间：{formatPiDate(item.createdAt, "admin")} · 适用政策{" "}
            {item.policyVersion}
          </p>
          <table className="after-sales-table">
            <thead>
              <tr>
                <th>订单行</th>
                <th>批次 / 实际送达（美东）</th>
                <th>数量</th>
                <th>便利退货截止</th>
              </tr>
            </thead>
            <tbody>
              {item.lines.map((line) => (
                <tr key={`${line.lineId}:${line.shipmentId}`}>
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
                    {line.shipmentName} · {line.deliveredDateEt}
                  </td>
                  <td>{line.physicalQuantity}</td>
                  <td>
                    {line.convenienceCutoffAt
                      ? formatPiDate(line.convenienceCutoffAt, "admin")
                      : "不适用"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>客户描述：{item.description}</p>
          <ol className="after-sales-thread">
            {item.messages.map((message) => (
              <li
                key={message.id}
                className={message.visibility === "internal" ? "internal" : ""}
              >
                <strong>
                  {message.authorRole === "customer"
                    ? "客户"
                    : message.authorRole === "system"
                      ? "系统"
                      : "卖方"}
                  {message.visibility === "internal" ? "（内部备注）" : ""}
                </strong>{" "}
                <small>{formatPiDate(message.createdAt, "admin")}</small>
                <p>{message.body}</p>
              </li>
            ))}
          </ol>
          <AdminEvidenceFiles
            orderId={orderId}
            scopeKind="case"
            scopeId={item.id}
            files={files}
            commandId={commandId}
            busy={busy}
          />
          <Form method="post" className="shipping-change-withdraw">
            <input type="hidden" name="intent" value="case-admin-reply" />
            <input type="hidden" name="caseId" value={item.id} />
            <input type="hidden" name="commandId" value={commandId} />
            <label>
              回复 / 备注
              <textarea name="body" required rows={2} />
            </label>
            <label>
              可见范围
              <select name="visibility" defaultValue="customer">
                <option value="customer">客户可见（发送邮件提醒）</option>
                <option value="internal">仅内部备注</option>
              </select>
            </label>
            <button className="button button-secondary" disabled={busy}>
              保存
            </button>
          </Form>
          {renderActions?.(item)}
        </article>
      ))}
    </div>
  );
}
