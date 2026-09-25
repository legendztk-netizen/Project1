export type ShipmentMilestoneStatus =
  "planned" | "ready_to_ship" | "shipped" | "delivered";

const stageIndex: Record<ShipmentMilestoneStatus, number> = {
  planned: 0,
  ready_to_ship: 1,
  shipped: 2,
  delivered: 3,
};

// Index of the last completed customer stage (0 = Order Confirmed).
export function completedStage(
  status: ShipmentMilestoneStatus,
  releaseReviewPending = false,
) {
  return releaseReviewPending ? 0 : stageIndex[status];
}

export function formatPhysicalQuantity(
  allocation: {
    physicalQuantity: number;
    unit: string;
    lengthPerPiece?: { value: number | null; unit: string | null } | null;
  },
  language: "zh" | "en",
) {
  const { physicalQuantity: quantity, unit, lengthPerPiece } = allocation;
  if (unit !== "pieces") return `${quantity} ${unit}`;
  const length =
    lengthPerPiece?.value != null
      ? `${lengthPerPiece.value} ${lengthPerPiece.unit ?? ""}`.trim()
      : null;
  if (language === "zh")
    return `${quantity} 根${length ? ` · 每根 ${length}` : ""}`;
  return `${quantity} ${quantity === 1 ? "piece" : "pieces"}${length ? ` · ${length} each` : ""}`;
}

export function adminShipmentProgressLabel(
  milestones: { status: ShipmentMilestoneStatus }[],
) {
  const total = milestones.length;
  if (!total) return "订单已确认";
  const delivered = milestones.filter(
    (item) => item.status === "delivered",
  ).length;
  const shipped = milestones.filter((item) =>
    ["shipped", "delivered"].includes(item.status),
  ).length;
  const ready = milestones.filter(
    (item) => item.status === "ready_to_ship",
  ).length;
  if (delivered === total) return total > 1 ? "已全部送达" : "已送达";
  if (shipped)
    return total > 1
      ? `已发货 ${shipped}/${total} 批${delivered ? ` · 已送达 ${delivered} 批` : ""}`
      : "已发货 · 待送达";
  if (ready)
    return total > 1
      ? `待发货 · 已备妥 ${ready}/${total} 批`
      : "已备妥 · 待发货";
  return total > 1 ? `待备妥 · 共 ${total} 批` : "待备妥";
}
