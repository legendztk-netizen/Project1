import { ArrowDown, ArrowUp, RotateCcw, Search } from "lucide-react";
import type { CSSProperties } from "react";
import { data, Form, Link } from "react-router";
import type { Route } from "./+types/customers";
import { customerDirectoryGrants } from "../domain/admin-module-access";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { beijingDate } from "../ui/customer-directory-format";
import { formatAdminUsd } from "../ui/order-display";
import {
  ColumnResizer,
  useResizableColumns,
  type ResizableColumn,
} from "../ui/resizable-columns";
import {
  customerDirectoryDefaults,
  customerDirectoryFilters,
  customerDirectoryIsFiltered,
  customerDirectorySearch,
} from "../../customer-identity/domain/customer-directory";
import { createD1AdminCustomerDirectory } from "../../customer-identity/infrastructure/d1-admin-customer-directory";
import { formatBeijingDateTime } from "../../quote-review/domain/admin-quote-review";
import "../ui/customer-directory.css";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export function meta() {
  return [{ title: "用户管理 | 管理后台" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const grants = customerDirectoryGrants(adminIdentity);
  const requested = customerDirectoryFilters(new URL(request.url).searchParams);
  const filters = grants.orders
    ? requested
    : { ...requested, orders: "all" as const };
  const directory = await createD1AdminCustomerDirectory(env.DB).list(
    filters,
    grants,
  );
  return data(
    { ...directory, filters: { ...filters, page: directory.page }, grants },
    { headers: headers() },
  );
}

const basePath = "/admin/customers";

export default function Customers({ loaderData }: Route.ComponentProps) {
  const { countries, filters, grants, page, pageCount, records, total } =
    loaderData;
  const url = (changes: Parameters<typeof customerDirectorySearch>[1]) =>
    `${basePath}${customerDirectorySearch(filters, changes)}`;
  const filtered = customerDirectoryIsFiltered(filters);
  const ascending = filters.sort === "registered_asc";
  const columns: ResizableColumn[] = [
    { id: "email", label: "邮箱", width: 230, min: 140 },
    { id: "name", label: "姓名", width: 100, min: 72 },
    { id: "type", label: "类型", width: 130, min: 72 },
    { id: "country", label: "国家", width: 60, min: 56 },
    { id: "registered", label: "注册日期", width: 112, min: 100 },
    { id: "lastSignIn", label: "最后登录", width: 128, min: 96 },
    ...(grants.quotes
      ? [{ id: "quotes", label: "询价数", width: 70, min: 64 }]
      : []),
    ...(grants.orders
      ? [{ id: "amount", label: "累计成交金额", width: 110, min: 110 }]
      : []),
  ];
  const columnWidths = useResizableColumns(
    "admin-customer-directory-columns",
    columns,
  );
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="customers" />
      <main className="admin-main customer-directory">
        <header className="customer-directory-heading">
          <h1>用户管理</h1>
          <p>
            已注册的客户。点击邮箱查看资料、地址、注册与最后登录
            IP、询价和订单。
          </p>
        </header>
        <Form
          className="customer-directory-filters"
          key={customerDirectorySearch(filters)}
          method="get"
          role="search"
        >
          {filters.sort !== "registered_desc" && (
            <input name="sort" type="hidden" value={filters.sort} />
          )}
          <label className="customer-directory-search">
            <span>搜索客户</span>
            <span className="customer-directory-search-input">
              <Search size={18} aria-hidden="true" />
              <input
                defaultValue={filters.query}
                maxLength={150}
                name="q"
                placeholder="邮箱、姓名、电话或公司名"
                type="search"
              />
            </span>
          </label>
          <label>
            <span>注册日期（北京时间）起</span>
            <input defaultValue={filters.from} name="from" type="date" />
          </label>
          <label>
            <span>至</span>
            <input defaultValue={filters.to} name="to" type="date" />
          </label>
          <label>
            <span>类型</span>
            <select defaultValue={filters.type} name="type">
              <option value="all">全部</option>
              <option value="individual">个人</option>
              <option value="organization">公司</option>
            </select>
          </label>
          <label>
            <span>国家</span>
            <select defaultValue={filters.country} name="country">
              <option value="">全部</option>
              {countries.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </label>
          {grants.orders && (
            <label>
              <span>订单</span>
              <select defaultValue={filters.orders} name="orders">
                <option value="all">全部</option>
                <option value="with">有订单</option>
                <option value="without">无订单</option>
              </select>
            </label>
          )}
          <div className="customer-directory-filter-actions">
            <button className="button button-primary" type="submit">
              应用筛选
            </button>
            {filtered && (
              <Link
                className="button button-secondary"
                // Reset keeps the chosen sort order.
                to={`${basePath}${customerDirectorySearch({
                  ...customerDirectoryDefaults,
                  sort: filters.sort,
                })}`}
              >
                <RotateCcw size={16} aria-hidden="true" /> 重置
              </Link>
            )}
          </div>
        </Form>
        <div className="customer-directory-count" role="status">
          {records.length
            ? `${filtered ? "筛选结果" : "共"} ${total} 位客户 · 第 ${page} / ${pageCount} 页`
            : filtered
              ? "没有符合条件的客户。"
              : "还没有注册客户。"}
        </div>
        {records.length > 0 && (
          <div className="customer-directory-scroll">
            <table
              className="customer-directory-table customer-directory-table-resizable"
              style={
                {
                  "--customer-table-width": `${columnWidths.tableWidth}px`,
                } as CSSProperties
              }
            >
              <colgroup>
                {columns.map((column, index) => (
                  <col
                    key={column.id}
                    style={
                      // The last column takes the remaining width.
                      index < columns.length - 1
                        ? { width: columnWidths.width(column) }
                        : undefined
                    }
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((column, index) => (
                    <th
                      aria-sort={
                        column.id === "registered"
                          ? ascending
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      key={column.id}
                      scope="col"
                    >
                      {column.id === "registered" ? (
                        <Link
                          className="customer-directory-sort"
                          preventScrollReset
                          title={
                            ascending ? "改为最新注册在前" : "改为最早注册在前"
                          }
                          to={url({
                            sort: ascending
                              ? "registered_desc"
                              : "registered_asc",
                            page: 1,
                          })}
                        >
                          {column.label}
                          {ascending ? (
                            <ArrowUp aria-hidden="true" size={14} />
                          ) : (
                            <ArrowDown aria-hidden="true" size={14} />
                          )}
                        </Link>
                      ) : (
                        column.label
                      )}
                      {index < columns.length - 1 && (
                        <ColumnResizer
                          column={column}
                          onReset={() => columnWidths.reset(column)}
                          onResize={(value, persist) =>
                            columnWidths.resize(column, value, persist)
                          }
                          width={columnWidths.width(column)}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((customer) => (
                  <tr key={customer.id}>
                    <td
                      className="customer-directory-wrap customer-directory-email"
                      data-label="邮箱"
                    >
                      <Link
                        to={`${basePath}/${encodeURIComponent(customer.id)}`}
                      >
                        {customer.email}
                      </Link>
                    </td>
                    <td className="customer-directory-wrap" data-label="姓名">
                      {customer.fullName || "—"}
                    </td>
                    <td className="customer-directory-wrap" data-label="类型">
                      {customer.organizationName ? (
                        <>
                          <strong>{customer.organizationName}</strong>
                          {customer.organizationCount > 1 && (
                            <small>
                              等 {customer.organizationCount} 家公司
                            </small>
                          )}
                        </>
                      ) : (
                        "个人"
                      )}
                    </td>
                    <td data-label="国家">{customer.countryCode ?? "—"}</td>
                    <td data-label="注册日期">
                      {beijingDate(customer.registeredAt)}
                    </td>
                    <td data-label="最后登录">
                      {customer.lastSignInAt ? (
                        <>
                          {beijingDate(customer.lastSignInAt)}
                          <small>
                            {formatBeijingDateTime(customer.lastSignInAt)
                              .split(" ")
                              .slice(1)
                              .join(" ")}
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    {grants.quotes && (
                      <td data-label="询价数">{customer.quoteCount}</td>
                    )}
                    {grants.orders && (
                      <td data-label="累计成交金额">
                        {formatAdminUsd(customer.confirmedCents ?? 0)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {records.length > 0 && grants.orders && (
          <p className="customer-directory-note">
            累计成交金额：已确认订单的金额合计，不含全部取消的订单；部分取消和退款未扣除。
          </p>
        )}
        {pageCount > 1 && (
          <nav className="customer-directory-pagination" aria-label="客户分页">
            {page > 1 ? (
              <Link to={url({ page: page - 1 })}>上一页</Link>
            ) : (
              <span>上一页</span>
            )}
            <span>
              {page} / {pageCount}
            </span>
            {page < pageCount ? (
              <Link to={url({ page: page + 1 })}>下一页</Link>
            ) : (
              <span>下一页</span>
            )}
          </nav>
        )}
      </main>
    </div>
  );
}
