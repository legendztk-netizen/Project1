import { data, Form, Link, redirect, useNavigation } from "react-router";
import { RefreshCw } from "lucide-react";
import type { Route } from "./+types/quote-inbound-email";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  dispatchInboundEmail,
  quoteInboundEmail,
} from "#workers/quote-inbound-email";
import { requireReviewMutation } from "../../quote-review/domain/private-review";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const query = new URL(request.url).searchParams;
  const selected = query.get("state");
  const state =
    selected === "dead_letter"
      ? "dead_letter"
      : selected === "all"
        ? undefined
        : "quarantined";
  const page = await (
    await quoteInboundEmail(env)
  ).listAdmin(adminIdentity, {
    state,
    cursor: query.get("cursor") ?? undefined,
  });
  return data({ page, state: state ?? "all" }, { headers: headers() });
}
export async function action({ context, request }: Route.ActionArgs) {
  const { env } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  await dispatchInboundEmail(env);
  return redirect("/admin/quote-inbound-email?state=all");
}
export default function InboundEmail({ loaderData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <h1>客户邮件接收</h1>
        <nav aria-label="邮件状态筛选">
          <Link to="?state=quarantined">隔离区</Link>
          {" · "}
          <Link to="?state=dead_letter">处理失败</Link>
          {" · "}
          <Link to="?state=all">全部记录</Link>
        </nav>
        <Form method="post">
          <button className="button button-secondary" disabled={busy}>
            <RefreshCw size={18} />
            处理待办邮件
          </button>
        </Form>
        {loaderData.page.rows.length ? (
          <div className="quote-conversation-messages">
            {loaderData.page.rows.map((row) => (
              <article className="quote-message" key={row.id}>
                <header>
                  <strong>{row.state}</strong>
                  <time>
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(row.created_at)}{" "}
                    北京时间
                  </time>
                </header>
                {row.reason ? <p>{row.reason}</p> : null}
                <p>
                  大小：{row.raw_size} bytes · 处理尝试：{row.attempts}
                </p>
                {row.request_id ? (
                  <Link to={`/admin/quotes/${row.request_id}/conversation`}>
                    查看会话
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p>暂无记录</p>
        )}
        {loaderData.page.nextCursor ? (
          <Link
            to={`?state=${loaderData.state}&cursor=${encodeURIComponent(loaderData.page.nextCursor)}`}
          >
            更早的记录
          </Link>
        ) : null}
      </main>
    </div>
  );
}
