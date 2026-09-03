import { AlertTriangle, FileText, Search } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/quote-reviews";
import {
  formatBeijingDateTime,
  parseAdminQuoteReviewFilters,
  type AdminTechnicalReviewState,
} from "../../quote-review/domain/admin-quote-review";
import { createD1AdminQuoteReviewRepository } from "../../quote-review/infrastructure/d1-admin-quote-review-repository";
import { AdminNavigation } from "../ui/admin-navigation";
import { AdminTechnicalTerm } from "../ui/admin-technical-term";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

export function meta() {
  return [{ title: "询价审核 | 管理后台" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  const filters = parseAdminQuoteReviewFilters(new URL(request.url));
  const reviews = await createD1AdminQuoteReviewRepository(env.DB).list(
    filters,
  );
  return { adminIdentity, environment: env.APP_ENV, filters, reviews };
}

const technicalLabels: Record<AdminTechnicalReviewState, string> = {
  not_flagged: "未标记",
  not_recorded: "快照未记录",
  required: "需要技术审核",
};

function money(value: number | null) {
  return value === null
    ? "快照未记录"
    : new Intl.NumberFormat("en-US", {
        currency: "USD",
        style: "currency",
      }).format(value);
}

export default function QuoteReviews({ loaderData }: Route.ComponentProps) {
  const requiredCount = loaderData.reviews.filter(
    ({ technicalReview }) => technicalReview.state === "required",
  ).length;
  const unknownCount = loaderData.reviews.filter(
    ({ technicalReview }) => technicalReview.state === "not_recorded",
  ).length;

  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main admin-quote-review-page">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">管理后台</span>
            <h1>
              <AdminTechnicalTerm explanation="客户提交的询价请求">
                RFQ
              </AdminTechnicalTerm>{" "}
              审核队列
            </h1>
            <p>只读取客户提交时的不可变快照，不使用当前目录补写历史数据。</p>
          </div>
          <span className="environment-badge">
            {loaderData.adminIdentity.accountType} · {loaderData.environment}
          </span>
        </header>

        <section className="admin-quote-metrics" aria-label="当前筛选结果">
          <article>
            <span>当前结果</span>
            <strong>{loaderData.reviews.length}</strong>
            <small>条询价请求</small>
          </article>
          <article>
            <span>需要技术审核</span>
            <strong>{requiredCount}</strong>
            <small>按提交快照标记</small>
          </article>
          <article>
            <span>技术状态未记录</span>
            <strong>{unknownCount}</strong>
            <small>不会推断为已审核</small>
          </article>
        </section>

        <section className="admin-quote-filters">
          <div>
            <Search aria-hidden="true" size={20} />
            <div>
              <h2>筛选与排序</h2>
              <p>技术审核优先排序只改变显示顺序，不修改客户请求快照。</p>
            </div>
          </div>
          <form method="get">
            <label>
              审核状态
              <select
                defaultValue={loaderData.filters.reviewState}
                name="review"
              >
                <option value="all">全部</option>
                <option value="awaiting_review">待审核</option>
              </select>
            </label>
            <label>
              技术标记
              <select
                defaultValue={loaderData.filters.technicalReview}
                name="technical"
              >
                <option value="all">全部</option>
                <option value="required">需要技术审核</option>
                <option value="not_flagged">未标记</option>
                <option value="not_recorded">快照未记录</option>
              </select>
            </label>
            <label>
              排序
              <select defaultValue={loaderData.filters.sort} name="sort">
                <option value="newest">最新提交优先</option>
                <option value="technical_first">技术审核优先</option>
              </select>
            </label>
            <button className="button button-primary" type="submit">
              应用
            </button>
          </form>
        </section>

        {loaderData.reviews.length === 0 ? (
          <section className="empty-state admin-quote-empty">
            <FileText aria-hidden="true" size={24} />
            <div>
              <strong>当前筛选条件下没有询价请求</strong>
              <p>更改筛选条件，或等待客户提交新的询价请求。</p>
            </div>
          </section>
        ) : (
          <section className="admin-quote-table-wrap" aria-label="RFQ 审核队列">
            <table className="admin-quote-table">
              <thead>
                <tr>
                  <th>
                    <AdminTechnicalTerm explanation="客户提交的询价请求">
                      RFQ
                    </AdminTechnicalTerm>
                  </th>
                  <th>客户 / 采购主体</th>
                  <th>目的地</th>
                  <th>商品</th>
                  <th>参考商品金额</th>
                  <th>技术标记</th>
                  <th>提交时间</th>
                  <th>
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loaderData.reviews.map((review) => (
                  <tr key={review.id}>
                    <td>
                      <strong>{review.referenceNumber}</strong>
                      <span>待审核</span>
                    </td>
                    <td>
                      <strong>
                        {review.customerDisplayName ?? "快照未记录"}
                      </strong>
                      <span>{review.customerEmail ?? "邮箱快照未记录"}</span>
                      <span>
                        {review.purchasingContextLabel ?? "采购主体快照未记录"}
                      </span>
                    </td>
                    <td>{review.destinationSummary ?? "快照未记录"}</td>
                    <td>{review.lineCount ?? "快照未记录"}</td>
                    <td>{money(review.merchandiseReferenceAmount)}</td>
                    <td>
                      <span
                        className={`admin-technical-state ${review.technicalReview.state}`}
                      >
                        {review.technicalReview.state === "required" ? (
                          <AlertTriangle aria-hidden="true" size={15} />
                        ) : null}
                        {technicalLabels[review.technicalReview.state]}
                      </span>
                    </td>
                    <td>{formatBeijingDateTime(review.submittedAt)}</td>
                    <td>
                      <Link
                        className="button button-secondary"
                        to={`/admin/quotes/${review.id}`}
                      >
                        查看快照
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
