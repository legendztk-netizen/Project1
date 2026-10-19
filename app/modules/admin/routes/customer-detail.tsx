import { ArrowLeft, Building2, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import {
  data,
  Link,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import type { Route } from "./+types/customer-detail";
import { customerDirectoryGrants } from "../domain/admin-module-access";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  accessLocation,
  beijingDate,
  signInMethodLabels,
} from "../ui/customer-directory-format";
import { formatAdminUsd, orderStageText } from "../ui/order-display";
import {
  createD1AdminCustomerDirectory,
  customerDetailListLimit,
} from "../../customer-identity/infrastructure/d1-admin-customer-directory";
import {
  adminQuoteReviewLabels,
  formatBeijingDateTime,
} from "../../quote-review/domain/admin-quote-review";
import "../ui/customer-directory.css";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export function meta() {
  return [{ title: "客户详情 | 管理后台" }];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const grants = customerDirectoryGrants(adminIdentity);
  const customer = await createD1AdminCustomerDirectory(env.DB).read(
    params.profileId,
    grants,
  );
  if (!customer) throw new Response("客户不存在", { status: 404 });
  return data({ customer }, { headers: headers() });
}

type Customer = Route.ComponentProps["loaderData"]["customer"];
type Order = NonNullable<Customer["currentOrders"]>[number];

function orderStatus(order: Order) {
  if (order.fullyCancelled) return "已全部取消";
  // Every unit was delivered or cancelled, even if a Shipment emptied by a
  // cancellation still shows as planned.
  if (order.settled)
    return order.partiallyCancelled ? "已送达 · 部分取消" : "已送达";
  const stage = orderStageText(order);
  return order.held ? `付款复核锁定 · ${stage}` : stage;
}

function ListLimitNote({ shown, total }: { shown: number; total: number }) {
  return total > shown ? (
    <p className="customer-detail-hint">
      共 {total} 条，仅显示最近 {customerDetailListLimit} 条。
    </p>
  ) : null;
}

function OrderTable({ orders, empty }: { orders: Order[]; empty: string }) {
  if (!orders.length) return <p className="customer-detail-empty">{empty}</p>;
  return (
    <div className="customer-directory-scroll">
      <table className="customer-directory-table customer-detail-table">
        <thead>
          <tr>
            <th scope="col">订单号</th>
            <th scope="col">询价编号</th>
            <th scope="col">金额</th>
            <th scope="col">状态</th>
            <th scope="col">确认时间</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td data-label="订单号">
                <Link to={`/admin/orders/${encodeURIComponent(order.id)}`}>
                  {order.orderNumber}
                </Link>
              </td>
              <td data-label="询价编号">{order.referenceNumber}</td>
              <td data-label="金额">{formatAdminUsd(order.totalCents)}</td>
              <td data-label="状态">
                {orderStatus(order)}
                {order.cancellationPending && <small>取消申请待处理</small>}
              </td>
              <td data-label="确认时间">
                {formatBeijingDateTime(order.confirmedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tabs = [
  { id: "profile", label: "资料" },
  { id: "access", label: "登录与 IP" },
  { id: "addresses", label: "地址簿" },
  { id: "quotes", label: "询价" },
  { id: "orders", label: "订单" },
] as const;
type Tab = (typeof tabs)[number]["id"];

// Switching tabs only changes `?tab=`; it needs no new data.
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  const withoutTab = (url: URL) => {
    const params = new URLSearchParams(url.search);
    params.delete("tab");
    return `${url.pathname}?${params}`;
  };
  if (!formMethod && withoutTab(currentUrl) === withoutTab(nextUrl))
    return false;
  return defaultShouldRevalidate;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function CustomerDetail({ loaderData }: Route.ComponentProps) {
  const { customer } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab =
    tabs.find((item) => item.id === searchParams.get("tab"))?.id ?? "profile";
  function selectTab(next: Tab) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === "profile") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { preventScrollReset: true },
    );
  }
  const company = customer.organizations.find(
    (organization) => organization.active,
  );
  const { stats } = customer;
  const counts: Partial<Record<Tab, number>> = {
    addresses: customer.addresses.length,
    quotes: stats.quoteCount ?? undefined,
    orders: stats.orderCount ?? undefined,
  };
  const registrationLocation = accessLocation(customer.registration.location);
  const lastSignInLocation = accessLocation(customer.lastSignIn.location);
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="customers" />
      <main className="admin-main customer-directory customer-detail">
        <Link className="customer-detail-back" to="/admin/customers">
          <ArrowLeft size={17} aria-hidden="true" /> 返回用户管理
        </Link>
        <header className="customer-detail-hero">
          <div className="customer-detail-identity">
            <span className="customer-detail-avatar" aria-hidden="true">
              {company ? <Building2 size={22} /> : <UserRound size={22} />}
            </span>
            <div>
              <h1>{customer.email}</h1>
              <p className="customer-detail-tags">
                {customer.fullName && <span>{customer.fullName}</span>}
                <span className="customer-detail-badge">
                  {company ? company.legalName : "个人"}
                </span>
                {customer.countryCode && (
                  <span className="customer-detail-badge">
                    {customer.countryCode}
                  </span>
                )}
              </p>
            </div>
          </div>
          <dl className="customer-detail-summary">
            <Fact label="注册时间">{beijingDate(customer.registeredAt)}</Fact>
            <Fact label="最后登录">
              {customer.lastSignIn.at
                ? beijingDate(customer.lastSignIn.at)
                : "—"}
            </Fact>
            {stats.quoteCount !== null && (
              <Fact label="询价">{stats.quoteCount}</Fact>
            )}
            {stats.currentOrderCount !== null && (
              <Fact label="当前订单">{stats.currentOrderCount}</Fact>
            )}
            {stats.confirmedCents !== null && (
              <Fact label="累计成交金额">
                {formatAdminUsd(stats.confirmedCents)}
              </Fact>
            )}
          </dl>
        </header>

        <nav
          aria-label="客户详情分区"
          className="customer-detail-tabs"
          role="tablist"
        >
          {tabs.map((item) => (
            <button
              aria-controls={`customer-panel-${item.id}`}
              aria-selected={tab === item.id}
              className={tab === item.id ? "active" : ""}
              id={`customer-tab-${item.id}`}
              key={item.id}
              onClick={() => selectTab(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
              {counts[item.id] !== undefined && <span>{counts[item.id]}</span>}
            </button>
          ))}
        </nav>

        <section
          aria-labelledby={`customer-tab-${tab}`}
          className="customer-detail-panel"
          id={`customer-panel-${tab}`}
          role="tabpanel"
        >
          {tab === "profile" && (
            <div className="customer-detail-columns">
              <div>
                <h2>基本信息</h2>
                <dl className="customer-detail-list">
                  <Fact label="邮箱">{customer.email}</Fact>
                  <Fact label="邮箱验证时间">
                    {formatBeijingDateTime(customer.emailVerifiedAt)}
                  </Fact>
                  <Fact label="姓名">{customer.fullName || "未填写"}</Fact>
                  <Fact label="电话">{customer.phoneNumber || "未填写"}</Fact>
                  <Fact label="注册时间">
                    {formatBeijingDateTime(customer.registeredAt)}
                  </Fact>
                  <Fact label="登录方式">
                    {customer.hasPassword ? "密码或邮箱验证码" : "仅邮箱验证码"}
                  </Fact>
                </dl>
              </div>
              <div>
                <h2>公司信息</h2>
                {customer.organizations.length ? (
                  customer.organizations.map((organization) => (
                    <dl className="customer-detail-list" key={organization.id}>
                      <Fact label="法定名称">
                        {organization.legalName}
                        {!organization.active && <small>（已停用）</small>}
                      </Fact>
                      <Fact label="商号">{organization.tradeName || "—"}</Fact>
                      <Fact label="国家">{organization.countryCode}</Fact>
                      <Fact label="注册号 / 税号">
                        {organization.registrationOrTaxId || "—"}
                      </Fact>
                      <Fact label="角色">
                        {organization.primaryContact ? "主联系人" : "成员"}
                      </Fact>
                    </dl>
                  ))
                ) : (
                  <p className="customer-detail-empty">
                    未填写公司信息，以个人身份购买。
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === "access" && (
            <>
              <p className="customer-detail-hint">
                只记录注册时和最后一次登录时的 IP。地点由 Cloudflare 按 IP
                估算，仅供参考。
              </p>
              <div className="customer-detail-columns">
                <div className="customer-detail-card">
                  <h2>注册</h2>
                  <dl className="customer-detail-list">
                    <Fact label="时间">
                      {formatBeijingDateTime(customer.registeredAt)}
                    </Fact>
                    <Fact label="IP">
                      {customer.registration.ip ?? "未记录（此功能上线前注册）"}
                    </Fact>
                    <Fact label="地点">{registrationLocation ?? "—"}</Fact>
                  </dl>
                </div>
                <div className="customer-detail-card">
                  <h2>最后登录</h2>
                  <dl className="customer-detail-list">
                    <Fact label="时间">
                      {customer.lastSignIn.at
                        ? formatBeijingDateTime(customer.lastSignIn.at)
                        : "未记录"}
                    </Fact>
                    <Fact label="方式">
                      {customer.lastSignIn.method
                        ? signInMethodLabels[customer.lastSignIn.method]
                        : "—"}
                    </Fact>
                    <Fact label="IP">
                      {customer.lastSignIn.ip ??
                        (customer.lastSignIn.at
                          ? "未记录（此功能上线前登录）"
                          : "—")}
                    </Fact>
                    <Fact label="地点">{lastSignInLocation ?? "—"}</Fact>
                  </dl>
                </div>
              </div>
            </>
          )}

          {tab === "addresses" &&
            (customer.addresses.length ? (
              <ul className="customer-detail-addresses">
                {customer.addresses.map((address) => (
                  <li key={address.id}>
                    <strong>
                      {address.label}
                      {address.selected && (
                        <span className="customer-detail-badge">默认地址</span>
                      )}
                    </strong>
                    <span>{address.recipientName}</span>
                    <span>{address.addressLine1}</span>
                    {address.addressLine2 && (
                      <span>{address.addressLine2}</span>
                    )}
                    <span>
                      {address.city}, {address.stateProvince}{" "}
                      {address.postalCode}, {address.countryCode}
                    </span>
                    <small>
                      {address.recipientPhone} · {address.recipientEmail}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="customer-detail-empty">还没有保存地址。</p>
            ))}

          {tab === "quotes" &&
            (customer.quotes === null ? (
              <p className="customer-detail-empty">
                需要「询价与 PI」权限才能查看此客户的询价。
              </p>
            ) : customer.quotes.length ? (
              <>
                <ListLimitNote
                  shown={customer.quotes.length}
                  total={stats.quoteCount ?? 0}
                />
                <div className="customer-directory-scroll">
                  <table className="customer-directory-table customer-detail-table">
                    <thead>
                      <tr>
                        <th scope="col">询价编号</th>
                        <th scope="col">购买身份</th>
                        <th scope="col">状态</th>
                        <th scope="col">提交时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer.quotes.map((quote) => (
                        <tr key={quote.id}>
                          <td data-label="询价编号">
                            <Link
                              to={`/admin/quotes/${encodeURIComponent(quote.id)}`}
                            >
                              {quote.referenceNumber}
                            </Link>
                          </td>
                          <td data-label="购买身份">
                            {quote.organization ? "公司" : "个人"}
                          </td>
                          <td data-label="状态">
                            {adminQuoteReviewLabels[quote.reviewState]}
                          </td>
                          <td data-label="提交时间">
                            {formatBeijingDateTime(quote.submittedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="customer-detail-empty">还没有提交询价。</p>
            ))}

          {tab === "orders" &&
            (customer.currentOrders === null ||
            customer.historicalOrders === null ? (
              <p className="customer-detail-empty">
                需要「订单与发货」权限才能查看此客户的订单。
              </p>
            ) : (
              <>
                <ListLimitNote
                  shown={
                    customer.currentOrders.length +
                    customer.historicalOrders.length
                  }
                  total={stats.orderCount ?? 0}
                />
                <h2>当前订单（{stats.currentOrderCount}）</h2>
                <OrderTable
                  empty="没有进行中的订单。"
                  orders={customer.currentOrders}
                />
                <h2 className="customer-detail-subheading">
                  历史订单（
                  {(stats.orderCount ?? 0) - (stats.currentOrderCount ?? 0)}）
                </h2>
                <p className="customer-detail-hint">
                  每件商品都已送达或已取消的订单。
                </p>
                <OrderTable
                  empty="还没有已完成的订单。"
                  orders={customer.historicalOrders}
                />
              </>
            ))}
        </section>
      </main>
    </div>
  );
}
