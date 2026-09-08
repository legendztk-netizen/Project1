import "../ui/assembly-management.css";
import {
  Link,
  Form,
  data,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import type { Route } from "./+types/catalog-assemblies";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  requireAdminRequestContext,
  requireCatalogWriteContext,
} from "../infrastructure/admin-request-context";
import { createD1ManagedAssemblies } from "../../catalog/infrastructure/d1-managed-assemblies";
import { CatalogItemRejected } from "../../catalog/domain/catalog-item-publication";

export function meta() {
  return [{ title: "总成管理 | Admin Backoffice" }];
}
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const mode = await env.DB.prepare(
    "SELECT mode FROM catalog_item_publication_state WHERE singleton=1",
  ).first<{ mode: string }>();
  if (mode?.mode !== "items") return redirect("/admin/catalog/reference-data");
  const repo = createD1ManagedAssemblies(env.DB, adminIdentity);
  const url = new URL(request.url);
  const filters = Object.fromEntries(
    ["endA", "series", "endB", "enabled", "ready", "q"].map((k) => [
      k,
      url.searchParams.get(k) ?? "",
    ]),
  );
  const page = Math.max(
    1,
    Math.floor(Number(url.searchParams.get("page")) || 1),
  );
  const [rows, pending, sources, history, options] = await Promise.all([
    repo.all({ filters, limit: 51, offset: (page - 1) * 50 }),
    repo.pending(),
    repo.sources(),
    repo.history(url.searchParams.get("detail") ?? undefined),
    repo.filterOptions(),
  ]);
  return {
    rows: rows.slice(0, 50),
    page,
    hasNext: rows.length > 50,
    pending,
    sources,
    history,
    filters,
    options,
    detail: url.searchParams.get("detail"),
    canEdit: adminIdentity.catalogPermission !== "view",
    commandId: crypto.randomUUID(),
    preview: url.searchParams.has("preview"),
  };
}
export async function action({ context, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireCatalogWriteContext(context);
  const repo = createD1ManagedAssemblies(env.DB, adminIdentity);
  const form = await request.formData();
  const value = (k: string) => String(form.get(k) ?? "");
  const command = {
    id: value("commandId") || crypto.randomUUID(),
    ipAddress: request.headers.get("cf-connecting-ip") ?? "local",
  };
  try {
    switch (value("intent")) {
      case "update":
        return data({
          message: "更新处理完成",
          results: await repo.update(command),
        });
      case "add":
        await repo.add(
          {
            hoseSku: value("hoseSku"),
            endAHoseEndSku: value("endAHoseEndSku"),
            endAFerruleSku: value("endAFerruleSku"),
            endBHoseEndSku: value("endBHoseEndSku"),
            endBFerruleSku: value("endBFerruleSku"),
          },
          command,
        );
        break;
      case "enable":
      case "disable":
        await repo.setEnabled(
          form.getAll("identity").map(String),
          value("intent") === "enable",
          value("reason"),
          command,
        );
        break;
      case "apply":
      case "reject":
      case "delete":
        await repo.processSource(
          value("sourceId"),
          value("intent") as "apply" | "reject" | "delete",
          value("reason"),
          command,
        );
        break;
      default:
        throw new CatalogItemRejected("未知操作");
    }
    return data({ message: "操作已保存", results: [] });
  } catch (error) {
    return data(
      {
        message: error instanceof Error ? error.message : "操作失败",
        results: [],
      },
      { status: error instanceof CatalogItemRejected ? error.status : 409 },
    );
  }
}
const sourceNames: Record<string, string> = {
  manual: "手动",
  automatic: "自动",
  import: "导入",
  legacy: "历史目录",
};
export default function AssemblyManagement() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="catalog" maintenanceMode="assemblies" />
      <main className="admin-main assembly-management">
        <h1>总成管理</h1>
        <p>
          管理胶管、End A 接头及套筒、End B
          接头及套筒的有序组合。长度、Clocking、保护方案和价格在客户配置时确定。
        </p>
        {result && (
          <div role="status">
            <p>{result.message}</p>
            {result.results.map((r) => (
              <p key={r.series}>
                {r.series}：{r.success ? "成功" : "失败"} — {r.reason}
              </p>
            ))}
          </div>
        )}
        <Form method="get">
          <fieldset>
            <legend>筛选</legend>
            {[
              ["endA", "End A", "endAHoseEndSku"],
              ["series", "胶管系列", "hoseSeries"],
              ["endB", "End B", "endBHoseEndSku"],
            ].map(([key, label, field]) => (
              <label key={key}>
                {label}
                <select name={key} defaultValue={d.filters[key]}>
                  <option value="">全部</option>
                  {[
                    ...new Set(
                      d.options
                        .filter(
                          (o) =>
                            o.kind ===
                            (field === "hoseSeries" ? "series" : "end"),
                        )
                        .map((o) => o.code),
                    ),
                  ]
                    .sort()
                    .map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                </select>
              </label>
            ))}
            <label>
              使用状态
              <select name="enabled" defaultValue={d.filters.enabled}>
                <option value="">全部</option>
                <option value="enabled">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
            <label>
              数据状态
              <select name="ready" defaultValue={d.filters.ready}>
                <option value="">全部</option>
                <option value="current">当前</option>
                <option value="pending">待更新</option>
              </select>
            </label>
            <label>
              SKU 模糊查询
              <input name="q" defaultValue={d.filters.q} />
            </label>
            <button>筛选</button>
          </fieldset>
        </Form>
        <section>
          <h2>更新总成数据</h2>
          <p>
            系统待更新系列：{d.pending.join("、") || "无"}
            。更新范围不受筛选或复选框影响。
          </p>
          {!d.preview ? (
            <Form method="get">
              <button name="preview" value="1">
                预览完整更新范围
              </button>
            </Form>
          ) : (
            <Form method="post">
              <input type="hidden" name="commandId" value={d.commandId} />
              <p>
                确认后逐系列更新；失败系列保留待更新。提交时重新计算完整范围。
              </p>
              <button
                name="intent"
                value="update"
                disabled={!d.canEdit || !d.pending.length}
              >
                确认更新全部待更新系列
              </button>
            </Form>
          )}
        </section>
        <details>
          <summary>新增手动组合</summary>
          <Form method="post">
            <input type="hidden" name="commandId" value={d.commandId} />
            {[
              ["hoseSku", "胶管 / Hose SKU"],
              ["endAHoseEndSku", "End A 接头 / Hose End SKU"],
              ["endAFerruleSku", "End A 套筒 / Ferrule SKU"],
              ["endBHoseEndSku", "End B 接头 / Hose End SKU"],
              ["endBFerruleSku", "End B 套筒 / Ferrule SKU"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input name={key} required />
              </label>
            ))}
            <p>
              依照现有 Dash、系列和剥胶规则校验 / Existing Dash, series and
              skive rules apply.
            </p>
            <button name="intent" value="add" disabled={!d.canEdit}>
              保存手动组合
            </button>
          </Form>
        </details>
        <Form method="post">
          <input type="hidden" name="commandId" value={d.commandId} />
          <table>
            <thead>
              <tr>
                {[
                  "选择",
                  "胶管",
                  "End A 接头 / 套筒",
                  "End B 接头 / 套筒",
                  "状态",
                  "来源",
                  "详情",
                ].map((v) => (
                  <th key={v}>{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((c) => (
                <tr key={c.identity}>
                  <td>
                    <input
                      type="checkbox"
                      name="identity"
                      value={c.identity}
                      aria-label={`选择 ${c.identity}`}
                    />
                  </td>
                  <td>
                    {c.hoseSeries} / {c.hoseSku}
                  </td>
                  <td>
                    {c.endAHoseEndSku} / {c.endAFerruleSku}
                  </td>
                  <td>
                    {c.endBHoseEndSku} / {c.endBFerruleSku}
                  </td>
                  <td>
                    {c.disabled ? "停用" : "启用"} ·{" "}
                    {c.pending ? "待更新" : "当前"}
                  </td>
                  <td>{sourceNames[c.source]}</td>
                  <td>
                    <details>
                      <summary>更多</summary>
                      <p>稳定有序身份：{c.identity}</p>
                      <p>生成依据：{c.generationId ?? "历史目录"}</p>
                      <p>
                        端点关系：{c.endACompatibilityId} /{" "}
                        {c.endBCompatibilityId}
                      </p>
                      <Link
                        to={`?${new URLSearchParams({ ...d.filters, detail: c.hoseSeries, page: String(d.page) })}`}
                      >
                        查看系列生成依据及完整审计
                      </Link>
                      {d.history
                        .filter(
                          (h) =>
                            h.hose_series === c.hoseSeries ||
                            h.payload_json.includes(
                              c.identity.replaceAll('"', '\\"'),
                            ),
                        )
                        .map((h) => (
                          <p key={h.id}>
                            {h.occurred_at} · {h.actor_id} · {h.kind}
                          </p>
                        ))}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.rows.length && <p>没有匹配的组合。</p>}
          <label>
            操作原因
            <input name="reason" required />
          </label>
          <button name="intent" value="disable" disabled={!d.canEdit}>
            停用选中组合
          </button>
          <button name="intent" value="enable" disabled={!d.canEdit}>
            启用选中组合
          </button>
        </Form>
        <nav aria-label="组合分页">
          {d.page > 1 && (
            <Link
              to={`?${new URLSearchParams({ ...d.filters, page: String(d.page - 1) })}`}
            >
              上一页
            </Link>
          )}
          <span>第 {d.page} 页，每页 50 条</span>
          {d.hasNext && (
            <Link
              to={`?${new URLSearchParams({ ...d.filters, page: String(d.page + 1) })}`}
            >
              下一页
            </Link>
          )}
        </nav>
        {d.detail && (
          <section>
            <h2>{d.detail}：生成依据及审计</h2>
            {d.history.map((h) => (
              <details key={h.id}>
                <summary>
                  {h.occurred_at} · {h.actor_id} · {h.kind}
                </summary>
                <pre>{JSON.stringify(JSON.parse(h.payload_json), null, 2)}</pre>
              </details>
            ))}
          </section>
        )}
        <section>
          <h2>三件套关系来源</h2>
          <p>
            工作表 04 保存单端三件套及压接参数，不是完整 A/B
            组合，也不代表生产验证。应用后需要更新受影响系列。
          </p>
          {d.sources.map((s) => (
            <details key={s.id}>
              <summary>
                {s.id} · {s.status}
              </summary>
              <pre>{JSON.stringify(JSON.parse(s.source_json), null, 2)}</pre>
              <p>{s.issues_json}</p>
              {s.status === "pending" && (
                <Form method="post">
                  <input type="hidden" name="sourceId" value={s.id} />
                  <input
                    type="hidden"
                    name="commandId"
                    value={`${d.commandId}:${s.id}`}
                  />
                  <label>
                    处理原因
                    <input name="reason" required />
                  </label>
                  {[
                    ["apply", "校验并应用"],
                    ["reject", "拒绝"],
                    ["delete", "删除请求"],
                  ].map(([intent, label]) => (
                    <button
                      key={intent}
                      name="intent"
                      value={intent}
                      disabled={!d.canEdit}
                    >
                      {label}
                    </button>
                  ))}
                </Form>
              )}
            </details>
          ))}
        </section>
      </main>
    </div>
  );
}
