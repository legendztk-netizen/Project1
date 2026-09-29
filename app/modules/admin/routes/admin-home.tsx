import {
  ArrowRight,
  Boxes,
  ClipboardList,
  FileText,
  MessagesSquare,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Settings,
  Waypoints,
} from "lucide-react";
import { Link, useRevalidator } from "react-router";
import type { Route } from "./+types/admin-home";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { readAdminOverview } from "../infrastructure/admin-overview";
import { AdminNavigation } from "../ui/admin-navigation";
import { formatBeijingDateTime } from "../../quote-review/domain/admin-quote-review";
import "../styles/admin-overview.css";

export function meta() {
  return [{ title: "后台总览 | 管理后台" }];
}
export async function loader({ context }: Route.LoaderArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  return readAdminOverview(env.DB, adminIdentity);
}
const icons = {
  products: Boxes,
  catalog: ClipboardList,
  configurator: Waypoints,
  quotes: FileText,
  orders: PackageCheck,
  messages: MessagesSquare,
  after_sales: RotateCcw,
  settings: Settings,
};
export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const busy = revalidator.state !== "idle";
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="overview" />
      <main className="admin-main admin-overview">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">管理后台</span>
            <h1>后台总览</h1>
            <p>查看待处理业务，快速进入常用工作。</p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void revalidator.revalidate()}
            disabled={busy}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {busy ? "正在更新…" : "刷新待办"}
          </button>
        </header>
        <section
          className="overview-section"
          aria-labelledby="overview-tasks-title"
          aria-busy={busy}
        >
          <div className="overview-section-heading">
            <h2 id="overview-tasks-title">业务待办</h2>
            <span>更新于 {formatBeijingDateTime(loaderData.updatedAt)}</span>
          </div>
          {loaderData.metrics.length ? (
            <div className="overview-tasks">
              {loaderData.metrics.map((metric) => {
                const Icon = icons[metric.key as keyof typeof icons];
                return (
                  <Link
                    key={metric.key}
                    to={metric.to}
                    className={`overview-task${metric.count ? " has-pending" : ""}`}
                    aria-label={`${metric.title} ${metric.count}，查看列表`}
                  >
                    <div className="overview-task-heading">
                      <span>{metric.title}</span>
                      <Icon size={21} aria-hidden="true" />
                    </div>
                    <strong>{metric.count.toLocaleString("zh-CN")}</strong>
                    <small>{metric.description}</small>
                    <span className="overview-task-link">
                      查看列表 <ArrowRight size={15} aria-hidden="true" />
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="overview-empty">
              当前可用模块没有待办统计，请从下方常用操作进入。
            </p>
          )}
        </section>
        <section
          className="overview-section"
          aria-labelledby="overview-shortcuts-title"
        >
          <div className="overview-section-heading">
            <h2 id="overview-shortcuts-title">常用操作</h2>
            <span>按当前账号权限显示</span>
          </div>
          {loaderData.shortcuts.length ? (
            <div className="overview-shortcuts">
              {loaderData.shortcuts.map((item) => {
                const Icon = icons[item.key];
                return (
                  <Link
                    key={item.key}
                    to={item.to}
                    className="overview-shortcut"
                  >
                    <span className="overview-shortcut-icon">
                      <Icon size={22} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>
                        {item.title}
                        {item.readonly && <small>只读</small>}
                      </strong>
                      <p>{item.description}</p>
                    </div>
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="overview-empty">
              <strong>暂未获得业务模块权限</strong>
              <p>请联系主账号管理员分配权限后开始工作。</p>
              <Link to="/admin/settings/permissions">
                查看我的权限 <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
