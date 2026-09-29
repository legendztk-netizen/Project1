const messages: Array<[RegExp, string]> = [
  [/^Package label is required/, "请填写包裹名称。"],
  [/^Carrier is required/, "请填写承运商名称。"],
  [/^Carrier handoff source is required/, "请填写交接凭据来源。"],
  [/^Delivery source is required/, "请填写送达确认来源。"],
  [
    /^Tracking source or correction reason is required/,
    "请填写记录来源或更正原因。",
  ],
  [/^Late handoff review reason is required/, "请填写迟录原因。"],
  [
    /^Invalid tracking URL|^Tracking URL must be a public HTTPS address/,
    "追踪链接必须是以 https:// 开头的公开网址。",
  ],
  [/^Invalid estimated arrival date/, "预计送达日期无效。"],
  [/^Invalid tracking details/, "追踪号码或预计送达日期格式无效。"],
  [/^Carrier tracking starts after readiness/, "核实备妥后才能添加包裹追踪。"],
  [
    /^Carrier handoff cannot precede verified readiness/,
    "交接时间不能早于核实备妥的记录时间。",
  ],
  [/^Carrier handoff cannot be in the future/, "交接时间不能晚于当前时间。"],
  [/^A valid carrier handoff time is required/, "请填写有效的交接时间。"],
  [
    /^Delivery cannot precede carrier handoff/,
    "送达日期不能早于承运商交接日期。",
  ],
  [/^An actual date cannot be in the future/, "实际日期不能晚于今天。"],
  [/^A valid actual date is required/, "请填写有效的实际日期。"],
];

// Turns a milestone or tracking command rejection into an actionable Admin message.
export function adminMilestoneError(status: number, message: string) {
  const match = messages.find(([pattern]) => pattern.test(message));
  if (match) return match[1];
  return status === 409
    ? "批次状态或放行条件已变化，请刷新后核查限制与数量。"
    : "批次状态保存失败，请检查日期、数量和必填凭据。";
}
