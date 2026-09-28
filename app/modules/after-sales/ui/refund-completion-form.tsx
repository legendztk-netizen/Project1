import { useState } from "react";
import { Form } from "react-router";
import { usd } from "../domain/refund-calculation";

export function RefundCompletionForm({
  payable,
  destinations,
  approvals,
  todayEt,
  commandId,
  busy,
}: {
  payable: Array<{
    kind: "after_sales" | "shipping";
    id: string;
    label: string;
    remainingCents: number;
  }>;
  destinations: Array<{
    id: string;
    label: string;
    accountLast4: string | null;
    kind: "original_channel" | "alternative";
  }>;
  approvals: Array<{
    destinationId: string;
    refundKind: "after_sales" | "shipping";
    refundId: string;
  }>;
  todayEt: string;
  commandId: string;
  busy: boolean;
}) {
  const [target, setTarget] = useState(`${payable[0]?.kind}:${payable[0]?.id}`);
  const selected = payable.find(
    (refund) => `${refund.kind}:${refund.id}` === target,
  );
  const availableAccounts = destinations.filter(
    (account) =>
      account.kind === "original_channel" ||
      approvals.some(
        (approval) =>
          approval.destinationId === account.id &&
          approval.refundKind === selected?.kind &&
          approval.refundId === selected?.id,
      ),
  );
  return (
    <Form method="post" className="shipping-change-form refund-account-form">
      <input type="hidden" name="intent" value="refund-initiation-record" />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="complete" value="true" />
      <input
        type="hidden"
        name="amountUsd"
        value={((selected?.remainingCents ?? 0) / 100).toFixed(2)}
      />
      <label>
        本次已汇款的退款
        <select
          name="refund"
          required
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          {payable.map((refund) => (
            <option
              key={`${refund.kind}:${refund.id}`}
              value={`${refund.kind}:${refund.id}`}
            >
              {refund.label} · {usd(refund.remainingCents)}
            </option>
          ))}
        </select>
      </label>
      <label>
        实际使用的退款账号
        <select
          key={target}
          name="destinationId"
          required
          disabled={!availableAccounts.length}
        >
          {!availableAccounts.length && (
            <option value="">暂无已批准的退款账号</option>
          )}
          {availableAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
              {account.accountLast4 ? ` · 尾号 ${account.accountLast4}` : ""}
            </option>
          ))}
        </select>
      </label>
      {!availableAccounts.length && (
        <p role="status">
          此笔退款尚无可用账号。客户选择的退款渠道与原收款渠道不同，或使用了替代账号，请先由
          Owner 在“Owner
          批准替代账户”中批准此账号用于这笔退款，再记录退款完成。勾选已核对账号不能代替该批准。
        </p>
      )}
      <p>
        确认已汇出 {usd(selected?.remainingCents ?? 0)}
        。这会结清所选退款；对应案件的收货、检验及其他退款也全部完成后，将自动结束案件。
      </p>
      <div className="shipping-change-fields">
        <label>
          汇款日期（美东）
          <input
            type="date"
            name="initiatedDateEt"
            required
            max={todayEt}
            defaultValue={todayEt}
          />
        </label>
        <label>
          汇款交易参考号
          <input name="externalReference" required maxLength={200} />
        </label>
      </div>
      <label className="shipping-change-choice">
        <input type="checkbox" name="accountVerified" required />
        已核对退款账号属于原采购主体，并确认在线下完成上述金额的汇款。
      </label>
      <p>
        此操作仅记录已经完成的汇款，不执行银行转账，也不表示客户银行已经入账。
      </p>
      <button
        className="button button-primary"
        disabled={busy || !selected || !availableAccounts.length}
      >
        已汇款，退款完成
      </button>
    </Form>
  );
}
