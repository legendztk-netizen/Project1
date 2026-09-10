import { CatalogItemRejected } from "../../catalog/domain/catalog-item-publication";
import { Form, useLoaderData, useActionData, data } from "react-router";
import type { Route } from "./+types/catalog-cutover";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createD1CatalogCutover } from "../../catalog/infrastructure/d1-catalog-cutover";
import { AdminNavigation } from "../ui/admin-navigation";
const states: Record<string, string> = {
  inventoried: "已盘点",
  frozen: "已冻结",
  committing: "切换中",
  committed: "已完成",
  cancelled: "已取消",
};
function repository(context: Route.LoaderArgs["context"], request?: Request) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  return createD1CatalogCutover(
    env.DB,
    adminIdentity,
    request
      ? {
          requestId: crypto.randomUUID(),
          ipAddress: request.headers.get("cf-connecting-ip") ?? "local",
        }
      : undefined,
  );
}
export async function loader({ context }: Route.LoaderArgs) {
  return { runs: await repository(context).history(), id: crypto.randomUUID() };
}
export async function action({ context, request }: Route.ActionArgs) {
  const repo = repository(context, request),
    form = await request.formData(),
    id = String(form.get("id") ?? ""),
    intent = String(form.get("intent") ?? "");
  try {
    if (!["inventory", "freeze", "commit", "cancel"].includes(intent))
      throw new Error("未知迁移操作");
    const result =
      await repo[intent as "inventory" | "freeze" | "commit" | "cancel"](id);
    return data({
      message: `迁移状态：${states[result.status] ?? result.status}`,
    });
  } catch (error) {
    return data(
      { message: error instanceof Error ? error.message : "迁移失败" },
      { status: error instanceof CatalogItemRejected ? error.status : 409 },
    );
  }
}
export default function Cutover() {
  const d = useLoaderData<typeof loader>(),
    result = useActionData<typeof action>();
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="catalog" />
      <main className="catalog-request-page">
        <h1>目录条目切换</h1>
        <p>
          先盘点并核对报告，再冻结旧维护写入并执行切换。冻结前内容发生变化会要求重新盘点。已提交切换仅支持前向恢复。
        </p>
        {result && <p role="status">{result.message}</p>}
        <Form method="post">
          <input type="hidden" name="id" value={d.id} />
          <button name="intent" value="inventory">
            生成迁移盘点
          </button>
        </Form>
        {d.runs.map((r) => (
          <section key={r.id}>
            <h2>
              {r.id} · {states[r.status] ?? r.status}
            </h2>
            <p>
              基线产品：{JSON.parse(r.report_json).baselineProducts}
              ；待审核请求：{JSON.parse(r.report_json).requests}；待处理关系：
              {JSON.parse(r.report_json).relations}。
            </p>
            <details>
              <summary>展开完整盘点与校验依据</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(JSON.parse(r.report_json), null, 2)}
              </pre>
            </details>
            <Form method="post">
              <input type="hidden" name="id" value={r.id} />
              {r.status === "inventoried" && (
                <button name="intent" value="freeze">
                  冻结并核对版本
                </button>
              )}
              {r.status === "frozen" && (
                <button name="intent" value="commit">
                  执行已核对的切换
                </button>
              )}
              {["inventoried", "frozen"].includes(r.status) && (
                <button name="intent" value="cancel">
                  取消本次切换
                </button>
              )}
            </Form>
          </section>
        ))}
      </main>
    </div>
  );
}
