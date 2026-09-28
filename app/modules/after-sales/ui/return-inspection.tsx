import { Form } from "react-router";

import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import {
  InspectionDecisionForm,
  conditionLabels,
} from "./inspection-decision-form";
import type { AfterSalesFileView } from "../application/after-sales-files";
import type { CaseView } from "../application/case-service";
import type { ReturnAuthorizationView } from "../application/return-authorization-service";
import type { ReceiptView } from "../application/return-inspection-service";
import { AdminEvidenceFiles } from "./admin-exceptional";
import { RefundBreakdown, refundStatusLabel } from "./refund-breakdown";
import { scopedField } from "../application/parse-after-sales-forms";
import { AdminActionDialog, EventAttachmentField } from "./admin-action-dialog";
import "./after-sales.css";

const outcomeZh: Record<string, string> = {
  approved: "批准",
  partially_approved: "部分批准",
  declined: "拒绝",
};

export function AdminReceiptRecordActions({
  item,
  ras,
  receipts,
  commandId,
  busy,
}: {
  item: CaseView;
  ras: ReturnAuthorizationView[];
  receipts: ReceiptView[];
  commandId: string;
  busy: boolean;
}) {
  const caseRas = ras.filter((ra) => ra.caseId === item.id);
  const name = (lineId: string) =>
    item.lines.find((line) => line.lineId === lineId)?.displayName ?? lineId;
  if (item.status !== "open") return null;
  return (
    <>
      {caseRas.map((ra) => {
        const received = (lineId: string, shipmentId: string) =>
          receipts
            .filter((receipt) => receipt.raId === ra.id)
            .flatMap((receipt) => receipt.lines)
            .filter(
              (line) =>
                line.lineId === lineId && line.shipmentId === shipmentId,
            )
            .reduce((sum, line) => sum + line.physicalQuantity, 0);
        const remaining = ra.lines.map((line) => ({
          ...line,
          remaining:
            line.physicalQuantity - received(line.lineId, line.shipmentId),
        }));
        if (!remaining.some((line) => line.remaining > 0)) return null;
        return (
          <AdminActionDialog
            key={ra.id}
            label={`记录 ${ra.raNumber} 收货`}
            title={`记录 ${ra.raNumber} 的实际收货`}
            wide
          >
            <Form method="post" className="shipping-change-form">
              <input type="hidden" name="intent" value="return-receive" />
              <input type="hidden" name="raId" value={ra.id} />
              <input type="hidden" name="commandId" value={commandId} />
              <div className="shipping-change-fields">
                <label>
                  实际到货时间（北京时间）
                  <input type="datetime-local" name="receivedAt" required />
                </label>
                <label>
                  收货证据来源
                  <input name="source" required />
                </label>
                <label>
                  包裹 / 运单号（可选）
                  <input name="packageReference" />
                </label>
                <label>
                  未授权或多余货物说明（不计入收货数量）
                  <input name="excessNote" />
                </label>
              </div>
              <div className="after-sales-quantity-list">
                {remaining.map((line) => (
                  <label
                    key={`${line.lineId}:${line.shipmentId}`}
                    className="after-sales-quantity-row"
                  >
                    <span>
                      <strong>{name(line.lineId)}</strong>
                      <small>尚未收到 {line.remaining}</small>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={line.remaining}
                      step={1}
                      defaultValue={0}
                      name={scopedField(
                        "receiveQty",
                        line.lineId,
                        line.shipmentId,
                      )}
                      aria-label={`${name(line.lineId)} 实收数量`}
                    />
                  </label>
                ))}
              </div>
              <p>
                到货晚于 RA 截止（{formatPiDate(ra.arrivalDeadlineAt, "admin")}
                ）将标记为逾期到货，需另行审核后才能检验，不得倒填时间。
              </p>
              <button className="button button-primary" disabled={busy}>
                保存收货记录
              </button>
            </Form>
          </AdminActionDialog>
        );
      })}
    </>
  );
}

