export const adminAfterSalesTabs = [
  { id: "cases", label: "售后案件" },
  { id: "refunds", label: "退款" },
  { id: "cancellations", label: "订单取消申请" },
] as const;

export type AdminAfterSalesTab = (typeof adminAfterSalesTabs)[number]["id"];

export function adminAfterSalesTab(value: string | null): AdminAfterSalesTab {
  return adminAfterSalesTabs.find((tab) => tab.id === value)?.id ?? "cases";
}
