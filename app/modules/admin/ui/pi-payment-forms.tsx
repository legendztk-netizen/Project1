import { useState } from "react";
import { Form, useFetcher, useLocation, useNavigation } from "react-router";
import { Save, Search } from "lucide-react";
import type { loader, PiPaymentsPageData } from "../routes/pi-payments";
import { parseUsdCents } from "../../proforma-invoice/application/pi-payment-service";
import { originalCurrencies, type PaymentPanel } from "./pi-payment-actions";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";

export function PiPaymentForms({
  loaderData,
  panel,
  receiptId,
  blockedReason,
  onClose,
}: {
  loaderData: PiPaymentsPageData;
  panel: PaymentPanel;
  receiptId: string | null;
  blockedReason?: string;
  onClose: () => void;
}) {
  const { payment, funds, correction, choices, commandId, targetId } =
    loaderData;
  const pending = useNavigation().state !== "idle";
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  query.set("piId", payment.piId);
  const formAction = `${location.pathname}?${query}`;
  const [amount, setAmount] = useState(
    (payment.amountReceivedCents / 100).toFixed(2),
  );
  const [currency, setCurrency] = useState("");
  const currencyDigits = currency
    ? (new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2)
    : 2;
  const [targetLookup, setTargetLookup] = useState(targetId);
  const targetFetcher = useFetcher<typeof loader>();
  const targetBasis = targetFetcher.data ?? loaderData;
  const target =
    targetBasis.targetId === targetLookup.trim() ? targetBasis.target : null;
  const receipt = payment.originalCurrencyReceipts.find(
    (entry) => entry.id === receiptId,
  );
  const money = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
  let preview: number | null = null;
  try {
    preview = parseUsdCents(amount);
  } catch {
    /* Incomplete amounts remain editable. */
  }
  const effectivePreview =
    preview === null
      ? null
      : preview +
        payment.allocatedInCents -
        payment.allocatedOutCents -
        payment.refundedCents;
  if (
    panel === "refund-original" &&
    (!receipt ||
      receipt.amountMinor === null ||
      receipt.refundedMinor === null ||
      receipt.currencyDigits === null)
  ) {
    return (
      <p className="payment-dialog-body">该记录缺少精确余额，请先人工核对。</p>
    );
  }
  if (panel === "retain-agreement") {
    const agreement = loaderData.agreement;
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <input type="hidden" name="intent" value="retain-agreement" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={payment.version} />
          <input
            type="hidden"
            name="expectedHeadVersion"
            value={agreement.headVersion}
          />
          <input
            type="hidden"
            name="acceptanceId"
            value={agreement.acceptanceId ?? ""}
          />
          <input
            type="hidden"
            name="documentVersion"
            value={agreement.documentVersion}
          />
          <input
            type="hidden"
            name="snapshotHash"
            value={agreement.snapshotHash}
          />
          <input
            type="hidden"
            name="latestQuoteRevisionId"
            value={agreement.latestQuoteRevisionId}
          />
          <input
            type="hidden"
            name="noPaymentDeadline"
            value={String(agreement.noPaymentDeadline)}
          />
          <p>
            <strong>
              {agreement.documentNumber} · 版本 {agreement.documentVersion}
            </strong>
          </p>
          <p>
            客户接受时间：
            {agreement.acceptedAt
              ? formatPiDate(agreement.acceptedAt, "admin")
              : "未接受"}
          </p>
          <p>
            保留原 PI、PDF
            和客户接受记录，不采用后续误操作的报价改动，不自动确认到账。
          </p>
          <p>
            {agreement.noPaymentDeadline
              ? "该协议未约定付款截止日。确认后不补设日期，仍需核实全款并人工确认付款。"
              : "原协议的付款期限和金额保持不变。"}
          </p>
          <label>
            保留原因
            <textarea name="reason" required maxLength={1000} />
          </label>
          <label className="payment-checkbox">
            <input type="checkbox" name="reviewed" required />
            我已核对客户接受的 PI，确认以该版本为最终协议。
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            disabled={pending || Boolean(blockedReason)}
          >
            <Save size={18} />
            确认保留原协议
          </button>
        </footer>
      </Form>
    );
  }
  if (panel === "received")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <p className="payment-form-context">
            填写核实后的累计到账总额。当前已登记{" "}
            {payment.receiptHistoryKnown
              ? money(payment.amountReceivedCents)
              : "待核对"}
            。
          </p>

          <input type="hidden" name="intent" value="received" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={payment.version} />
          <label>
            累计到账金额（USD）
            <input
              name="amount"
              inputMode="decimal"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label>
            实际到账渠道
            <select
              name="actualChannel"
              required
              defaultValue={payment.actualChannel ?? ""}
            >
              <option value="">请选择</option>
              <option value="bank_transfer">银行转账</option>
              <option value="paypal">PayPal</option>
            </select>
          </label>
          <label>
            外部核验参考
            <input name="verificationReference" required maxLength={1000} />
          </label>
          <label>
            实际使用的付款说明版本
            <select
              name="receivedInstructionId"
              required
              defaultValue={payment.instructionId}
            >
              {loaderData.instructionVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.channel === "paypal" ? "PayPal" : "银行转账"} · 版本{" "}
                  {version.version}
                  {version.status === "superseded" ? "（旧说明）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            更正原因（调低金额时必填）
            <textarea name="reason" maxLength={1000} />
          </label>
          <p>
            本次变更{" "}
            {preview === null || !payment.receiptHistoryKnown
              ? "待核对"
              : `${preview >= payment.amountReceivedCents ? "+" : "-"}${money(Math.abs(preview - payment.amountReceivedCents))}`}{" "}
            · 预览：
            {preview === null
              ? "金额格式无效"
              : `累计 ${money(preview)} · 剩余 ${money(Math.max(0, payment.totalDueCents - effectivePreview!))} · 超额 ${money(Math.max(0, effectivePreview! - payment.totalDueCents))}`}
          </p>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            disabled={
              pending ||
              Boolean(blockedReason) ||
              preview === null ||
              preview === payment.amountReceivedCents
            }
          >
            <Save size={18} />
            保存到账金额
          </button>
        </footer>
      </Form>
    );
  if (panel === "instructions")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <p>仅当前 PI 从未登记到账时可更改；归零更正不会重新开放此操作。</p>
          <input type="hidden" name="intent" value="instructions" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={payment.version} />
          <label>
            新付款说明
            <select
              name="choice"
              required
              disabled={
                !payment.receiptHistoryKnown ||
                payment.hasEverReceived ||
                payment.amountReceivedCents > 0 ||
                !payment.current
              }
            >
              <option value="">请选择</option>
              {choices
                .filter((choice) => choice.id !== payment.instructionId)
                .map((choice) => (
                  <option
                    key={choice.id}
                    value={JSON.stringify({
                      id: choice.id,
                      version: choice.version,
                      channel: choice.channel,
                    })}
                  >
                    {choice.channel === "paypal" ? "PayPal" : "银行转账"} · 版本{" "}
                    {choice.version}
                  </option>
                ))}
            </select>
          </label>
          <label>
            变更原因
            <input name="reason" maxLength={1000} required />
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-secondary"
            disabled={
              pending ||
              Boolean(blockedReason) ||
              !payment.receiptHistoryKnown ||
              payment.hasEverReceived ||
              payment.amountReceivedCents > 0 ||
              !payment.current
            }
          >
            保存付款说明
          </button>
        </footer>
      </Form>
    );
  if (panel === "original")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <p>非 USD 款项只留痕，不计入 USD 到账、余额或清算。</p>
          <input type="hidden" name="intent" value="original-currency" />
          <input type="hidden" name="commandId" value={commandId} />
          <label>
            原始币种（ISO 代码）
            <select
              name="currency"
              required
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="">请选择币种</option>
              {originalCurrencies.map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            原币金额
            <input
              name="amount"
              type="number"
              inputMode={currencyDigits === 0 ? "numeric" : "decimal"}
              min={10 ** -currencyDigits}
              step={10 ** -currencyDigits}
              required
            />
            {currency && (
              <small className="field-note">
                {currencyDigits === 0
                  ? "该币种金额使用整数。"
                  : `最多 ${currencyDigits} 位小数。`}
              </small>
            )}
          </label>
          <label>
            实际到账渠道
            <select name="actualChannel" required defaultValue="">
              <option value="">请选择</option>
              <option value="bank_transfer">银行转账</option>
              <option value="paypal">PayPal</option>
            </select>
          </label>
          <label>
            外部核验参考
            <input name="verificationReference" maxLength={1000} required />
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-secondary"
            disabled={pending || Boolean(blockedReason)}
          >
            登记原币审核记录
          </button>
        </footer>
      </Form>
    );
  if (panel === "confirm")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <div className="payment-form-context">
            <strong>{payment.documentNumber}</strong>
            <p>{payment.buyerName}</p>
            <p>
              应付 {money(payment.totalDueCents)} · 可用于本 PI 的到账{" "}
              {money(Math.min(payment.applicableCents, payment.totalDueCents))}
            </p>
            <p>
              {payment.acceptedAt
                ? "确认后将尝试创建订单，系统会重新检查全部条件。"
                : "客户尚未接受 PI，确认后将等待客户接受。"}
            </p>
          </div>
          <input type="hidden" name="intent" value="confirm" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={payment.version} />
          <label>
            卖方账户核验参考
            <input name="externalReference" maxLength={1000} required />
          </label>
          <label>
            <input type="checkbox" name="externallyVerified" required />{" "}
            已核对卖方控制账户内的清算款项
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={pending || Boolean(blockedReason)}
          >
            确认到账
          </button>
        </footer>
      </Form>
    );
  if (panel === "extend")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <p className="payment-form-context">
            当前截止日期：{payment.dueDateEt ?? "未确定"}（美国东部时间）
          </p>

          <p>
            仅当前已接受的 PI；新 ET
            日期必须晚于现有截止时间。延期不等于确认到账。
          </p>
          <input type="hidden" name="intent" value="extend" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={payment.version} />
          <label>
            新截止日期（美国东部时间）
            <input type="date" name="newDateEt" required />
          </label>
          <label>
            延期原因
            <textarea name="reason" required maxLength={1000} />
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-secondary"
            disabled={
              pending ||
              Boolean(blockedReason) ||
              !payment.acceptedAt ||
              !payment.dueAt ||
              !payment.current ||
              !!payment.orderId
            }
          >
            保存延期
          </button>
        </footer>
      </Form>
    );
  if (panel === "late-review")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <input type="hidden" name="intent" value="late-review" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={payment.version} />
          <label>
            复核结论
            <select name="decision" required defaultValue="">
              <option value="">请选择</option>
              <option value="same_terms_approved">
                原条款仍可履行并确认到账
              </option>
              <option value="replacement_required">
                需要修订报价和重新签发 PI
              </option>
            </select>
          </label>
          <label>
            <input type="checkbox" name="pricingChecked" required /> 已核对价格
          </label>
          <label>
            <input type="checkbox" name="availabilityChecked" required />{" "}
            已核对库存/供应
          </label>
          <label>
            <input type="checkbox" name="freightChecked" required /> 已核对运费
          </label>
          <label>
            <input type="checkbox" name="tradeTermsChecked" required />{" "}
            已核对贸易条款
          </label>
          <label>
            <input type="checkbox" name="leadTimeChecked" required /> 已核对交期
          </label>
          <label>
            卖方账户核验参考（批准原条款时必填）
            <input name="externalReference" maxLength={1000} />
          </label>
          <label>
            复核原因
            <textarea name="reason" required maxLength={1000} />
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            disabled={pending || Boolean(blockedReason)}
          >
            保存复核决定
          </button>
        </footer>
      </Form>
    );
  if (panel === "refund")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <input type="hidden" name="intent" value="refund" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={funds.version} />
          <label>
            已退款金额（USD）
            <input name="amount" inputMode="decimal" required />
          </label>
          <label>
            客户书面授权
            <textarea name="customerAuthorization" required maxLength={1000} />
          </label>
          <label>
            已完成退款的银行/PayPal 参考
            <input name="externalReference" required maxLength={1000} />
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-secondary"
            disabled={
              pending || Boolean(blockedReason) || funds.availableCents <= 0
            }
          >
            登记完成退款
          </button>
        </footer>
      </Form>
    );
  if (
    panel === "refund-original" &&
    receipt &&
    receipt.amountMinor !== null &&
    receipt.refundedMinor !== null &&
    receipt.currencyDigits !== null
  )
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <p>
            剩余 {receipt.currency}{" "}
            {(
              (receipt.amountMinor - receipt.refundedMinor) /
              10 ** receipt.currencyDigits
            ).toFixed(receipt.currencyDigits)}
          </p>
          <input type="hidden" name="intent" value="refund-original" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="receiptId" value={receipt.id} />
          <label>
            已退款原币金额
            <input name="amount" inputMode="decimal" required />
          </label>
          <label>
            客户书面授权
            <textarea name="customerAuthorization" required maxLength={1000} />
          </label>
          <label>
            已完成退款参考
            <input name="externalReference" required maxLength={1000} />
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-secondary"
            disabled={
              pending ||
              Boolean(blockedReason) ||
              receipt.amountMinor === receipt.refundedMinor
            }
          >
            登记原币退款
          </button>
        </footer>
      </Form>
    );
  if (panel === "correct-confirmation")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <p>此操作保留原确认、订单及所有历史。受影响订单将立即进入审核锁。</p>
          <input type="hidden" name="intent" value="correct-confirmation" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={payment.version} />
          <label>
            核实后的累计到账（USD）
            <input
              name="correctedAmount"
              inputMode="decimal"
              defaultValue={(payment.amountReceivedCents / 100).toFixed(2)}
              required
            />
          </label>
          <label>
            更正原因
            <textarea name="reason" maxLength={1000} required />
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-secondary"
            disabled={pending || Boolean(blockedReason)}
          >
            保存更正并暂停放行
          </button>
        </footer>
      </Form>
    );
  if (panel === "resolve-correction")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <p>请先核对全部受影响订单与已分配款项；余额不足时系统拒绝解除。</p>
          <input type="hidden" name="intent" value="resolve-correction" />
          <input type="hidden" name="commandId" value={commandId} />
          <input type="hidden" name="expectedVersion" value={payment.version} />
          <input
            type="hidden"
            name="correctionId"
            value={String(
              correction.disputes.find(
                (entry) =>
                  entry.pi_id === payment.piId &&
                  entry.active === 1 &&
                  entry.source_pi_id === payment.piId,
              )?.correction_id ?? "",
            )}
          />
          <label>
            复核结果
            <textarea name="reason" maxLength={1000} required />
          </label>
          <label>
            卖方账户核验参考
            <input name="verificationReference" maxLength={1000} required />
          </label>
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            disabled={pending || Boolean(blockedReason)}
          >
            确认解除
          </button>
        </footer>
      </Form>
    );
  if (panel === "allocate")
    return (
      <Form method="post" action={formAction} className="payment-action-form">
        <div className="payment-dialog-body commercial-settings-form">
          <p className="payment-form-context">
            来源 PI：{payment.documentNumber} · 可用款项{" "}
            {money(funds.availableCents)}
          </p>
          <label>
            目标 PI ID
            <input
              value={targetLookup}
              onChange={(event) => setTargetLookup(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button button-secondary"
            disabled={!targetLookup.trim() || targetFetcher.state !== "idle"}
            onClick={() => {
              const params = new URLSearchParams({
                piId: payment.piId,
                targetPiId: targetLookup.trim(),
              });
              void targetFetcher.load(`${location.pathname}?${params}`);
            }}
          >
            <Search size={17} />
            {targetFetcher.state !== "idle" ? "核对中…" : "核对目标 PI"}
          </button>
          {targetBasis.targetId === targetLookup.trim() &&
            targetBasis.targetError && (
              <p role="alert">{targetBasis.targetError}</p>
            )}
          {target && (
            <>
              <p className="payment-form-context">
                目标 {target.documentNumber} · 尚缺{" "}
                {money(target.shortfallCents)}
              </p>
              {target.piId === payment.piId && (
                <p role="alert">请选择另一个 PI。</p>
              )}
              <input type="hidden" name="intent" value="allocate" />
              <input type="hidden" name="commandId" value={commandId} />
              <input
                type="hidden"
                name="expectedVersion"
                value={funds.version}
              />
              <input
                type="hidden"
                name="targetVersion"
                value={target.version}
              />
              <input type="hidden" name="targetPiId" value={target.piId} />
              <label>
                分配金额（USD）
                <input name="amount" inputMode="decimal" required />
              </label>
              <label>
                客户授权证据/引用
                <textarea
                  name="customerAuthorization"
                  required
                  maxLength={1000}
                />
              </label>
              <label>
                外部核验参考
                <input name="externalReference" required maxLength={1000} />
              </label>
            </>
          )}
        </div>
        <footer className="payment-form-footer">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            disabled={
              pending ||
              Boolean(blockedReason) ||
              targetFetcher.state !== "idle" ||
              !target ||
              target.piId === payment.piId ||
              target.shortfallCents <= 0
            }
          >
            确认分配
          </button>
        </footer>
      </Form>
    );
  return null;
}
