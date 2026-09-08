import { Form, Link, data } from "react-router";
import type { Route } from "./+types/catalog-items";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { createD1CatalogItemRepository } from "../../catalog/infrastructure/d1-catalog-item-repository";
import {
  CatalogItemRejected,
  itemCurrencies,
  type CatalogItemCommand,
  type CatalogItemPayload,
} from "../../catalog/domain/catalog-item-publication";
import {
  HoseMaintenanceRejected,
  type HoseVariantInput,
} from "../../catalog/domain/catalog-hose-maintenance";
import { CatalogCommercialMaintenanceRejected } from "../../catalog/domain/catalog-commercial-maintenance";

const fields = [
  ["sku", "SKU", "text"],
  ["hoseSeries", "胶管系列", "text"],
  ["dash", "Dash", "text"],
  ["nominalIdIn", "公称内径 (in)", "number"],
  ["idMm", "内径 (mm)", "number"],
  ["odMm", "外径 (mm)", "number"],
  ["workingBar", "工作压力 (bar)", "number"],
  ["workingPsi", "工作压力 (psi)", "number"],
  ["burstBar", "爆破压力 (bar)", "number"],
  ["bendRadiusMm", "弯曲半径 (mm)", "number"],
  ["weightKgM", "米重 (kg/m)", "number"],
  ["skiveRequirement", "剥胶要求", "text"],
  ["mshaMarking", "MSHA 标识", "text"],
  ["technicalDataStatus", "技术数据状态", "text"],
  ["source", "数据来源", "text"],
  ["notes", "备注", "text"],
] as const;

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  const repository = createD1CatalogItemRepository(env.DB);
  const url = new URL(request.url);
  const code = url.searchParams.get("sku")?.trim().toUpperCase() ?? "";
  const payload = code
    ? await repository.findPayload(
        "sku",
        code,
        url.searchParams.get("draft") === "1",
      )
    : null;
  return {
    state: await repository.state(),
    payload,
    code,
    commandId: crypto.randomUUID(),
    history: code ? await repository.history("sku", code) : [],
    series: await repository.listSeries(),
    media: (
      await env.DB.prepare(
        "SELECT id, COALESCE(approved_reference, id) AS label FROM catalog_media_versions ORDER BY created_at DESC",
      ).all<{ id: string; label: string }>()
    ).results,
    canEnable: env.APP_ENV === "local" || env.APP_ENV === "preview",
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const repository = createD1CatalogItemRepository(env.DB);
  const form = await request.formData();
  const text = (key: string) => String(form.get(key) ?? "").trim();
  try {
    if (text("intent") === "enable") {
      await repository.enable({
        environment: env.APP_ENV,
        actorId: adminIdentity.id,
      });
      return { saved: "隔离环境已启用条目发布", error: null };
    }
    const variant = Object.fromEntries(
      fields.map(([key, , type]) => [
        key,
        type === "number" ? (text(key) ? Number(text(key)) : NaN) : text(key),
      ]),
    ) as unknown as HoseVariantInput;
    const payload: CatalogItemPayload = {
      kind: "sku",
      productType: "hose",
      variant,
      mediaVersionId: text("mediaVersionId") || null,
      price: {
        amount: text("amount") ? Number(text("amount")) : null,
        currency: text("currency") || "USD",
        packageLengthFt: text("packageLengthFt")
          ? Number(text("packageLengthFt"))
          : null,
        ...Object.fromEntries(
          [
            "unitsPerSalesPack",
            "netUnitWeightKg",
            "innerPackQty",
            "masterCartonQty",
            "cartonGrossWeightKg",
            "cartonLCm",
            "cartonWCm",
            "cartonHCm",
          ].map((key) => [key, text(key) ? Number(text(key)) : null]),
        ),
        packingBasis: text("packingBasis") || null,
      },
    };
    const result = await repository.apply({
      commandId: text("commandId"),
      actorId: adminIdentity.id,
      ipAddress: request.headers.get("cf-connecting-ip") ?? "local",
      payload,
      targetState: text("targetState") as CatalogItemCommand["targetState"],
      mode: text("mode") as CatalogItemCommand["mode"],
      baselineRevisionId: text("baselineRevisionId") || null,
      source: { channel: "manual" },
    });
    return {
      saved: `已保存修订 ${result.revisionId}（顺序 ${result.sequence}）`,
      error: null,
    };
  } catch (error) {
    if (
      error instanceof CatalogItemRejected ||
      error instanceof HoseMaintenanceRejected ||
      error instanceof CatalogCommercialMaintenanceRejected
    ) {
      return data(
        {
          saved: null,
          error:
            error instanceof HoseMaintenanceRejected
              ? error.findings.map((f) => f.message).join("；") || error.message
              : error.message,
        },
        { status: error instanceof CatalogItemRejected ? error.status : 400 },
      );
    }
    throw error;
  }
}

