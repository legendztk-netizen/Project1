import { Form } from "react-router";

import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type { AfterSalesFileView } from "../application/after-sales-files";
import { productClassLabel } from "./admin-cancellations";
import "../../shipment/ui/order-shipping-changes.css";
import { scopedField } from "../application/parse-after-sales-forms";
import { AdminActionDialog } from "./admin-action-dialog";
import "./after-sales.css";

interface ExceptionalEligible {
  lineId: string;
  shipmentId: string | null;
  available: number;
  displayName: string;
  sku: string;
  productClass: string;
  pieceLengthFt: number | null;
  shipmentName: string | null;
}

export function AdminExceptionalOpenForm({
  eligible,
  commandId,
  busy,
}: {
  eligible: ExceptionalEligible[];
  commandId: string;
  busy: boolean;
}) {
  if (!eligible.length) return null;
  return (
    <AdminActionDialog
      label="记录客服发起的取消审核"
      title="记录客服发起的定制品 / 未切割软管取消审核"
      wide
    >
      <Form method="post" className="shipping-change-form">
        <input
          type="hidden"
          name="intent"
          value="cancellation-open-exceptional"
        />
        <input type="hidden" name="commandId" value={commandId} />
        <p>
          仅在客户联系客服后使用。提交后锁定所选实物数量，等待依据工厂实际情况作出决定；不得修改已批准规格。
        </p>
        <fieldset>
          <legend>涉及的实物数量</legend>
          <div className="after-sales-quantity-list">
            {eligible.map((item) => (
              <label
                key={`${item.lineId}:${item.shipmentId ?? ""}`}
                className="after-sales-quantity-row"
              >
                <span>
                  <strong>{item.displayName}</strong>
                  <small>
                    {item.sku} · {productClassLabel[item.productClass]}
                    {item.pieceLengthFt !== null
                      ? ` · 每段 ${item.pieceLengthFt} ft（按段数计）`
                      : ""}
                    {item.shipmentName ? ` · ${item.shipmentName}` : ""} · 最多{" "}
                    {item.available}
                  </small>
                </span>
                <input
                  type="number"
                  min={0}
                  max={item.available}
                  step={1}
                  defaultValue={0}
                  name={scopedField("cancelQty", item.lineId, item.shipmentId)}
                  aria-label={`${item.displayName} 审核数量`}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          客服联系记录编号 / 会话引用
          <input name="supportReference" required />
        </label>
        <label>
          客户反映的问题（客户可见摘要）
          <textarea name="reason" required rows={2} />
        </label>
        <button className="button button-primary" disabled={busy}>
          锁定数量并开始审核
        </button>
      </Form>
    </AdminActionDialog>
  );
}

export function FactoryEvidenceFields({
  files,
  hasCutHose,
}: {
  files: AfterSalesFileView[];
  hasCutHose: boolean;
}) {
  return (
    <fieldset>
      <legend>工厂实际信息（必填；网站没有生产记录不代表未开工）</legend>
      <div className="shipping-change-fields">
        <label>
          实际工厂状态
          <input name="factoryStatus" required />
        </label>
        <label>
          信息来源（人员 / 渠道）
          <input name="factorySource" required />
        </label>
        <label>
          核实时间（北京时间）
          <input name="factoryReviewedAt" type="datetime-local" required />
        </label>
        <label>
          客服联系记录编号
          <input name="factorySupportReference" required />
        </label>
        <label>
          外部标识（工厂单号等，可选）
          <input name="factoryExternalIdentifiers" />
        </label>
        {hasCutHose && (
          <label className="shipping-change-choice">
            <input type="checkbox" name="factoryPrecut" />
            已有书面记录确认软管尚未切割（批准按长度订购软管取消的必要条件）
          </label>
        )}
      </div>
      {files.length > 0 && (
        <div>
          <p>引用的私密附件：</p>
          {files.map((file) => (
            <label key={file.id} className="shipping-change-choice">
              <input
                type="checkbox"
                name="factoryAttachmentId"
                value={file.id}
              />
              {file.filename}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function AdminEvidenceFiles({
  orderId,
  scopeKind,
  scopeId,
  files,
  commandId,
  busy,
}: {
  orderId: string;
  scopeKind: "cancellation" | "case" | "inspection";
  scopeId: string;
  files: AfterSalesFileView[];
  commandId: string;
  busy: boolean;
}) {
  const scoped = files.filter(
    (file) => file.scopeKind === scopeKind && file.scopeId === scopeId,
  );
  return (
    <div className="after-sales-files">
      <h5>私密附件（默认仅内部可见）</h5>
      {scoped.length ? (
        <ul>
          {scoped.map((file) => (
            <li key={file.id}>
              <a
                href={`/admin/orders/${encodeURIComponent(orderId)}/after-sales/files/${encodeURIComponent(file.id)}`}
              >
                {file.filename}
              </a>{" "}
              · {file.uploaderRole === "customer" ? "客户上传" : "内部"} ·{" "}
              {file.visibility === "shared"
                ? `已向客户共享（${file.shareReason}）`
                : file.visibility === "customer"
                  ? "客户可见"
                  : "仅内部"}{" "}
              · {formatPiDate(file.createdAt, "admin")}
              {file.visibility === "internal" &&
                scopeKind !== "cancellation" && (
                  <Form method="post" className="after-sales-inline-form">
                    <input
                      type="hidden"
                      name="intent"
                      value="after-sales-file-share"
                    />
                    <input type="hidden" name="fileId" value={file.id} />
                    <input
                      name="shareReason"
                      required
                      placeholder="共享理由（支持客户可见说明）"
                      aria-label={`${file.filename} 共享理由`}
                    />
                    <button className="button button-secondary" disabled={busy}>
                      向客户共享此文件
                    </button>
                  </Form>
                )}
            </li>
          ))}
        </ul>
      ) : (
        <p>暂无附件。</p>
      )}
      <Form
        method="post"
        encType="multipart/form-data"
        className="after-sales-inline-form"
      >
        <input type="hidden" name="intent" value="after-sales-file-upload" />
        <input type="hidden" name="scopeKind" value={scopeKind} />
        <input type="hidden" name="scopeId" value={scopeId} />
        <input type="hidden" name="commandId" value={commandId} />
        <input
          type="file"
          name="file"
          required
          accept="application/pdf,image/png,image/jpeg"
          aria-label="上传私密附件"
        />
        <button className="button button-secondary" disabled={busy}>
          上传（PDF / PNG / JPEG，≤10 MB）
        </button>
      </Form>
    </div>
  );
}