export function AdminReturnReceipts({
  item,
  receipts,
  files,
  orderId,
  commandId,
  busy,
}: {
  item: CaseView;
  receipts: ReceiptView[];
  files: AfterSalesFileView[];
  orderId: string;
  commandId: string;
  busy: boolean;
}) {
  const name = (lineId: string) =>
    item.lines.find((line) => line.lineId === lineId)?.displayName ?? lineId;
  const caseReceipts = receipts.filter((receipt) => receipt.caseId === item.id);
  if (!caseReceipts.length) return null;
  return (
    <div className="after-sales-receipt-list">
      {caseReceipts.map((receipt) => (
        <section key={receipt.id} className="shipping-change-proposal">
          <h4>
            收货 {formatPiDate(receipt.receivedAt, "admin")}
            {receipt.timeliness === "late" ? " · 逾期到货" : ""}
            {receipt.inspectionOverdue ? " · 检验已超期" : ""}
          </h4>
          <p>
            登记时间 {formatPiDate(receipt.recordedAt, "admin")} · 来源{" "}
            {receipt.source}
            {receipt.packageReference ? ` · ${receipt.packageReference}` : ""}
            {receipt.excessNote ? ` · 多余/未授权：${receipt.excessNote}` : ""}
          </p>
          <p>
            检验决定期限：
            {formatPiDate(receipt.inspectionDeadlineAt, "admin")}
            （5 个美国工作日，超期仅内部提醒）
          </p>
          <ul className="after-sales-line-list">
            {receipt.lines.map((line) => (
              <li key={`${line.lineId}:${line.shipmentId}`}>
                {name(line.lineId)} × {line.physicalQuantity}
              </li>
            ))}
          </ul>
          <AdminEvidenceFiles
            orderId={orderId}
            scopeKind="inspection"
            scopeId={receipt.id}
            files={files}
            commandId={commandId}
            busy={busy}
          />
          {receipt.timeliness === "late" && !receipt.lateReviewed && (
            <div className="after-sales-case-actions">
              <AdminActionDialog label="审核逾期到货">
                <Form method="post" className="shipping-change-form">
                  <input
                    type="hidden"
                    name="intent"
                    value="return-late-review"
                  />
                  <input type="hidden" name="receiptId" value={receipt.id} />
                  <input type="hidden" name="commandId" value={commandId} />
                  <label>
                    逾期到货审核记录（接受检验的依据）
                    <textarea name="note" required rows={3} />
                  </label>
                  <button className="button button-primary" disabled={busy}>
                    记录审核并允许检验
                  </button>
                </Form>
              </AdminActionDialog>
            </div>
          )}
          {receipt.decision ? (
            <div>
              <p>
                <strong>
                  检验决定：{outcomeZh[receipt.decision.outcome]} ·{" "}
                  {receipt.decision.responsibility === "customer"
                    ? "客户原因退货"
                    : "卖方责任"}{" "}
                  ·{" "}
                  {receipt.decision.remedy === "replacement"
                    ? "更换"
                    : receipt.decision.remedy === "refund"
                      ? "退款"
                      : "无补救"}
                </strong>
              </p>
              {receipt.decision.customerReason && (
                <p>客户可见原因：{receipt.decision.customerReason}</p>
              )}
              {receipt.decision.replacement && (
                <p>
                  更换范围：{receipt.decision.replacement.scope} · 费用：
                  {receipt.decision.replacement.costs}
                  {receipt.decision.replacement.fulfillmentEvidence
                    ? ` · 履约证据：${receipt.decision.replacement.fulfillmentEvidence}`
                    : ""}
                </p>
              )}
              {receipt.inspection?.map((row) => (
                <p key={`${row.lineId}:${row.shipmentId}`}>
                  {name(row.lineId)}：检验 {row.inspectedQuantity}，批准{" "}
                  {row.approvedQuantity}；
                  {conditionLabels
                    .filter(([key]) => row.conditions[key])
                    .map(([key, label]) => `${label}：${row.conditions[key]}`)
                    .join("；")}
                </p>
              ))}
              {receipt.decision.revisions.map((revision) => (
                <p key={revision.id}>
                  修订 #{revision.revisionNumber}（
                  {formatPiDate(revision.createdAt, "admin")}）：
                  {outcomeZh[revision.outcome]} · {revision.customerReason} ·{" "}
                  {revision.financialEffect === "supplemental"
                    ? "已生成补充退款"
                    : revision.financialEffect === "replaced"
                      ? "未发起前已替换退款授权"
                      : revision.financialEffect === "flagged"
                        ? "已发起金额不变，需人工复核"
                        : "金额不变"}
                </p>
              ))}
              {receipt.decision.refunds.map((refund) => (
                <div key={refund.id}>
                  <p>
                    <strong>
                      {refund.sourceKind === "supplemental"
                        ? "补充退款 · "
                        : ""}
                      {refundStatusLabel(refund, "zh")}
                    </strong>
                  </p>
                  <RefundBreakdown refund={refund} language="zh" />
                </div>
              ))}
              <div className="after-sales-case-actions">
                <AdminActionDialog
                  label="修订检验决定"
                  title="追加检验决定修订（不覆盖历史）"
                >
                  <Form
                    method="post"
                    encType="multipart/form-data"
                    className="shipping-change-form"
                  >
                    <input type="hidden" name="intent" value="return-revise" />
                    <input type="hidden" name="caseId" value={item.id} />
                    <input
                      type="hidden"
                      name="decisionId"
                      value={receipt.decision.id}
                    />
                    <input
                      type="hidden"
                      name="expectedRevision"
                      value={receipt.decision.revisions.length}
                    />
                    <input type="hidden" name="commandId" value={commandId} />
                    {(
                      receipt.decision.revisions.at(-1)?.effective.lines ??
                      receipt.decision.lines
                    ).map((line) => (
                      <label
                        key={`${line.lineId}:${line.shipmentId}`}
                        className="after-sales-quantity-row"
                      >
                        <span>
                          <strong>{line.displayName}</strong>
                          <small>
                            已检验 {line.receivedQuantity} · 当前批准{" "}
                            {line.approvedQuantity}
                          </small>
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={line.receivedQuantity}
                          step={1}
                          defaultValue={line.approvedQuantity}
                          name={scopedField(
                            "reviseApprove",
                            line.lineId,
                            line.shipmentId,
                          )}
                          aria-label={`${line.displayName} 修订后批准数量`}
                        />
                      </label>
                    ))}
                    <label>
                      修订原因（客户可见，必填）
                      <textarea name="customerReason" required rows={3} />
                    </label>
                    <EventAttachmentField />
                    <p>
                      已发起的退款不会被修改；增加的金额生成补充退款，减少的金额仅标记待复核。
                    </p>
                    <button className="button button-primary" disabled={busy}>
                      追加修订
                    </button>
                  </Form>
                </AdminActionDialog>
              </div>
            </div>
          ) : (
            (receipt.timeliness === "timely" || receipt.lateReviewed) && (
              <div className="after-sales-case-actions">
                <AdminActionDialog
                  label="检验并退款"
                  title="检验并退款"
                  description="确认线下检验结果并批准退款或更换。此操作不会打款；退款批准后，仍需在退款区记录实际发起。"
                  primary
                  wide
                >
                  <InspectionDecisionForm
                    item={item}
                    receipt={receipt}
                    commandId={commandId}
                    busy={busy}
                  />
                </AdminActionDialog>
              </div>
            )
          )}
        </section>
      ))}
    </div>
  );
}
