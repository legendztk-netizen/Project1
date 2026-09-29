import type { ReactNode } from "react";
import { Link } from "react-router";
import { MessagesSquare, Paperclip } from "lucide-react";

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

export const adminCaseStatusLabel: Record<CaseView["status"], string> = {
  open: "处理中",
  closed: "已关闭",
};

export function AdminCases({
  cases,
  orderId,
  requestId,
  files,
  commandId,
  busy,
  renderActions,
  renderDetails,
}: {
  cases: CaseView[];
  orderId: string;
  requestId: string;
  files: AfterSalesFileView[];
  commandId: string;
  busy: boolean;
  renderActions?: (item: CaseView) => ReactNode;
  renderDetails?: (item: CaseView) => ReactNode;
}) {
  if (!cases.length) return <p>该订单暂无售后案件。</p>;
  const fileHref = (fileId: string) =>
    `/admin/orders/${encodeURIComponent(orderId)}/after-sales/files/${encodeURIComponent(fileId)}`;
  return (
    <div className="after-sales-case-list">
      {cases.map((item) => {
        const caseFiles = files.filter(
          (file) => file.scopeKind === "case" && file.scopeId === item.id,
        );
        const customerFiles = caseFiles.filter(
          (file) => file.uploaderRole === "customer",
        );
        const fileName = (id: string) =>
          caseFiles.find((file) => file.id === id)?.filename ?? "附件";
        return (
          <article key={item.id} className="after-sales-case-card">
            <header className="after-sales-case-header">
              <div>
                <h3>
                  {item.caseNumber} · {adminCaseReasonLabel[item.reason]}
                </h3>
                <small>
                  提交 {formatPiDate(item.createdAt, "admin")} · 政策{" "}
                  {item.policyVersion}
                </small>
              </div>
              <span
                className={`after-sales-status after-sales-status-${item.status}`}
              >
                {adminCaseStatusLabel[item.status]}
              </span>
            </header>
            <div className="after-sales-case-actions">
              {renderActions?.(item)}
              <Link
                className="button button-secondary"
                to={`/admin/messages/${encodeURIComponent(requestId)}?case=${encodeURIComponent(item.id)}#latest`}
              >
                <MessagesSquare size={17} aria-hidden="true" />
                客户对话
              </Link>
            </div>
            <div className="after-sales-case-grid">
              <section className="after-sales-case-section">
                <h4>申报商品</h4>
                <ul className="after-sales-compact-lines">
                  {item.lines.map((line) => (
                    <li key={`${line.lineId}:${line.shipmentId}`}>
                      <span>
                        <strong>
                          #{line.lineNumber} {line.displayName}
                        </strong>
                        <small>
                          {line.sku} · {productClassLabel[line.productClass]}
                          {line.pieceLengthFt !== null
                            ? ` · 每段 ${line.pieceLengthFt} ft`
                            : ""}{" "}
                          · {line.shipmentName} · 送达（美东）
                          {line.deliveredDateEt}
                          {line.convenienceCutoffAt
                            ? ` · 便利退货截止 ${formatPiDate(line.convenienceCutoffAt, "admin")}`
                            : ""}
                        </small>
                      </span>
                      <b>× {line.physicalQuantity}</b>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="after-sales-case-section">
                <h4>客户描述</h4>
                <p className="after-sales-description">{item.description}</p>
                {customerFiles.length > 0 && (
                  <ul className="after-sales-file-links">
                    {customerFiles.map((file) => (
                      <li key={file.id}>
                        <a href={fileHref(file.id)}>
                          <Paperclip size={14} aria-hidden="true" />
                          {file.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            {renderDetails?.(item)}
            <section className="after-sales-case-section">
              <h4>操作记录</h4>
              <ol className="after-sales-timeline">
                <li>
                  <time dateTime={item.createdAt}>
                    {formatPiDate(item.createdAt, "admin")}
                  </time>
                  <p>客户提交售后申请</p>
                </li>
                {item.events.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.createdAt}>
                      {formatPiDate(event.createdAt, "admin")}
                    </time>
                    <p>{event.body}</p>
                    {event.fileIds.length > 0 && (
                      <ul className="after-sales-file-links">
                        {event.fileIds.map((fileId) => (
                          <li key={fileId}>
                            <a href={fileHref(fileId)}>
                              <Paperclip size={14} aria-hidden="true" />
                              {fileName(fileId)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            <details className="after-sales-evidence">
              <summary>案件附件与内部证据（{caseFiles.length}）</summary>
              <AdminEvidenceFiles
                orderId={orderId}
                scopeKind="case"
                scopeId={item.id}
                files={files}
                commandId={commandId}
                busy={busy}
              />
            </details>
          </article>
        );
      })}
    </div>
  );
}
