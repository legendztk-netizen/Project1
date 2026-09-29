export const ADMIN_MODULES = [
  {
    key: "catalog",
    label: "产品管理",
    description: "产品审核、发布、维护与总成管理",
  },
  {
    key: "configurator",
    label: "总成参数配置",
    description: "测量方法、时钟角、保护套与总成估价规则",
  },
  {
    key: "quotes",
    label: "询价与 PI",
    description: "询价审核、报价、PI 和收款记录",
  },
  {
    key: "orders",
    label: "订单与发货",
    description: "订单、发货单据与进度管理",
  },
  {
    key: "after_sales",
    label: "取消与售后",
    description: "售后处理、退货和退款执行记录；需同时授予订单只读或编辑权限",
  },
  { key: "messages", label: "消息管理", description: "客户对话、消息和附件" },
  {
    key: "notifications",
    label: "通知",
    description: "已授权业务的通知；只读也可标记自己的已读状态",
  },
  { key: "settings", label: "商业设置", description: "商业规则、工作日历" },
] as const;
export type AdminModule = (typeof ADMIN_MODULES)[number]["key"];
export type ModuleAccess = Partial<Record<AdminModule, "read" | "write">>;
export function adminPathModule(path: string): AdminModule | null {
  path = path.replace(/\.data$/, "");
  if (path === "/admin/catalog/reference-data") return "configurator";
  if (
    path.startsWith("/admin/catalog/") ||
    path.startsWith("/admin/diagnostics/")
  )
    return "catalog";
  if (path.includes("/after-sales")) return "after_sales";
  if (path.startsWith("/admin/messages") || path.includes("/conversation"))
    return "messages";
  if (
    path.startsWith("/admin/quotes") ||
    path.startsWith("/admin/quote-") ||
    path.startsWith("/admin/pi-")
  )
    return "quotes";
  if (path.startsWith("/admin/orders")) return "orders";
  if (path.startsWith("/admin/notifications")) return "notifications";
  if (path === "/admin/settings/commercial" || path === "/admin/china-calendar")
    return "settings";
  return null;
}
export function canAccessAdminPath(
  identity: { accountType: string; moduleAccess?: ModuleAccess },
  path: string,
  method: string,
) {
  if (identity.accountType === "owner") return true;
  // Legacy Access identities retain their existing authorization checks.
  if (!identity.moduleAccess) return true;
  path = path.replace(/\.data$/, "");
  const read = ["GET", "HEAD"].includes(method);
  if (
    path === "/admin" ||
    path === "/admin/" ||
    path === "/admin/settings/permissions"
  )
    return read;
  // This route only opens notifications or changes the actor's own read state.
  // Its action rejects all other intents; it cannot mutate business records.
  if (
    path === "/admin/notifications" &&
    method === "POST" &&
    identity.moduleAccess.notifications
  )
    return true;
  // The order detail action also hosts after-sales forms. That action checks
  // the submitted intent before any mutation; this exception only admits it.
  if (
    method === "POST" &&
    /^\/admin\/orders\/[^/]+$/.test(path) &&
    identity.moduleAccess.orders &&
    identity.moduleAccess.after_sales === "write"
  )
    return true;
  const module = adminPathModule(path);
  return (
    !!module &&
    (identity.moduleAccess[module] === "write" ||
      (read && identity.moduleAccess[module] === "read"))
  );
}

export function canWriteAdminModule(
  identity: { accountType: string; moduleAccess?: ModuleAccess },
  module: AdminModule,
) {
  return (
    identity.accountType === "owner" ||
    !identity.moduleAccess ||
    identity.moduleAccess[module] === "write"
  );
}
