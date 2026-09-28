import { Form } from "react-router";

import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type { CaseView } from "../application/case-service";
import type { ReturnAuthorizationView } from "../application/return-authorization-service";
import { etDisplayDate } from "../domain/return-policy";
import { scopedField } from "../application/parse-after-sales-forms";
import { Ban, CircleX, PackageCheck } from "lucide-react";
import { AdminActionDialog, EventAttachmentField } from "./admin-action-dialog";
import "./after-sales.css";

type Ra = ReturnAuthorizationView & { reviewNote?: string | null };

export function CustomerReturnAuthorizations({
  ras,
  lineName,
}: {
  ras: Ra[];
  lineName: (lineId: string) => string;
}) {
  if (!ras.length) return null;
  return (
    <div className="after-sales-ra-list">
      {ras.map((ra) => (
        <section key={ra.id} className="shipping-change-proposal">
          <h4>
            Return Authorization {ra.raNumber}
            {ra.expired ? " — expired" : ""}
          </h4>
          {ra.expired ? (
            <p role="status">
              This authorization expired at 11:59 PM ET on{" "}
              {etDisplayDate(ra.arrivalDeadlineDateEt)}. Please don&apos;t send
              the goods; message us and we will review again.
            </p>
          ) : (
            <p>
              Must arrive by 11:59 PM ET on{" "}
              {etDisplayDate(ra.arrivalDeadlineDateEt)}. Shipping before that
              date is not enough. An RA authorizes return for inspection; it
              doesn&apos;t approve a refund.
            </p>
          )}
          <ul className="after-sales-line-list">
            {ra.lines.map((line) => (
              <li key={`${line.lineId}:${line.shipmentId}`}>
                {lineName(line.lineId)} × {line.physicalQuantity}
              </li>
            ))}
          </ul>
          {!ra.expired && (
            <>
              <p>
                <strong>Return to</strong>
              </p>
              <address className="after-sales-address">
                {ra.location.label}
                <br />
                {ra.location.address.split(/\r?\n/).map((line) => (
                  <span key={line}>
                    {line}
                    <br />
                  </span>
                ))}
                {ra.location.phone}
              </address>
              <p className="after-sales-instructions">{ra.instructions}</p>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

export function AdminReturnAuthorizationList({
  item,
  ras,
}: {
  item: CaseView;
  ras: Ra[];
}) {
  const caseRas = ras.filter((ra) => ra.caseId === item.id);
  if (!caseRas.length) return null;
  return (
    <div className="after-sales-ra-list">
      {caseRas.map((ra) => (
        <section key={ra.id} className="after-sales-ra-card">
          <header>
            <strong>{ra.raNumber}</strong>
            <span
              className={`after-sales-status ${ra.expired ? "after-sales-status-closed" : "after-sales-status-open"}`}
            >
              {ra.expired ? "已过期（仅关闭授权）" : "有效"}
            </span>
          </header>
          <dl className="after-sales-facts">
            <div>
              <dt>签发</dt>
              <dd>{formatPiDate(ra.issuedAt, "admin")}</dd>
            </div>
            <div>
              <dt>到货截止</dt>
              <dd>
                美东 {ra.arrivalDeadlineDateEt} 23:59（
                {formatPiDate(ra.arrivalDeadlineAt, "admin")}）
              </dd>
            </div>
            <div>
              <dt>退货地址</dt>
              <dd>
                {ra.location.label} · {ra.location.address.replace(/\n/g, "，")}{" "}
                · {ra.location.phone}
              </dd>
            </div>
            <div>
              <dt>授权数量</dt>
              <dd>
                {ra.lines
                  .map(
                    (line) =>
                      `${
                        item.lines.find(
                          (candidate) => candidate.lineId === line.lineId,
                        )?.displayName ?? line.lineId
                      } × ${line.physicalQuantity}`,
                  )
                  .join("；")}
              </dd>
            </div>
            <div>
              <dt>退货说明</dt>
              <dd>{ra.instructions}</dd>
            </div>
            {ra.reviewNote && (
              <div>
                <dt>重新审核</dt>
                <dd>{ra.reviewNote}</dd>
              </div>
            )}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Case-level decisions, each opened from a button into a dialog. */
export function AdminCaseDecisionActions({
  item,
  ras,
  locations,
  commandId,
  busy,
}: {
  item: CaseView;
  ras: Ra[];
  locations: Array<{ id: string; label: string; address: string }>;
  commandId: string;
  busy: boolean;
}) {
  if (item.status !== "open") return null;
  const caseRas = ras.filter((ra) => ra.caseId === item.id);
  const active = caseRas.filter((ra) => !ra.expired);
  const expired = caseRas.filter((ra) => ra.expired);
  const authorized = (lineId: string, shipmentId: string) =>
    active
      .flatMap((ra) => ra.lines)
      .filter(
        (line) => line.lineId === lineId && line.shipmentId === shipmentId,
      )
      .reduce((sum, line) => sum + line.physicalQuantity, 0);
  const authorizable = item.lines.some(
    (line) =>
      line.physicalQuantity - authorized(line.lineId, line.shipmentId) > 0,
  );
  return (
    <>
      {authorizable && (
        <AdminActionDialog
          label="签发退货授权（RA）"
          description="RA 只授权退回检验，不代表批准退款；到货期限为签发日（美东）+30 天 23:59。"
          icon={<PackageCheck size={17} aria-hidden="true" />}
          primary
          wide
        >
          <Form
            method="post"
            encType="multipart/form-data"
            className="shipping-change-form"
          >
            <input type="hidden" name="intent" value="case-issue-ra" />
            <input type="hidden" name="caseId" value={item.id} />
            <input type="hidden" name="commandId" value={commandId} />
            <label>
              退货地点（仅向获授权客户显示冻结后的地址）
              <select name="locationId" required defaultValue="">
                <option value="" disabled>
                  请选择
                </option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>授权退回的实物数量</legend>
              <div className="after-sales-quantity-list">
                {item.lines.map((line) => {
                  const remaining = Math.max(
                    0,
                    line.physicalQuantity -
                      authorized(line.lineId, line.shipmentId),
                  );
                  return (
                    <label
                      key={`${line.lineId}:${line.shipmentId}`}
                      className="after-sales-quantity-row"
                    >
                      <span>
                        <strong>{line.displayName}</strong>
                        <small>
                          {line.shipmentName} · 可授权 {remaining}
                        </small>
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        step={1}
                        defaultValue={remaining}
                        name={scopedField(
                          "raQty",
                          line.lineId,
                          line.shipmentId,
                        )}
                        aria-label={`${line.displayName} 授权数量`}
                      />
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label>
              退货与包装说明（冻结在 RA 中，客户可见）
              <textarea name="instructions" required rows={4} />
            </label>
            {expired.length > 0 && (
              <>
                <label>
                  重新授权所接续的已过期 RA
                  <select name="previousRaId" defaultValue={expired.at(-1)!.id}>
                    {expired.map((ra) => (
                      <option key={ra.id} value={ra.id}>
                        {ra.raNumber}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  重新审核记录（必填）
                  <textarea name="reviewNote" required rows={2} />
                </label>
              </>
            )}
            <EventAttachmentField />
            <button className="button button-primary" disabled={busy}>
              签发 RA
            </button>
          </Form>
        </AdminActionDialog>
      )}
      <AdminActionDialog
        label="不予授权"
        title="不予授权退货"
        description="案件保持处理中，客户会收到原因说明，可在站内信中补充信息。"
        icon={<Ban size={17} aria-hidden="true" />}
      >
        <Form
          method="post"
          encType="multipart/form-data"
          className="shipping-change-form"
        >
          <input type="hidden" name="intent" value="case-decline-return" />
          <input type="hidden" name="caseId" value={item.id} />
          <input type="hidden" name="commandId" value={commandId} />
          <label>
            不予授权的原因（客户可见，必填）
            <textarea name="reason" required rows={4} />
          </label>
          <EventAttachmentField />
          <button className="button button-primary" disabled={busy}>
            告知客户不予授权
          </button>
        </Form>
      </AdminActionDialog>
      <AdminActionDialog
        label="关闭案件"
        description="关闭说明会显示在客户订单的售后记录中。"
        icon={<CircleX size={17} aria-hidden="true" />}
      >
        <Form
          method="post"
          encType="multipart/form-data"
          className="shipping-change-form"
        >
          <input type="hidden" name="intent" value="case-close" />
          <input type="hidden" name="caseId" value={item.id} />
          <input type="hidden" name="expectedVersion" value={item.version} />
          <input type="hidden" name="commandId" value={commandId} />
          <label>
            关闭说明（客户可见，必填）
            <textarea name="reason" required rows={4} />
          </label>
          <EventAttachmentField />
          <button className="button button-primary" disabled={busy}>
            关闭案件
          </button>
        </Form>
      </AdminActionDialog>
    </>
  );
}
