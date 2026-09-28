/**
 * Individually assignable Admin Permissions (ADR-0047). The Owner Account
 * holds all of them; an Admin Subaccount holds only those the Owner grants.
 */
export const ADMIN_PERMISSIONS = [
  {
    key: "after_sales.review",
    label: "售后审核",
    description:
      "查看并处理取消申请、售后案件、退货授权、收货、检验、决定修订和证据文件",
  },
  {
    key: "after_sales.refund",
    label: "退款执行记录",
    description: "核验退款账户、查看待退款队列、记录在网站外发起的退款",
  },
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]["key"];

export function isAdminPermission(value: unknown): value is AdminPermission {
  return ADMIN_PERMISSIONS.some((permission) => permission.key === value);
}
