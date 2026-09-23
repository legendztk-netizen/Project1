import type { PiPaymentsPageData } from "../routes/pi-payments";

export const paymentPanelTitles = {
  "retain-agreement": "以客户已接受的 PI 为准",
  received: "更新累计到账金额",
  instructions: "更改付款渠道和说明",
  original: "登记原币到账",
  confirm: "确认付款",
  extend: "延长付款期限",
  "late-review": "逾期商业复核",
  allocate: "分配款项至其他 PI",
  refund: "登记已完成外部退款",
  "refund-original": "登记原币退款",
  "correct-confirmation": "更正付款确认",
  "resolve-correction": "付款放行审核",
} as const;
export type PaymentPanel = keyof typeof paymentPanelTitles;

export const originalCurrencies = [
  ["EUR", "欧元"],
  ["GBP", "英镑"],
  ["CNY", "人民币"],
  ["HKD", "港币"],
  ["JPY", "日元"],
  ["CAD", "加拿大元"],
  ["AUD", "澳大利亚元"],
  ["SGD", "新加坡元"],
  ["CHF", "瑞士法郎"],
  ["NZD", "新西兰元"],
  ["KRW", "韩元"],
  ["TWD", "新台币"],
  ["AED", "阿联酋迪拉姆"],
  ["SAR", "沙特里亚尔"],
  ["INR", "印度卢比"],
  ["MYR", "马来西亚林吉特"],
  ["THB", "泰铢"],
  ["IDR", "印度尼西亚卢比"],
  ["VND", "越南盾"],
  ["PHP", "菲律宾比索"],
  ["MXN", "墨西哥比索"],
  ["BRL", "巴西雷亚尔"],
  ["ZAR", "南非兰特"],
  ["SEK", "瑞典克朗"],
  ["NOK", "挪威克朗"],
  ["DKK", "丹麦克朗"],
  ["PLN", "波兰兹罗提"],
] as const;

export function paymentActionReasons(
  data: PiPaymentsPageData,
): Partial<Record<PaymentPanel, string>> {
  const { payment: p, late, correction, funds, isOwner } = data;
  const disputed = correction.disputes.some((entry) => entry.active === 1);
  return {
    "retain-agreement": data.agreement.blockedReason ?? undefined,
    received: p.paymentConfirmed
      ? "款项已确认，请使用更正付款确认。"
      : undefined,
    instructions: !p.current
      ? "仅当前 PI 可更改付款说明。"
      : !p.receiptHistoryKnown
        ? "到账历史尚未核对，暂不能更改付款说明。"
        : p.hasEverReceived || p.amountReceivedCents > 0
          ? "已有到账历史，不能更改付款说明。"
          : !data.choices.some((choice) => choice.id !== p.instructionId)
            ? "没有其他可用的付款说明。"
            : undefined,
    confirm: !p.current
      ? "历史 PI 不能确认付款。"
      : p.paymentConfirmed
        ? "款项已确认。"
        : disputed
          ? "请先完成付款放行审核。"
          : !p.receiptHistoryKnown
            ? "请先核对并登记到账金额。"
            : p.termKind === "legacy_review" && !p.paymentDeadlineUnspecified
              ? "请先核对客户接受的 PI，并确认以该协议为准。"
              : p.quoteReviewRequired
                ? "已发布新的报价，请先核对是否保留客户已接受的 PI。"
                : late.overdue
                  ? "请先延期或完成逾期商业复核。"
                  : p.balanceCents > 0
                    ? "到账金额尚未达到应付总额。"
                    : !p.actualChannel
                      ? "请先登记实际到账渠道。"
                      : undefined,
    extend: !p.current
      ? "仅当前 PI 可延期。"
      : p.orderId
        ? "订单已创建，不能延长付款期限。"
        : !p.acceptedAt
          ? "客户接受 PI 后才可延期。"
          : !p.dueAt
            ? p.paymentDeadlineUnspecified
              ? "原协议未约定截止日，无需延期。"
              : "付款截止时间尚未确定。"
            : undefined,
    "late-review": !p.current ? "仅当前 PI 可进行逾期复核。" : undefined,
    allocate: funds.availableCents <= 0 ? "暂无可分配款项。" : undefined,
    refund: funds.availableCents <= 0 ? "暂无可退款项。" : undefined,
    "correct-confirmation": !p.paymentConfirmed
      ? "尚无有效付款确认可更正。"
      : undefined,
    "resolve-correction": !isOwner
      ? "需由 Owner 完成放行审核。"
      : !correction.disputes.some(
            (entry) => entry.active === 1 && entry.source_pi_id === p.piId,
          )
        ? "请在更正来源 PI 处理放行审核。"
        : undefined,
  };
}
