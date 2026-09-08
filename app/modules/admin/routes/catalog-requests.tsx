import "../ui/catalog-request-review.css";
import {
  Form,
  data,
  redirect,
  useLoaderData,
  useActionData,
} from "react-router";
import { AdminNavigation } from "../ui/admin-navigation";
import { useEffect, useState } from "react";
import type { Route } from "./+types/catalog-requests";
import {
  requireAdminRequestContext,
  requireCatalogWriteContext,
} from "../infrastructure/admin-request-context";
import { createD1ItemImportReview } from "../../catalog/infrastructure/d1-item-import-review";
import { createD1CatalogItemRepository } from "../../catalog/infrastructure/d1-catalog-item-repository";
import { createD1ProductManagementRepository } from "../../catalog/infrastructure/d1-product-management-repository";
import { readCatalogWorkbook } from "../../catalog/infrastructure/read-catalog-workbook";
import {
  itemCode,
  CatalogItemRejected,
  type CatalogItemCommand,
} from "../../catalog/domain/catalog-item-publication";
import { itemSeriesCode } from "../../catalog/infrastructure/d1-additional-catalog-items";
import {
  productFields,
  packagingFields,
  productTypeLabels,
  ownedProductValues,
} from "../../catalog/domain/catalog-product-fields";
import { importRuleKeys } from "../../catalog/domain/catalog-item-import";
import { catalogWorksheetContracts } from "../../catalog/domain/catalog-workbook";

