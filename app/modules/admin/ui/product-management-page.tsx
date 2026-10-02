import { useEffect, useRef, useState } from "react";
import {
  Link,
  useFetcher,
  useLocation,
  useNavigate,
  useNavigation,
} from "react-router";
import type { loader as pageLoader, action } from "../routes/catalog-products";
import type { loader as editorLoader } from "../routes/catalog-product-editor";
import { AdminNavigation } from "./admin-navigation";
import {
  commercialProductTypes,
  type CommercialProductType,
} from "../../catalog/domain/catalog-commercial-maintenance";
import {
  productTypeLabels,
  productFields,
  packagingFields,
  ownedProductValues,
} from "../../catalog/domain/catalog-product-fields";
import { itemCurrencies } from "../../catalog/domain/catalog-item-publication";
import {
  selectionActions,
  validateProductPackaging,
} from "../../catalog/domain/catalog-product-management";
import type {
  ManagedProduct,
  ProductSelection,
} from "../../catalog/infrastructure/d1-product-management-repository";
import type { CatalogFieldContract } from "../../catalog/domain/catalog-workbook";
import "../styles/product-management.css";
type PageData = Awaited<ReturnType<typeof pageLoader>>;
type EditorData = Awaited<ReturnType<typeof editorLoader>>;
const key = (r: ProductSelection) => `${r.productType}:${r.kind}:${r.code}`;
const seriesFields = [
  "hoseSeries",
  "fittingSeries",
  "ferruleSeries",
  "adapterFamilyId",
  "couplerSeries",
];
const stateLabels: Record<string, string> = {
  online: "上线",
  draft: "草稿",
  discontinued: "停用",
};
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d?.showModal) d.showModal();
    else d?.setAttribute("open", "");
    return () => d?.close?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className="product-editor"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Field({
  field,
  defaultValue,
  readOnly = false,
  series,
}: {
  field: CatalogFieldContract;
  defaultValue?: string | number | null;
  readOnly?: boolean;
  series?: ManagedProduct[];
}) {
  return (
    <label>
      {field.header.replace(/^\*\s*/, "")}
      {field.required ? " *" : ""}
      {series ? (
        <select
          name={field.key}
          defaultValue={defaultValue ?? ""}
          required={field.required}
          disabled={readOnly}
        >
          <option value="">Select series / 选择系列</option>
          {series.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
      ) : field.controlledValues ? (
        <select
          name={field.key}
          defaultValue={defaultValue ?? ""}
          required={field.required}
          disabled={readOnly}
        >
          <option value="">Select / 请选择</option>
          {field.controlledValues.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          name={field.key}
          type={field.kind === "number" ? "number" : "text"}
          step={field.kind === "number" ? "any" : undefined}
          defaultValue={defaultValue ?? ""}
          required={field.required}
          readOnly={readOnly}
        />
      )}
    </label>
  );
}
function ProductEditor({
  editor,
  onClose,
  submit,
  error,
  busy,
}: {
  editor: EditorData;
  onClose: () => void;
  submit: (form: FormData) => void;
  error: string | null;
  busy: boolean;
}) {
  const dirty = useRef(false);
  const { payload, kind, productType } = editor;
  const values = payload ? ownedProductValues(payload) : {};
  const price = payload?.kind === "sku" ? payload.price : null;
  const [currency, setCurrency] = useState(price?.currency ?? "USD");
  const [amount, setAmount] = useState(String(price?.amount ?? ""));
  const [state, setState] = useState(editor.targetState);
  const [clientError, setClientError] = useState<string | null>(null);
  const canEdit = editor.canEdit;
  const close = () => {
    if (!dirty.current || window.confirm("放弃未保存的修改？")) onClose();
  };
  return (
    <Modal
      title={`${productTypeLabels[productType]} · ${kind === "series" ? "Series / 系列" : "Product / 产品"}${payload ? " · 编辑" : " · 新增"}`}
      onClose={close}
    >
      <form
        onChange={() => {
          dirty.current = true;
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          try {
            if (kind === "sku") {
              const rule =
                editor.rules?.find(
                  (rule) =>
                    rule.seriesCode === String(form.get("hoseSeries") ?? ""),
                ) ?? null;
              const length = String(form.get("packageLengthFt") ?? "").trim();
              validateProductPackaging(
                productType,
                rule,
                length ? Number(length) : null,
              );
              for (const field of packagingFields.filter(
                (field) => field.kind === "number",
              )) {
                const value = String(form.get(field.key) ?? "").trim();
                if (
                  value &&
                  (!Number.isFinite(Number(value)) || Number(value) <= 0)
                )
                  throw new Error(`${field.header} 必须大于零`);
              }
            }
            setClientError(null);
            submit(form);
          } catch (error) {
            setClientError(
              error instanceof Error ? error.message : "包装数据无效",
            );
          }
        }}
      >
        {(clientError || error) && <p role="alert">{clientError || error}</p>}
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="productType" value={productType} />
        <input type="hidden" name="commandId" value={editor.commandId} />
        <input
          type="hidden"
          name="baselineRevisionId"
          value={editor.baselineRevisionId ?? ""}
        />
        <input
          type="hidden"
          name="basePayload"
          value={payload ? JSON.stringify(payload) : ""}
        />
        <fieldset disabled={!canEdit || busy} className="product-field-grid">
          <legend>Product parameters / 产品参数</legend>
          {productFields(productType, kind).map((f) => (
            <Field
              key={f.key}
              field={f}
              defaultValue={
                values[f.key] ??
                (seriesFields.includes(f.key) ? editor.initialSeries : null) ??
                (f.key === "technicalDataStatus" ? "Complete" : null)
              }
              readOnly={
                Boolean(payload) && ["sku", "seriesCode"].includes(f.key)
              }
              series={
                kind === "sku" &&
                ["hoseSeries", "fittingSeries"].includes(f.key)
                  ? editor.series
                  : undefined
              }
            />
          ))}
          <label>
            Main Image / 主图
            <select
              name="mediaVersionId"
              defaultValue={payload?.mediaVersionId ?? ""}
            >
              <option value="">
                {kind === "sku"
                  ? "Inherit series image / 继承系列图片"
                  : "No image / 暂不设置"}
              </option>
              {editor.media.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Upload New Image / 上传新图片
            <input
              name="mainImageUpload"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            />
            <small>
              A new image creates a new image version and replaces the choice
              above / 上传会创建新的图片版本，并取代上面的选择；JPEG、PNG 或
              WebP，最大 12 MB。
            </small>
          </label>
          <label>
            Image Source Notes / 图片来源备注（可选）
            <input name="imageSourceNotes" type="text" />
          </label>
          <label>
            Image License Notes / 图片授权备注（可选）
            <input name="imageLicenseNotes" type="text" />
          </label>
        </fieldset>
        {kind === "sku" && (
          <fieldset disabled={!canEdit || busy} className="product-field-grid">
            <legend>Price and Packaging / 价格和包装</legend>
            <p>Sales SKU follows product SKU / 销售 SKU 自动使用产品 SKU。</p>
            <label>
              Retail Unit Price / 零售单价
              <input
                name="amount"
                type="number"
                min="0"
                step="any"
                required={state === "online"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Currency / 币种
              <select
                name="currency"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setAmount("");
                }}
              >
                {itemCurrencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {productType === "hose" && (
              <Field
                field={{
                  key: "packageLengthFt",
                  header:
                    "Package Length ft / 包装长度（预包装必填、裁切可空）",
                  kind: "number",
                  required: false,
                }}
                defaultValue={price?.packageLengthFt}
              />
            )}
            {packagingFields.map((f) => (
              <Field
                key={f.key}
                field={f}
                defaultValue={
                  (
                    price as unknown as Record<
                      string,
                      string | number | null
                    > | null
                  )?.[f.key]
                }
              />
            ))}
          </fieldset>
        )}
        <p>
          Shared sales rules / 共享销售规则：
          <Link to={`/admin/catalog/commercial?productType=${productType}`}>
            销售、包装和价格
          </Link>
          。Changing currency requires entering the price again; no conversion.
          / 更换币种后须重新填写价格，不自动换算。
        </p>
        <footer>
          <label>
            保存状态{" "}
            <select
              name="targetState"
              value={state}
              onChange={(e) => setState(e.target.value)}
              disabled={!canEdit}
            >
              <option value="online">上线</option>
              <option value="draft">草稿</option>
              {kind === "sku" && <option value="discontinued">停用</option>}
            </select>
          </label>
          <button type="button" onClick={close}>
            关闭
          </button>
          {canEdit && (
            <button type="submit" disabled={busy}>
              {busy ? "正在保存…" : "保存产品"}
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
function priceSummary(rows: ManagedProduct[]) {
  const currencies = new Map<string, number[]>();
  for (const r of rows)
    if (r.amount !== null) {
      currencies.set(r.currency, [
        ...(currencies.get(r.currency) ?? []),
        r.amount,
      ]);
    }
  return [...currencies].map(([currency, amounts]) => {
    const min = Math.min(...amounts),
      max = Math.max(...amounts);
    const format = (n: number) =>
      n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    return `${currency} ${format(min)}${min === max ? "" : ` – ${format(max)}`}`;
  });
}
export function ProductManagementPage(props: PageData) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const editor = useFetcher<typeof editorLoader>();
  const mutation = useFetcher<typeof action>();
  const plan = useFetcher<typeof pageLoader>();
  const [selected, setSelected] = useState<ProductSelection[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState(props.query);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<CommercialProductType>("hose");
  const [addKind, setAddKind] = useState<"series" | "sku">("sku");
  const [deleteId, setDeleteId] = useState("");
  const filtered = !!(
    props.query ||
    props.types.length ||
    props.status ||
    props.attention
  );
  useEffect(() => {
    setSelected([]);
    setQuery(props.query);
    setExpanded(
      props.query || props.status || props.attention
        ? props.page.items
            .filter((g) => g.item.kind === "series")
            .map((g) => key(g.item))
        : [],
    );
  }, [location.search, props.query, props.status, props.attention]);
  useEffect(() => {
    if (mutation.state === "idle" && mutation.data?.ok) {
      setEditorOpen(false);
      setDeleteOpen(false);
      setSelected([]);
    }
  }, [mutation.state, mutation.data]);
  const controls = selectionActions(selected);
  const busy = mutation.state !== "idle";
  const loading = navigation.state !== "idle";
  const canWrite = props.canEdit && props.state.mode === "items";
  function filter(changes: Record<string, string | string[]>) {
    const params = new URLSearchParams(location.search);
    params.delete("page");
    params.delete("deletePlan");
    for (const [name, value] of Object.entries(changes)) {
      params.delete(name);
      for (const v of Array.isArray(value) ? value : [value])
        if (v) params.append(name, v);
    }
    void navigate(`?${params}`);
  }
  function open(
    type: CommercialProductType,
    kind: "series" | "sku",
    code = "",
    series = "",
  ) {
    setEditorOpen(true);
    setAddOpen(false);
    void editor.load(
      `/admin/catalog/product-editor?${new URLSearchParams({ type, kind, code, series })}`,
    );
  }
  function toggle(row: ManagedProduct) {
    setSelected((old) =>
      old.some((s) => key(s) === key(row))
        ? old.filter((s) => key(s) !== key(row))
        : [
            ...old,
            { kind: row.kind, productType: row.productType, code: row.code },
          ],
    );
  }
  function remove() {
    setDeleteId(crypto.randomUUID());
    setDeleteOpen(true);
    void plan.load(
      `/admin/catalog/products?deletePlan=${encodeURIComponent(JSON.stringify(selected))}`,
    );
  }
  function pageHref(number: number) {
    const params = new URLSearchParams(location.search);
    params.set("page", String(number));
    return `?${params}`;
  }
  const allExpanded = props.page.items
    .filter((g) => g.item.kind === "series")
    .every((g) => expanded.includes(key(g.item)));
  function row(
    r: ManagedProduct,
    children: ManagedProduct[] = [],
    child = false,
    totalChildren = children.length,
  ) {
    const isSeries = r.kind === "series";
    const prices = priceSummary(isSeries ? children : [r]);
    const missing = isSeries
      ? children.filter((c) => c.amount === null).length
      : Number(r.amount === null);
    const technicalPending = (isSeries ? children : [r]).filter(
      (c) => c.technicalStatus === "Pending",
    ).length;
    const drafts = isSeries
      ? children.filter((c) => c.draftRevisionId).length
      : 0;
    return (
      <tr key={key(r)} className={child ? "product-child" : "product-parent"}>
        <td>
          <input
            type="checkbox"
            aria-label={`选择${isSeries ? "系列" : "SKU"} ${r.code}`}
            checked={selected.some((s) => key(s) === key(r))}
            onChange={() => toggle(r)}
          />
        </td>
        <td>
          <div className="product-identity">
            {isSeries && (
              <button
                className="product-expand"
                type="button"
                aria-label={`${expanded.includes(key(r)) ? "收起" : "展开"} ${r.code}`}
                aria-expanded={expanded.includes(key(r))}
                onClick={() =>
                  setExpanded((old) =>
                    old.includes(key(r))
                      ? old.filter((k) => k !== key(r))
                      : [...old, key(r)],
                  )
                }
              >
                {expanded.includes(key(r)) ? "−" : "+"}
              </button>
            )}
            {r.imageId ? (
              <img
                alt=""
                loading="lazy"
                src={`/media/catalog/${encodeURIComponent(r.imageId)}/thumbnail`}
              />
            ) : (
              <span className="product-image-placeholder" aria-hidden="true">
                {isSeries ? "系列" : "SKU"}
              </span>
            )}
            <div>
              <strong>{r.name}</strong>
              <small>
                {r.name !== r.code ? `${r.code} · ` : ""}
                {isSeries
                  ? children.length !== totalChildren
                    ? `匹配 ${children.length} / ${totalChildren} SKU`
                    : `${children.length} SKU`
                  : `系列 ${r.seriesCode || "未设置"}`}
              </small>
            </div>
          </div>
        </td>
        <td>
          <span className="product-category">
            {productTypeLabels[r.productType]}
          </span>
        </td>
        <td className="product-spec">
          {isSeries ? (
            <>
              <span>{children.length} 个匹配规格</span>
              <small>展开查看尺寸与接口</small>
            </>
          ) : (
            <>
              <span>{r.dimensions || "规格待补充"}</span>
              <small>
                {r.technicalStatus
                  ? `技术资料：${({ Complete: "完整", Inherited: "继承系列", Pending: "待完善" } as Record<string, string>)[r.technicalStatus] ?? r.technicalStatus}`
                  : ""}
              </small>
            </>
          )}
        </td>
        <td className="product-price">
          {prices.length ? (
            prices.map((p) => <strong key={p}>{p}</strong>)
          ) : (
            <span className="product-muted">暂无定价</span>
          )}
          <small>
            {isSeries
              ? "匹配 SKU 的价格范围"
              : r.salesUnit
                ? `每 ${r.salesUnit}`
                : "零售单价"}
          </small>
        </td>
        <td>
          <span className={`product-state product-state-${r.state}`}>
            {stateLabels[r.state] ?? r.state}
          </span>
          {isSeries && children.length > 0 && (
            <small>
              {children.filter((c) => c.state === "online").length} /{" "}
              {children.length} SKU 上线
            </small>
          )}
        </td>
        <td className="product-quality">
          {missing > 0 && (
            <span className="product-warning">
              {isSeries ? `${missing} 个 SKU 未定价` : "未定价"}
            </span>
          )}
          {(r.draftRevisionId || drafts > 0) && (
            <span>有草稿修订{drafts > 0 ? `（${drafts} SKU）` : ""}</span>
          )}
          {(r.assemblyPending || children.some((c) => c.assemblyPending)) && (
            <span>总成待更新</span>
          )}
          {technicalPending > 0 && (
            <span>
              {isSeries
                ? `${technicalPending} 个 SKU 技术资料待完善`
                : "技术资料待完善"}
            </span>
          )}
          {!missing &&
            !r.draftRevisionId &&
            !drafts &&
            !technicalPending &&
            !r.assemblyPending &&
            !children.some((c) => c.assemblyPending) &&
            (isSeries ||
              !r.technicalStatus ||
              ["Complete", "Inherited"].includes(r.technicalStatus)) && (
              <span className="product-muted">—</span>
            )}
        </td>
        <td>
          <div className="product-row-actions">
            <button
              type="button"
              aria-label={`${canWrite ? "编辑" : "查看"} ${r.code}`}
              onClick={() => open(r.productType, r.kind, r.code)}
            >
              {canWrite ? "编辑" : "查看"}
            </button>
            {isSeries && canWrite && (
              <button
                type="button"
                aria-label={`在 ${r.code} 下新增 SKU`}
                onClick={() => open(r.productType, "sku", "", r.code)}
              >
                + SKU
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="imports" maintenanceMode="manual" />
      <main className="product-management">
        <header className="product-page-header">
          <div>
            <span className="eyebrow">产品数据维护 / CATALOG</span>
            <h1>管理所有产品</h1>
            <p>查找产品、维护规格与价格，掌握每个系列的发布情况。</p>
          </div>
          <button
            className="product-primary"
            disabled={!canWrite}
            onClick={() => setAddOpen(true)}
          >
            ＋ 新增产品
          </button>
        </header>
        {props.state.mode === "legacy" && (
          <aside role="status">
            <p>当前为旧目录模式。启用条目发布后可新增和维护产品。</p>
            {props.canEnable && props.canEdit && (
              <mutation.Form method="post">
                <button name="intent" value="enable">
                  启用本环境条目发布
                </button>
              </mutation.Form>
            )}
          </aside>
        )}
        <section className="product-filters" aria-label="搜索与筛选">
          <form
            className="product-search"
            onSubmit={(e) => {
              e.preventDefault();
              filter({ q: query.trim() });
            }}
          >
            <label htmlFor="product-search">查找产品</label>
            <div>
              <input
                id="product-search"
                name="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索 SKU、系列名称、尺寸或接口…"
              />
              <button
                className="product-primary"
                type="submit"
                disabled={loading}
              >
                {loading ? "查询中…" : "查询"}
              </button>
            </div>
          </form>
          <div className="product-filter-row">
            <span className="product-filter-label">产品类目</span>
            <div className="product-type-chips">
              <button
                aria-pressed={!props.types.length}
                onClick={() => filter({ type: [] })}
              >
                全部
              </button>
              {commercialProductTypes.map((t) => (
                <button
                  key={t}
                  aria-pressed={props.types.includes(t)}
                  onClick={() =>
                    filter({
                      type: props.types.includes(t)
                        ? props.types.filter((x) => x !== t)
                        : [...props.types, t],
                    })
                  }
                >
                  {productTypeLabels[t]}
                </button>
              ))}
            </div>
            <span className="product-muted">可多选</span>
          </div>
          <div className="product-filter-row">
            <label>
              发布状态
              <select
                value={props.status ?? ""}
                onChange={(e) => filter({ status: e.target.value })}
              >
                <option value="">全部状态</option>
                <option value="online">上线</option>
                <option value="draft">草稿</option>
                <option value="discontinued">停用</option>
              </select>
            </label>
            <label>
              待处理项
              <select
                value={props.attention ?? ""}
                onChange={(e) => filter({ attention: e.target.value })}
              >
                <option value="">全部产品</option>
                <option value="missing_price">未定价</option>
                <option value="draft_changes">有草稿修订</option>
                <option value="assembly_pending">总成待更新</option>
                <option value="technical_pending">技术资料待完善</option>
              </select>
            </label>
            {filtered && (
              <button
                className="product-text-button"
                onClick={() => {
                  setQuery("");
                  void navigate(location.pathname);
                }}
              >
                清空筛选
              </button>
            )}
          </div>
        </section>
        <section className="product-overview" aria-label="当前筛选结果概览">
          <div>
            <span>系列 / 独立项目</span>
            <strong>{props.page.total}</strong>
          </div>
          <div>
            <span>匹配 SKU</span>
            <strong>{props.page.summary.skuCount}</strong>
          </div>
          <div>
            <span>上线 SKU</span>
            <strong>{props.page.summary.onlineCount}</strong>
          </div>
          <div>
            <span>未定价 SKU</span>
            <strong
              className={
                props.page.summary.missingPriceCount ? "product-warning" : ""
              }
            >
              {props.page.summary.missingPriceCount}
            </strong>
          </div>
        </section>
        {mutation.data?.error && <p role="alert">{mutation.data.error}</p>}
        {mutation.data?.ok && <p role="status">{mutation.data.result}</p>}
        <section
          className="product-results"
          aria-label="产品列表"
          aria-busy={loading}
        >
          <div className="product-list-toolbar">
            <div>
              <h2>产品列表</h2>
              <span className="product-muted">
                {filtered ? "当前筛选结果" : "全部产品"} · 按系列分组
              </span>
            </div>
            <div>
              <button
                disabled={!props.page.items.length}
                onClick={() =>
                  setExpanded(
                    allExpanded
                      ? []
                      : props.page.items
                          .filter((g) => g.item.kind === "series")
                          .map((g) => key(g.item)),
                  )
                }
              >
                {allExpanded && props.page.items.length
                  ? "收起全部"
                  : "展开全部"}
              </button>
              <label>
                每页
                <select
                  value={props.pageSize}
                  onChange={(e) => filter({ size: e.target.value })}
                >
                  <option value="20">20 组</option>
                  <option value="50">50 组</option>
                </select>
              </label>
            </div>
          </div>
          {selected.length > 0 && (
            <div className="product-selection">
              <strong>已选择 {selected.length} 项</strong>
              <button
                disabled={!controls.edit}
                onClick={() =>
                  open(
                    selected[0].productType,
                    selected[0].kind,
                    selected[0].code,
                  )
                }
              >
                {canWrite ? "编辑" : "查看"}
              </button>
              <button disabled={!canWrite || !controls.delete} onClick={remove}>
                删除
              </button>
              <button onClick={() => setSelected([])}>取消选择</button>
              {!controls.delete && <span>系列与 SKU 请分别选择操作</span>}
            </div>
          )}
          {loading && (
            <p className="product-loading" role="status">
              正在更新列表…
            </p>
          )}
          <div className="product-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>产品 / 系列</th>
                  <th>类目</th>
                  <th>规格信息</th>
                  <th>零售价格</th>
                  <th>发布状态</th>
                  <th>待处理</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {props.page.items.flatMap((g) => [
                  row(g.item, g.children, false, g.totalChildren),
                  ...(expanded.includes(key(g.item))
                    ? g.children.map((c) => row(c, [], true))
                    : []),
                ])}
              </tbody>
            </table>
          </div>
          {!props.page.items.length && (
            <div className="product-empty">
              <strong>没有找到符合条件的产品</strong>
              <p>试试其他 SKU、系列名称，或减少筛选条件。</p>
              {filtered && (
                <button onClick={() => void navigate(location.pathname)}>
                  清空筛选
                </button>
              )}
            </div>
          )}
          <nav className="product-pagination" aria-label="产品分页">
            <span>
              共 {props.page.total} 组 · 第 {props.page.page} /{" "}
              {props.page.pages} 页
            </span>
            <div>
              {props.page.page > 1 ? (
                <Link to={pageHref(props.page.page - 1)}>← 上一页</Link>
              ) : (
                <span aria-disabled="true">← 上一页</span>
              )}
              {props.page.page < props.page.pages ? (
                <Link to={pageHref(props.page.page + 1)}>下一页 →</Link>
              ) : (
                <span aria-disabled="true">下一页 →</span>
              )}
            </div>
          </nav>
        </section>
        {addOpen && (
          <Modal title="新增产品" onClose={() => setAddOpen(false)}>
            <p className="product-modal-intro">
              先选择产品类目，再填写规格、价格和发布状态。
            </p>
            <div className="product-add-types">
              {commercialProductTypes.map((t, i) => (
                <button
                  key={t}
                  aria-pressed={addType === t}
                  onClick={() => {
                    setAddType(t);
                    setAddKind("sku");
                  }}
                >
                  <span>0{i + 1}</span>
                  <strong>{productTypeLabels[t]}</strong>
                  <small>
                    {t === "hose" || t === "hose_end"
                      ? "支持系列与 SKU"
                      : "新增 SKU 产品"}
                  </small>
                </button>
              ))}
            </div>
            {(addType === "hose" || addType === "hose_end") && (
              <fieldset className="product-add-kind">
                <legend>新增内容</legend>
                <label>
                  <input
                    type="radio"
                    name="addKind"
                    checked={addKind === "sku"}
                    onChange={() => setAddKind("sku")}
                  />
                  SKU 子体 <small>在已有系列下增加规格</small>
                </label>
                <label>
                  <input
                    type="radio"
                    name="addKind"
                    checked={addKind === "series"}
                    onChange={() => setAddKind("series")}
                  />
                  产品系列 <small>先建立系列，再添加 SKU</small>
                </label>
              </fieldset>
            )}
            <footer>
              <button onClick={() => setAddOpen(false)}>取消</button>
              <button
                className="product-primary"
                onClick={() => open(addType, addKind)}
              >
                下一步：填写资料 →
              </button>
            </footer>
          </Modal>
        )}
        {editorOpen && (editor.state !== "idle" || !editor.data) && (
          <Modal title="加载产品资料" onClose={() => setEditorOpen(false)}>
            <p role="status" className="product-loading">
              正在读取规格、价格和可选系列…
            </p>
          </Modal>
        )}
        {editorOpen && editor.state === "idle" && editor.data && (
          <ProductEditor
            key={editor.data.commandId}
            editor={{
              ...editor.data,
              canEdit: editor.data.canEdit && props.state.mode === "items",
            }}
            onClose={() => setEditorOpen(false)}
            error={mutation.data?.error ?? null}
            busy={busy}
            submit={(form) =>
              void mutation.submit(form, {
                method: "post",
                encType: "multipart/form-data",
              })
            }
          />
        )}
        {deleteOpen && (
          <Modal title="确认删除" onClose={() => setDeleteOpen(false)}>
            {plan.state !== "idle" ? (
              <p>正在检查影响…</p>
            ) : plan.data?.deletionPlan ? (
              <>
                <p>
                  已选择 {selected.length} 项，将处理{" "}
                  {plan.data.deletionPlan.targets.length} 个系列/产品和{" "}
                  {plan.data.deletionPlan.requestIds.length}{" "}
                  个待审核请求。历史记录保留。
                </p>
                {plan.data.deletionPlan.blockers > 0 && (
                  <p role="alert">
                    有 {plan.data.deletionPlan.blockers}{" "}
                    个上线子体或有效依赖阻止删除。
                  </p>
                )}
                <ul>
                  {plan.data.deletionPlan.targets.map((t) => (
                    <li key={key(t)}>
                      {t.code} · {stateLabels[t.state]}
                    </li>
                  ))}
                </ul>
                <button
                  disabled={busy || plan.data.deletionPlan.blockers > 0}
                  onClick={() =>
                    void mutation.submit(
                      {
                        intent: "delete",
                        commandId: deleteId,
                        selected: JSON.stringify(selected),
                      },
                      { method: "post" },
                    )
                  }
                >
                  确认删除
                </button>
              </>
            ) : (
              <p>无法读取删除影响。</p>
            )}
          </Modal>
        )}
      </main>
    </div>
  );
}
