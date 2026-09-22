import { Form, Link, data, redirect, useNavigation } from "react-router";
import { ArrowLeft, FilePlus2, Save } from "lucide-react";
import type { Route } from "./+types/quote-revisions";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { createQuoteRevisions } from "../../quote-review/infrastructure/d1-quote-revisions";
import { createQuotePreparation } from "../../quote-review/infrastructure/d1-quote-preparation";
import { saveQuoteLineRevisions } from "../../quote-review/infrastructure/d1-quote-line-revisions";
import { quoteRevisionDifferences } from "../../quote-review/domain/quote-revision-differences";
import { QuoteRevisionChanges } from "../../quote-review/ui/quote-revision-changes";
import { CustomerQuoteOffer } from "../../quote-review/ui/customer-quote-offer";
import { customerRevisionProjection } from "../../quote-review/domain/quote-revision";
import type {
  QuoteLineEdit,
  ReviewedQuoteLine,
} from "../../quote-review/domain/quote-line-revision";
import { quotedSpecificationLabels } from "../../quote-review/domain/quote-line-revision";
import {
  requireReviewMutation,
  readPrivateReviewForm,
} from "../../quote-review/domain/private-review";
import { formatBeijingDateTime } from "../../quote-review/domain/admin-quote-review";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";
import { assemblyAmendmentFields } from "../../quote-review/infrastructure/prepare-quote-assembly-amendment";

