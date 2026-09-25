import { useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { CheckCheck } from "lucide-react";
import { piPrivateHeaders } from "#workers/proforma-invoice";
import { formatBeijingDateTime } from "../../quote-review/domain/admin-quote-review";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import {
  createD1AdminNotifications,
  type AdminNotification,
  type AdminNotificationFilter,
} from "../infrastructure/d1-admin-notifications";
import { AdminNavigation } from "../ui/admin-navigation";
import "../ui/confirmed-orders.css";
import "../ui/admin-notifications.css";

export const headers = piPrivateHeaders;

export function meta() {
  return [{ title: "通知 | 管理后台" }];
}

const BATCH_FORM_ID = "admin-notification-batch";

function listUrl(filter: AdminNotificationFilter, page: number) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/admin/notifications${query ? `?${query}` : ""}`;
}

function readListQuery(url: URL) {
  const filter: AdminNotificationFilter =
    url.searchParams.get("filter") === "unread" ? "unread" : "all";
  const page = Math.max(
    1,
    Math.floor(Number(url.searchParams.get("page"))) || 1,
  );
  return { filter, page };
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const { filter, page } = readListQuery(new URL(request.url));
  const result = await createD1AdminNotifications(env.DB).list(
    adminIdentity.id,
    { filter, page },
  );
  if (page > result.pageCount)
    throw redirect(listUrl(filter, result.pageCount), { headers: headers() });
  return data({ ...result, filter, page }, { headers: headers() });
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const service = createD1AdminNotifications(env.DB);
  const readAt = new Date().toISOString();
  const intent = form.get("intent");
  if (intent === "open") {
    const id = String(form.get("notificationId") ?? "");
    const notification = await service.find(adminIdentity.id, id);
    if (!notification)
      throw new Response("Notification not found", { status: 404 });
    await service.markRead(adminIdentity.id, [id], readAt);
    return redirect(notification.target, { headers: headers() });
  }
  if (intent === "mark-read") {
    const ids = form
      .getAll("notificationId")
      .filter((value): value is string => typeof value === "string" && !!value);
    if (!ids.length)
      return data(
        { error: "请先勾选要标为已读的消息。" },
        { status: 400, headers: headers() },
      );
    await service.markRead(adminIdentity.id, ids, readAt);
    const { filter, page } = readListQuery(new URL(request.url));
    return redirect(listUrl(filter, page), { headers: headers() });
  }
  throw new Response("Unknown notification action", { status: 400 });
}

function notificationTitle(notification: AdminNotification) {
  if (notification.kind === "rfq_submitted") return "新 RFQ 待审核";
  return notification.changeKind === "delivery_address"
    ? "客户提交了收货地址变更申请"
    : "客户提交了发货计划变更申请";
}

function notificationReference(notification: AdminNotification) {
  if (!notification.reference) return null;
  return notification.kind === "rfq_submitted"
    ? `RFQ ${notification.reference}`
    : `订单 ${notification.reference}`;
}

export default function AdminNotifications({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
}) {
  const { notifications, filter, page, pageCount, all, unread } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = notifications.filter((item) => !item.read);
  const selectedOnPage = selectable.filter((item) => selected.has(item.id));
  const allSelected =
    selectable.length > 0 && selectedOnPage.length === selectable.length;
  const busy = navigation.state !== "idle";

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="notifications" unreadNotifications={unread} />
      <main className="admin-main private-review-page admin-notifications-page">
        <header className="orders-page-heading">
          <h1>通知</h1>
          <p>
            客户提交的 RFQ
            和订单变更申请会在这里提醒。点击消息查看详情并自动标为已读。
          </p>
        </header>
        <nav className="orders-status-tabs" aria-label="通知筛选">
          {(
            [
              { id: "all", label: "全部", count: all },
              { id: "unread", label: "未读", count: unread },
            ] as const
          ).map((tab) => (
            <Link
              key={tab.id}
              to={listUrl(tab.id, 1)}
              aria-current={filter === tab.id ? "page" : undefined}
              className={filter === tab.id ? "active" : ""}
            >
              {tab.label} <span>{tab.count}</span>
            </Link>
          ))}
        </nav>
        <Form
          method="post"
          id={BATCH_FORM_ID}
          className="admin-notification-toolbar"
          onSubmit={() => setSelected(new Set())}
        >
          <input type="hidden" name="intent" value="mark-read" />
          <label className="admin-notification-check">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={!selectable.length}
              onChange={(event) =>
                setSelected(
                  event.currentTarget.checked
                    ? new Set(selectable.map((item) => item.id))
                    : new Set(),
                )
              }
            />
            <span>全选本页未读</span>
          </label>
          <button
            type="submit"
            className="button button-secondary"
            disabled={!selectedOnPage.length || busy}
          >
            <CheckCheck size={16} aria-hidden="true" />
            标为已读
            {selectedOnPage.length ? `（${selectedOnPage.length}）` : ""}
          </button>
          {actionData && "error" in actionData ? (
            <p role="alert" className="admin-notification-error">
              {actionData.error}
            </p>
          ) : null}
        </Form>
        {notifications.length ? (
          <ul className="admin-notification-list">
            {notifications.map((notification) => {
              const reference = notificationReference(notification);
              return (
                <li
                  key={notification.id}
                  className={notification.read ? "read" : "unread"}
                >
                  <label className="admin-notification-check">
                    <input
                      type="checkbox"
                      form={BATCH_FORM_ID}
                      name="notificationId"
                      value={notification.id}
                      checked={selected.has(notification.id)}
                      disabled={notification.read}
                      onChange={(event) =>
                        toggle(notification.id, event.currentTarget.checked)
                      }
                      aria-label={`选择：${notificationTitle(notification)}`}
                    />
                  </label>
                  <Form method="post" className="admin-notification-open">
                    <input type="hidden" name="intent" value="open" />
                    <input
                      type="hidden"
                      name="notificationId"
                      value={notification.id}
                    />
                    <button type="submit" disabled={busy}>
                      <span className="admin-notification-title">
                        {notification.read ? null : (
                          <span className="admin-notification-dot">未读</span>
                        )}
                        {notificationTitle(notification)}
                      </span>
                      <span className="admin-notification-meta">
                        {reference ? <span>{reference}</span> : null}
                        {notification.customerEmail ? (
                          <span>{notification.customerEmail}</span>
                        ) : null}
                        <time dateTime={notification.createdAt}>
                          {formatBeijingDateTime(notification.createdAt)}
                        </time>
                      </span>
                    </button>
                  </Form>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="admin-notification-empty">
            {filter === "unread" ? "没有未读通知。" : "暂无通知。"}
          </p>
        )}
        {pageCount > 1 ? (
          <nav className="admin-notification-pages" aria-label="通知分页">
            {page > 1 ? (
              <Link to={listUrl(filter, page - 1)}>上一页</Link>
            ) : (
              <span />
            )}
            <span>
              第 {page} / {pageCount} 页
            </span>
            {page < pageCount ? (
              <Link to={listUrl(filter, page + 1)}>下一页</Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </main>
    </div>
  );
}
