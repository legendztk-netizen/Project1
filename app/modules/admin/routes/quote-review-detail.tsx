import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/quote-review-detail";
import {
  formatBeijingDateTime,
  jsonArray,
  jsonObject,
  jsonPath,
  jsonString,
} from "../../quote-review/domain/admin-quote-review";
import { createD1AdminQuoteReviewRepository } from "../../quote-review/infrastructure/d1-admin-quote-review-repository";
import {
  AdminQuoteSnapshotLine,
  SnapshotField,
  SnapshotJson,
} from "../../quote-review/ui/admin-quote-snapshot";
import { AdminNavigation } from "../ui/admin-navigation";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

export function meta() {
  return [{ title: "询价详情 | 管理后台" }];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  const review = await createD1AdminQuoteReviewRepository(env.DB).find(
    params.requestId,
  );
  if (!review) throw new Response("Not found", { status: 404 });
  return { adminIdentity, environment: env.APP_ENV, review };
}

function text(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return "快照未记录";
}

function adminTimestamp(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? formatBeijingDateTime(value)
    : text(value);
}

function snapshotVersionLabel(snapshot: unknown) {
  const version = jsonPath(snapshot, "version");
  if (version === 2) return "版本 2 · 含产品参数快照";
  if (version === 1) return "版本 1 · 旧快照（未保存产品参数）";
  return text(version);
}

function address(snapshot: unknown) {
  const value = jsonObject(jsonPath(snapshot, "destination"));
  if (!value) return <p className="snapshot-warning">目的地资料快照未记录。</p>;
  return (
    <address className="admin-quote-address">
      <strong>{text(value.recipientName)}</strong>
      <span>{text(value.addressLine1)}</span>
      {jsonString(value.addressLine2) ? (
        <span>{jsonString(value.addressLine2)}</span>
      ) : null}
      <span>
        {[value.city, value.stateProvince, value.postalCode]
          .map(text)
          .join(", ")}
      </span>
      <span>{text(value.countryCode)}</span>
      <span>
        {text(value.recipientEmail)} · {text(value.recipientPhone)}
      </span>
      <small>地址标签：{text(value.label)}</small>
    </address>
  );
}

export default function QuoteReviewDetail({
  loaderData,
}: Route.ComponentProps) {
  const review = loaderData.review;
  const snapshot = review.snapshot;
  const actor = jsonObject(jsonPath(snapshot, "actor"));
  const context = jsonObject(jsonPath(snapshot, "purchasingContext"));
  const amounts = jsonObject(jsonPath(snapshot, "amounts"));
  const importResponsibility = jsonObject(
    jsonPath(snapshot, "importResponsibility"),
  );
  const lines = jsonArray(jsonPath(snapshot, "lines"));

  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main admin-quote-detail-page">
        <Link className="admin-back-link" to="/admin/quotes">
          <ArrowLeft aria-hidden="true" size={17} /> 返回询价审核队列
        </Link>
        <header className="admin-quote-detail-header">
          <div>
            <span className="eyebrow">不可变客户请求快照</span>
            <h1>{review.referenceNumber}</h1>
            <p>提交于 {formatBeijingDateTime(review.submittedAt)}</p>
          </div>
          <span
            className={`admin-technical-state ${review.technicalReview.state}`}
          >
            {review.technicalReview.state === "required" ? (
              <AlertTriangle aria-hidden="true" size={15} />
            ) : null}
            {review.technicalReview.state === "required"
              ? "需要技术审核"
              : review.technicalReview.state === "not_flagged"
                ? "未标记技术问题"
                : "技术状态快照未记录"}
          </span>
        </header>

        <div className="admin-quote-summary-grid">
          <section className="admin-quote-section">
            <span className="eyebrow">客户资料</span>
            <h2>客户与采购主体</h2>
            <dl className="admin-snapshot-fields">
              <SnapshotField label="客户姓名" value={text(actor?.fullName)} />
              <SnapshotField label="验证邮箱" value={text(actor?.email)} />
              <SnapshotField
                label="联系电话"
                value={text(actor?.phoneNumber)}
              />
              <SnapshotField
                label="身份验证时间"
                value={adminTimestamp(actor?.verifiedAt)}
              />
              <SnapshotField label="采购类型" value={text(context?.kind)} />
              <SnapshotField
                label="采购主体"
                value={text(
                  context?.legalName ?? review.purchasingContextLabel,
                )}
              />
              <SnapshotField label="采购主体 ID" value={text(context?.id)} />
            </dl>
          </section>

          <section className="admin-quote-section">
            <span className="eyebrow">目的地资料</span>
            <h2>提交目的地</h2>
            {address(snapshot)}
          </section>

          <section className="admin-quote-section">
            <span className="eyebrow">请求条款</span>
            <h2>请求金额与责任</h2>
            <dl className="admin-snapshot-fields">
              <SnapshotField label="币种" value={text(amounts?.currency)} />
              <SnapshotField
                label="参考商品金额"
                value={text(amounts?.merchandiseSubtotal)}
              />
              <SnapshotField
                label="服务费"
                value={text(amounts?.serviceFeeTotal)}
              />
              <SnapshotField
                label="贸易责任"
                value={text(importResponsibility?.fulfillmentTerm)}
              />
              <SnapshotField
                label="责任规则版本"
                value={text(importResponsibility?.version)}
              />
              <SnapshotField
                label="询价快照版本"
                value={snapshotVersionLabel(snapshot)}
              />
            </dl>
          </section>

          <section className="admin-quote-section">
            <span className="eyebrow">客户确认</span>
            <h2>客户提交确认</h2>
          </section>
        </div>

        {review.technicalReview.reasons.length > 0 ? (
          <section className="admin-quote-section admin-technical-reasons">
            <h2>技术审核原因</h2>
            <ul>
              {review.technicalReview.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="admin-quote-lines-section">
          <header>
            <div>
              <span className="eyebrow">客户提交内容</span>
              <h2>提交商品快照</h2>
            </div>
            <span>{lines ? `${lines.length} 行` : "商品行快照未记录"}</span>
          </header>
          {lines ? (
            <div className="admin-quote-lines">
              {lines.map((line, index) => (
                <AdminQuoteSnapshotLine index={index} key={index} line={line} />
              ))}
            </div>
          ) : (
            <p className="snapshot-warning">
              该历史 RFQ 没有可识别的商品行快照。
            </p>
          )}
        </section>

        <section className="admin-quote-section admin-readonly-boundary">
          <h2>只读边界</h2>
          <p>
            本页面不读取当前产品目录补齐字段，也不提供修改客户请求的操作。后续报价会创建独立的报价修订版。
          </p>
          <SnapshotJson value={snapshot} />
        </section>
      </main>
    </div>
  );
}
