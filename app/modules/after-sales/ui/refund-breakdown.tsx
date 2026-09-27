import type { RefundAuthorizationView } from "../infrastructure/d1-refund-authorizations";
import { usd } from "../domain/refund-calculation";
import "./after-sales.css";

const labels = {
  en: {
    merchandise: "Merchandise",
    logistics: "Recoverable logistics",
    sellerLogistics: "Seller-funded logistics",
    tax: "Sales Tax adjustment",
    service: "Service fee reversal",
    gross: "Gross refund",
    restocking: "Restocking fee (10%)",
    thirdParty: "Documented third-party cost",
    net: "Refund amount",
    initiated: "Refund initiated",
    remaining: "Not yet initiated",
  },
  zh: {
    merchandise: "商品金额（折后）",
    logistics: "可退回物流费用",
    sellerLogistics: "卖方承担的物流费用",
    tax: "销售税调整",
    service: "服务费退回",
    gross: "退款总额",
    restocking: "退货手续费（10%）",
    thirdParty: "已记录第三方费用",
    net: "应退金额",
    initiated: "已发起退款",
    remaining: "尚未发起",
  },
} as const;

export function refundStatusLabel(
  refund: Pick<
    RefundAuthorizationView,
    "status" | "initiatedCents" | "refundCents" | "deadlineDateEt"
  >,
  language: "en" | "zh",
) {
  if (refund.status === "superseded")
    return language === "en"
      ? "Replaced by a revised amount"
      : "已被修订金额取代";
  if (refund.initiatedCents >= refund.refundCents)
    return language === "en" ? "Refund initiated" : "已发起退款";
  if (refund.initiatedCents > 0)
    return language === "en" ? "Refund partly initiated" : "部分已发起退款";
  if (refund.status === "awaiting_customer_confirmation")
    return language === "en"
      ? "Your confirmation is needed"
      : "等待客户确认扣减金额";
  if (refund.status === "disputed")
    return language === "en"
      ? "Disputed — under seller review"
      : "客户对金额有异议，待处理";
  return language === "en"
    ? `Refund approved — not yet sent${refund.deadlineDateEt ? ` (to be initiated by ${refund.deadlineDateEt} ET)` : ""}`
    : `退款已批准，尚未发起${refund.deadlineDateEt ? `（须在美东 ${refund.deadlineDateEt} 前发起）` : ""}`;
}

export function RefundBreakdown({
  refund,
  language,
}: {
  refund: RefundAuthorizationView;
  language: "en" | "zh";
}) {
  const text = labels[language];
  const rows: Array<[string, number, boolean?]> = [
    [text.merchandise, refund.merchandiseCents],
    [text.logistics, refund.logisticsCents],
    [text.sellerLogistics, refund.sellerLogisticsCents],
    [text.tax, refund.taxCents],
    [text.service, refund.serviceFeeCents],
  ];
  return (
    <dl className="after-sales-money">
      {rows
        .filter(([, value], index) => index === 0 || value > 0)
        .map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt>{label}</dt>
            <dd>{usd(value)}</dd>
          </div>
        ))}
      {(refund.restockingFeeCents > 0 || refund.thirdPartyCostCents > 0) && (
        <>
          <dt>{text.gross}</dt>
          <dd>{usd(refund.grossCents)}</dd>
        </>
      )}
      {refund.restockingFeeCents > 0 && (
        <>
          <dt>{text.restocking}</dt>
          <dd>{usd(-refund.restockingFeeCents)}</dd>
        </>
      )}
      {refund.thirdPartyCostCents > 0 && (
        <>
          <dt>
            {text.thirdParty}
            {refund.thirdPartyCostEvidence
              ? ` — ${refund.thirdPartyCostEvidence}`
              : ""}
          </dt>
          <dd>{usd(-refund.thirdPartyCostCents)}</dd>
        </>
      )}
      <dt className="after-sales-money-total">{text.net}</dt>
      <dd className="after-sales-money-total">{usd(refund.refundCents)}</dd>
      {refund.initiatedCents > 0 && (
        <>
          <dt>{text.initiated}</dt>
          <dd>{usd(refund.initiatedCents)}</dd>
          <dt>{text.remaining}</dt>
          <dd>{usd(refund.remainingCents)}</dd>
        </>
      )}
    </dl>
  );
}
