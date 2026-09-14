import { Form, Link, data, redirect, useNavigation } from "react-router";
import { ArrowLeft, Save } from "lucide-react";
import type { Route } from "./+types/quote-pricing";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createQuotePreparation } from "../../quote-review/infrastructure/d1-quote-preparation";
import {
  parseUsdCents,
  parseDiscount,
  quoteLineTotals,
} from "../../quote-review/domain/quote-pricing";
import {
  requireReviewMutation,
  readPrivateReviewForm,
} from "../../quote-review/domain/private-review";
import { AdminNavigation } from "../ui/admin-navigation";

export function headers() {
  return { "Cache-Control": "private, no-store" };
}
export async function loader({ context, params }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const draft = await createQuotePreparation(env.DB, adminIdentity).find(
    params.requestId,
  );
  const costs = draft
    ? await Promise.all(
        draft.source.lines.map((line) =>
          env.DB.prepare(
            "SELECT c.currency,c.factory_unit_price,c.tier_qty,c.tier_price FROM catalog_cost_bases c JOIN catalog_releases r ON r.source_import_id=c.import_id WHERE r.id=? AND c.sales_sku=?",
          )
            .bind(line.catalogReleaseId, line.sku)
            .all<{
              currency: string;
              factory_unit_price: number | null;
              tier_qty: number | null;
              tier_price: number | null;
            }>(),
        ),
      )
    : [];
  return data(
    {
      draft,
      costs: costs.map((result) => result.results),
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}
export async function action({ context, params, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const service = createQuotePreparation(env.DB, adminIdentity);
  if (form.get("intent") === "start") await service.start(params.requestId);
  else if (form.get("intent") === "prices") {
    const draft = await service.find(params.requestId);
    if (!draft) throw new Response("Not found", { status: 404 });
    try {
      const prices = draft.source.lines.map((_, index) => ({
        unitPriceCents: parseUsdCents(String(form.get(`price-${index}`) ?? "")),
        discountBasisPoints: parseDiscount(
          String(form.get(`discount-${index}`) ?? "0"),
        ),
      }));
      await service.savePrices(
        params.requestId,
        Number(form.get("version")),
        prices,
        String(form.get("reason") ?? ""),
        String(form.get("commandId") ?? ""),
      );
    } catch (error) {
      if (error instanceof Response) throw error;
      return data(
        { error: error instanceof Error ? error.message : "Invalid prices" },
        { status: 400 },
      );
    }
  } else throw new Response("Invalid operation", { status: 400 });
  return redirect(`/admin/quotes/${params.requestId}/pricing`);
}
const money = (cents: number | null) =>
  cents === null ? "待填写" : `USD ${(cents / 100).toFixed(2)}`;
export default function QuotePricing({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const draft = loaderData.draft;
  const pending = useNavigation().state !== "idle";
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <Link
          className="admin-back-link"
          to={`/admin/quotes/${params.requestId}`}
        >
          <ArrowLeft size={17} />
          返回询价详情
        </Link>
        <h1>报价定价 · USD</h1>
        {draft ? (
          <Link to={`/admin/quotes/${params.requestId}/terms`}>
            商业与交付条款
          </Link>
        ) : null}
        {actionData?.error ? <p role="alert">{actionData.error}</p> : null}
        {!draft ? (
          <Form method="post">
            <input type="hidden" name="intent" value="start" />
            <button className="button button-primary" disabled={pending}>
              开始商业审核
            </button>
          </Form>
        ) : (
          <Form
            method="post"
            className="commercial-settings-form"
            key={draft.version}
          >
            <input type="hidden" name="intent" value="prices" />
            <input type="hidden" name="version" value={draft.version} />
            <input
              type="hidden"
              name="commandId"
              value={loaderData.commandId}
            />
            <p>
              草稿版本 {draft.version} · 原币参考仅供审核，最终报价由管理员填写
              USD。
            </p>
            {draft.source.lines.map((line, index) => {
              const price = draft.prices[index];
              const totals = quoteLineTotals(line, price);
              return (
                <section className="admin-quote-section" key={index}>
                  <h2>{line.sku}</h2>
                  <p>{line.displayName}</p>
                  <dl className="admin-snapshot-fields">
                    <div>
                      <dt>计价数量</dt>
                      <dd>
                        {totals.quantity}{" "}
                        {line.lineKind === "length_based_hose"
                          ? "ft"
                          : line.salesUnit}
                      </dd>
                    </div>
                    <div>
                      <dt>提交参考单价</dt>
                      <dd>
                        {line.currency} {line.referenceUnitPrice ?? "未记录"}
                      </dd>
                    </div>
                    <div>
                      <dt>未折扣金额</dt>
                      <dd>{money(totals.undiscountedCents)}</dd>
                    </div>
                    <div>
                      <dt>折扣金额</dt>
                      <dd>{money(totals.discountCents)}</dd>
                    </div>
                    <div>
                      <dt>行金额</dt>
                      <dd>{money(totals.totalCents)}</dd>
                    </div>
                  </dl>
                  <details>
                    <summary>旧目录成本参考（非当前产品修订版成本）</summary>
                    <small>旧目录版本：{line.catalogReleaseId}</small>
                    {loaderData.costs[index]?.length ? (
                      loaderData.costs[index].map((cost, n) => (
                        <p key={n}>
                          {cost.currency} {cost.factory_unit_price ?? "未记录"}
                          {cost.tier_qty
                            ? ` · 阶梯数量 ${cost.tier_qty} / 单价 ${cost.tier_price ?? "未记录"}`
                            : ""}
                        </p>
                      ))
                    ) : (
                      <p>该版本无成本记录</p>
                    )}
                  </details>
                  <label>
                    最终单价（USD /{" "}
                    {line.lineKind === "length_based_hose"
                      ? "ft"
                      : line.salesUnit}
                    ）
                    <input
                      name={`price-${index}`}
                      inputMode="decimal"
                      required
                      defaultValue={
                        price.unitPriceCents === null
                          ? ""
                          : (price.unitPriceCents / 100).toFixed(2)
                      }
                    />
                  </label>
                  <label>
                    人工数量折扣（%）
                    <input
                      name={`discount-${index}`}
                      inputMode="decimal"
                      required
                      defaultValue={(price.discountBasisPoints / 100).toFixed(
                        2,
                      )}
                    />
                  </label>
                </section>
              );
            })}
            <label>
              本次定价原因
              <textarea name="reason" required maxLength={2000} rows={2} />
            </label>
            <button className="button button-primary" disabled={pending}>
              <Save size={18} />
              保存定价
            </button>
          </Form>
        )}
      </main>
    </div>
  );
}
