import { ArrowRight, Package, RotateCcw, Search } from "lucide-react";
import { data, Form, Link, type LoaderFunctionArgs } from "react-router";
import { confirmedOrders, piPrivateHeaders } from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import type { AdminOrderFilters } from "../../proforma-invoice/application/confirmed-order-service";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { hoseMediaPath } from "../../storefront/ui/catalog-media";
import "../ui/confirmed-orders.css";

export const headers = piPrivateHeaders;

const statusOptions = ["all", "confirmed", "hold"] as const;
const productOptions = ["all", "standard", "assembly", "hose"] as const;
const sortOptions = ["newest", "oldest", "amount_desc", "amount_asc"] as const;

function choice<T extends string>(
  value: string | null,
  options: readonly T[],
  fallback: T,
): T {
  return options.find((option) => option === value) ?? fallback;
}

function filtersFromUrl(url: URL): AdminOrderFilters {
  const params = url.searchParams;
  const date = (value: string | null) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  return {
    query: (params.get("q") ?? "").trim().slice(0, 150),
    status: choice(params.get("status"), statusOptions, "all"),
    from: date(params.get("from")),
    to: date(params.get("to")),
    country: (params.get("country") ?? "").trim().slice(0, 3),
    productType: choice(params.get("product"), productOptions, "all"),
    sort: choice(params.get("sort"), sortOptions, "newest"),
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const filters = filtersFromUrl(new URL(request.url));
  const result = await confirmedOrders(env).adminList(adminIdentity, filters);
  return data({ filters, ...result }, { headers: headers() });
}

const money = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;

export default function ConfirmedOrders({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
}) {
  const { filters, counts, countries, records, page, pageCount } = loaderData;
  const buildUrl = (changes: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    if (filters.query) params.set("q", filters.query);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.country) params.set("country", filters.country);
    if (filters.productType !== "all")
      params.set("product", filters.productType);
    if (filters.sort !== "newest") params.set("sort", filters.sort);
    if (filters.status !== "all") params.set("status", filters.status);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, String(value));
    }
    const query = params.toString();
    return `/admin/orders${query ? `?${query}` : ""}`;
  };
  const returnTo = buildUrl({ page });
  const statusTabs = [
    { id: "all", label: "全部订单", count: counts.all },
    { id: "confirmed", label: "正常订单", count: counts.confirmed },
    { id: "hold", label: "付款复核锁定", count: counts.hold },
  ] as const;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="orders" />
      <main className="admin-main private-review-page orders-workspace">
        <header className="orders-page-heading">
          <h1>订单</h1>
          <p>浏览已确认订单，按付款复核状态处理待办。</p>
          <Link className="button button-secondary" to="/admin/china-calendar">
            中国履约日历
          </Link>
        </header>
        <nav className="orders-status-tabs" aria-label="订单状态">
          {statusTabs.map((tab) => (
            <Link
              key={tab.id}
              to={buildUrl({
                status: tab.id === "all" ? null : tab.id,
                page: null,
              })}
              aria-current={filters.status === tab.id ? "page" : undefined}
              className={filters.status === tab.id ? "active" : ""}
            >
              {tab.label} <span>{tab.count}</span>
            </Link>
          ))}
        </nav>
        <Form method="get" className="orders-filters" role="search">
          {filters.status !== "all" && (
            <input type="hidden" name="status" value={filters.status} />
          )}
          <label className="orders-search">
            <span>订单、PI、RFQ 或客户</span>
            <span className="orders-search-input">
              <Search size={18} aria-hidden="true" />
              <input
                name="q"
                defaultValue={filters.query}
                maxLength={150}
                placeholder="输入编号、姓名、公司或邮箱"
              />
            </span>
          </label>
          <label>
            <span>确认日期（北京时间）起</span>
            <input type="date" name="from" defaultValue={filters.from} />
          </label>
          <label>
            <span>至</span>
            <input type="date" name="to" defaultValue={filters.to} />
          </label>
          <label>
            <span>目的地国家</span>
            <select name="country" defaultValue={filters.country}>
              <option value="">全部</option>
              {countries.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>商品类型</span>
            <select name="product" defaultValue={filters.productType}>
              <option value="all">全部</option>
              <option value="standard">标准件</option>
              <option value="assembly">胶管总成</option>
              <option value="hose">按长度销售胶管</option>
            </select>
          </label>
          <label>
            <span>排序</span>
            <select name="sort" defaultValue={filters.sort}>
              <option value="newest">最新确认优先</option>
              <option value="oldest">最早确认优先</option>
              <option value="amount_desc">金额从高到低</option>
              <option value="amount_asc">金额从低到高</option>
            </select>
          </label>
          <div className="orders-filter-actions">
            <button className="button button-primary" type="submit">
              应用筛选
            </button>
            <Link
              to={buildUrl({
                q: null,
                from: null,
                to: null,
                country: null,
                product: null,
                sort: null,
                page: null,
              })}
              className="button button-secondary"
            >
              <RotateCcw size={16} aria-hidden="true" /> 重置
            </Link>
          </div>
        </Form>
        <div className="orders-result-count" role="status">
          {records.length
            ? `共 ${statusTabs.find((tab) => tab.id === filters.status)?.count ?? 0} 条订单 · 第 ${page} / ${pageCount} 页`
            : "没有符合条件的订单。"}
        </div>
        {records.length > 0 && (
          <div className="orders-table-scroll">
            <table className="orders-table">
              <thead>
                <tr>
                  <th scope="col">订单 / PI</th>
                  <th scope="col">客户</th>
                  <th scope="col">商品</th>
                  <th scope="col">总金额</th>
                  <th scope="col">目的地</th>
                  <th scope="col">发货计划</th>
                  <th scope="col">状态</th>
                  <th scope="col">确认时间</th>
                  <th scope="col">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((order) => (
                  <tr key={order.id}>
                    <td data-label="订单 / PI">
                      <strong>
                        <Link
                          to={`/admin/orders/${encodeURIComponent(order.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                        >
                          {order.orderNumber}
                        </Link>
                      </strong>
                      <small>{order.documentNumber ?? order.piId}</small>
                      <small>{order.referenceNumber}</small>
                    </td>
                    <td data-label="客户">
                      <strong>{order.customerName}</strong>
                      {order.customerName !== order.customerEmail && (
                        <small>{order.customerEmail}</small>
                      )}
                    </td>
                    <td data-label="商品">
                      <div className="orders-product-summary">
                        <div className="orders-product-images">
                          {order.lines.map((line, index) => {
                            const src =
                              line.imageUrl ||
                              (line.hoseMediaKey
                                ? hoseMediaPath(line.hoseMediaKey)
                                : null);
                            return src ? (
                              <img
                                key={index}
                                src={src}
                                alt={line.displayName}
                              />
                            ) : (
                              <span key={index} aria-label="暂无商品图片">
                                <Package size={20} />
                              </span>
                            );
                          })}
                        </div>
                        <span>
                          {order.lines[0]?.displayName ?? "商品快照"}
                          {order.lineCount > 1
                            ? ` 等 ${order.lineCount} 项`
                            : ""}
                        </span>
                      </div>
                    </td>
                    <td data-label="总金额">
                      <strong>{money(order.totalCents)}</strong>
                    </td>
                    <td data-label="目的地">{order.countryCode ?? "未记录"}</td>
                    <td data-label="发货计划">
                      {order.shipmentPlanStatus === "review"
                        ? "待核对"
                        : order.shipmentPlanStatus === "ready"
                          ? `${order.shipmentCount} 个批次`
                          : "计划待核查"}
                    </td>
                    <td data-label="状态">
                      <span
                        className={`orders-status ${order.status === "Payment Review Hold" ? "hold" : "confirmed"}`}
                      >
                        {order.status === "Payment Review Hold"
                          ? "付款复核锁定"
                          : "订单确认"}
                      </span>
                    </td>
                    <td data-label="确认时间">
                      {formatPiDate(order.confirmedAt, "admin")}
                    </td>
                    <td data-label="操作">
                      <Link
                        aria-label={`查看订单 ${order.orderNumber}`}
                        to={`/admin/orders/${encodeURIComponent(order.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                        className="orders-row-link"
                      >
                        <ArrowRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <nav className="orders-pagination" aria-label="订单分页">
            {page > 1 ? (
              <Link to={buildUrl({ page: page - 1 })}>上一页</Link>
            ) : (
              <span>上一页</span>
            )}
            <span>
              {page} / {pageCount}
            </span>
            {page < pageCount ? (
              <Link to={buildUrl({ page: page + 1 })}>下一页</Link>
            ) : (
              <span>下一页</span>
            )}
          </nav>
        )}
      </main>
    </div>
  );
}