export default function CatalogItems({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { payload, state, history } = loaderData;
  const sku = payload?.kind === "sku" ? payload : null;
  return (
    <main className="admin-page">
      <Link to="/admin">返回后台</Link>
      <h1>胶管条目发布</h1>
      <p>
        当前模式：{state.mode === "items" ? "条目发布" : "旧目录发布"}
        。系列属性、图片和销售规则继承自系列；本表单只保存 SKU 自有数据。
      </p>
      {actionData?.error && <p role="alert">{actionData.error}</p>}
      {actionData?.saved && <p role="status">{actionData.saved}</p>}
      {state.mode === "legacy" ? (
        loaderData.canEnable ? (
          <Form method="post">
            <button name="intent" value="enable">
              在本隔离环境启用条目发布
            </button>
            <p>需要已有上线目录作为冻结基线；启用后旧目录写入入口关闭。</p>
          </Form>
        ) : (
          <p>生产切换由 Ticket 05 开放。</p>
        )
      ) : (
        <>
          <Form method="get">
            <label>
              查找 SKU <input name="sku" defaultValue={loaderData.code} />
            </label>
            <button>读取上线数据</button>
            <button name="draft" value="1">
              读取草稿
            </button>
          </Form>
          <p>
            可用系列：{loaderData.series.map((s) => s.code).join("、")}
            。系列销售规则的完整维护入口由 Ticket 02 的系列编辑弹窗交付。
          </p>
          <Form
            method="post"
            key={`${loaderData.commandId}:${loaderData.code}`}
          >
            <input
              type="hidden"
              name="commandId"
              value={loaderData.commandId}
            />
            <input type="hidden" name="mode" value={sku ? "edit" : "create"} />
            <input
              type="hidden"
              name="baselineRevisionId"
              value={
                history.find((r) => r.targetState !== "draft")?.revisionId ??
                (sku
                  ? `legacy:${state.baseline_release_id}:sku:${sku.variant.sku}`
                  : "")
              }
            />
            {fields.map(([key, label, type]) => (
              <p key={key}>
                <label>
                  {label}{" "}
                  <input
                    name={key}
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    readOnly={key === "sku" && Boolean(sku)}
                    defaultValue={
                      sku?.variant[key] ??
                      (key === "technicalDataStatus" ? "Complete" : "")
                    }
                  />
                </label>
              </p>
            ))}
            <p>
              <label>
                价格金额{" "}
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={sku?.price?.amount ?? ""}
                />
              </label>
              <label>
                币种{" "}
                <select
                  name="currency"
                  defaultValue={sku?.price?.currency ?? "USD"}
                >
                  {itemCurrencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </p>
            <p>
              <label>
                包装长度 (ft){" "}
                <input
                  name="packageLengthFt"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={sku?.price?.packageLengthFt ?? ""}
                />
              </label>
              按长度销售可留空；定长包装必须填写。
            </p>
            {(
              [
                "unitsPerSalesPack",
                "netUnitWeightKg",
                "innerPackQty",
                "masterCartonQty",
                "cartonGrossWeightKg",
                "cartonLCm",
                "cartonWCm",
                "cartonHCm",
                "packingBasis",
              ] as const
            ).map((key) => (
              <input
                key={key}
                type="hidden"
                name={key}
                value={sku?.price?.[key] ?? ""}
              />
            ))}
            <p>
              <label>
                SKU 图片覆盖{" "}
                <select
                  name="mediaVersionId"
                  defaultValue={sku?.mediaVersionId ?? ""}
                >
                  <option value="">继承系列图片</option>
                  {loaderData.media.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <p>
              <label>
                保存状态{" "}
                <select name="targetState">
                  <option value="online">直接上线</option>
                  <option value="draft">保存草稿</option>
                  <option value="discontinued">停用</option>
                </select>
              </label>
            </p>
            <button>提交条目</button>
          </Form>
        </>
      )}
      <h2>不可变修订历史</h2>
      {history.map((r) => (
        <details key={r.revisionId}>
          <summary>
            {r.sequence} · {r.targetState} · {r.revisionId}
          </summary>
          <pre>{JSON.stringify(r.payload, null, 2)}</pre>
        </details>
      ))}
    </main>
  );
}
