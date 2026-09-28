import { RefundCompletionForm } from "./refund-completion-form";
import { Form } from "react-router";

import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type { OrderRefunds } from "../application/refund-initiation-service";
import { usd } from "../domain/refund-calculation";
import { refundStatusLabel } from "./refund-breakdown";
import { AdminActionDialog } from "./admin-action-dialog";
import "./after-sales.css";

const sourceLabel: Record<string, string> = {
  cancellation: "取消退款",
  return: "退货检验退款",
  supplemental: "补充退款",
  shipping: "发货变更退款",
};
const channelZh = { bank_transfer: "银行转账 / WorldFirst", paypal: "PayPal" };

export function AdminOrderRefunds({
  refunds,
  isOwner,
  canRefund,
  commandId,
  busy,
  todayEt,
}: {
  refunds: OrderRefunds;
  isOwner: boolean;
  canRefund: boolean;
  commandId: string;
  busy: boolean;
  todayEt: string;
}) {
  const payable = [
    ...refunds.afterSales
      .filter((refund) => refund.status !== "superseded")
      .map((refund) => ({
        kind: "after_sales" as const,
        id: refund.id,
        label: `${sourceLabel[refund.sourceKind]} ${refund.id.slice(0, 8)}`,
        status: refundStatusLabel(refund, "zh"),
        refundCents: refund.refundCents,
        initiatedCents: refund.initiatedCents,
        remainingCents: refund.remainingCents,
        deadlineAt: refund.deadlineAt,
        payableNow:
          refund.status === "approved" &&
          refund.remainingCents > 0 &&
          !refund.onHold,
        initiations: refund.initiations,
      })),
    ...refunds.shipping.map((refund) => ({
      kind: "shipping" as const,
      id: refund.id,
      label: `${sourceLabel.shipping} ${refund.id.slice(0, 8)}`,
      status: refund.remainingCents > 0 ? "待发起" : "已发起",
      refundCents: refund.refundCents,
      initiatedCents: refund.initiatedCents,
      remainingCents: refund.remainingCents,
      deadlineAt: refund.deadlineAt,
      payableNow: refund.remainingCents > 0,
      initiations: refund.initiations,
    })),
  ];
  if (!payable.length && !refunds.destinations.length) return <p>暂无退款。</p>;
  const alternatives = refunds.destinations.filter(
    (destination) => destination.kind === "alternative",
  );
  return (
    <div className="after-sales-refunds">
      <p>
        实际收款渠道：
        {refunds.receiptChannel ? channelZh[refunds.receiptChannel] : "未记录"}
        {refunds.originalReference
          ? ` · 原始付款参考 ${refunds.originalReference}`
          : ""}
        。网站只记录线下已发起的退款，不执行转账。
      </p>
      <table className="after-sales-table">
        <thead>
          <tr>
            <th>退款</th>
            <th>状态</th>
            <th>批准 / 已发起 / 剩余</th>
            <th>发起期限</th>
          </tr>
        </thead>
        <tbody>
          {payable.map((refund) => (
            <tr key={`${refund.kind}:${refund.id}`}>
              <td>{refund.label}</td>
              <td>
                {refund.payableNow
                  ? refunds.customerAccount?.account
                    ? refunds.customerAccount.account.kind === "alternative" &&
                      !refunds.approvals.some(
                        (approval) =>
                          approval.destinationId ===
                            refunds.customerAccount?.account?.id &&
                          approval.refundKind === refund.kind &&
                          approval.refundId === refund.id,
                      )
                      ? "收款账号已提供，退款渠道需 Owner 批准"
                      : "收款账号已提供，待汇款"
                    : refunds.destinations.length
                      ? "退款账号已登记，待汇款"
                      : "等待客户提供收款账号"
                  : refund.remainingCents === 0 && refund.initiatedCents > 0
                    ? "已汇款，退款完成"
                    : refund.status}
              </td>
              <td>
                {usd(refund.refundCents)} / {usd(refund.initiatedCents)} /{" "}
                {usd(refund.remainingCents)}
                {refund.initiations.map((initiation) => (
                  <small key={initiation.id} style={{ display: "block" }}>
                    {initiation.initiatedDateEt ?? "—"} ·{" "}
                    {usd(initiation.amountCents)} ·{" "}
                    {initiation.channel ? channelZh[initiation.channel] : "—"} ·{" "}
                    {"externalReference" in initiation
                      ? String(initiation.externalReference)
                      : ""}
                  </small>
                ))}
              </td>
              <td>
                {refund.deadlineAt
                  ? formatPiDate(refund.deadlineAt, "admin")
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {refunds.customerAccount?.account && (
        <section className="after-sales-refund-summary">
          <h4>收款账号已提供</h4>
          <p>
            客户提交 ·{" "}
            {refunds.customerAccount.account.channel === "paypal"
              ? "PayPal"
              : `银行尾号 ${refunds.customerAccount.account.accountLast4}`}{" "}
            ·{" "}
            {formatPiDate(refunds.customerAccount.account.submittedAt, "admin")}
          </p>
          {refunds.customerAccount.details ? (
            <details className="after-sales-evidence">
              <summary>查看退款账号信息</summary>
              <dl className="after-sales-facts">
                {(refunds.customerAccount.details.channel === "paypal"
                  ? [
                      [
                        "账户持有人",
                        refunds.customerAccount.details.holderName,
                      ],
                      [
                        "PayPal 邮箱",
                        refunds.customerAccount.details.paypalEmail,
                      ],
                    ]
                  : [
                      [
                        "账户持有人",
                        refunds.customerAccount.details.holderName,
                      ],
                      [
                        "持有人地址",
                        refunds.customerAccount.details.holderAddress,
                      ],
                      ["银行", refunds.customerAccount.details.bankName],
                      ["银行国家", refunds.customerAccount.details.bankCountry],
                      [
                        "账号 / IBAN",
                        refunds.customerAccount.details.accountNumber,
                      ],
                      [
                        "Routing / 清算代码",
                        refunds.customerAccount.details.routingCode,
                      ],
                      [
                        "SWIFT / BIC",
                        refunds.customerAccount.details.swiftCode,
                      ],
                      ["账户类型", refunds.customerAccount.details.accountType],
                      ["银行地址", refunds.customerAccount.details.bankAddress],
                    ]
                )
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          ) : (
            <p>完整退款账号信息仅具备退款权限的账号可查看。</p>
          )}
        </section>
      )}
      <h4>退款账号</h4>
      {refunds.destinations.length ? (
        <ul className="after-sales-line-list">
          {refunds.destinations.map((destination) => (
            <li key={destination.id}>
              {destination.id === refunds.customerAccount?.account?.id
                ? `客户提供的${destination.channel === "paypal" ? " PayPal " : "银行"}账号`
                : `${destination.label} · ${channelZh[destination.channel]} · ${destination.holderName} · ${destination.institution}`}
              {destination.accountLast4
                ? ` ****${destination.accountLast4}`
                : ""}{" "}
              ·{" "}
              {destination.kind === "alternative"
                ? "替代账户（需 Owner 逐笔批准）"
                : "原收款渠道 / 同一采购主体"}{" "}
              {destination.id !== refunds.customerAccount?.account?.id && (
                <> · 核实依据：{destination.verificationEvidence}</>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          等待客户提供收款账号，客户可在订单顶部填写银行或 PayPal 退款账号。
        </p>
      )}
      {canRefund && !refunds.customerAccount?.account && (
        <AdminActionDialog label="手动登记退款账号">
          <Form method="post" className="shipping-change-form">
            <input type="hidden" name="intent" value="refund-destination-add" />
            <input type="hidden" name="commandId" value={commandId} />
            <div className="shipping-change-fields">
              <label>
                渠道
                <select
                  name="channel"
                  defaultValue={refunds.receiptChannel ?? "bank_transfer"}
                >
                  <option value="bank_transfer">银行转账 / WorldFirst</option>
                  <option value="paypal">PayPal（原交易退款）</option>
                </select>
              </label>
              <label>
                类型
                <select name="kind" defaultValue="original_channel">
                  <option value="original_channel">
                    原收款渠道，同一采购主体
                  </option>
                  <option value="alternative">
                    替代账户（需 Owner 批准和理由）
                  </option>
                </select>
              </label>
              <label>
                名称
                <input name="label" required />
              </label>
              <label>
                账户持有人
                <input name="holderName" required />
              </label>
              <label>
                银行 / PayPal
                <input name="institution" required />
              </label>
              <label>
                账号后四位（勿填写完整账号）
                <input name="accountLast4" maxLength={4} />
              </label>
              <label className="shipping-change-choice">
                <input
                  type="checkbox"
                  name="samePurchasingContext"
                  defaultChecked
                />
                已核实属于同一个人客户 / 组织采购主体
              </label>
              <label>
                核实依据（内部，不向客户显示）
                <input name="verificationEvidence" required />
              </label>
            </div>
            <p>不支持现金、Store Credit 或未经核实的第三方账户。</p>
            <button className="button button-secondary" disabled={busy}>
              保存退款账号
            </button>
          </Form>
        </AdminActionDialog>
      )}
      {isOwner && alternatives.length > 0 && (
        <AdminActionDialog
          label="Owner 批准替代账户"
          title="Owner 批准替代账户（逐笔退款）"
        >
          <Form method="post" className="shipping-change-form">
            <input
              type="hidden"
              name="intent"
              value="refund-destination-approve"
            />
            <input type="hidden" name="commandId" value={commandId} />
            <label>
              替代账户
              <select name="destinationId" required>
                {alternatives.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              退款
              <select name="refund" required>
                {payable.map((refund) => (
                  <option
                    key={`${refund.kind}:${refund.id}`}
                    value={`${refund.kind}:${refund.id}`}
                  >
                    {refund.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              批准理由
              <textarea name="reason" required rows={2} />
            </label>
            <button className="button button-secondary" disabled={busy}>
              批准
            </button>
          </Form>
        </AdminActionDialog>
      )}
      {canRefund &&
        payable.some((refund) => refund.payableNow) &&
        refunds.destinations.length > 0 && (
          <AdminActionDialog
            label="已汇款，退款完成"
            title="确认已汇款并完成退款"
            primary
          >
            <RefundCompletionForm
              approvals={refunds.approvals}
              payable={payable.filter((refund) => refund.payableNow)}
              destinations={refunds.destinations.map((account) => ({
                ...account,
                label:
                  account.id === refunds.customerAccount?.account?.id
                    ? `客户提供的${account.channel === "paypal" ? " PayPal " : "银行"}账号`
                    : account.label,
              }))}
              commandId={commandId}
              todayEt={todayEt}
              busy={busy}
            />
          </AdminActionDialog>
        )}
    </div>
  );
}
