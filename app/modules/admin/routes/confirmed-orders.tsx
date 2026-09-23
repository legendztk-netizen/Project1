import { Search } from "lucide-react";
import { data, Form, Link, type LoaderFunctionArgs } from "react-router";
import { confirmedOrders, piPrivateHeaders } from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";

export const headers = piPrivateHeaders;
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const orders = query
    ? await confirmedOrders(env).adminSearch(adminIdentity, query)
    : [];
  return data({ query, orders }, { headers: headers() });
}

export default function ConfirmedOrders({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
}) {
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="orders" />
      <main className="admin-main private-review-page">
        <h1>确认订单</h1>
        <Form method="get" className="commercial-settings-form">
          <label>
            订单编号、PI 编号或客户邮箱
            <input
              name="q"
              defaultValue={loaderData.query}
              required
              maxLength={150}
            />
          </label>
          <button className="button button-primary">
            <Search size={18} />
            查询
          </button>
        </Form>
        {loaderData.query && loaderData.orders.length === 0 && (
          <p>没有匹配的确认订单。</p>
        )}
        {loaderData.orders.map((order) => (
          <section className="admin-quote-section" key={order.id}>
            <h2>{order.orderNumber}</h2>
            <p>
              {order.snapshot.buyer.legalName} ·{" "}
              {formatPiDate(order.confirmedAt, "admin")}
            </p>
            <p>
              PI {order.snapshot.documentNumber} · USD{" "}
              {(order.totalCents / 100).toFixed(2)}
            </p>
            <Link
              className="button button-secondary"
              to={`/admin/orders/${encodeURIComponent(order.id)}`}
            >
              查看订单
            </Link>
          </section>
        ))}
      </main>
    </div>
  );
}
