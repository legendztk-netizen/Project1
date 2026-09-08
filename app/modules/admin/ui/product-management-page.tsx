import { useEffect, useRef, useState } from "react";
import { Form, Link, useFetcher, useLocation } from "react-router";
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
import { selectionActions } from "../../catalog/domain/catalog-product-management";
import type {
  ManagedProduct,
  ProductSelection,
} from "../../catalog/infrastructure/d1-product-management-repository";
import type { CatalogFieldContract } from "../../catalog/domain/catalog-workbook";
import "../styles/product-management.css";
type PageData = Awaited<ReturnType<typeof pageLoader>>;
type EditorData = Awaited<ReturnType<typeof editorLoader>>;
const key = (r: ProductSelection) => `${r.productType}:${r.kind}:${r.code}`;
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
      {field.header}
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
          submit(new FormData(e.currentTarget));
        }}
      >
        {error && <p role="alert">{error}</p>}
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
              提交
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
export function ProductManagementPage(props: PageData) {
  const location = useLocation();
  const editor = useFetcher<typeof editorLoader>();
  const mutation = useFetcher<typeof action>();
  const plan = useFetcher<typeof pageLoader>();
  const [selected, setSelected] = useState<ProductSelection[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  useEffect(() => {
    setSelected([]);
    setExpanded([]);
  }, [location.search]);
  useEffect(() => {
    if (mutation.state === "idle" && mutation.data?.ok) {
      setEditorOpen(false);
      setDeleteOpen(false);
      setSelected([]);
    }
  }, [mutation.state, mutation.data]);
  const controls = selectionActions(selected);
  const busy = mutation.state !== "idle";
  function open(
    type: CommercialProductType,
    kind: "series" | "sku",
    code = "",
  ) {
    setEditorOpen(true);
    setMenu(false);
    void editor.load(
      `/admin/catalog/product-editor?type=${type}&kind=${kind}&code=${encodeURIComponent(code)}`,
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
  function row(r: ManagedProduct, child = false) {
    return (
      <tr key={key(r)} className={child ? "product-child" : ""}>
        <td>
          <input
            type="checkbox"
            aria-label={`选择${r.kind === "series" ? "系列" : "SKU"} ${r.code}`}
            checked={selected.some((s) => key(s) === key(r))}
            onChange={() => toggle(r)}
          />
        </td>
        <td>
          {r.kind === "series" && (
            <button
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
              {expanded.includes(key(r)) ? "▾" : "▸"}
            </button>
          )}
          {r.imageId && (
            <img
              alt=""
              src={`/media/catalog/${encodeURIComponent(r.imageId)}/thumbnail`}
            />
          )}
          <strong>{r.name}</strong>
        </td>
        <td>{productTypeLabels[r.productType]}</td>
        <td>{r.kind === "sku" ? r.dimensions : "系列"}</td>
        <td>
          {r.amount === null
            ? "—"
            : `${r.currency} ${r.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}`}
        </td>
        <td>
          {stateLabels[r.state] ?? r.state}
          {r.assemblyPending && <span> · 总成待更新</span>}
        </td>
        <td>
          <button
            type="button"
            onClick={() => open(r.productType, r.kind, r.code)}
          >
            更多
          </button>
        </td>
      </tr>
    );
  }
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="imports" maintenanceMode="manual" />
      <main className="product-management">
        <header>
          <span className="eyebrow">产品数据维护</span>
          <h1>管理所有产品</h1>
          <p>按系列与子体管理产品，提交后按所选状态生效。</p>
        </header>
        {props.state.mode === "legacy" && (
          <aside role="status">
            <p>当前为旧目录模式。新产品管理在隔离环境启用后可直接发布。</p>
            {props.canEnable && props.canEdit && (
              <mutation.Form method="post">
                <button name="intent" value="enable">
                  启用本环境条目发布
                </button>
              </mutation.Form>
            )}
          </aside>
        )}
        <section className="product-management-toolbar">
          <Form method="get">
            <fieldset>
              <legend>产品小类（不选即全部）</legend>
              {commercialProductTypes.map((t) => (
                <label key={t}>
                  <input
                    type="checkbox"
                    name="type"
                    value={t}
                    defaultChecked={props.types.includes(t)}
                  />
                  {productTypeLabels[t]}
                </label>
              ))}
            </fieldset>
            <label>
              SKU 模糊查询
              <input name="q" defaultValue={props.query} />
            </label>
            <label>
              每页
              <select name="size" defaultValue={props.pageSize}>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </label>
            <button>筛选</button>
          </Form>
          <div className="product-actions">
            <div
              className="product-add-menu"
              onMouseEnter={() => setMenu(true)}
              onMouseLeave={() => setMenu(false)}
              onFocus={() => setMenu(true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setMenu(false);
              }}
            >
              <button
                type="button"
                aria-expanded={menu}
                aria-haspopup="true"
                disabled={!props.canEdit || props.state.mode !== "items"}
                onClick={() => setMenu(true)}
              >
                新增
              </button>
              {menu && props.canEdit && props.state.mode === "items" && (
                <div className="product-add-options">
                  {commercialProductTypes.map((t) => (
                    <div key={t}>
                      <strong>{productTypeLabels[t]}</strong>
                      {t === "hose" || t === "hose_end" ? (
                        <>
                          <button onClick={() => open(t, "series")}>
                            增加系列
                          </button>
                          <button onClick={() => open(t, "sku")}>
                            增加子体
                          </button>
                        </>
                      ) : (
                        <button onClick={() => open(t, "sku")}>新增产品</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
              {props.canEdit ? "编辑" : "查看"}
            </button>
            <button
              disabled={
                !props.canEdit ||
                !controls.delete ||
                props.state.mode !== "items"
              }
              onClick={remove}
            >
              删除
            </button>
          </div>
        </section>
        {mutation.data?.error && <p role="alert">{mutation.data.error}</p>}
        {mutation.data?.ok && <p role="status">{mutation.data.result}</p>}
        <p>
          {props.page.total} 个一级项目 · 已选择 {selected.length} 项
        </p>
        <div className="product-table-scroll">
          <table>
            <thead>
              <tr>
                <th>选择</th>
                <th>系列 / SKU</th>
                <th>类目</th>
                <th>关键尺寸</th>
                <th>当前零售价格</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.page.items.flatMap((g) => [
                row(g.item),
                ...(expanded.includes(key(g.item))
                  ? g.children.map((c) => row(c, true))
                  : []),
              ])}
            </tbody>
          </table>
        </div>
        {!props.page.items.length && <p>没有符合条件的产品。</p>}
        <nav aria-label="产品分页">
          {props.page.page > 1 && (
            <Link to={pageHref(props.page.page - 1)}>上一页</Link>
          )}
          <span>
            第 {props.page.page} / {props.page.pages} 页
          </span>
          {props.page.page < props.page.pages && (
            <Link to={pageHref(props.page.page + 1)}>下一页</Link>
          )}
        </nav>
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
            submit={(form) => void mutation.submit(form, { method: "post" })}
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
