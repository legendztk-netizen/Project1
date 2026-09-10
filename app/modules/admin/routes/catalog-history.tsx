import "../ui/catalog-request-review.css";
import { Form, Link, useLoaderData } from "react-router";
import type { Route } from "./+types/catalog-history";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  historySections,
  readCatalogHistory,
} from "../../catalog/infrastructure/d1-catalog-history";
export function meta() {
  return [{ title: "历史目录与导入来源 | 后台" }];
}
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  return readCatalogHistory(env.DB, new URL(request.url));
}
export async function action({ context }: Route.ActionArgs) {
  requireAdminRequestContext(context);
  throw new Response("历史目录仅供读取", { status: 405 });
}
const statuses: Record<string, string> = {
  draft: "历史草稿",
  published: "已发布基线",
  superseded: "历史已发布",
};
export default function History() {
  const d = useLoaderData<typeof loader>();
  const href = (page: number) => {
    const params = new URLSearchParams({
      page: String(page),
      section: d.section,
      q: d.query,
      status: d.status,
    });
    if (d.releaseId) params.set("release", d.releaseId);
    return `/admin/catalog/history?${params}`;
  };
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="catalog" />
      <main className="catalog-request-page">
        <h1>历史目录与导入来源</h1>
        <p>
          原目录及草稿只读保留。此处展示当时保存的数据，不代表当前上线产品，也不会重新计算或发布。
        </p>
        <p>
          <Link to="/admin/catalog/requests">返回产品审核与发布</Link>
          {d.release && (
            <>
              {" "}
              · <Link to="/admin/catalog/history">全部历史版本</Link>
            </>
          )}
        </p>
        {d.release && (
          <section>
            <h2>
              {String(d.release.release_number)} ·{" "}
              {statuses[String(d.release.status)] ?? String(d.release.status)}
            </h2>
            <p>
              来源文件：{String(d.release.source_file_name ?? "未记录")}
              ；导入编号：{String(d.release.source_import_id)}
            </p>
            <details>
              <summary>版本来源详情</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(d.release, null, 2)}
              </pre>
            </details>
          </section>
        )}
        <Form method="get">
          {d.releaseId ? (
            <>
              <input type="hidden" name="release" value={d.releaseId} />
              <label>
                历史数据类别
                <select name="section" defaultValue={d.section}>
                  {Object.entries(historySections).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              版本状态
              <select name="status" defaultValue={d.status}>
                <option value="">全部</option>
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(!d.release || d.section === "catalog_skus") && (
            <label>
              {d.release ? "SKU 模糊查询" : "版本编号查询"}
              <input name="q" defaultValue={d.query} />
            </label>
          )}
          <button>筛选</button>
        </Form>
        <p>
          第 {d.page} / {d.pages} 页，共 {d.total} 条，每页 20 条。
        </p>
        {d.rows.map((row, index) => (
          <section key={index}>
            {d.release ? (
              <details>
                <summary>
                  {String(
                    row.sku ??
                      row.series_code ??
                      row.compatibility_id ??
                      row.entry_key ??
                      row.id ??
                      `记录 ${(d.page - 1) * 20 + index + 1}`,
                  )}{" "}
                  · 查看原记录
                </summary>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(row, null, 2)}
                </pre>
              </details>
            ) : (
              <>
                <Link
                  to={`/admin/catalog/history?release=${encodeURIComponent(String(row.id))}`}
                >
                  {String(row.release_number)}
                </Link>
                <p>
                  {statuses[String(row.status)] ?? String(row.status)} ·{" "}
                  {String(row.created_at)}
                </p>
              </>
            )}
          </section>
        ))}
        {!d.rows.length && <p>没有匹配的历史记录。</p>}
        <nav aria-label="历史目录分页">
          {d.page > 1 && <Link to={href(d.page - 1)}>上一页</Link>}{" "}
          {d.page < d.pages && <Link to={href(d.page + 1)}>下一页</Link>}
        </nav>
      </main>
    </div>
  );
}
