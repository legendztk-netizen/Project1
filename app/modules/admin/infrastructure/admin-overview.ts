import type { AdminIdentity } from "#workers/admin-access";
import {
  canAccessAdminPath,
  canWriteAdminModule,
  adminPathModule,
} from "../domain/admin-module-access";
import { createD1AdminQuoteReviewRepository } from "../../quote-review/infrastructure/d1-admin-quote-review-repository";
import { createD1MessageCenter } from "../../message-center/infrastructure/d1-message-center";
import { orderStageSql } from "../../proforma-invoice/application/confirmed-order-service";

const shortcuts = [
  {
    key: "products",
    title: "管理所有产品",
    description: "查询规格、价格与产品状态",
    to: "/admin/catalog/products",
  },
  {
    key: "catalog",
    title: "产品审核与发布",
    description: "处理导入后的产品变更",
    to: "/admin/catalog/requests",
  },
  {
    key: "configurator",
    title: "总成参数配置",
    description: "维护测量方法、时钟角与估价规则",
    to: "/admin/catalog/reference-data",
  },
  {
    key: "quotes",
    title: "询价审核",
    description: "审核客户需求，准备报价与 PI",
    to: "/admin/quotes",
  },
  {
    key: "orders",
    title: "订单与发货",
    description: "查看订单、安排发货与更新进度",
    to: "/admin/orders",
  },
  {
    key: "messages",
    title: "消息管理",
    description: "查看客户对话与附件",
    to: "/admin/messages",
  },
  {
    key: "after_sales",
    title: "取消与售后",
    description: "处理取消申请、退货与退款记录",
    to: "/admin/after-sales",
  },
  {
    key: "settings",
    title: "商业设置",
    description: "维护公司资料与交易设置",
    to: "/admin/settings/commercial",
  },
] as const;

export async function readAdminOverview(
  db: D1Database,
  identity: AdminIdentity,
) {
  const allowed = (to: string) =>
    canAccessAdminPath(identity, to.split("?")[0], "GET");
  const count = async (sql: string) =>
    (await db.prepare(sql).first<{ count: number }>())?.count ?? 0;
  const tasks = [
    {
      key: "catalog",
      title: "待审核产品",
      description: "待处理的产品变更",
      to: "/admin/catalog/requests?status=pending",
      load: () =>
        count(
          "SELECT count(*) AS count FROM catalog_product_change_requests WHERE status='pending'",
        ),
    },
    {
      key: "quotes",
      title: "待审核询价",
      description: "尚未开始报价审核",
      to: "/admin/quotes?review=awaiting_review",
      load: () => createD1AdminQuoteReviewRepository(db).countAwaitingReview(),
    },
    {
      key: "orders",
      title: "待发货订单",
      description: "已备妥且未被付款复核锁定",
      to: "/admin/orders?stage=ready&status=confirmed",
      load: () =>
        count(
          `SELECT count(*) AS count FROM confirmed_orders o LEFT JOIN order_release_guards guard ON guard.order_id=o.id WHERE coalesce(guard.held,0)=0 AND (${orderStageSql})='ready'`,
        ),
    },
    {
      key: "messages",
      title: "未读客户对话",
      description: "有客户新消息的对话",
      to: "/admin/messages?filter=unread",
      load: () => createD1MessageCenter(db).adminUnreadThreads(identity.id),
    },
  ];
  // Filter before querying: unauthorized business counts never enter the loader response.
  const metrics = await Promise.all(
    tasks
      .filter((task) => allowed(task.to))
      .map(async ({ load, ...task }) => ({ ...task, count: await load() })),
  );
  return {
    metrics,
    shortcuts: shortcuts
      .filter((item) => allowed(item.to))
      .map((item) => ({
        ...item,
        readonly: !canWriteAdminModule(identity, adminPathModule(item.to)!),
      })),
    updatedAt: new Date().toISOString(),
  };
}
