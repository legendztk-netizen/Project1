import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  Banknote,
  CheckCircle,
  ChevronDown,
  Clock,
  FilePenLine,
  History,
  Plus,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Link, useNavigation } from "react-router";
import type { PiPaymentsPageData } from "../routes/pi-payments";
import { AdminNavigation } from "./admin-navigation";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import {
  paymentActionReasons,
  paymentPanelTitles,
  type PaymentPanel,
} from "./pi-payment-actions";
import { PiPaymentDialog } from "./pi-payment-dialog";
import { PiPaymentForms } from "./pi-payment-forms";
import "./pi-payments.css";

const money = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
const channel = (value: string | null) =>
  value === "bank_transfer"
    ? "银行转账"
    : value === "paypal"
      ? "PayPal"
      : "未记录";
const historyLabels: Record<string, string> = {
  "pi.accepted_agreement_retained": "保留客户已接受的 PI",
  "pi.accepted": "客户接受 PI",
  "pi.amount_received_updated": "更新累计到账金额",
  "pi.instructions_changed": "更改付款说明",
  "pi.original_currency_receipt": "登记原币到账",
  "pi.payment_confirmed": "确认付款",
  "pi.payment_reverified": "重新核验付款",
  "pi.deadline_extended": "延长付款期限",
  "pi.late_payment_reviewed": "逾期商业复核",
  "pi.funds_allocated": "款项分配",
  "pi.external_refund_recorded": "登记外部退款",
  "pi.original_currency_refund_recorded": "登记原币退款",
  "pi.payment_corrected": "更正付款确认",
  "pi.payment_review_resolved": "解除付款审核锁",
};
function historyDetail(raw: string) {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.newCents === "number")
      return `${typeof value.previousCents === "number" ? money(value.previousCents) : "历史金额待核对"} → ${money(value.newCents)}`;
    if (typeof value.corrected === "number")
      return `${typeof value.prior === "number" ? money(value.prior) : "待核对"} → ${money(value.corrected)} · ${String(value.reason ?? "")}`;
    if (typeof value.amountCents === "number") return money(value.amountCents);
    if (typeof value.totalCents === "number") return money(value.totalCents);
    if (typeof value.currency === "string" && typeof value.amount === "string")
      return `${value.currency} ${value.amount}`;
    if (typeof value.from === "string" && typeof value.to === "string")
      return `${formatPiDate(value.from, "admin")} → ${formatPiDate(value.to, "admin")}`;
    return typeof value.reason === "string" ? value.reason : "已记录";
  } catch {
    return "历史记录详情不可用";
  }
}

