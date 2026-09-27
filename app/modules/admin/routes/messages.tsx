import { data, Form, Link } from "react-router";
import { Search } from "lucide-react";
import type { Route } from "./+types/messages";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  adminThreadFilter,
  createMessageCenter,
} from "../../message-center/application/message-center-service";
import { MessageInbox } from "../../message-center/ui/message-center";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const filter = adminThreadFilter(url.searchParams.get("filter"));
  const query = url.searchParams.get("q") ?? "";
  const page = Number(url.searchParams.get("page") ?? 1);
  const center = createMessageCenter(env.DB, env.PRIVATE_FILES).admin(
    adminIdentity,
  );
  const [inbox, unread] = await Promise.all([
    center.threads({ filter, query, page }),
    center.unreadThreads(),
  ]);
  return data(
    {
      ...inbox,
      unread,
      filter,
      query,
      page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    },
    { headers: headers() },
  );
}

const filters = [
  { key: "all", label: "全部对话" },
  { key: "unread", label: "未读" },
  { key: "awaiting", label: "待回复" },
] as const;

export default function AdminMessages({ loaderData }: Route.ComponentProps) {
  const { threads, hasMore, unread, filter, query, page } = loaderData;
  const href = (next: { filter?: string; page?: number }) => {
    const params = new URLSearchParams();
    const nextFilter = next.filter ?? filter;
    if (nextFilter !== "all") params.set("filter", nextFilter);
    if (query) params.set("q", query);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const search = params.toString();
    return `/admin/messages${search ? `?${search}` : ""}`;
  };
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="messages" />
      <main className="admin-main message-center-page">
        <header>
          <h1>消息管理</h1>
          <p>
            与客户的全部对话：询价、订单、取消与售后沟通都在这里。每个询价 /
            订单一个对话，售后相关消息会标注案件号；内部备注客户不可见。
          </p>
        </header>
        <div className="message-center-toolbar">
          <nav className="message-center-filters" aria-label="对话筛选">
            {filters.map((item) => (
              <Link
                key={item.key}
                to={href({ filter: item.key })}
                aria-current={filter === item.key ? "page" : undefined}
              >
                {item.label}
                {item.key === "unread" && unread ? `（${unread}）` : ""}
              </Link>
            ))}
          </nav>
          <Form method="get" className="message-center-search" role="search">
            {filter !== "all" && (
              <input type="hidden" name="filter" value={filter} />
            )}
            <input
              name="q"
              type="search"
              defaultValue={query}
              placeholder="订单号、询价号或客户邮箱"
              aria-label="搜索对话"
            />
            <button className="button button-secondary" type="submit">
              <Search size={16} aria-hidden="true" />
              搜索
            </button>
          </Form>
        </div>
        <MessageInbox
          threads={threads}
          language="zh"
          threadHref={(requestId) =>
            `/admin/messages/${encodeURIComponent(requestId)}`
          }
          empty={
            filter === "unread"
              ? "没有未读对话。"
              : filter === "awaiting"
                ? "没有待回复的对话。"
                : "暂无对话。"
          }
        />
        <nav className="message-center-filters" aria-label="分页">
          {page > 1 && <Link to={href({ page: page - 1 })}>上一页</Link>}
          {hasMore && <Link to={href({ page: page + 1 })}>下一页</Link>}
        </nav>
      </main>
    </div>
  );
}
