import type { CustomerOrderStage } from "../../proforma-invoice/application/confirmed-order-service";

export const orderStageLabels: Record<CustomerOrderStage, string> = {
  processing: "待备妥",
  ready: "已备妥 · 待发货",
  shipped: "已发货",
  delivered: "已送达",
};

/** The fulfillment stage, showing partial shipment as shipped/total. */
export function orderStageText(order: {
  stage: CustomerOrderStage;
  shippedCount: number;
  shipmentCount: number;
}) {
  return order.stage === "shipped" && order.shippedCount < order.shipmentCount
    ? `部分发货 ${order.shippedCount}/${order.shipmentCount}`
    : orderStageLabels[order.stage];
}

/** Admin money display, e.g. `USD 1234.56`. */
export function formatAdminUsd(cents: number) {
  return `USD ${(cents / 100).toFixed(2)}`;
}
