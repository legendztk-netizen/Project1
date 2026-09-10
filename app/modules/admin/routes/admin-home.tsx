import { Activity, Boxes, Database, Waypoints } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/admin-home";
import { createD1CatalogPublicationRepository } from "../../catalog/infrastructure/d1-catalog-publication-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createD1CatalogItemRepository } from "../../catalog/infrastructure/d1-catalog-item-repository";
import { AdminNavigation } from "../ui/admin-navigation";

export function meta() {
  return [{ title: "Admin Backoffice | Hydraulic Supply" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  const activeRelease = await createD1CatalogPublicationRepository(
    env.DB,
  ).findActiveRelease();
  return {
    activeRelease,
    adminIdentity,
    environment: env.APP_ENV,
    publication: await createD1CatalogItemRepository(env.DB).state(),
  };
}

export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const itemMode = loaderData.publication.mode === "items";
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="overview" />

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">Admin Backoffice</span>
            <h1>Overview</h1>
          </div>
          <span className="environment-badge">
            <Activity size={15} /> {loaderData.adminIdentity.accountType} ·{" "}
            {loaderData.environment}
          </span>
        </header>

        <section className="admin-metrics" aria-label="Platform status">
          <article>
            <span>Application</span>
            <strong>Running</strong>
            <small>Cloudflare Worker</small>
          </article>
          <article>
            <span>产品发布方式</span>
            <strong>
              {itemMode
                ? "条目级发布"
                : (loaderData.activeRelease?.releaseNumber ?? "尚未发布")}
            </strong>
            <small>
              {itemMode
                ? "产品独立发布，总成按受影响系列更新"
                : loaderData.activeRelease
                  ? "整本目录发布"
                  : "等待导入产品"}
            </small>
          </article>
          <article>
            <span>Environment</span>
            <strong>{loaderData.environment}</strong>
            <small>Runtime binding</small>
          </article>
        </section>

        <section className="admin-panel">
          <div>
            <span className="eyebrow">System boundary</span>
            <h2>Catalog operations</h2>
          </div>
          <div className="empty-state">
            <Database size={24} />
            <div>
              <strong>
                {itemMode
                  ? "产品维护已切换到条目流程"
                  : loaderData.activeRelease
                    ? "目录已发布"
                    : "尚无已发布目录"}
              </strong>
              <p>
                {itemMode
                  ? "手动新增或编辑直接发布；批量导入在产品审核与发布中处理。历史目录保留只读。"
                  : "通过目录导入和审核维护产品。"}
              </p>
            </div>
          </div>
          <Link className="button button-primary" to="/admin/catalog/products">
            <Boxes size={17} /> 管理所有产品
          </Link>
          <Link
            className="button button-secondary"
            to="/admin/catalog/requests"
          >
            <Boxes size={17} /> 产品审核与发布
          </Link>
          <Link
            className="button button-secondary"
            to="/admin/catalog/reference-data"
          >
            <Waypoints size={17} /> 总成参数配置
          </Link>
          {itemMode && (
            <Link
              className="button button-secondary"
              to="/admin/catalog/history"
            >
              历史目录与来源
            </Link>
          )}
          <Link
            className="button button-secondary"
            to="/admin/diagnostics/catalog-release"
          >
            <Database size={17} /> Open D1 diagnostic
          </Link>
        </section>
      </main>
    </div>
  );
}
