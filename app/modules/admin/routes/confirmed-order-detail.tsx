import { ArrowLeft } from "lucide-react";
import {
  data,
  Form,
  Link,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  confirmedOrders,
  followOnQuotes,
  piPrivateHeaders,
  piRouteId,
} from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { ConfirmedOrderLine } from "../../proforma-invoice/ui/confirmed-order-line";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";

export const headers = piPrivateHeaders;
export async function loader({ context, params }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const order = await confirmedOrders(env).adminRead(
    adminIdentity,
    piRouteId(params.orderId),
  );
  const drafts = await followOnQuotes(env).adminListForOrder(
    adminIdentity,
    order.id,
  );
  return data(
    { order, drafts, commandId: crypto.randomUUID() },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const orderId = piRouteId(params.orderId);
  await confirmedOrders(env).adminRead(adminIdentity, orderId);
  const form = await readPrivateReviewForm(request);
  const commandId = String(form.get("commandId") ?? "");
  await followOnQuotes(env).adminCreate(adminIdentity, orderId, commandId);
  return redirect(`/admin/orders/${encodeURIComponent(orderId)}`);
}

export default function ConfirmedOrderDetail({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
}) {
  const { order, drafts, commandId } = loaderData;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="orders" />
      <main className="admin-main private-review-page">
        <Link to="/admin/orders">
          <ArrowLeft size={17} />
          返回订单查询
        </Link>
        <h1 className="confirmed-order-number">{order.orderNumber}</h1>
        <p>
          {order.status === "Payment Review Hold" ? "付款复核锁定" : "订单确认"}{" "}
          · {formatPiDate(order.confirmedAt, "admin")}
        </p>
        <p>
          客户：{order.snapshot.buyer.legalName} · PI：
          {order.snapshot.documentNumber}
        </p>
        <p>USD {(order.totalCents / 100).toFixed(2)}</p>
        <Link
          to={`/admin/quotes/${encodeURIComponent(order.requestId)}/pi/payments`}
        >
          查看付款记录
        </Link>
        <section className="admin-quote-section">
          <h2>追加采购询价</h2>
          <p>新草稿不修改原订单，也不会自动提交 RFQ。</p>
          <Form method="post">
            <input type="hidden" name="commandId" value={commandId} />
            <button className="button button-secondary">
              为客户创建 Follow-on 草稿
            </button>
          </Form>
          {drafts.map((draft) => (
            <p key={draft.id}>
              {draft.submittedRequestId ? (
                <Link
                  to={`/admin/quotes/${encodeURIComponent(draft.submittedRequestId)}`}
                >
                  已提交 RFQ
                </Link>
              ) : (
                `待客户选择商品 · ${draft.id}`
              )}
            </p>
          ))}
        </section>
        {order.snapshot.lines.map((line) => (
          <ConfirmedOrderLine key={line.id} line={line} locale="zh" />
        ))}
        <section className="admin-quote-section">
          <h2>交付信息</h2>
          <p>
            {order.snapshot.terms.incoterm} · {order.snapshot.terms.namedPlace}
          </p>
          <p>
            {order.snapshot.destination.recipientName} ·{" "}
            {order.snapshot.destination.addressLine1} ·{" "}
            {order.snapshot.destination.city}
          </p>
        </section>
      </main>
    </div>
  );
}