export function headers() {
  return { "Cache-Control": "private, no-store" };
}
export async function loader({ context, params }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const repository = createQuoteRevisions(env.DB);
  const history = await repository.history(params.requestId);
  const draft = await createQuotePreparation(env.DB, adminIdentity).find(
    params.requestId,
  );
  if (!draft || !history.length)
    throw redirect(`/admin/quotes/${params.requestId}/issue`);
  const current = history[0];
  const changes = draft.terms
    ? quoteRevisionDifferences(current.snapshot, {
        source: draft.source,
        prices: draft.prices,
        terms: draft.terms,
      })
    : [];
  return data(
    {
      history,
      draft,
      current,
      changes,
      commandId: crypto.randomUUID(),
      newLineId: crypto.randomUUID(),
      assemblyFields: Object.fromEntries(
        draft.source.lines.map((line) => [
          line.id,
          assemblyAmendmentFields(line),
        ]),
      ),
      protections:
        (
          await createD1ConfiguratorReferenceRepository(
            env.DB,
          ).findActiveSnapshot()
        )?.installedProtections
          .filter((p) => p.availability === "available")
          .map((p) => ({ code: p.code, name: p.publicName })) ?? [],
    },
    { headers: headers() },
  );
}
export async function action({ request, context, params }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const text = (key: string) => String(form.get(key) ?? "");
  try {
    if (text("intent") === "start") {
      await createQuoteRevisions(env.DB).startNext(
        adminIdentity,
        params.requestId,
        text("baseRevisionId"),
        Number(text("version")),
      );
    } else if (text("intent") === "products") {
      const edits: QuoteLineEdit[] = form
        .getAll("lineId")
        .map(String)
        .filter((id) => form.get(`include:${id}`) === "on")
        .map((id) => ({
          id,
          sku: text(`sku:${id}`),
          quantity: Number(text(`quantity:${id}`)),
          lengthValue: text(`length:${id}`),
          lengthUnit: text(`unit:${id}`) as QuoteLineEdit["lengthUnit"],
          ...(form.has(`endASku:${id}`)
            ? {
                assembly: {
                  confirmCurrentComponentRefresh:
                    form.get(`refreshComponents:${id}`) === "on",
                  endASku: text(`endASku:${id}`),
                  endAFerruleSku: text(`endAFerruleSku:${id}`),
                  endBSku: text(`endBSku:${id}`),
                  endBFerruleSku: text(`endBFerruleSku:${id}`),
                  measurement: text(`measurement:${id}`),
                  clocking: text(`clocking:${id}`),
                  protectionCode: text(`protectionCode:${id}`),
                },
              }
            : {}),
          specifications: form
            .getAll(`specIndex:${id}`)
            .map(String)
            .map((index) => ({
              label: text(`specLabel:${id}:${index}`),
              value: text(`specValue:${id}:${index}`),
            }))
            .filter((spec) => spec.label || spec.value),
        }));
      if (text("newSku").trim())
        edits.push({
          id: text("newLineId"),
          sku: text("newSku"),
          quantity: Number(text("newQuantity")),
          lengthValue: text("newLength"),
          lengthUnit: "ft",
          specifications: [],
        });
      await saveQuoteLineRevisions(env.DB, adminIdentity, {
        requestId: params.requestId,
        version: Number(text("version")),
        edits,
        reason: text("reason"),
        commandId: text("commandId"),
      });
    } else throw new Response("Unknown action", { status: 400 });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { error: error instanceof Error ? error.message : "Invalid revision" },
      { status: 400, headers: headers() },
    );
  }
  return redirect(`/admin/quotes/${params.requestId}/revisions`);
}
export default function QuoteRevisions({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { draft, current, history } = loaderData;
  const active = draft.baseRevisionId === current.id;
  const pending = useNavigation().state !== "idle";
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <Link to={`/admin/quotes/${params.requestId}`}>
          <ArrowLeft size={17} />
          返回询价
        </Link>
        <h1>报价修订与历史</h1>
        {actionData?.error ? <p role="alert">{actionData.error}</p> : null}
        {!active ? (
          <Form method="post">
            <input type="hidden" name="intent" value="start" />
            <input type="hidden" name="version" value={draft.version} />
            <input type="hidden" name="baseRevisionId" value={current.id} />
            <button className="button button-primary" disabled={pending}>
              <FilePlus2 size={18} />
              基于版本 {current.snapshot.revisionNumber} 新建修订
            </button>
          </Form>
        ) : (
          <>
            <nav className="quote-revision-links">
              <Link to={`/admin/quotes/${params.requestId}/pricing`}>
                修改价格与折扣
              </Link>
              <Link to={`/admin/quotes/${params.requestId}/terms`}>
                修改商业条款
              </Link>
              <Link to={`/admin/quotes/${params.requestId}/issue`}>
                审核并发布修订
              </Link>
            </nav>
            <QuoteRevisionChanges changes={loaderData.changes} />
            <Form method="post" key={draft.version}>
              <input type="hidden" name="intent" value="products" />
              <input type="hidden" name="version" value={draft.version} />
              <input
                type="hidden"
                name="commandId"
                value={loaderData.commandId}
              />
              <h2>报价产品</h2>
              {draft.source.lines.map((line) => {
                const overrides =
                  (line as ReviewedQuoteLine).quotedSpecificationOverrides ??
                  [];
                const length =
                  line.lineKind === "length_based_hose"
                    ? {
                        value: String(line.lengthOrder.originalLengthValue),
                        unit: "ft",
                      }
                    : line.lineKind === "configured_assembly"
                      ? {
                          value:
                            line.configuredAssembly.snapshot.configuration
                              .finishedLength?.originalValue ?? "",
                          unit:
                            line.configuredAssembly.snapshot.configuration
                              .finishedLength?.originalUnit ?? "in",
                        }
                      : { value: "", unit: "ft" };
                return (
                  <fieldset key={line.id}>
                    <legend>{line.displayName}</legend>
                    <input type="hidden" name="lineId" value={line.id} />
                    <label className="quote-confirmation">
                      <input
                        type="checkbox"
                        name={`include:${line.id}`}
                        defaultChecked
                      />
                      保留此产品
                    </label>
                    <div className="admin-snapshot-fields">
                      <label>
                        SKU
                        <input
                          name={`sku:${line.id}`}
                          defaultValue={line.sku}
                          required
                        />
                      </label>
                      <label>
                        数量
                        <input
                          name={`quantity:${line.id}`}
                          type="number"
                          min="1"
                          max="1000000"
                          step="1"
                          defaultValue={line.quantity}
                          required
                        />
                      </label>
                      <label>
                        每件长度（适用于胶管或总成）
                        <input
                          name={`length:${line.id}`}
                          defaultValue={length.value}
                        />
                      </label>
                      <label>
                        长度单位
                        <select
                          name={`unit:${line.id}`}
                          defaultValue={length.unit}
                        >
                          <option value="ft">ft</option>
                          <option value="in">in</option>
                          <option value="mm">mm</option>
                        </select>
                      </label>
                    </div>
                    {loaderData.assemblyFields[line.id] ? (
                      <div className="admin-snapshot-fields">
                        <label className="quote-confirmation">
                          <input
                            type="checkbox"
                            name={`refreshComponents:${line.id}`}
                          />
                          本次修改总成组件，确认按当前目录重新核验全部组件、保护层和测量规则，并在签发前审核差异
                        </label>
                        {(
                          [
                            "endASku",
                            "endAFerruleSku",
                            "endBSku",
                            "endBFerruleSku",
                          ] as const
                        ).map((field, index) => (
                          <label key={field}>
                            {
                              [
                                "End A SKU",
                                "End A Ferrule SKU",
                                "End B SKU",
                                "End B Ferrule SKU",
                              ][index]
                            }
                            <input
                              name={`${field}:${line.id}`}
                              defaultValue={
                                loaderData.assemblyFields[line.id]![field]
                              }
                              required
                            />
                          </label>
                        ))}
                        <label>
                          测量方法
                          <select
                            name={`measurement:${line.id}`}
                            defaultValue={
                              loaderData.assemblyFields[line.id]!.measurement
                            }
                          >
                            <option value="not_sure">
                              Not Sure · 需要人工确认
                            </option>
                            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                              <option
                                key={n}
                                value={`M0${n}`}
                              >{`M0${n}`}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Clocking（000–359 / not_sure）
                          <input
                            name={`clocking:${line.id}`}
                            defaultValue={
                              loaderData.assemblyFields[line.id]!.clocking
                            }
                            required
                          />
                        </label>
                        <label>
                          已安装保护层
                          <select
                            name={`protectionCode:${line.id}`}
                            defaultValue={
                              loaderData.assemblyFields[line.id]!.protectionCode
                            }
                          >
                            <option
                              value={
                                loaderData.assemblyFields[line.id]!
                                  .protectionCode
                              }
                            >
                              {line.lineKind === "configured_assembly"
                                ? line.configuredAssembly.snapshot.configuration
                                    .installedProtection?.publicName
                                : ""}
                              （原快照）
                            </option>
                            {loaderData.protections
                              .filter(
                                (p) =>
                                  p.code !==
                                  loaderData.assemblyFields[line.id]!
                                    .protectionCode,
                              )
                              .map((p) => (
                                <option key={p.code} value={p.code}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                    <h3>审核后的规格修订（英文）</h3>
                    {[...overrides, { label: "", value: "" }].map(
                      (spec, index) => (
                        <div className="admin-snapshot-fields" key={index}>
                          <input
                            type="hidden"
                            name={`specIndex:${line.id}`}
                            value={index}
                          />
                          <label>
                            参数名称
                            <select
                              name={`specLabel:${line.id}:${index}`}
                              defaultValue={spec.label}
                            >
                              <option value="">未选择</option>
                              {quotedSpecificationLabels.map((label) => (
                                <option key={label} value={label}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            最终报价参数
                            <textarea
                              name={`specValue:${line.id}:${index}`}
                              defaultValue={spec.value}
                              maxLength={2000}
                            />
                          </label>
                        </div>
                      ),
                    )}
                  </fieldset>
                );
              })}
              <fieldset>
                <legend>增加产品（可选）</legend>
                <input
                  type="hidden"
                  name="newLineId"
                  value={loaderData.newLineId}
                />
                <label>
                  新产品 SKU
                  <input name="newSku" />
                </label>
                <label>
                  数量
                  <input
                    name="newQuantity"
                    type="number"
                    min="1"
                    defaultValue="1"
                  />
                </label>
                <label>
                  每件胶管长度（ft）
                  <input name="newLength" inputMode="decimal" />
                </label>
              </fieldset>
              <label>
                产品修订原因
                <textarea name="reason" required maxLength={2000} />
              </label>
              <button className="button button-primary" disabled={pending}>
                <Save size={18} />
                保存产品修订
              </button>
            </Form>
          </>
        )}
        <h2>已发布历史</h2>
        {history.map((revision) => (
          <details key={revision.id}>
            <summary>
              版本 {revision.snapshot.revisionNumber} ·{" "}
              {formatBeijingDateTime(revision.snapshot.issuedAt)}
              {revision.id === current.id ? " · 当前报价" : " · 历史报价"}
            </summary>
            <CustomerQuoteOffer
              adminSource={revision.snapshot.source.lines}
              offer={customerRevisionProjection(revision.snapshot)}
            />
          </details>
        ))}
      </main>
    </div>
  );
}