export function meta() {
  return [{ title: "产品更新请求审核 | Admin Backoffice" }];
}
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const repository = createD1ItemImportReview(env.DB, adminIdentity);
  const url = new URL(request.url);
  const filters = Object.fromEntries(
    ["batch", "status", "target", "sheet", "series", "q"].map((k) => [
      k,
      url.searchParams.get(k) ?? (k === "status" ? "pending" : ""),
    ]),
  );
  const all = await repository.all();
  const scope = all.filter(
    (r) =>
      (!filters.batch || r.batchId === filters.batch) &&
      (!filters.status || r.status === filters.status) &&
      (!filters.target || r.command.targetState === filters.target) &&
      (!filters.sheet ||
        (Array.isArray(r.original) &&
          r.original.some((s) => s.sheet === filters.sheet))),
  );
  const requests = scope.filter(
    (r) =>
      (!filters.series ||
        itemSeriesCode(r.command.payload) === filters.series) &&
      (!filters.q ||
        itemCode(r.command.payload)
          .toLowerCase()
          .includes(filters.q.toLowerCase())),
  );
  const detail = url.searchParams.get("detail")
    ? await repository.get(url.searchParams.get("detail")!)
    : null;
  const products = await createD1ProductManagementRepository(env.DB).all();
  return {
    requests,
    filters,
    batchSource: filters.batch
      ? await repository.batchSource(filters.batch)
      : null,
    seriesOptions: [
      ...new Map(
        [
          ...products
            .filter((p) => p.kind === "series")
            .map((p) => ({ code: p.code, productType: p.productType })),
          ...all.map((r) => ({
            code: itemSeriesCode(r.command.payload),
            productType: r.command.payload.productType,
          })),
        ]
          .filter((option) => option.code)
          .map((option) => [`${option.productType}:${option.code}`, option]),
      ).values(),
    ],
    batches: await repository.batches(),
    relations: await repository.relations(filters.batch || undefined),
    detail,
    affected: products
      .filter(
        (p) =>
          p.kind === "sku" &&
          p.productType === detail?.command.payload.productType &&
          p.seriesCode === itemCode(detail.command.payload),
      )
      .map((p) => p.code),
    media: (
      await env.DB.prepare(
        "SELECT id,COALESCE(approved_reference,id) AS label FROM catalog_media_versions ORDER BY created_at DESC",
      ).all<{ id: string; label: string }>()
    ).results,
    canEdit: adminIdentity.catalogPermission !== "view",
    mode: (await createD1CatalogItemRepository(env.DB).state()).mode,
    batchId: crypto.randomUUID(),
  };
}
export async function action({ context, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireCatalogWriteContext(context);
  const repository = createD1ItemImportReview(env.DB, adminIdentity);
  const form = await request.formData();
  const value = (key: string) => String(form.get(key) ?? "");
  const actorId = adminIdentity.id;
  const ipAddress = request.headers.get("cf-connecting-ip") ?? "local";
  try {
    const intent = value("intent");
    if (intent === "import") {
      const file = form.get("workbook");
      if (
        !(file instanceof File) ||
        !file.size ||
        file.size > 10 * 1024 * 1024 ||
        !file.name.toLowerCase().endsWith(".xlsx")
      )
        throw new CatalogItemRejected("请选择不超过 10 MB 的 .xlsx 工作簿");
      const batchId = await repository.importWorkbook({
        batchId: value("batchId"),
        fileName: file.name,
        fileSize: file.size,
        sheets: await readCatalogWorkbook(await file.arrayBuffer()),
        actorId,
        ipAddress,
      });
      return redirect(
        `/admin/catalog/requests?batch=${encodeURIComponent(batchId)}`,
      );
    }
    if (intent === "correct") {
      const row = await repository.get(value("id"));
      const payload = structuredClone(row.command.payload);
      const owned = ownedProductValues(payload);
      for (const field of productFields(payload.productType, payload.kind))
        if (!["sku", "seriesCode"].includes(field.key)) {
          const raw = value(`owned.${field.key}`).trim();
          owned[field.key] = raw
            ? field.kind === "number"
              ? Number(raw)
              : raw
            : null;
        }
      payload.mediaVersionId = value("mediaVersionId") || null;
      const section = payload.kind === "sku" ? "price" : "commercialRule";
      const keys =
        payload.kind === "sku"
          ? [
              "amount",
              "currency",
              "packageLengthFt",
              ...packagingFields.map((f) => f.key),
            ]
          : importRuleKeys;
      const fields: Record<string, unknown> = {};
      const textKeys = [
        "currency",
        "packingBasis",
        "salesUnit",
        "quantityInputMode",
        "countryOfOrigin",
        "hsCode",
        "notes",
        "continuousLengthConfirmation",
      ];
      for (const key of keys) {
        const raw = value(`${section}.${key}`).trim();
        fields[key] = raw ? (textKeys.includes(key) ? raw : Number(raw)) : null;
      }
      if (payload.kind === "sku")
        payload.price = fields as unknown as typeof payload.price;
      else
        payload.commercialRule = {
          ...fields,
          productType: payload.productType,
          seriesCode: payload.series.seriesCode,
        } as unknown as typeof payload.commercialRule;
      const result = await repository.correct({
        id: row.id,
        version: Number(value("version")),
        payload,
        targetState: value("targetState") as CatalogItemCommand["targetState"],
        actorId,
        ipAddress,
        reason: value("reason"),
      });
      return {
        error: null,
        results: [
          {
            id: row.id,
            code: itemCode(payload),
            ok: true,
            message: result.issues.length
              ? `修正已保存，仍需处理：${result.issues.join("；")}`
              : "修正已保存，可审核",
          },
        ],
      };
    }
    if (!["approve", "reject", "delete"].includes(intent))
      throw new CatalogItemRejected("操作无效");
    const selected = form.getAll("selected").map((s) => {
      const [id, version] = String(s).split(":");
      return { id, version: Number(version) };
    });
    const results = await repository.review({
      selected,
      intent: intent as "approve" | "reject" | "delete",
      actorId,
      ipAddress,
    });
    return { error: null, results };
  } catch (e) {
    return data(
      { error: e instanceof Error ? e.message : "操作失败", results: [] },
      { status: e instanceof CatalogItemRejected ? e.status : 400 },
    );
  }
}
const statusLabels: Record<string, string> = {
  pending: "待审核",
  approved: "已批准",
  rejected: "已拒绝",
  deleted: "已删除",
};
const targetLabels: Record<string, string> = {
  online: "上线",
  draft: "草稿",
  discontinued: "停用",
};
export default function CatalogRequests() {
  const page = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [selected, setSelected] = useState<string[]>([]);
  const [worksheet, setWorksheet] = useState(page.filters.sheet);
  const [series, setSeries] = useState(page.filters.series);
  useEffect(() => {
    setWorksheet(page.filters.sheet);
    setSeries(page.filters.series);
  }, [page.filters.sheet, page.filters.series]);
  const worksheetType = (
    {
      "01": "hose",
      "02": "hose_end",
      "03": "ferrule",
      "05": "adapter",
      "06": "quick_coupler",
    } as Record<string, string>
  )[worksheet.slice(0, 2)];
  const seriesOptions = [
    ...new Set(
      page.seriesOptions
        .filter(
          (option) => !worksheetType || option.productType === worksheetType,
        )
        .map((option) => option.code),
    ),
  ].sort();
  const detail = page.detail;
  const filters = new URLSearchParams(page.filters);
  const offerFields = catalogWorksheetContracts.find((c) =>
    c.name.startsWith("07"),
  )!.fields;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="catalog" />
      <main className="catalog-request-page">
        <h1>产品更新请求审核</h1>
        <a href="/admin/catalog/item-template" download>
          下载条目导入模板
        </a>
        <p>
          导入只生成待审核请求。批准整条参数、价格和图片后发布；每项独立成功或失败。
        </p>
        <p>
          未提供的列继承导入时数据；提供的空值会清空可选字段，必填空值会报错。支持
          USD、CNY、EUR、CAD、GBP、JPY；非 USD
          请用通用零售单价列。系列销售规则在「销售、包装和价格」维护。
        </p>
        {page.mode !== "items" && (
          <p role="alert">条目发布尚未启用；当前导入和审核不可提交。</p>
        )}
        {page.canEdit && (
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="import" />
            <input type="hidden" name="batchId" value={page.batchId} />
            <label>
              Excel 工作簿
              <input type="file" name="workbook" accept=".xlsx" required />
            </label>
            <button disabled={page.mode !== "items"}>导入为独立请求</button>
          </Form>
        )}
        <Form method="get">
          <label>
            批次
            <select name="batch" defaultValue={page.filters.batch}>
              <option value="">全部批次</option>
              {page.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.file_name} · {b.created_at}
                </option>
              ))}
            </select>
          </label>
          <label>
            更新请求状态
            <select name="status" defaultValue={page.filters.status}>
              <option value="">全部</option>
              {Object.entries(statusLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标产品状态
            <select name="target" defaultValue={page.filters.target}>
              <option value="">全部</option>
              {Object.entries(targetLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            工作表
            <select
              name="sheet"
              value={worksheet}
              onChange={(event) => {
                setWorksheet(event.target.value);
                setSeries("");
              }}
            >
              <option value="">全部</option>
              {catalogWorksheetContracts.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            系列
            <select
              name="series"
              value={series}
              onChange={(event) => setSeries(event.target.value)}
            >
              <option value="">全部</option>
              {seriesOptions.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            SKU 模糊查询
            <input name="q" defaultValue={page.filters.q} />
          </label>
          <button>筛选</button>
        </Form>
        {actionData?.error && <p role="alert">{actionData.error}</p>}
        {actionData?.results.map((r) => (
          <p role={r.ok ? "status" : "alert"} key={r.id}>
            {r.code}：{r.message}
          </p>
        ))}
        <Form method="post">
          <table>
            <thead>
              <tr>
                <th>选择</th>
                <th>类型</th>
                <th>产品 / 系列</th>
                <th>更新请求状态</th>
                <th>目标产品状态</th>
                <th>问题</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {page.requests.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      aria-label={`选择 ${itemCode(r.command.payload)}`}
                      type="checkbox"
                      name="selected"
                      value={`${r.id}:${r.version}`}
                      disabled={!page.canEdit || r.status !== "pending"}
                      checked={selected.includes(r.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, r.id]
                            : selected.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    {productTypeLabels[r.command.payload.productType]} /{" "}
                    {r.command.payload.kind === "series" ? "系列" : "SKU"}
                  </td>
                  <td>{itemCode(r.command.payload)}</td>
                  <td>{statusLabels[r.status]}</td>
                  <td>{targetLabels[r.command.targetState]}</td>
                  <td>
                    {r.issues.join("；")}
                    {r.dependencies.length > 0 && "；有系列依赖"}
                  </td>
                  <td>
                    <a href={`?${filters.toString()}&detail=${r.id}`}>更多</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!page.requests.length && <p>没有匹配的更新请求。</p>}
          {page.canEdit && (
            <div>
              <button name="intent" value="approve" disabled={!selected.length}>
                批准选中条目
              </button>
              <button name="intent" value="reject" disabled={!selected.length}>
                拒绝选中条目
              </button>
              <button name="intent" value="delete" disabled={!selected.length}>
                删除选中请求
              </button>
            </div>
          )}
        </Form>
        {detail && (
          <section aria-label="更新请求详情">
            <h2>{itemCode(detail.command.payload)} · 完整更新请求</h2>
            <a href={`?${filters.toString()}`}>关闭详情</a>
            <p>
              导入人：{detail.createdBy}；版本：{detail.version}
              。原始导入内容保留，修正另记审计。
            </p>
            {page.affected.length > 0 && (
              <p>继承本系列数据的子体：{page.affected.join("、")}</p>
            )}
            <Form method="post" key={`${detail.id}:${detail.version}`}>
              <input type="hidden" name="intent" value="correct" />
              <input type="hidden" name="id" value={detail.id} />
              <input type="hidden" name="version" value={detail.version} />
              <fieldset disabled={!page.canEdit || detail.status !== "pending"}>
                <legend>Product Snapshot / 完整产品快照</legend>
                {productFields(
                  detail.command.payload.productType,
                  detail.command.payload.kind,
                ).map((f) => (
                  <label key={f.key}>
                    {f.header}
                    <input
                      name={`owned.${f.key}`}
                      defaultValue={
                        ownedProductValues(detail.command.payload)[f.key] ?? ""
                      }
                      readOnly={["sku", "seriesCode"].includes(f.key)}
                    />
                  </label>
                ))}
                <label>
                  Target State / 目标状态
                  <select
                    name="targetState"
                    defaultValue={detail.command.targetState}
                  >
                    {Object.entries(targetLabels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {v} / {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Image Version / 图片版本
                  <select
                    name="mediaVersionId"
                    defaultValue={detail.command.payload.mediaVersionId ?? ""}
                  >
                    <option value="">
                      Inherit Series Image / 继承系列图片（系列留空表示未指定）
                    </option>
                    {page.media.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                {(detail.command.payload.kind === "sku"
                  ? [
                      "amount",
                      "currency",
                      "packageLengthFt",
                      ...packagingFields.map((f) => f.key),
                    ]
                  : importRuleKeys
                ).map((key) => {
                  const p = detail.command.payload;
                  const section = p.kind === "sku" ? "price" : "commercialRule";
                  const values = (p.kind === "sku"
                    ? p.price
                    : p.commercialRule) as unknown as Record<
                    string,
                    string | number | null
                  > | null;
                  return (
                    <label key={key}>
                      {key === "amount"
                        ? "Retail Unit Price / 零售单价"
                        : (offerFields.find((f) => f.key === key)?.header ??
                          key)}
                      <input
                        name={`${section}.${key}`}
                        defaultValue={values?.[key] ?? ""}
                      />
                    </label>
                  );
                })}
                <label>
                  Correction Reason / 修正说明
                  <input name="reason" required />
                </label>
                <button>Save Correction / 保存修正，不发布</button>
              </fieldset>
            </Form>
            {detail.command.payload.mediaVersionId && (
              <img
                className="request-image"
                src={`/media/catalog/${detail.command.payload.mediaVersionId}/thumbnail`}
                alt="请求图片预览"
              />
            )}
            <details>
              <summary>完整原始上传内容</summary>
              <pre>{JSON.stringify(detail.original, null, 2)}</pre>
            </details>
            <details>
              <summary>导入基线</summary>
              <pre>{JSON.stringify(detail.baseline, null, 2)}</pre>
            </details>
          </section>
        )}
        {page.batchSource && (
          <details>
            <summary>批次原始工作簿（含无法识别的行）</summary>
            <pre>{page.batchSource.original_json}</pre>
            <p>缺少产品身份的行保留在此处；补齐工作簿后重新导入。</p>
          </details>
        )}
        <h2>待处理总成来源（工作表 04）</h2>
        <p>
          这些来源独立保留，由总成管理处理。产品审核、拒绝或删除不会应用或删除它们。
        </p>
        {page.relations.map((r) => (
          <details key={r.id}>
            <summary>
              {r.batch_id} ·{" "}
              {(
                {
                  pending: "待处理",
                  applied: "已应用",
                  rejected: "已拒绝",
                  deleted: "已删除",
                } as Record<string, string>
              )[r.status] ?? r.status}
            </summary>
            <pre>{r.source_json}</pre>
            <p>{r.issues_json}</p>
          </details>
        ))}
        {page.batches
          .filter((b) => !page.filters.batch || b.id === page.filters.batch)
          .map(
            (b) =>
              b.issues_json !== "[]" && (
                <p role="alert" key={b.id}>
                  {b.file_name}：{b.issues_json}
                </p>
              ),
          )}
      </main>
    </div>
  );
}
