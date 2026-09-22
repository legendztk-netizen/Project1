import { Form, Link, data, useNavigation } from "react-router";
import { ArrowLeft, Send } from "lucide-react";
import type { Route } from "./+types/quote-issue";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { createQuotePreparation } from "../../quote-review/infrastructure/d1-quote-preparation";
import { createQuoteRevisions } from "../../quote-review/infrastructure/d1-quote-revisions";
import { technicalReviewContext } from "../../quote-review/infrastructure/d1-technical-review";
import {
  customerRevisionProjection,
  requiresFactoryReview,
  validateQuoteIssuance,
} from "../../quote-review/domain/quote-revision";
import { CustomerQuoteOffer } from "../../quote-review/ui/customer-quote-offer";
import { formatBeijingDateTime } from "../../quote-review/domain/admin-quote-review";
import { quoteRevisionDifferences } from "../../quote-review/domain/quote-revision-differences";
import { QuoteRevisionChanges } from "../../quote-review/ui/quote-revision-changes";
import {
  requireReviewMutation,
  readPrivateReviewForm,
} from "../../quote-review/domain/private-review";

export function headers() {
  return { "Cache-Control": "private, no-store" };
}
export async function loader({ context, params }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const draft = await createQuotePreparation(env.DB, adminIdentity).find(
    params.requestId,
  );
  if (!draft)
    throw new Response("Preparation draft not found", { status: 404 });
  const current = await createQuoteRevisions(env.DB).current(params.requestId);
  let error: string | null = null;
  try {
    validateQuoteIssuance(draft, true);
  } catch (issue) {
    error = issue instanceof Error ? issue.message : "Incomplete quote";
  }
  return data(
    {
      draft,
      current,
      differences:
        current && draft.terms
          ? quoteRevisionDifferences(current.snapshot, {
              source: draft.source,
              prices: draft.prices,
              terms: draft.terms,
            })
          : [],
      requiresFactoryReview: requiresFactoryReview(draft.source),
      technicalCompletion: (
        await technicalReviewContext(env.DB, params.requestId)
      ).completion,
      error,
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}
export async function action({ request, context, params }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  try {
    await createQuoteRevisions(env.DB).issueRevision(adminIdentity, {
      requestId: params.requestId,
      preparationVersion: Number(form.get("version")),
      sourceHash: String(form.get("sourceHash") ?? ""),
      factoryReviewConfirmed: form.get("factoryReviewConfirmed") === "on",
      commandId: String(form.get("commandId") ?? ""),
      baseRevisionId: String(form.get("baseRevisionId") ?? "") || null,
      changeReason: String(form.get("changeReason") ?? ""),
    });
    return data({ error: null }, { headers: headers() });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { error: error instanceof Error ? error.message : "Invalid quote" },
      { status: 400, headers: headers() },
    );
  }
}
export default function IssueQuote({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const pending = useNavigation().state !== "idle";
  const { draft, current } = loaderData;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <Link to={`/admin/quotes/${params.requestId}/terms`}>
          <ArrowLeft size={17} />
          返回商业条款
        </Link>
        <h1>发布正式报价</h1>
        {current ? (
          <Link to={`/admin/quotes/${params.requestId}/revisions`}>
            报价修订与历史
          </Link>
        ) : null}
        {current && draft.baseRevisionId !== current.id ? (
          <>
            <p>
              报价版本 {current.snapshot.revisionNumber} 已发布 ·{" "}
              {formatBeijingDateTime(current.snapshot.issuedAt)}
            </p>
            <CustomerQuoteOffer
              adminSource={current.snapshot.source.lines}
              offer={customerRevisionProjection(current.snapshot)}
            />
          </>
        ) : (
          <>
            <p>审核草稿版本 {draft.version}</p>
            {current ? (
              <QuoteRevisionChanges changes={loaderData.differences} />
            ) : null}
            {(actionData?.error ?? loaderData.error) ? (
              <div role="alert">
                <h2>暂时无法发布报价</h2>
                {!draft.terms ? (
                  <p>
                    商业与交付条款尚未保存。请填写完整并点击“保存商业条款”，再返回此页发布。
                  </p>
                ) : null}
                {!draft.source.lines.length ? (
                  <p>报价缺少商品明细，请返回询价详情检查。</p>
                ) : null}
                {draft.prices.some((price) => price.unitPriceCents === null) ? (
                  <p>部分商品尚未填写最终单价，请完成并保存定价。</p>
                ) : null}
                {draft.terms && draft.source.lines.length ? (
                  <p>{actionData?.error ?? loaderData.error}</p>
                ) : null}
                <p>
                  <Link
                    className="button button-primary"
                    to={`/admin/quotes/${params.requestId}/terms`}
                  >
                    填写商业与交付条款
                  </Link>
                </p>
                <p>
                  <Link to={`/admin/quotes/${params.requestId}/pricing`}>
                    返回定价
                  </Link>
                  {" · "}
                  <Link to={`/admin/quotes/${params.requestId}`}>
                    返回询价详情
                  </Link>
                </p>
              </div>
            ) : null}
            {!loaderData.error && current && !loaderData.differences.length ? (
              <p role="status">当前草稿与已发布报价没有变化，无需重复发布。</p>
            ) : null}
            <Form method="post">
              <input
                type="hidden"
                name="baseRevisionId"
                value={draft.baseRevisionId ?? ""}
              />
              {current ? (
                <label>
                  本次修订原因
                  <textarea name="changeReason" required maxLength={2000} />
                </label>
              ) : null}
              <input type="hidden" name="version" value={draft.version} />
              <input type="hidden" name="sourceHash" value={draft.sourceHash} />
              <input
                type="hidden"
                name="commandId"
                value={loaderData.commandId}
              />
              {loaderData.technicalCompletion ? (
                <p className="admin-technical-state completed">
                  技术审核已完成，无需重复确认。
                </p>
              ) : loaderData.requiresFactoryReview ? (
                <label className="quote-confirmation">
                  <input
                    type="checkbox"
                    name="factoryReviewConfirmed"
                    required
                  />
                  已与工厂审核未决产品事项
                </label>
              ) : null}
              <button
                className="button button-primary"
                disabled={
                  pending ||
                  !!loaderData.error ||
                  (!!current && !loaderData.differences.length)
                }
              >
                <Send size={18} />
                发布报价版本 {(current?.snapshot.revisionNumber ?? 0) + 1}
              </button>
            </Form>
          </>
        )}
      </main>
    </div>
  );
}
