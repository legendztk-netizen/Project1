import { data, Link, type LoaderFunctionArgs } from "react-router";

import { piPrivateHeaders } from "#workers/proforma-invoice";
import { createCancellationService } from "../../after-sales/application/cancellation-service";
import { createCaseService } from "../../after-sales/application/case-service";
import { adminCaseReasonLabel } from "../../after-sales/ui/admin-cases";
import { hasAfterSalesPermission } from "../../after-sales/domain/permissions";
import { cancellationStatusLabel } from "../../after-sales/ui/admin-cancellations";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import "../ui/confirmed-orders.css";
import "../../after-sales/ui/after-sales.css";

export const headers = piPrivateHeaders;

export function meta() {
  return [{ title: "取消与售后 | 管理后台" }];
}

const cancellationFilters = [
  { id: "pending_review", label: "待审核" },
  { id: "resolved", label: "已决定" },
  { id: "withdrawn", label: "已撤回" },
  { id: "all", label: "全部" },
] as const;
type CancellationFilter = (typeof cancellationFilters)[number]["id"];

function listUrl(status: string, page: number) {
  const params = new URLSearchParams();
  params.set("status", status);
  if (page > 1) params.set("page", String(page));
  return `/admin/after-sales?${params}`;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const requested = url.searchParams.get("status");
  const status: CancellationFilter = cancellationFilters.some(
    (item) => item.id === requested,
  )
    ? (requested as CancellationFilter)
    : "pending_review";
  const page = Math.max(
    1,
    Math.floor(Number(url.searchParams.get("page"))) || 1,
  );
  if (!hasAfterSalesPermission(adminIdentity, "after_sales.review"))
    return data(
      { allowed: false as const, status, page },
      { headers: piPrivateHeaders() },
    );
  const casePage = Math.max(
    1,
    Math.floor(Number(url.searchParams.get("casePage"))) || 1,
  );
  const caseStatus =
    url.searchParams.get("caseStatus") === "all" ? "all" : "open";
  const [cancellations, cases] = await Promise.all([
    createCancellationService(env.DB).adminList(adminIdentity, {
      status,
      page,
    }),
    createCaseService(env.DB).adminList(adminIdentity, {
      status: caseStatus,
      page: casePage,
    }),
  ]);
  return data(
    {
      allowed: true as const,
      status,
      page,
      cancellations,
      cases,
      caseStatus,
    },
    { headers: piPrivateHeaders() },
  );
}

export default function AdminAfterSales({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>["data"];
}) {
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="after-sales" />
      <main className="admin-main private-review-page orders-workspace">
        <header className="orders-page-heading">
          <h1>取消与售后</h1>
          <p>
            审核售后案件与发货前取消申请。每条记录均关联原订单、订单行、批次和实际数量；原
            PI 与订单保持不变。
          </p>
        </header>
        {!loaderData.allowed ? (
          <p role="alert">当前账号没有售后审核权限，请联系 Owner 授权。</p>
        ) : (
          <>
            <section aria-labelledby="after-sales-cases">
              <h2 id="after-sales-cases">售后案件</h2>
              <nav className="orders-status-tabs" aria-label="售后案件筛选">
                {(
                  [
                    ["open", "处理中"],
                    ["all", "全部"],
                  ] as const
                ).map(([id, label]) => (
                  <Link
                    key={id}
                    to={`/admin/after-sales?caseStatus=${id}`}
                    aria-current={
                      loaderData.caseStatus === id ? "page" : undefined
                    }
                    className={loaderData.caseStatus === id ? "active" : ""}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
              {loaderData.cases.records.length ? (
                <table className="after-sales-table">
                  <thead>
                    <tr>
                      <th>案件</th>
                      <th>订单</th>
                      <th>原因</th>
                      <th>最近客户回复</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaderData.cases.records.map((record) => (
                      <tr key={record.id}>
                        <td>
                          <Link
                            to={`/admin/orders/${encodeURIComponent(record.orderId)}?tab=after-sales`}
                          >
                            {record.caseNumber}
                          </Link>
                        </td>
                        <td>{record.orderNumber}</td>
                        <td>{adminCaseReasonLabel[record.reason]}</td>
                        <td>
                          {record.lastCustomerAt
                            ? formatPiDate(record.lastCustomerAt, "admin")
                            : "—"}
                        </td>
                        <td>{formatPiDate(record.updatedAt, "admin")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>没有符合条件的售后案件。</p>
              )}
              <nav className="after-sales-pagination" aria-label="案件分页">
                {loaderData.cases.page > 1 && (
                  <Link
                    to={`/admin/after-sales?caseStatus=${loaderData.caseStatus}&casePage=${loaderData.cases.page - 1}`}
                  >
                    上一页
                  </Link>
                )}
                <span>
                  第 {loaderData.cases.page} / {loaderData.cases.pageCount}{" "}
                  页，共 {loaderData.cases.total} 条
                </span>
                {loaderData.cases.page < loaderData.cases.pageCount && (
                  <Link
                    to={`/admin/after-sales?caseStatus=${loaderData.caseStatus}&casePage=${loaderData.cases.page + 1}`}
                  >
                    下一页
                  </Link>
                )}
              </nav>
            </section>
            <section aria-labelledby="after-sales-cancellations">
              <h2 id="after-sales-cancellations">取消申请</h2>
              <nav className="orders-status-tabs" aria-label="取消申请筛选">
                {cancellationFilters.map((filter) => (
                  <Link
                    key={filter.id}
                    to={listUrl(filter.id, 1)}
                    aria-current={
                      loaderData.status === filter.id ? "page" : undefined
                    }
                    className={loaderData.status === filter.id ? "active" : ""}
                  >
                    {filter.label}
                  </Link>
                ))}
              </nav>
              {loaderData.cancellations.records.length ? (
                <table className="after-sales-table">
                  <thead>
                    <tr>
                      <th>订单</th>
                      <th>类型</th>
                      <th>数量</th>
                      <th>状态</th>
                      <th>提交时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaderData.cancellations.records.map((record) => (
                      <tr key={record.id}>
                        <td>
                          <Link
                            to={`/admin/orders/${encodeURIComponent(record.orderId)}?tab=after-sales`}
                          >
                            {record.orderNumber}
                          </Link>
                        </td>
                        <td>
                          {record.kind === "standard"
                            ? "标准品取消"
                            : "特殊取消"}
                          {record.origin === "support" ? "（客服）" : ""}
                        </td>
                        <td>{record.physicalQuantity}</td>
                        <td>
                          {cancellationStatusLabel[record.status] ??
                            record.status}
                          {record.handoffConflict && (
                            <>
                              {" "}
                              <span className="after-sales-flag">交接冲突</span>
                            </>
                          )}
                        </td>
                        <td>{formatPiDate(record.createdAt, "admin")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>没有符合条件的取消申请。</p>
              )}
              <nav className="after-sales-pagination" aria-label="分页">
                {loaderData.cancellations.page > 1 && (
                  <Link
                    to={listUrl(
                      loaderData.status,
                      loaderData.cancellations.page - 1,
                    )}
                  >
                    上一页
                  </Link>
                )}
                <span>
                  第 {loaderData.cancellations.page} /{" "}
                  {loaderData.cancellations.pageCount} 页，共{" "}
                  {loaderData.cancellations.total} 条
                </span>
                {loaderData.cancellations.page <
                  loaderData.cancellations.pageCount && (
                  <Link
                    to={listUrl(
                      loaderData.status,
                      loaderData.cancellations.page + 1,
                    )}
                  >
                    下一页
                  </Link>
                )}
              </nav>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
