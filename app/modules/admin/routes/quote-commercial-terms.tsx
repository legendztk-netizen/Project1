import {
  Form,
  Link,
  data,
  redirect,
  useNavigation,
  useBlocker,
  useBeforeUnload,
  useSearchParams,
} from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import type { Route } from "./+types/quote-commercial-terms";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { createQuotePreparation } from "../../quote-review/infrastructure/d1-quote-preparation";
import {
  commercialChargeKeys,
  commercialTotals,
  type CommercialCharges,
  type QuoteCommercialTerms,
} from "../../quote-review/domain/quote-commercial-terms";
import {
  requireReviewMutation,
  readPrivateReviewForm,
} from "../../quote-review/domain/private-review";
import { parseUsdCents } from "../../quote-review/domain/quote-pricing";
import type { DeliveryAddressDraft } from "../../customer-identity/domain/customer-account";
import { physicalLineQuantity } from "../../shipment/domain/shipment-plan";
import { parseShipmentGroupsForm } from "../../shipment/application/parse-shipment-groups-form";
import { ShipmentGroupFields } from "../../shipment/ui/shipment-group-fields";

const addressLabels: Record<keyof DeliveryAddressDraft, string> = {
  label: "地址标签",
  recipientName: "收件人",
  recipientEmail: "收件邮箱",
  recipientPhone: "联系电话",
  countryCode: "国家代码",
  stateProvince: "州 / 省",
  city: "城市",
  postalCode: "邮编",
  addressLine1: "地址第一行",
  addressLine2: "地址第二行（可选）",
};
const chargeLabels: Record<keyof CommercialCharges, string> = {
  freight: "运费",
  insurance: "保险",
  dutiesImport: "关税及进口费用",
  salesTax: "销售税",
  cuttingLabeling: "切割与贴标费",
  assemblyService: "总成加工费",
  protectionService: "保护层安装费",
};
export function headers() {
  return { "Cache-Control": "private, no-store" };
}
export async function loader({ context, params }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const draft = await createQuotePreparation(env.DB, adminIdentity).find(
    params.requestId,
  );
  if (!draft) throw redirect(`/admin/quotes/${params.requestId}/pricing`);
  const evidence = await env.DB.prepare(
    "SELECT id,filename FROM quote_private_evidence WHERE request_id=? AND kind='tax_exemption' ORDER BY created_at",
  )
    .bind(params.requestId)
    .all<{ id: string; filename: string }>();
  return data(
    { draft, evidence: evidence.results, commandId: crypto.randomUUID() },
    { headers: headers() },
  );
}
export async function action({ context, params, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const text = (key: string) => String(form.get(key) ?? "");
  try {
    const preparation = createQuotePreparation(env.DB, adminIdentity);
    const draft = await preparation.find(params.requestId);
    if (!draft) throw new Response("Not found", { status: 404 });
    const shipmentMode = text(
      "shipmentMode",
    ) as QuoteCommercialTerms["shipmentMode"];
    const shipmentGroups =
      shipmentMode === "split"
        ? parseShipmentGroupsForm(form, draft.source.lines, {
            incoterm: text("incoterm") as QuoteCommercialTerms["incoterm"],
            namedPlace: text("namedPlace"),
          })
        : undefined;
    const terms: QuoteCommercialTerms = {
      destination: Object.fromEntries(
        Object.keys(addressLabels).map((key) => [key, text(key)]),
      ) as unknown as DeliveryAddressDraft,
      addressConfirmed: form.get("addressConfirmed") === "on",
      addressReplacementReason: text("addressReplacementReason"),
      shipmentMode,
      splitPlan: text("splitPlan"),
      shipmentGroups,
      transportMethod: text("transportMethod"),
      incoterm: text("incoterm") as QuoteCommercialTerms["incoterm"],
      termReplacementReason: text("termReplacementReason"),
      namedPlace: text("namedPlace"),
      packingEstimate: text("packingEstimate"),
      taxTreatment: text(
        "taxTreatment",
      ) as QuoteCommercialTerms["taxTreatment"],
      taxEvidenceId: text("taxEvidenceId") || null,
      leadTime: text("leadTime"),
      charges: Object.fromEntries(
        commercialChargeKeys.map((key) => [key, parseUsdCents(text(key))]),
      ) as CommercialCharges,
      manualCurrencyConfirmed: form.get("manualCurrencyConfirmed") === "on",
      freightReviewConfirmed: form.get("freightReviewConfirmed") === "on",
      actualPacking: text("actualPacking"),
    };
    await preparation.saveTerms(
      params.requestId,
      Number(text("version")),
      terms,
      text("commandId"),
    );
  } catch (error) {
    if (error instanceof Response && ![400, 409, 422].includes(error.status))
      throw error;
    return data(
      {
        error:
          error instanceof Response
            ? error.status === 409
              ? "草稿已被修改，请保留当前输入并核对最新版本后重试。"
              : await error.text()
            : error instanceof Error
              ? error.message
              : "商业条款保存失败",
      },
      { status: error instanceof Response ? error.status : 400 },
    );
  }
  return redirect(
    `/admin/quotes/${params.requestId}/${text("intent") === "continue" ? "issue" : "terms?saved=1"}`,
  );
}
export default function CommercialTerms({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { draft } = loaderData;
  const terms = draft.terms;
  const [shipmentMode, setShipmentMode] = useState(
    terms?.shipmentMode ?? "together",
  );
  const address = terms?.destination ?? draft.source.destination;
  const pending = useNavigation().state !== "idle";
  const [searchParams] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    setDirty(false);
    submitting.current = false;
    setShipmentMode(terms?.shipmentMode ?? "together");
  }, [draft.version]);
  useEffect(() => {
    if (actionData?.error) submitting.current = false;
  }, [actionData]);
  useEffect(() => {
    // An identical save succeeds without increasing the draft version.
    if (!pending && submitting.current && !actionData?.error) {
      setDirty(false);
      submitting.current = false;
    }
  }, [pending, actionData]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !submitting.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [dirty],
    ),
  );
  let total: number | null = null;
  try {
    if (terms)
      total = commercialTotals(
        draft.source,
        draft.prices,
        terms.charges,
      ).totalCents;
  } catch {
    /* Incomplete pricing remains editable. */
  }
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
        <h1>商业与交付条款</h1>
        <button
          className="button button-primary"
          type="submit"
          form="commercial-terms-form"
          name="intent"
          value="continue"
          disabled={pending}
        >
          保存并进入发布审核
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        {searchParams.get("saved") === "1" && !dirty && !actionData?.error ? (
          <p role="status">商业条款已保存。</p>
        ) : null}
        {blocker.state === "blocked" ? (
          <div role="alert">
            <p>商业条款有未保存的修改，离开会丢失这些输入。</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => blocker.reset()}
            >
              继续填写
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => blocker.proceed()}
            >
              放弃修改并离开
            </button>
          </div>
        ) : null}
        <p>
          草稿版本 {draft.version} ·{" "}
          {total === null ? "条款待完成" : `USD ${(total / 100).toFixed(2)}`}
        </p>
        {actionData?.error ? <p role="alert">{actionData.error}</p> : null}
        <Form
          id="commercial-terms-form"
          method="post"
          key={draft.version}
          className="commercial-settings-form"
          onChange={() => setDirty(true)}
          onSubmit={() => {
            submitting.current = true;
          }}
        >
          <input type="hidden" name="version" value={draft.version} />
          <input type="hidden" name="commandId" value={loaderData.commandId} />
          <fieldset>
            <legend>最终交付地址</legend>
            <div className="admin-snapshot-fields">
              {Object.entries(addressLabels).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    name={key}
                    defaultValue={
                      address?.[key as keyof DeliveryAddressDraft] ?? ""
                    }
                    required={key !== "addressLine2"}
                  />
                </label>
              ))}
            </div>
            <label>
              地址修改原因（地址变化时必填）
              <textarea
                name="addressReplacementReason"
                defaultValue={terms?.addressReplacementReason}
              />
            </label>
            <label className="quote-confirmation">
              <input
                type="checkbox"
                name="addressConfirmed"
                defaultChecked={terms?.addressConfirmed}
                required
              />
              已确认最终地址
            </label>
          </fieldset>
          <fieldset>
            <legend>包装与运输</legend>
            <label>
              发货安排
              <select
                name="shipmentMode"
                defaultValue={terms?.shipmentMode ?? "together"}
                onChange={(event) =>
                  setShipmentMode(event.target.value as "together" | "split")
                }
              >
                <option value="together">合并发货</option>
                <option value="split">约定分批发货</option>
              </select>
            </label>
            <label>
              分批计划（分批时必填）
              <textarea name="splitPlan" defaultValue={terms?.splitPlan} />
            </label>
            {shipmentMode === "split" && (
              <ShipmentGroupFields
                key={draft.version}
                lines={draft.source.lines.map((line) => ({
                  id: line.id,
                  sku: line.sku,
                  unit:
                    line.lineKind === "length_based_hose"
                      ? "件"
                      : line.salesUnit,
                  physicalQuantity: physicalLineQuantity(line),
                }))}
                groups={
                  terms?.shipmentMode === "split"
                    ? terms.shipmentGroups
                    : undefined
                }
                charges={
                  terms?.charges ?? {
                    freight: 0,
                    insurance: 0,
                    dutiesImport: 0,
                  }
                }
                transportMethod={terms?.transportMethod ?? ""}
                onDirty={() => setDirty(true)}
              />
            )}
            <label>
              运输方式
              <input
                name="transportMethod"
                defaultValue={terms?.transportMethod}
                required
              />
            </label>
            <label>
              包装估算
              <textarea
                name="packingEstimate"
                defaultValue={terms?.packingEstimate}
                required
              />
            </label>
            <label className="quote-confirmation">
              <input
                type="checkbox"
                name="freightReviewConfirmed"
                defaultChecked={terms?.freightReviewConfirmed}
                required
              />
              已审核包装估算，足以核定本次运费
            </label>
            <label>
              实际包装数据（可选：箱数、重量、尺寸）
              <textarea
                name="actualPacking"
                defaultValue={terms?.actualPacking}
              />
            </label>
            <label>
              按本次数量审核的交期（英文）
              <textarea
                name="leadTime"
                defaultValue={terms?.leadTime}
                required
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>贸易与税务</legend>
            <label>
              Incoterm
              <select
                name="incoterm"
                required
                defaultValue={
                  terms?.incoterm ??
                  (draft.source.importResponsibility.fulfillmentTerm ===
                  "MANUAL"
                    ? ""
                    : draft.source.importResponsibility.fulfillmentTerm)
                }
              >
                <option value="">请选择</option>
                <option value="DDP">DDP</option>
                <option value="DAP">DAP</option>
              </select>
            </label>
            <label>
              指定地点
              <input
                name="namedPlace"
                defaultValue={terms?.namedPlace}
                required
              />
            </label>
            <label>
              贸易条款修改 / 人工确认原因
              <textarea
                name="termReplacementReason"
                defaultValue={terms?.termReplacementReason}
              />
            </label>
            <label>
              销售税处理
              <select
                name="taxTreatment"
                required
                defaultValue={terms?.taxTreatment ?? ""}
              >
                <option value="">请选择</option>
                <option value="Collected">Collected · 收取</option>
                <option value="Exempt">Exempt · 免税</option>
                <option value="Not Collected">Not Collected · 不收取</option>
              </select>
            </label>
            <label>
              私有免税证明
              <select
                name="taxEvidenceId"
                defaultValue={terms?.taxEvidenceId ?? ""}
              >
                <option value="">未选择</option>
                {loaderData.evidence.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.filename}
                  </option>
                ))}
              </select>
            </label>
            <Link to={`/admin/quotes/${params.requestId}/private`}>
              管理私有证明
            </Link>
            <label className="quote-confirmation">
              <input
                type="checkbox"
                name="manualCurrencyConfirmed"
                defaultChecked={terms?.manualCurrencyConfirmed}
              />
              已人工确认 USD 定价及进口条款
            </label>
          </fieldset>
          <fieldset>
            <legend>附加费用 · USD</legend>
            <div className="admin-snapshot-fields">
              {commercialChargeKeys.map((key) => (
                <label key={key}>
                  {chargeLabels[key]}
                  <input
                    name={key}
                    inputMode="decimal"
                    required
                    defaultValue={((terms?.charges[key] ?? 0) / 100).toFixed(2)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          {actionData?.error ? (
            <p role="alert">
              保存失败：{actionData.error}。当前输入仍保留，请修正后重新保存。
            </p>
          ) : null}
          <button className="button button-primary" disabled={pending}>
            <Save size={18} />
            {pending ? "正在保存…" : "保存商业条款"}
          </button>
        </Form>
      </main>
    </div>
  );
}
