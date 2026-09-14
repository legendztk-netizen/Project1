import { data, Form, Link, redirect, useNavigation } from "react-router";
import { RefreshCw } from "lucide-react";
import type { Route } from "./+types/quote-notifications";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { quoteNotifications } from "#workers/quote-notifications";
import { requireReviewMutation } from "../../quote-review/domain/private-review";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const service = await quoteNotifications(env);
  const query = new URL(request.url).searchParams;
  const filter = query.get("filter") === "unresolved" ? "unresolved" : "all";
  return data(
    {
      page: await service.listAdmin(adminIdentity, {
        filter,
        before: query.get("before") ?? undefined,
      }),
      filter,
      local: env.APP_ENV === "local",
    },
    { headers: headers() },
  );
}
export async function action({ context, request }: Route.ActionArgs) {
  const { env } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  await (await quoteNotifications(env)).dispatch(env.ASYNC_JOBS);
  return redirect("/admin/quote-notifications");
}
export default function QuoteNotifications({
  loaderData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const states = {
    pending: "待发送",
    sending: "发送中",
    retry: "等待重试",
    sent: loaderData.local ? "已生成本地测试邮件" : "已发送",
    review: "需要人工核查",
    dead_letter: "发送失败",
  };
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <h1>会话邮件通知</h1>
        <Form method="post">
          <button
            className="button button-secondary"
            type="submit"
            disabled={busy}
          >
            <RefreshCw size={18} />
            处理待发送任务
          </button>
        </Form>
        <nav aria-label="通知筛选">
          <Link
            to="/admin/quote-notifications"
            aria-current={loaderData.filter === "all" ? "page" : undefined}
          >
            全部通知
          </Link>
          {" · "}
          <Link
            to="/admin/quote-notifications?filter=unresolved"
            aria-current={
              loaderData.filter === "unresolved" ? "page" : undefined
            }
          >
            待人工处理
          </Link>
        </nav>
        {loaderData.page.rows.length === 0 ? (
          <p>暂无通知任务</p>
        ) : (
          <div className="quote-conversation-messages">
            {loaderData.page.rows.map((row) => (
              <article
                key={row.id}
                className="quote-message quote-message-admin"
              >
                <header>
                  <Link to={`/admin/quotes/${row.request_id}/conversation`}>
                    查看客户会话
                  </Link>
                  <strong>{states[row.state]}</strong>
                </header>
                <p>
                  发送尝试：{row.attempts} · 队列尝试：{row.dispatch_attempts}
                </p>
                {row.failure_code ? (
                  <p role="status">{row.failure_code}</p>
                ) : null}
                {loaderData.local && row.has_local_capture ? (
                  <Link
                    to={`/admin/quote-notifications/${row.id}/capture`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看本地测试邮件
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {loaderData.page.nextCursor ? (
          <Link
            to={`/admin/quote-notifications?filter=${loaderData.filter}&before=${encodeURIComponent(loaderData.page.nextCursor)}`}
          >
            更早的通知
          </Link>
        ) : null}
      </main>
    </div>
  );
}
