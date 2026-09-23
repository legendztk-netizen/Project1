import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { Send } from "lucide-react";
import type { PiLifecyclePageData } from "../routes/proforma-invoice-lifecycle";
import type { ReplaceProformaInvoiceCommand } from "../../proforma-invoice/application/pi-lifecycle-service";
import { type PiReplacementReasonCode } from "../../proforma-invoice/domain/pi-lifecycle";
import { piUtcInstant } from "../../proforma-invoice/domain/proforma-invoice";
import { sellerIdentityReadyForPi } from "../../seller-settings/domain/seller-commercial-settings";

const adminReplacementReasons: Record<PiReplacementReasonCode, string> = {
  customer_requested_change: "客户要求变更",
  customer_data_correction: "更正客户提供的信息",
  seller_requested_change: "卖方要求变更",
  seller_packing_estimate_error: "卖方包装估算更正",
  seller_freight_estimate_error: "卖方运费估算更正",
  seller_ddp_duty_estimate_error: "卖方 DDP 关税估算更正",
  seller_import_tax_estimate_error: "卖方进口税估算更正",
  lower_actual_seller_cost: "卖方实际成本降低",
};

export function replacementDeadline(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Invalid Beijing deadline");
  const utc = piUtcInstant(`${value}:00.000Z`);
  return new Date(new Date(utc).getTime() - 8 * 60 * 60 * 1000).toISOString();
}