export default function PiPaymentsWorkspace({
  loaderData,
  actionData,
}: {
  loaderData: PiPaymentsPageData;
  actionData?: { message?: string; error?: string };
}) {
  const { payment, late, funds, correction } = loaderData;
  const [panel, setPanel] = useState<PaymentPanel | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [recordTab, setRecordTab] = useState("receipts");
  const actionAtOpen = useRef(actionData);
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const busy = useNavigation().state !== "idle";
  const reasons = paymentActionReasons(loaderData);
  const activeDisputes = correction.disputes.filter(
    (entry) => entry.active === 1,
  );
  const needsHistoryReview =
    !payment.receiptHistoryKnown ||
    (payment.termKind === "legacy_review" &&
      !payment.paymentDeadlineUnspecified);
  const quoteDetails = `/admin/quotes/${encodeURIComponent(loaderData.requestId)}`;
  const piLink = `${quoteDetails}/pi`;
  useEffect(() => {
    if (actionData?.message) setPanel(null);
  }, [actionData]);
  function open(next: PaymentPanel, originalReceiptId: string | null = null) {
    actionAtOpen.current = actionData;
    setReceiptId(originalReceiptId);
    setPanel(next);
    if (moreMenu.current) moreMenu.current.open = false;
  }
  function actionButton(
    kind: PaymentPanel,
    label: string,
    icon: ReactNode,
    primary = false,
  ) {
    return (
      <span className="payment-action-tooltip" title={reasons[kind]}>
        <button
          type="button"
          className={`button ${primary ? "button-primary" : "button-secondary"}`}
          disabled={busy || Boolean(reasons[kind])}
          onClick={() => open(kind)}
          aria-label={reasons[kind] ? `${label}：${reasons[kind]}` : label}
        >
          {icon}
          {label}
        </button>
      </span>
    );
  }
  const state = activeDisputes.length
    ? "放行审核中"
    : payment.paymentConfirmed
      ? "付款已确认"
      : needsHistoryReview
        ? "待核对资料"
        : late.overdue
          ? "付款已逾期"
          : payment.balanceCents === 0
            ? "待确认付款"
            : payment.applicableCents > 0
              ? "部分到账"
              : "待到账";
  const tabs = [
    {
      id: "receipts",
      label: "到账记录",
      count: payment.receiptInstructionHistory.length,
    },
    {
      id: "original",
      label: "原币记录",
      count: payment.originalCurrencyReceipts.length,
    },
    { id: "history", label: "操作历史", count: loaderData.history.length },
  ];
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main payment-workspace">
        <Link className="admin-back-link" to={quoteDetails}>
          <ArrowLeft size={17} aria-hidden="true" />
          返回询价详情
        </Link>
        <header className="payment-page-header">
          <div>
            <h1>付款与到账</h1>
            <p>
              {payment.documentNumber} <span>· {payment.buyerName}</span>
            </p>
          </div>
          <div className="payment-inline-actions">
            {!payment.current && (
              <span className="payment-status">历史 PI</span>
            )}
            <span
              className={`payment-status ${payment.paymentConfirmed && !activeDisputes.length ? "payment-status-success" : ""}`}
            >
              {state}
            </span>
          </div>
        </header>

        {activeDisputes.length > 0 && (
          <section
            className="payment-notice payment-notice-danger"
            role="status"
          >
            <ShieldCheck size={21} aria-hidden="true" />
            <div>
              <strong>付款更正尚待复核</strong>
              <p>相关款项需重新核验，受影响订单的放行已暂停。</p>
              <ul>
                {activeDisputes.map((entry) => (
                  <li key={String(entry.pi_id)}>
                    PI {String(entry.pi_id)}
                    {entry.order_id
                      ? ` · 订单 ${String(entry.order_id)}`
                      : " · 待核验"}
                  </li>
                ))}
              </ul>
              {reasons["resolve-correction"] && (
                <p>{reasons["resolve-correction"]}</p>
              )}
            </div>
            {actionButton(
              "resolve-correction",
              "审核放行",
              <ShieldCheck size={17} />,
              true,
            )}
          </section>
        )}
        {needsHistoryReview && (
          <section className="payment-notice" role="status">
            <TriangleAlert size={21} aria-hidden="true" />
            <div>
              <strong>历史资料待核对</strong>
              {!payment.receiptHistoryKnown && (
                <p>到账历史不完整，请先核对并登记累计到账金额。</p>
              )}
              {payment.termKind === "legacy_review" &&
                !payment.paymentDeadlineUnspecified && (
                  <p>
                    该 PI
                    未记录付款期限。请核对客户已接受的协议，确认保留后按“未约定截止日”执行。
                  </p>
                )}
            </div>
            <Link className="button button-secondary" to={piLink}>
              查看 PI
            </Link>
          </section>
        )}
        {payment.current &&
          payment.acceptedAt &&
          !payment.orderId &&
          !payment.acceptedAgreementRetained && (
            <section className="payment-notice" role="status">
              <ShieldCheck size={21} aria-hidden="true" />
              <div>
                <strong>客户已接受的协议</strong>
                <p>
                  {payment.quoteReviewRequired
                    ? "已有新的正式报价。如属误操作，可保留客户已接受的 PI。"
                    : "重复保存商业条款不会改写已签发的 PI。可核对并确认继续以客户已接受的 PI 为最终协议。"}
                </p>
              </div>
              {actionButton(
                "retain-agreement",
                "以客户已接受的 PI 为准",
                <ShieldCheck size={17} />,
                true,
              )}
            </section>
          )}
        {payment.acceptedAgreementRetained && (
          <p role="status">
            已确认以客户接受的 PI 为最终协议。
            {payment.paymentDeadlineUnspecified
              ? "付款截止：未约定截止日；核实全款后可确认付款。"
              : "原付款期限保持不变。"}
          </p>
        )}
        {late.overdue && (
          <section className="payment-notice" role="status">
            <Clock size={21} aria-hidden="true" />
            <div>
              <strong>付款期限已过</strong>
              <p>请先延期或完成逾期商业复核。</p>
            </div>
            {actionButton(
              "late-review",
              "逾期商业复核",
              <FilePenLine size={17} />,
              true,
            )}
          </section>
        )}

        <section className="payment-overview" aria-label="付款概览">
          <dl className="payment-totals">
            <div>
              <dt>应付总额</dt>
              <dd>{money(payment.totalDueCents)}</dd>
            </div>
            <div>
              <dt>已登记到账</dt>
              <dd>
                {payment.receiptHistoryKnown
                  ? money(payment.amountReceivedCents)
                  : "待核对"}
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
              <dt>付款截止（北京时间）</dt>
              <dd className="payment-date">
                {payment.dueAt
                  ? formatPiDate(payment.dueAt, "admin")
                  : payment.paymentDeadlineUnspecified
                    ? "未约定截止日"
                    : payment.termKind === "legacy_review"
                      ? "待核对"
                      : "接受后计算"}
              </dd>
            </div>
          </dl>
          <div className="payment-meta">
            <span>
              付款说明：{channel(payment.instructionChannel)} · 版本{" "}
              {payment.instructionVersion}
            </span>
            <span>
              PI 接受：
              {payment.acceptedAt
                ? formatPiDate(payment.acceptedAt, "admin")
                : "待客户接受"}
            </span>
            {actionButton("extend", "延期", <Clock size={16} />)}
          </div>
          {(payment.allocatedInCents > 0 ||
            payment.allocatedOutCents > 0 ||
            payment.refundedCents > 0) && (
            <p className="payment-balance-detail">
              转入 {money(payment.allocatedInCents)} · 转出{" "}
              {money(payment.allocatedOutCents)} · 已退款{" "}
              {money(payment.refundedCents)}
            </p>
          )}
          <div className="payment-toolbar">
            {actionButton(
              "received",
              "更新到账金额",
              <Banknote size={18} />,
              true,
            )}
            {actionButton(
              "confirm",
              "确认付款",
              <CheckCircle size={18} />,
              !reasons.confirm,
            )}
            <details
              className="payment-more-menu"
              ref={moreMenu}
              onKeyDown={(event) => {
                if (event.key === "Escape") event.currentTarget.open = false;
              }}
            >
              <summary className="button button-secondary">
                更多操作
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
              <div className="payment-menu-options">
                {actionButton(
                  "instructions",
                  "更改付款渠道和说明",
                  <FilePenLine size={17} />,
                )}
                {actionButton("original", "登记原币到账", <Plus size={17} />)}
                {payment.paymentConfirmed &&
                  actionButton(
                    "correct-confirmation",
                    "更正付款确认",
                    <TriangleAlert size={17} />,
                  )}
              </div>
            </details>
            {payment.orderId && (
              <Link
                className="button button-secondary"
                to={`/admin/orders/${encodeURIComponent(payment.orderId)}`}
              >
                查看订单
              </Link>
            )}
          </div>
          {reasons.confirm && !payment.paymentConfirmed && (
            <p className="payment-action-reason">确认付款：{reasons.confirm}</p>
          )}
          <p className="payment-note">
            到账登记后，仍需核对卖方账户并确认清算。
          </p>
          {payment.paymentConfirmed && !payment.orderId && (
            <p className="payment-note">
              款项已确认，等待客户接受 PI 或订单创建条件满足。
            </p>
          )}
        </section>

        {(funds.availableCents > 0 || payment.excessCents > 0) && (
          <section className="payment-funds-strip" aria-label="待处理款项">
            <div>
              <strong>可分配 / 可退款 {money(funds.availableCents)}</strong>
              <p>其中超额待处理 {money(payment.excessCents)}</p>
            </div>
            <div className="payment-inline-actions">
              {actionButton(
                "allocate",
                "分配款项",
                <ArrowRightLeft size={17} />,
              )}
              {actionButton("refund", "登记外部退款", <Banknote size={17} />)}
            </div>
          </section>
        )}
        {!panel && actionData?.message && (
          <p className="payment-save-success" role="status">
            <CheckCircle size={18} />
            {actionData.message}
          </p>
        )}
        {!panel && actionData?.error && (
          <p className="payment-dialog-error" role="alert">
            {actionData.error}
          </p>
        )}

        <section className="payment-records" aria-label="付款记录">
          <div
            className="payment-tabs"
            role="tablist"
            aria-label="付款记录分类"
          >
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`payment-tab-${tab.id}`}
                aria-controls={`payment-records-${tab.id}`}
                aria-selected={recordTab === tab.id}
                tabIndex={recordTab === tab.id ? 0 : -1}
                onClick={() => setRecordTab(tab.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    setRecordTab(tabs[next].id);
                    document
                      .getElementById(`payment-tab-${tabs[next].id}`)
                      ?.focus();
                  }
                }}
              >
                {tab.label}
                <span>{tab.count}</span>
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`payment-records-${recordTab}`}
            aria-labelledby={`payment-tab-${recordTab}`}
            tabIndex={0}
          >
            {recordTab === "receipts" && (
              <>
                {payment.receiptInstructionHistory.length === 0 ? (
                  <p className="payment-empty">暂无到账登记记录。</p>
                ) : (
                  <div className="payment-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>登记时间（北京时间）</th>
                          <th>累计到账</th>
                          <th>渠道</th>
                          <th>付款说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payment.receiptInstructionHistory.map((entry) => (
                          <tr key={entry.id}>
                            <td>{formatPiDate(entry.occurredAt, "admin")}</td>
                            <td>{money(entry.cumulativeCents)}</td>
                            <td>{channel(entry.channel)}</td>
                            <td>
                              {entry.version === null
                                ? "历史版本未记录"
                                : `版本 ${entry.version}`}
                              {entry.status === "superseded" &&
                                "（当前已停用）"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {funds.resolutions.length > 0 && (
                  <div className="payment-fund-history">
                    <h3>款项分配与退款</h3>
                    <div className="payment-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>时间（北京时间）</th>
                            <th>类型</th>
                            <th>金额</th>
                            <th>相关 PI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {funds.resolutions.map((entry) => (
                            <tr key={String(entry.id)}>
                              <td>
                                {formatPiDate(
                                  String(entry.resolvedAt),
                                  "admin",
                                )}
                              </td>
                              <td>
                                {entry.kind === "allocation"
                                  ? "款项分配"
                                  : "外部退款"}
                              </td>
                              <td>{money(Number(entry.amountCents))}</td>
                              <td>
                                {String(
                                  entry.sourcePiId === payment.piId
                                    ? (entry.targetPiId ?? "本 PI")
                                    : entry.sourcePiId,
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
            {recordTab === "original" && (
              <>
                <div className="payment-record-toolbar">
                  <p>非 USD 款项单独留痕，待人工处理。</p>
                  {actionButton(
                    "original",
                    "登记原币到账",
                    <Plus size={17} />,
                    true,
                  )}
                </div>
                {payment.originalCurrencyReceipts.length === 0 ? (
                  <p className="payment-empty">暂无原币到账记录。</p>
                ) : (
                  <div className="payment-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>登记时间（北京时间）</th>
                          <th>原币金额</th>
                          <th>渠道</th>
                          <th>剩余待处理</th>
                          <th>状态 / 操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payment.originalCurrencyReceipts.map((receipt) => {
                          const known =
                            receipt.amountMinor !== null &&
                            receipt.refundedMinor !== null &&
                            receipt.currencyDigits !== null;
                          const remaining = known
                            ? receipt.amountMinor! - receipt.refundedMinor!
                            : null;
                          return (
                            <tr key={receipt.id}>
                              <td>
                                {formatPiDate(receipt.recordedAt, "admin")}
                              </td>
                              <td>
                                {receipt.currency} {receipt.amount}
                              </td>
                              <td>{channel(receipt.actualChannel)}</td>
                              <td>
                                {remaining === null
                                  ? "待核对"
                                  : `${receipt.currency} ${(remaining / 10 ** receipt.currencyDigits!).toFixed(receipt.currencyDigits!)}`}
                              </td>
                              <td>
                                <span>
                                  {remaining === 0
                                    ? "已退款"
                                    : known && receipt.refundedMinor! > 0
                                      ? "部分退款"
                                      : "待处理"}
                                </span>
                                {remaining !== null && remaining > 0 && (
                                  <button
                                    className="button button-secondary"
                                    onClick={() =>
                                      open("refund-original", receipt.id)
                                    }
                                  >
                                    登记原币退款
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {recordTab === "history" && (
              <>
                <p className="payment-history-caption">
                  <History size={16} />
                  最近 100 条付款操作记录
                </p>
                {loaderData.history.length === 0 ? (
                  <p className="payment-empty">暂无付款操作记录。</p>
                ) : (
                  <div className="payment-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>时间（北京时间）</th>
                          <th>操作</th>
                          <th>变更</th>
                          <th>操作人</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loaderData.history.map((entry) => (
                          <tr key={entry.id}>
                            <td>{formatPiDate(entry.occurredAt, "admin")}</td>
                            <td>{historyLabels[entry.kind] ?? "付款操作"}</td>
                            <td>{historyDetail(entry.payload)}</td>
                            <td>{entry.actor}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {late.extensions.length > 0 && (
                  <details className="payment-history-details">
                    <summary>
                      付款期限变更详情（{late.extensions.length}）
                    </summary>
                    {late.extensions.map((entry) => (
                      <p key={String(entry.id)}>
                        {String(entry.oldDate)} → {String(entry.newDate)}
                        （美国东部时间）· {String(entry.reason)}
                      </p>
                    ))}
                  </details>
                )}
                {late.reviews.length > 0 && (
                  <details className="payment-history-details">
                    <summary>逾期复核详情（{late.reviews.length}）</summary>
                    {late.reviews.map((entry) => (
                      <p key={String(entry.id)}>
                        {entry.decision === "same_terms_approved"
                          ? "原条款批准"
                          : "需修订报价"}{" "}
                        · {String(entry.reason)}
                      </p>
                    ))}
                  </details>
                )}
              </>
            )}
          </div>
        </section>
      </main>
      {panel && (
        <PiPaymentDialog
          key={`${payment.piId}:${panel}:${receiptId ?? ""}`}
          title={paymentPanelTitles[panel]}
          compact={
            panel === "confirm" ||
            panel === "extend" ||
            panel === "retain-agreement"
          }
          error={
            actionData !== actionAtOpen.current ? actionData?.error : undefined
          }
          onClose={() => setPanel(null)}
        >
          {(close) => (
            <PiPaymentForms
              loaderData={loaderData}
              panel={panel}
              receiptId={receiptId}
              blockedReason={reasons[panel]}
              onClose={close}
            />
          )}
        </PiPaymentDialog>
      )}
    </div>
  );
}
