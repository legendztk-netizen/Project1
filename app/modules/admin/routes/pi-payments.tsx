import { useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import {
  data,
  Form,
  Link,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { parseUsdCents } from "../../proforma-invoice/application/pi-payment-service";
import {
  piFundResolutions,
  piLatePayments,
  piPaymentCorrections,
  piPayments,
  piPrivateHeaders,
  piRouteId,
  proformaInvoices,
} from "#workers/proforma-invoice";

export const headers = piPrivateHeaders;
export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const requestId = piRouteId(params.requestId);
  const readiness = await proformaInvoices(env).readiness(
    adminIdentity,
    requestId,
  );
  const piId =
    new URL(request.url).searchParams.get("piId") || readiness.current?.id;
  if (
    !piId ||
    !(await env.DB.prepare(
      "SELECT 1 FROM proforma_invoices WHERE id=? AND request_id=?",
    )
      .bind(piId, requestId)
      .first())
  )
    throw new Response("PI not found", { status: 404 });
  const payment = await piPayments(env).adminRead(adminIdentity, piId);
  const instructionVersions = (
    await env.DB.prepare(
      `SELECT id,channel,version,status FROM seller_payment_instruction_versions
       ORDER BY channel,version DESC`,
    ).all<{ id: string; channel: string; version: number; status: string }>()
  ).results;
  const late = await piLatePayments(env).read(adminIdentity, piId);
  const funds = await piFundResolutions(env).read(adminIdentity, piId);
  const correction = await piPaymentCorrections(env).read(adminIdentity, piId);
  const targetId =
    new URL(request.url).searchParams.get("targetPiId")?.trim() ?? "";
  const target = targetId
    ? await piFundResolutions(env).read(adminIdentity, targetId)
    : null;
  return data(
    {
      requestId,
      payment,
      instructionVersions,
      late,
      funds,
      correction,
      isOwner: adminIdentity.accountType === "owner",
      target,
      targetId,
      choices: readiness.payments,
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const requestId = piRouteId(params.requestId);
  const current = await proformaInvoices(env).adminCurrent(
    adminIdentity,
    requestId,
  );
  const piId = new URL(request.url).searchParams.get("piId") || current?.id;
  if (
    !piId ||
    !(await env.DB.prepare(
      "SELECT 1 FROM proforma_invoices WHERE id=? AND request_id=?",
    )
      .bind(piId, requestId)
      .first())
  )
    throw new Response("PI not found", { status: 404 });
  const form = await readPrivateReviewForm(request);
  const field = (key: string) => String(form.get(key) ?? "");
  const auditOptions = {
    auditIp: request.headers.get("cf-connecting-ip") ?? "local",
  };
  try {
    const base = {
      piId,
      commandId: field("commandId"),
      expectedVersion: Number(field("expectedVersion")),
    };
    if (field("intent") === "received") {
      await piPayments(env, auditOptions).updateReceived(adminIdentity, {
        ...base,
        amount: field("amount"),
        currency: "USD",
        actualChannel: field("actualChannel") as "bank_transfer" | "paypal",
        verificationReference: field("verificationReference"),
        receivedInstructionId: field("receivedInstructionId"),
        reason: field("reason"),
      });
    } else if (field("intent") === "instructions") {
      const choice = JSON.parse(field("choice")) as {
        id: string;
        version: number;
        channel: "bank_transfer" | "paypal";
      };
      await piPayments(env, auditOptions).changeInstructions(adminIdentity, {
        ...base,
        instructionId: choice.id,
        instructionVersion: choice.version,
        channel: choice.channel,
        reason: field("reason"),
      });
    } else if (field("intent") === "original-currency") {
      await piPayments(env, auditOptions).recordOriginalCurrencyReceipt(
        adminIdentity,
        {
          piId,
          commandId: field("commandId"),
          currency: field("currency"),
          amount: field("amount"),
          actualChannel: field("actualChannel") as "bank_transfer" | "paypal",
          verificationReference: field("verificationReference"),
        },
      );
    } else if (field("intent") === "confirm") {
      await piPayments(env, auditOptions).confirmPayment(adminIdentity, {
        ...base,
        externallyVerified: field("externallyVerified") === "on",
        externalReference: field("externalReference"),
      });
    } else if (field("intent") === "extend") {
      await piLatePayments(env, auditOptions).extend(adminIdentity, {
        ...base,
        newDateEt: field("newDateEt"),
        reason: field("reason"),
      });
    } else if (field("intent") === "late-review") {
      await piLatePayments(env, auditOptions).review(adminIdentity, {
        ...base,
        decision: field("decision") as
          "same_terms_approved" | "replacement_required",
        reason: field("reason"),
        externalReference: field("externalReference"),
        pricingChecked: field("pricingChecked") === "on",
        availabilityChecked: field("availabilityChecked") === "on",
        freightChecked: field("freightChecked") === "on",
        tradeTermsChecked: field("tradeTermsChecked") === "on",
        leadTimeChecked: field("leadTimeChecked") === "on",
      });
    } else if (field("intent") === "allocate") {
      await piFundResolutions(env, auditOptions).allocate(adminIdentity, {
        sourcePiId: piId,
        targetPiId: field("targetPiId"),
        commandId: field("commandId"),
        sourceVersion: Number(field("expectedVersion")),
        targetVersion: Number(field("targetVersion")),
        amount: field("amount"),
        customerAuthorization: field("customerAuthorization"),
        externalReference: field("externalReference"),
      });
    } else if (field("intent") === "refund") {
      await piFundResolutions(env, auditOptions).recordRefund(adminIdentity, {
        piId,
        commandId: field("commandId"),
        expectedVersion: Number(field("expectedVersion")),
        amount: field("amount"),
        customerAuthorization: field("customerAuthorization"),
        externalReference: field("externalReference"),
      });
    } else if (field("intent") === "refund-original") {
      await piFundResolutions(env, auditOptions).refundOriginalCurrency(
        adminIdentity,
        {
          receiptId: field("receiptId"),
          commandId: field("commandId"),
          amount: field("amount"),
          customerAuthorization: field("customerAuthorization"),
          externalReference: field("externalReference"),
        },
      );
    } else if (field("intent") === "correct-confirmation") {
      await piPaymentCorrections(env, auditOptions).correct(adminIdentity, {
        piId,
        commandId: field("commandId"),
        expectedVersion: Number(field("expectedVersion")),
        correctedAmount: field("correctedAmount"),
        reason: field("reason"),
      });
    } else if (field("intent") === "resolve-correction") {
      await piPaymentCorrections(env, auditOptions).resolve(adminIdentity, {
        piId,
        commandId: field("commandId"),
        correctionId: field("correctionId"),
        expectedVersion: Number(field("expectedVersion")),
        reason: field("reason"),
        verificationReference: field("verificationReference"),
      });
    } else throw new Response("Invalid operation", { status: 400 });
    const payment = await piPayments(env).adminRead(adminIdentity, piId);
    return data(
      { message: "已保存，并记录付款审计。", payment },
      { headers: headers() },
    );
  } catch (error) {
    if (error instanceof Response && [400, 409].includes(error.status))
      return data(
        { error: await error.text() },
        { status: error.status, headers: headers() },
      );
    throw error;
  }
}

export default function PiPayments({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>> extends infer T
    ? T extends { data: infer U }
      ? U
      : never
    : never;
  actionData?: { message?: string; error?: string };
}) {
  const {
    requestId,
    payment,
    late,
    funds,
    correction,
    isOwner,
    target,
    targetId,
    choices,
    commandId,
  } = loaderData;
  const pending = useNavigation().state !== "idle";
  const [amount, setAmount] = useState(
    (payment.amountReceivedCents / 100).toFixed(2),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  let preview: number | null = null;
  try {
    preview = parseUsdCents(amount);
  } catch {
    /* invalid input remains editable */
  }
  const money = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
  const base = `/admin/quotes/${encodeURIComponent(requestId)}/pi`;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <Link to={base}>
          <ArrowLeft size={17} />
          返回 PI
        </Link>
        <h1>付款与到账</h1>
        <section className="admin-quote-section">
          <h2 style={{ overflowWrap: "anywhere" }}>{payment.documentNumber}</h2>
          <dl className="admin-snapshot-fields">
            <div>
              <dt>客户</dt>
              <dd>{payment.buyerName}</dd>
            </div>
            <div>
              <dt>应付总额</dt>
              <dd>{money(payment.totalDueCents)}</dd>
            </div>
            <div>
              <dt>已登记到账</dt>
              <dd>
                {payment.receiptHistoryKnown
                  ? money(payment.amountReceivedCents)
                  : "历史记录不完整，待核对"}
              </dd>
            </div>
            <div>
              <dt>剩余应付</dt>
              <dd>
                {payment.receiptHistoryKnown
                  ? money(payment.balanceCents)
                  : "待核对"}
              </dd>
            </div>
            <div>
              <dt>超额待处理</dt>
              <dd>{money(payment.excessCents)}</dd>
            </div>
            <div>
              <dt>可分配/可退款</dt>
              <dd>{money(funds.availableCents)}</dd>
            </div>
            <div>
              <dt>PI 接受</dt>
              <dd>
                {payment.acceptedAt
                  ? formatPiDate(payment.acceptedAt, "admin")
                  : "待客户接受"}
              </dd>
            </div>
            <div>
              <dt>付款截止</dt>
              <dd>
                {payment.dueAt
                  ? formatPiDate(payment.dueAt, "admin")
                  : payment.termKind === "legacy_review"
                    ? "历史条款待人工核对"
                    : "接受后计算"}
              </dd>
            </div>
          </dl>
          <p>到账登记不等于确认清算，也不会创建订单或启动生产。</p>
          {payment.paymentConfirmed && (
            <p role="status">
              款项已确认
              {payment.orderId ? "，订单已创建。" : "，等待客户接受 PI。"}
            </p>
          )}
          {late.overdue && (
            <p role="status">
              付款期限已过，须先延期或进行逾期商业复核；不会自动取消 PI。
            </p>
          )}
        </section>
        {actionData?.message && <p role="status">{actionData.message}</p>}
        {actionData?.error && <p role="alert">{actionData.error}</p>}
        <Form method="post" className="commercial-settings-form">
          <h2>更新累计到账金额</h2>
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
            预览：
            {preview === null
              ? "金额格式无效"
              : `累计 ${money(preview)} · 剩余 ${money(Math.max(0, payment.totalDueCents - preview))} · 超额 ${money(Math.max(0, preview - payment.totalDueCents))}`}
          </p>
          <button
            className="button button-primary"
            disabled={
              pending ||
              preview === null ||
              preview === payment.amountReceivedCents
            }
          >
            <Save size={18} />
            保存到账金额
          </button>
        </Form>
        {payment.receiptInstructionHistory.length > 0 && (
          <section className="admin-quote-section">
            <h2>到账说明版本记录</h2>
            {payment.receiptInstructionHistory.map((entry) => (
              <p key={entry.id}>
                {formatPiDate(entry.occurredAt, "admin")} · 累计{" "}
                {money(entry.cumulativeCents)} ·{" "}
                {entry.channel === "paypal"
                  ? "PayPal"
                  : entry.channel === "bank_transfer"
                    ? "银行转账"
                    : "历史未知渠道"}{" "}
                ·{" "}
                {entry.version === null
                  ? "旧记录未标记版本"
                  : `说明版本 ${entry.version}`}
                {entry.status === "superseded" ? "（当前已停用）" : ""}
              </p>
            ))}
          </section>
        )}
        <Form method="post" className="commercial-settings-form">
          <h2>更改付款渠道和说明</h2>
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
                payment.amountReceivedCents > 0 ||
                !payment.current
              }
            >
              <option value="">请选择</option>
              {choices.map((choice) => (
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
          <button
            className="button button-secondary"
            disabled={
              pending ||
              !payment.receiptHistoryKnown ||
              payment.amountReceivedCents > 0 ||
              !payment.current
            }
          >
            保存付款说明
          </button>
        </Form>
        <Form method="post" className="commercial-settings-form">
          <h2>原币到账审核记录</h2>
          <p>非 USD 款项只留痕，不计入 USD 到账、余额或清算。</p>
          <input type="hidden" name="intent" value="original-currency" />
          <input type="hidden" name="commandId" value={commandId} />
          <label>
            原始币种（ISO 代码）
            <input name="currency" maxLength={3} required placeholder="EUR" />
          </label>
          <label>
            原币金额
            <input name="amount" inputMode="decimal" required />
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
          <button className="button button-secondary" disabled={pending}>
            登记原币审核记录
          </button>
          {payment.originalCurrencyReceipts.map((receipt) => (
            <p key={receipt.id}>
              {receipt.currency} {receipt.amount} ·{" "}
              {formatPiDate(receipt.recordedAt, "admin")} · 待人工处理
            </p>
          ))}
        </Form>
        <section className="admin-quote-section">
          <h2>确认清算</h2>
          <p>须先在卖方控制的收款账户核对到账，不能仅凭客户截图。</p>
          <button
            type="button"
            className="button button-primary"
            disabled={
              pending ||
              payment.paymentConfirmed ||
              !payment.receiptHistoryKnown ||
              payment.termKind === "legacy_review" ||
              payment.balanceCents > 0 ||
              !payment.current
            }
            onClick={() => setConfirmOpen(true)}
          >
            确认付款
          </button>
          {confirmOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="pi-payment-confirm-title"
              className="admin-payment-confirm-dialog"
            >
              <h3 id="pi-payment-confirm-title">确认外部到账</h3>
              <p>
                PI：{payment.documentNumber} · 客户：{payment.buyerName}
              </p>
              <p>
                币种：USD · 应付：{money(payment.totalDueCents)} · 核准到账：
                {money(
                  Math.min(payment.amountReceivedCents, payment.totalDueCents),
                )}
              </p>
              <p>
                {payment.acceptedAt
                  ? "确认后将尝试立即创建订单，系统会重新检查全部条件。"
                  : "客户尚未接受 PI；确认后保留款项，待接受时自动创建订单。"}
              </p>
              <Form method="post" className="commercial-settings-form">
                <input type="hidden" name="intent" value="confirm" />
                <input type="hidden" name="commandId" value={commandId} />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={payment.version}
                />
                <label>
                  卖方账户核验参考
                  <input name="externalReference" maxLength={1000} required />
                </label>
                <label>
                  <input type="checkbox" name="externallyVerified" required />{" "}
                  已核对卖方控制账户内的清算款项
                </label>
                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={pending}
                  >
                    确认到账
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setConfirmOpen(false)}
                  >
                    取消
                  </button>
                </div>
              </Form>
            </div>
          )}
        </section>
        <Form method="post" className="commercial-settings-form">
          <h2>延长付款期限</h2>
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
          <button
            className="button button-secondary"
            disabled={
              pending ||
              !payment.acceptedAt ||
              !payment.dueAt ||
              !payment.current ||
              !!payment.orderId
            }
          >
            保存延期
          </button>
          {late.extensions.map((entry) => (
            <p key={String(entry.id)}>
              {String(entry.oldDate)} → {String(entry.newDate)} ·{" "}
              {String(entry.reason)}
            </p>
          ))}
        </Form>
        {late.overdue && (
          <Form method="post" className="commercial-settings-form">
            <h2>逾期商业复核</h2>
            <input type="hidden" name="intent" value="late-review" />
            <input type="hidden" name="commandId" value={commandId} />
            <input
              type="hidden"
              name="expectedVersion"
              value={payment.version}
            />
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
              <input type="checkbox" name="pricingChecked" required />{" "}
              已核对价格
            </label>
            <label>
              <input type="checkbox" name="availabilityChecked" required />{" "}
              已核对库存/供应
            </label>
            <label>
              <input type="checkbox" name="freightChecked" required />{" "}
              已核对运费
            </label>
            <label>
              <input type="checkbox" name="tradeTermsChecked" required />{" "}
              已核对贸易条款
            </label>
            <label>
              <input type="checkbox" name="leadTimeChecked" required />{" "}
              已核对交期
            </label>
            <label>
              卖方账户核验参考（批准原条款时必填）
              <input name="externalReference" maxLength={1000} />
            </label>
            <label>
              复核原因
              <textarea name="reason" required maxLength={1000} />
            </label>
            <button className="button button-primary" disabled={pending}>
              保存复核决定
            </button>
            {late.reviews.map((entry) => (
              <p key={String(entry.id)}>
                {entry.decision === "same_terms_approved"
                  ? "原条款批准"
                  : "需修订报价"}{" "}
                · {String(entry.reason)}
              </p>
            ))}
          </Form>
        )}
        <section className="admin-quote-section">
          <h2>历史款项与超额处理</h2>
          <p>
            仅已核验、未承诺给订单的 USD
            款项可按客户授权分配或登记已完成外部退款。这里不是客户钱包。
          </p>
          {funds.resolutions.map((entry) => (
            <p key={String(entry.id)}>
              {entry.kind === "allocation" ? "转至/来自 PI" : "外部退款"} ·{" "}
              {money(Number(entry.amountCents))}
              {entry.targetPiId
                ? ` · 目标 ${String(entry.targetPiId)}`
                : ""} · {formatPiDate(String(entry.resolvedAt), "admin")}
            </p>
          ))}
          <Form method="get" className="commercial-settings-form">
            <label>
              目标 PI ID
              <input name="targetPiId" defaultValue={targetId} required />
            </label>
            <button className="button button-secondary">核对目标 PI</button>
          </Form>
          {target && (
            <Form method="post" className="commercial-settings-form">
              <h3>分配至 {target.documentNumber}</h3>
              <p>
                目标尚缺 {money(target.shortfallCents)} · 来源可用{" "}
                {money(funds.availableCents)}
              </p>
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
              <button
                className="button button-primary"
                disabled={
                  pending ||
                  funds.availableCents <= 0 ||
                  target.shortfallCents <= 0
                }
              >
                确认分配
              </button>
            </Form>
          )}
          <Form method="post" className="commercial-settings-form">
            <h3>登记已完成外部退款</h3>
            <input type="hidden" name="intent" value="refund" />
            <input type="hidden" name="commandId" value={commandId} />
            <input type="hidden" name="expectedVersion" value={funds.version} />
            <label>
              已退款金额（USD）
              <input name="amount" inputMode="decimal" required />
            </label>
            <label>
              客户书面授权
              <textarea
                name="customerAuthorization"
                required
                maxLength={1000}
              />
            </label>
            <label>
              已完成退款的银行/PayPal 参考
              <input name="externalReference" required maxLength={1000} />
            </label>
            <button
              className="button button-secondary"
              disabled={pending || funds.availableCents <= 0}
            >
              登记完成退款
            </button>
          </Form>
          {payment.originalCurrencyReceipts.map((receipt) => (
            <details key={receipt.id}>
              <summary>
                {receipt.currency} {receipt.amount} · 原币待处理
              </summary>
              {receipt.amountMinor === null ||
              receipt.currencyDigits === null ||
              receipt.refundedMinor === null ? (
                <p>历史记录缺少精确余额，请人工核对后处理。</p>
              ) : (
                <Form method="post" className="commercial-settings-form">
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
                    <textarea
                      name="customerAuthorization"
                      required
                      maxLength={1000}
                    />
                  </label>
                  <label>
                    已完成退款参考
                    <input name="externalReference" required maxLength={1000} />
                  </label>
                  <button
                    className="button button-secondary"
                    disabled={
                      pending || receipt.amountMinor === receipt.refundedMinor
                    }
                  >
                    登记原币退款
                  </button>
                </Form>
              )}
            </details>
          ))}
        </section>
        <section className="admin-quote-section">
          <h2>付款确认更正与放行审核</h2>
          {correction.disputes
            .filter((entry) => entry.active === 1)
            .map((entry) => (
              <p key={String(entry.pi_id)} role="status">
                受影响 PI {String(entry.pi_id)}
                {entry.order_id
                  ? ` · 订单 ${String(entry.order_id)} 放行已暂停`
                  : " · 待核验"}
              </p>
            ))}
          {payment.paymentConfirmed && (
            <Form method="post" className="commercial-settings-form">
              <h3>更正错误确认</h3>
              <p>
                此操作保留原确认、订单及所有历史。受影响订单将立即进入审核锁。
              </p>
              <input type="hidden" name="intent" value="correct-confirmation" />
              <input type="hidden" name="commandId" value={commandId} />
              <input
                type="hidden"
                name="expectedVersion"
                value={payment.version}
              />
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
              <button className="button button-secondary" disabled={pending}>
                保存更正并暂停放行
              </button>
            </Form>
          )}
          {isOwner &&
            correction.disputes.some(
              (entry) =>
                entry.active === 1 && entry.source_pi_id === payment.piId,
            ) && (
              <Form method="post" className="commercial-settings-form">
                <h3>Owner 解除审核锁</h3>
                <p>
                  请先核对全部受影响订单与已分配款项；余额不足时系统拒绝解除。
                </p>
                <input type="hidden" name="intent" value="resolve-correction" />
                <input type="hidden" name="commandId" value={commandId} />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={payment.version}
                />
                <input
                  type="hidden"
                  name="correctionId"
                  value={String(
                    correction.disputes.find(
                      (entry) => entry.pi_id === payment.piId,
                    )?.correction_id ?? "",
                  )}
                />
                <label>
                  复核结果
                  <textarea name="reason" maxLength={1000} required />
                </label>
                <label>
                  卖方账户核验参考
                  <input
                    name="verificationReference"
                    maxLength={1000}
                    required
                  />
                </label>
                <button className="button button-primary" disabled={pending}>
                  确认解除
                </button>
              </Form>
            )}
        </section>
      </main>
    </div>
  );
}
