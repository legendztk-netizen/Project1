import { ArrowLeft, AlertTriangle, CheckCircle } from "lucide-react";
import { Form, Link, data, useNavigation } from "react-router";
import { useRef } from "react";
import {
  completeTechnicalReview,
  technicalReviewContext,
} from "../../quote-review/infrastructure/d1-technical-review";
import {
  requireReviewMutation,
  readPrivateReviewForm,
} from "../../quote-review/domain/private-review";

import type { Route } from "./+types/quote-review-detail";
import {
  formatBeijingDateTime,
  jsonArray,
  jsonObject,
  jsonPath,
  jsonString,
  adminTechnicalReviewLabels,
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
  const [technical, availability] = await Promise.all([
    technicalReviewContext(env.DB, params.requestId),
    env.DB.prepare(
      `SELECT
        EXISTS(SELECT 1 FROM quote_preparation_drafts WHERE request_id=?) AS hasDraft,
        EXISTS(SELECT 1 FROM proforma_invoice_heads WHERE request_id=?) AS hasCurrentPi`,
    )
      .bind(params.requestId, params.requestId)
      .first<{ hasDraft: number; hasCurrentPi: number }>(),
  ]);
  return data(
    {
      adminIdentity,
      environment: env.APP_ENV,
      review,
      technical,
      hasDraft: Boolean(availability?.hasDraft),
      hasCurrentPi: Boolean(availability?.hasCurrentPi),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  try {
    if (form.get("intent") !== "complete-technical-review")
      throw new Response("Invalid intent", { status: 400 });
    await completeTechnicalReview(
      env.DB,
      adminIdentity,
      params.requestId,
      String(form.get("fingerprint") ?? ""),
      String(form.get("conclusion") ?? ""),
    );
    return data({ error: null, saved: true });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      {
        error:
          error instanceof Error ? error.message : "审核保存失败，请重试。",
        saved: false,
      },
      { status: 400 },
    );
  }
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
  actionData,
}: Route.ComponentProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useNavigation().state !== "idle";
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
            <nav className="admin-quote-actions" aria-label="询价处理操作">
              <Form method="post" action={`/admin/quotes/${review.id}/pricing`}>
                <input type="hidden" name="intent" value="start" />
                <button
                  className="button button-primary"
                  disabled={pending}
                  type="submit"
                >
                  报价定价
                </button>
              </Form>
              {loaderData.hasDraft ? (
                <Link
                  className="button button-primary"
                  to={`/admin/quotes/${review.id}/terms`}
                >
                  商业与交付条款
                </Link>
              ) : (
                <span title="请先开始报价定价">
                  <button
                    className="button admin-quote-action-unavailable"
                    type="button"
                    disabled
                    aria-label="商业与交付条款：请先开始报价定价"
                  >
                    商业与交付条款
                  </button>
                </span>
              )}
              {loaderData.hasCurrentPi ? (
                <Link
                  className="button button-primary"
                  to={`/admin/quotes/${review.id}/pi/payments`}
                >
                  付款与到账
                </Link>
              ) : (
                <span title="请先签发 PI">
                  <button
                    className="button admin-quote-action-unavailable"
                    type="button"
                    disabled
                    aria-label="付款与到账：请先签发 PI"
                  >
                    付款与到账
                  </button>
                </span>
              )}
              <Link
                className="button button-secondary"
                to={`/admin/quotes/${review.id}/conversation`}
              >
                客户会话
              </Link>
              <Link
                className="button button-secondary"
                to={`/admin/quotes/${review.id}/pi`}
              >
                PI 签发与查看
              </Link>
              <Link
                className="button button-secondary"
                to={`/admin/quotes/${review.id}/private`}
              >
                内部备注与私有证明
              </Link>
            </nav>
            <p>提交于 {formatBeijingDateTime(review.submittedAt)}</p>
          </div>
          <span
            className={`admin-technical-state ${review.technicalReview.state}`}
          >
            {review.technicalReview.state === "required" ? (
              <AlertTriangle aria-hidden="true" size={15} />
            ) : null}
            {adminTechnicalReviewLabels[review.technicalReview.state]}
          </span>
        </header>

        <section className="admin-quote-section">
          <h2>当前配置技术审核</h2>
          {loaderData.technical.completion ? (
            <>
              <p className="admin-technical-state completed">
                <CheckCircle size={16} />
                技术审核已完成
              </p>
              <p>{loaderData.technical.completion.conclusion}</p>
              <p>
                审核人：{loaderData.technical.completion.actor} ·{" "}
                {formatBeijingDateTime(loaderData.technical.completion.at)} ·{" "}
                {loaderData.technical.completion.basis}
              </p>
            </>
          ) : review.technicalReview.state === "not_flagged" ? (
            <p>未触发技术审核</p>
          ) : (
            <button
              className="button button-primary"
              onClick={() => dialog.current?.showModal()}
            >
              <CheckCircle size={18} />
              完成技术审核
            </button>
          )}
        </section>
        <dialog
          ref={dialog}
          className="technical-review-dialog"
          aria-labelledby="technical-review-title"
        >
          <h2 id="technical-review-title">确认完成技术审核</h2>
          <p>审核配置版本：{loaderData.technical.basis}</p>
          <ul>
            {review.technicalReview.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {loaderData.technical.completion ? (
            <>
              <p role="status">技术审核已保存。</p>
              <button
                className="button button-secondary"
                onClick={() => dialog.current?.close()}
              >
                关闭
              </button>
            </>
          ) : (
            <>
              <details>
                <summary>查看本次审核的商品配置</summary>
                {jsonArray(
                  jsonPath(loaderData.technical.snapshot, "lines"),
                )?.map((line, index) => (
                  <div key={index}>
                    <AdminQuoteSnapshotLine index={index} line={line} />
                    {jsonArray(jsonPath(line, "quotedSpecificationOverrides"))
                      ?.length ? (
                      <>
                        <h3>本次报价修订规格</h3>
                        <dl className="admin-snapshot-fields">
                          {jsonArray(
                            jsonPath(line, "quotedSpecificationOverrides"),
                          )?.map((spec, i) => (
                            <SnapshotField
                              key={i}
                              label={text(jsonPath(spec, "label"))}
                              value={text(jsonPath(spec, "value"))}
                            />
                          ))}
                        </dl>
                      </>
                    ) : null}
                  </div>
                ))}
              </details>
              <Form method="post" className="commercial-settings-form">
                <input
                  type="hidden"
                  name="intent"
                  value="complete-technical-review"
                />
                <input
                  type="hidden"
                  name="fingerprint"
                  value={loaderData.technical.fingerprint}
                />
                <label>
                  审核结论
                  <textarea
                    name="conclusion"
                    required
                    maxLength={2000}
                    rows={4}
                  />
                </label>
                {actionData?.error ? (
                  <p role="alert">{actionData.error}</p>
                ) : null}
                <div className="admin-quote-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={pending}
                    onClick={() => dialog.current?.close()}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={pending}
                  >
                    <CheckCircle size={18} />
                    {pending ? "保存中…" : "确认完成技术审核"}
                  </button>
                </div>
              </Form>
            </>
          )}
        </dialog>

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