export function PiReplacementForm({ basis }: { basis: PiLifecyclePageData }) {
  // Capture the entire reviewed basis for this form instance, including all CAS tokens.
  const [captured] = useState(() => structuredClone(basis));
  const { issuance, replacement, requestId } = captured;
  const [sellerId, setSellerId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [reasonCode, setReasonCode] = useState<PiReplacementReasonCode | "">(
    "",
  );
  const [explanation, setExplanation] = useState("");
  const [customerRequested, setCustomerRequested] = useState(false);
  const [customerDataAccurate, setCustomerDataAccurate] = useState(false);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const [fixedPaymentDueDateEt, setFixedPaymentDueDateEt] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const pending = useNavigation().state !== "idle";
  const payment = issuance.payments.find((item) => item.id === paymentId);
  const seller = issuance.seller;
  const next = issuance.quoteRevision;
  const current = captured.history.find(
    (record) => record.id === replacement.expectedPi.piId,
  );
  const hasNext =
    next &&
    next.id !== current?.quoteRevisionId &&
    next.id === replacement.nextQuoteRevisionId;
  let validUntil: string | undefined;
  let invalidDeadline = false;
  try {
    validUntil = deadline ? replacementDeadline(deadline) : undefined;
  } catch {
    invalidDeadline = true;
  }
  const sellerCause =
    reasonCode.startsWith("seller_") ||
    reasonCode === "lower_actual_seller_cost";
  const consistentReason =
    !!reasonCode &&
    !(sellerCause && customerRequested) &&
    !(reasonCode === "customer_requested_change" && !customerRequested) &&
    !(!customerDataAccurate && reasonCode !== "customer_data_correction") &&
    !(reasonCode === "customer_data_correction" && customerDataAccurate);
  const activeJob = (replacement.pdfJobs ?? []).some(
    (job) => job.state !== "failed",
  );
  const blocked =
    !hasNext ||
    !sellerIdentityReadyForPi(seller) ||
    sellerId !== seller?.id ||
    !payment ||
    !issuance.conditionsConfigured ||
    !consistentReason ||
    !explanation.trim() ||
    !evidenceIds.length ||
    evidenceIds.length > 50 ||
    invalidDeadline ||
    !reviewed ||
    activeJob;
  const command: ReplaceProformaInvoiceCommand | null =
    seller && payment && next && reasonCode
      ? {
          requestId,
          commandId: captured.commandId,
          quoteRevisionId: next.id,
          quoteRevisionHash: next.hash,
          sellerIdentityId: seller.id,
          sellerVersion: seller.version,
          paymentChannel: payment.channel,
          paymentInstructionId: payment.id,
          paymentInstructionVersion: payment.version,
          ...(validUntil ? { validUntil } : {}),
          ...(fixedPaymentDueDateEt ? { fixedPaymentDueDateEt } : {}),
          replacement: {
            expectedPi: replacement.expectedPi,
            expectedHeadVersion: replacement.expectedHeadVersion,
            expectedAcceptanceId: replacement.expectedAcceptanceId,
            nextQuoteRevisionId: replacement.nextQuoteRevisionId,
            reason: {
              code: reasonCode,
              customerRequested,
              customerDataAccurate,
              explanation,
              evidenceIds,
            },
          },
        }
      : null;
  return (
    <Form
      method="post"
      className="commercial-settings-form"
      style={{ minWidth: 0 }}
    >
      <input type="hidden" name="intent" value="replace" />
      <input type="hidden" name="command" value={JSON.stringify(command)} />
      <section className="admin-quote-section">
        <h2>替换审核</h2>
        <p>
          当前 PI：{" "}
          {current?.snapshot.documentNumber ?? replacement.expectedPi.piId} -
          版本 {replacement.expectedPi.documentVersion}
        </p>
        <p>
          当前金额：{" "}
          {current
            ? `USD ${(current.snapshot.totals.totalCents / 100).toFixed(2)}`
            : "不可用"}
        </p>
        <p>新报价版本： {next?.id ?? "尚未签发"}</p>
        <Link to={`/admin/quotes/${encodeURIComponent(requestId)}`}>
          查看报价版本
        </Link>
        {!hasNext && <p role="alert">须先签发新的报价版本。</p>}
        {!issuance.conditionsConfigured && (
          <p role="alert">PI 版本化条款尚未配置。</p>
        )}
        {replacement.expectedAcceptanceId && (
          <p>
            卖方包装、运费、DDP
            关税及进口税估算错误不得调整已接受金额；实际成本降低不自动退款。
          </p>
        )}
        <details>
          <summary>已审核的版本标识</summary>
          <p>当前 PI 指针版本： {replacement.expectedHeadVersion}</p>
          <p>接受记录： {replacement.expectedAcceptanceId ?? "尚未接受"}</p>
          <p>快照 SHA-256： {replacement.expectedPi.snapshotHash}</p>
          <p>报价 SHA-256： {next?.hash}</p>
        </details>
      </section>
      <label>
        卖方版本
        <select
          required
          value={sellerId}
          onChange={(event) => {
            setSellerId(event.target.value);
            setReviewed(false);
          }}
          style={{ maxWidth: "100%" }}
        >
          <option value="">请选择卖方版本</option>
          {seller && (
            <option value={seller.id}>
              {seller.legalName} · 版本 {seller.version}
            </option>
          )}
        </select>
      </label>
      {seller && (
        <p style={{ whiteSpace: "pre-wrap" }}>{seller.registeredAddressEn}</p>
      )}
      {!sellerIdentityReadyForPi(seller) && (
        <p role="alert">卖方英文注册地址尚未配置完整。</p>
      )}
      <label>
        付款说明版本
        <select
          required
          value={paymentId}
          onChange={(event) => {
            setPaymentId(event.target.value);
            setReviewed(false);
          }}
          style={{ maxWidth: "100%" }}
        >
          <option value="">请选择付款渠道</option>
          {issuance.payments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.channel === "paypal" ? "PayPal" : "银行转账"} · 版本{" "}
              {item.version}
            </option>
          ))}
        </select>
      </label>
      {payment && (
        <p style={{ whiteSpace: "pre-wrap" }}>{payment.instructions}</p>
      )}
      {!issuance.payments.length && <p role="alert">暂无有效付款说明。</p>}
      <label>
        有效期（北京时间，可选）
        <input
          type="datetime-local"
          value={deadline}
          onChange={(event) => {
            setDeadline(event.target.value);
            setReviewed(false);
          }}
          style={{ maxWidth: "100%" }}
        />
      </label>
      <label>
        固定付款截止日（美国东部日期；留空为接受后 10 个美国银行工作日）
        <input
          type="date"
          value={fixedPaymentDueDateEt}
          onChange={(event) => {
            setFixedPaymentDueDateEt(event.target.value);
            setReviewed(false);
          }}
        />
      </label>
      <label>
        替换原因
        <select
          required
          value={reasonCode}
          onChange={(event) => {
            setReasonCode(event.target.value as PiReplacementReasonCode);
            setReviewed(false);
          }}
          style={{ maxWidth: "100%" }}
        >
          <option value="">请选择已审核的原因</option>
          {Object.entries(adminReplacementReasons).map(([code, label]) => (
            <option value={code} key={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={customerRequested}
          onChange={(event) => {
            setCustomerRequested(event.target.checked);
            setReviewed(false);
          }}
        />{" "}
        客户要求此次变更
      </label>
      <label>
        <input
          type="checkbox"
          checked={customerDataAccurate}
          onChange={(event) => {
            setCustomerDataAccurate(event.target.checked);
            setReviewed(false);
          }}
        />{" "}
        客户提供的信息准确
      </label>
      <label>
        审核说明
        <textarea
          required
          maxLength={2000}
          value={explanation}
          onChange={(event) => {
            setExplanation(event.target.value);
            setReviewed(false);
          }}
          rows={3}
        />
      </label>
      <fieldset style={{ minWidth: 0 }}>
        <legend>关联证据</legend>
        {(replacement.evidence ?? []).map((item) => (
          <label
            key={item.id}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              overflowWrap: "anywhere",
            }}
          >
            <input
              type="checkbox"
              checked={evidenceIds.includes(item.id)}
              onChange={(event) => {
                setEvidenceIds((ids) =>
                  event.target.checked
                    ? [...ids, item.id]
                    : ids.filter((id) => id !== item.id),
                );
                setReviewed(false);
              }}
            />
            <span>
              {{ note: "内部备注", file: "附件", message: "对话" }[item.kind] ??
                "证据"}
              ：{item.label || item.id}
            </span>
          </label>
        ))}
        {!replacement.evidence?.length && (
          <p>
            暂无关联证据。{" "}
            <Link to={`/admin/quotes/${encodeURIComponent(requestId)}`}>
              打开询价审核
            </Link>
          </p>
        )}
      </fieldset>
      {reasonCode && !consistentReason && (
        <p role="alert">变更原因与客户信息审核结论不一致。</p>
      )}
      <label>
        <input
          type="checkbox"
          name="reviewed"
          checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)}
          required
        />{" "}
        我已审核上述确切版本，替换 PI 需要客户重新接受
      </label>
      <button
        className="button button-primary"
        type="submit"
        disabled={pending || blocked}
      >
        <Send size={17} />
        {pending ? "正在提交替换" : "签发替换 PI"}
      </button>
    </Form>
  );
}
