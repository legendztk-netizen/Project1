import { useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { ArrowLeft, Download, FilePlus2, Plus, Trash2 } from "lucide-react";

import { piPrivateHeaders, piRouteId } from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  createShipmentDocumentsService,
  type ShipmentDocumentKind,
} from "../../shipment/application/shipment-documents-service";
import {
  changeCartonDimensionUnit,
  changeCartonWeightUnit,
  changeDivisorDimensionUnit,
  changeDivisorWeightUnit,
  type CartonGroup,
  type DimensionUnit,
  type ShipmentPackingDraft,
  type WeightUnit,
} from "../../shipment/domain/shipment-packing";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import "../../shipment/ui/shipment-documents.css";

export const headers = piPrivateHeaders;

const documentKinds: { value: ShipmentDocumentKind; label: string }[] = [
  { value: "packing_list", label: "装箱单" },
  { value: "readiness_evidence", label: "备货凭证" },
  { value: "inspection_evidence", label: "检验证明" },
  { value: "customs_file", label: "海关资料" },
  { value: "logistics_document", label: "物流文件" },
];

const blankCarton = (): CartonGroup => ({
  count: 1,
  dimensionUnit: "cm",
  length: null,
  width: null,
  height: null,
  weightUnit: "kg",
  grossWeight: null,
});

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : null;
}

async function adminError(error: unknown) {
  const message =
    error instanceof Response
      ? await error.text()
      : error instanceof Error
        ? error.message
        : "";
  if (error instanceof Response && error.status === 413)
    return "文件超过 10 MB 限制。";
  if (/Only PDF, PNG and JPEG/.test(message))
    return "仅支持 PDF、PNG 或 JPEG 文件。";
  if (/File must be between/.test(message))
    return "文件必须大于 0 字节且不超过 10 MB。";
  if (/Upload recovery required|Upload reservation expired/.test(message))
    return "上一次上传已中断，请重新选择文件并提交。";
  if (/Final packing cannot change after dispatch/.test(message))
    return "该批次已发货，最终装箱记录不能再修改。";
  if (/Packing record changed|Shipment document changed/.test(message))
    return "资料已被其他管理员更新，请刷新页面后重试。";
  if (/Command identity conflict/.test(message))
    return "此操作标识已用于另一项修改，请刷新页面后重试。";
  if (
    /positive measured value|positive whole number|supported measurement/.test(
      message,
    )
  )
    return "箱数、尺寸、重量或除数必须是有效的正数。";
  if (/all three carton dimensions/.test(message))
    return "请填写纸箱长、宽、高三项，或全部留空。";
  if (/No more than 100 carton groups/.test(message))
    return "纸箱组最多只能添加 100 组。";
  if (/Packing notes/.test(message)) return "内部装箱备注最多 2000 字。";
  if (/Explicit.*units/.test(message)) return "请选择有效的尺寸与重量单位。";
  if (error instanceof Response && error.status === 409)
    return "资料已被更新，请刷新页面后重试。";
  return "操作未完成，请检查填写内容后重试。";
}

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const orderId = piRouteId(params.orderId);
  const shipmentId = piRouteId(params.shipmentId);
  const search = new URL(request.url).searchParams;
  const workspace = await createShipmentDocumentsService(
    env.DB,
    env.PRIVATE_FILES,
  ).adminList(
    adminIdentity,
    orderId,
    shipmentId,
    Number(search.get("page") ?? 1),
  );
  return data(
    {
      orderId,
      shipmentId,
      workspace,
      commandId: crypto.randomUUID(),
      selectedTab:
        search.get("tab") === "files"
          ? ("files" as const)
          : ("packing" as const),
      saved: search.has("saved"),
    },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const orderId = piRouteId(params.orderId);
  const shipmentId = piRouteId(params.shipmentId);
  const service = createShipmentDocumentsService(env.DB, env.PRIVATE_FILES);
  const auditRequestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const auditIp = request.headers.get("cf-connecting-ip");
  let intent = "";
  try {
    const form = await readPrivateReviewForm(request);
    const text = (key: string) => String(form.get(key) ?? "");
    intent = text("intent");
    if (intent === "packing") {
      const draft = JSON.parse(text("packingJson")) as ShipmentPackingDraft;
      await service.savePacking(adminIdentity, {
        orderId,
        shipmentId,
        draft,
        expectedVersion: Number(text("expectedVersion")),
        commandId: text("commandId"),
        auditRequestId,
        auditIp,
      });
    } else if (intent === "upload") {
      const file = form.get("file");
      if (!(file instanceof File))
        throw new Response("请选择文件", { status: 400 });
      await service.upload(adminIdentity, {
        orderId,
        shipmentId,
        commandId: text("commandId"),
        kind: text("kind") as ShipmentDocumentKind,
        file,
        auditRequestId,
        auditIp,
      });
    } else if (intent === "visibility") {
      await service.changeVisibility(adminIdentity, {
        orderId,
        shipmentId,
        documentId: text("documentId"),
        expectedVersion: Number(text("expectedVersion")),
        commandId: text("commandId"),
        visibility: text("visibility") as "internal" | "customer_shared",
        auditRequestId,
        auditIp,
      });
    } else {
      throw new Response("Invalid operation", { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response && ![400, 409, 413].includes(error.status))
      throw error;
    const retryCommandId =
      error instanceof Response &&
      /Upload recovery required|Upload reservation expired/.test(
        await error.clone().text(),
      )
        ? crypto.randomUUID()
        : undefined;
    return data(
      {
        error: await adminError(error),
        retryCommandId,
      },
      { status: error instanceof Response ? error.status : 400 },
    );
  }
  const tab = intent === "packing" ? "packing" : "files";
  return redirect(
    `/admin/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(shipmentId)}?tab=${tab}&saved=1`,
  );
}

type LoaderData = Awaited<ReturnType<typeof loader>>["data"];

export default function ShipmentDocuments({
  loaderData,
  actionData,
}: {
  loaderData: LoaderData;
  actionData?: { error?: string; retryCommandId?: string };
}) {
  const { orderId, shipmentId, workspace, commandId } = loaderData;
  const [tab, setTab] = useState<"packing" | "files">(loaderData.selectedTab);
  const [cartons, setCartons] = useState<CartonGroup[]>(
    workspace.packing?.cartons ?? [],
  );
  const [notes, setNotes] = useState(workspace.packing?.notes ?? "");
  const [divisor, setDivisor] = useState<
    ShipmentPackingDraft["dimensionalDivisor"]
  >(workspace.packing?.dimensionalDivisor ?? null);
  const [divisorDimensionUnit, setDivisorDimensionUnit] =
    useState<DimensionUnit>(
      workspace.packing?.dimensionalDivisor?.dimensionUnit ?? "cm",
    );
  const [divisorWeightUnit, setDivisorWeightUnit] = useState<WeightUnit>(
    workspace.packing?.dimensionalDivisor?.weightUnit ?? "kg",
  );
  const busy = useNavigation().state !== "idle";
  useEffect(() => {
    setTab(loaderData.selectedTab);
    setCartons(workspace.packing?.cartons ?? []);
    setNotes(workspace.packing?.notes ?? "");
    setDivisor(workspace.packing?.dimensionalDivisor ?? null);
    setDivisorDimensionUnit(
      workspace.packing?.dimensionalDivisor?.dimensionUnit ?? "cm",
    );
    setDivisorWeightUnit(
      workspace.packing?.dimensionalDivisor?.weightUnit ?? "kg",
    );
  }, [loaderData.selectedTab, workspace.packing?.version]);
  const patchCarton = (index: number, patch: Partial<CartonGroup>) =>
    setCartons((current) =>
      current.map((carton, at) =>
        at === index ? { ...carton, ...patch } : carton,
      ),
    );
  const base = `/admin/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(shipmentId)}`;

  return (
    <div className="admin-shell">
      <AdminNavigation active="orders" />
      <main className="admin-main shipment-documents-page">
        <Link
          to={`/admin/orders/${encodeURIComponent(orderId)}`}
          className="admin-back-link"
        >
          <ArrowLeft size={18} aria-hidden="true" /> 返回订单详情
        </Link>
        <p className="shipment-documents-eyebrow">
          第 {workspace.shipment.sequenceNumber} 批发货
        </p>
        <h1>{workspace.shipment.displayName}</h1>
        <div
          className="shipment-documents-tabs"
          role="tablist"
          aria-label="批次资料"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "packing"}
            aria-controls="shipment-packing-panel"
            onClick={() => setTab("packing")}
          >
            实际装箱
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            aria-controls="shipment-files-panel"
            onClick={() => setTab("files")}
          >
            批次文件
          </button>
        </div>
        {actionData?.error && (
          <p role="alert" className="shipment-documents-error">
            {actionData.error}
          </p>
        )}
        {loaderData.saved && !actionData?.error && (
          <p role="status" className="shipment-documents-saved">
            已保存
          </p>
        )}
        {tab === "packing" && (
          <section
            id="shipment-packing-panel"
            role="tabpanel"
            className="shipment-documents-panel"
          >
            <div className="shipment-documents-section-title">
              <h2>纸箱记录</h2>
              <button
                className="button"
                type="button"
                onClick={() =>
                  setCartons((current) => [...current, blankCarton()])
                }
                disabled={cartons.length >= 100}
              >
                <Plus size={17} /> 添加同规格纸箱组
              </button>
            </div>
            <Form method="post" className="shipment-packing-form">
              <input type="hidden" name="intent" value="packing" />
              <input type="hidden" name="commandId" value={commandId} />
              <input
                type="hidden"
                name="expectedVersion"
                value={workspace.packing?.version ?? 0}
              />
              <input
                type="hidden"
                name="packingJson"
                value={JSON.stringify({
                  cartons,
                  dimensionalDivisor: divisor,
                  notes,
                })}
              />
              {cartons.length === 0 && (
                <p>尚未记录纸箱。也可以只上传外部装箱单。</p>
              )}
              {cartons.map((carton, index) => (
                <fieldset key={index} className="shipment-carton-group">
                  <legend>纸箱组 {index + 1}</legend>
                  <div className="shipment-carton-grid">
                    <label>
                      箱数
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={carton.count}
                        onChange={(event) =>
                          patchCarton(index, {
                            count: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      尺寸单位
                      <select
                        value={carton.dimensionUnit}
                        onChange={(event) =>
                          patchCarton(
                            index,
                            changeCartonDimensionUnit(
                              carton,
                              event.target
                                .value as CartonGroup["dimensionUnit"],
                            ),
                          )
                        }
                      >
                        <option value="cm">cm</option>
                        <option value="in">in</option>
                      </select>
                    </label>
                    <label>
                      重量单位
                      <select
                        value={carton.weightUnit}
                        onChange={(event) =>
                          patchCarton(
                            index,
                            changeCartonWeightUnit(
                              carton,
                              event.target.value as CartonGroup["weightUnit"],
                            ),
                          )
                        }
                      >
                        <option value="kg">kg</option>
                        <option value="lb">lb</option>
                      </select>
                    </label>
                    {(["length", "width", "height"] as const).map((field) => (
                      <label key={field}>
                        {{ length: "长", width: "宽", height: "高" }[field]} (
                        {carton.dimensionUnit})
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={carton[field] ?? ""}
                          onChange={(event) =>
                            patchCarton(index, {
                              [field]: optionalNumber(event.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      毛重 ({carton.weightUnit} / 箱)
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        value={carton.grossWeight ?? ""}
                        onChange={(event) =>
                          patchCarton(index, {
                            grossWeight: optionalNumber(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="shipment-carton-remove"
                    title="移除纸箱组"
                    aria-label={`移除纸箱组 ${index + 1}`}
                    onClick={() =>
                      setCartons((current) =>
                        current.filter((_, at) => at !== index),
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </fieldset>
              ))}
              <div className="shipment-divisor-section">
                <h3>体积重除数（可选）</h3>
                <div className="shipment-divisor-grid">
                  <label>
                    除数
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      value={divisor?.value ?? ""}
                      onChange={(event) => {
                        const value = optionalNumber(event.target.value);
                        setDivisor(
                          value === null
                            ? null
                            : {
                                value,
                                dimensionUnit: divisorDimensionUnit,
                                weightUnit: divisorWeightUnit,
                              },
                        );
                      }}
                    />
                  </label>
                  <label>
                    体积单位
                    <select
                      value={divisorDimensionUnit}
                      onChange={(event) => {
                        const unit = event.target.value as DimensionUnit;
                        setDivisorDimensionUnit(unit);
                        setDivisor((current) =>
                          current
                            ? changeDivisorDimensionUnit(current, unit)
                            : null,
                        );
                      }}
                    >
                      <option value="cm">cm³</option>
                      <option value="in">in³</option>
                    </select>
                  </label>
                  <label>
                    重量单位
                    <select
                      value={divisorWeightUnit}
                      onChange={(event) => {
                        const unit = event.target.value as WeightUnit;
                        setDivisorWeightUnit(unit);
                        setDivisor((current) =>
                          current
                            ? changeDivisorWeightUnit(current, unit)
                            : null,
                        );
                      }}
                    >
                      <option value="kg">kg</option>
                      <option value="lb">lb</option>
                    </select>
                  </label>
                </div>
              </div>
              <label className="shipment-packing-notes">
                内部装箱备注
                <textarea
                  value={notes}
                  maxLength={2000}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
              {workspace.packing && (
                <p className="shipment-packing-totals">
                  已记录 {workspace.packing.totals.cartonCount} 箱 · 毛重{" "}
                  {workspace.packing.totals.grossKg === null
                    ? "未记录"
                    : `${workspace.packing.totals.grossKg.toFixed(2)} kg`}{" "}
                  · 体积重{" "}
                  {workspace.packing.totals.dimensionalKg === null
                    ? "未计算"
                    : `${workspace.packing.totals.dimensionalKg.toFixed(2)} kg`}
                </p>
              )}
              <button
                type="submit"
                className="button button-primary"
                disabled={busy}
              >
                {busy ? "保存中…" : "保存装箱记录"}
              </button>
            </Form>
          </section>
        )}
        {tab === "files" && (
          <section
            id="shipment-files-panel"
            role="tabpanel"
            className="shipment-documents-panel"
          >
            <h2>上传批次文件</h2>
            <Form
              method="post"
              encType="multipart/form-data"
              className="shipment-file-upload"
            >
              <input type="hidden" name="intent" value="upload" />
              <input
                type="hidden"
                name="commandId"
                value={actionData?.retryCommandId ?? commandId}
              />
              <label>
                文件类别
                <select name="kind">
                  {documentKinds.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                文件（PDF、PNG 或 JPEG；不超过 10 MB）
                <input
                  name="file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  required
                />
              </label>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy}
              >
                <FilePlus2 size={17} /> {busy ? "上传中…" : "上传为内部文件"}
              </button>
            </Form>
            <h2>已上传文件</h2>
            {workspace.documents.length === 0 ? (
              <p>暂无批次文件。</p>
            ) : (
              <ul className="shipment-document-list">
                {workspace.documents.map((document) => (
                  <li key={document.id}>
                    <div>
                      <strong>{document.filename}</strong>
                      <span>
                        {
                          documentKinds.find(
                            (kind) => kind.value === document.kind,
                          )?.label
                        }
                      </span>
                    </div>
                    <span
                      className={
                        document.visibility === "customer_shared"
                          ? "shared"
                          : "internal"
                      }
                    >
                      {document.visibility === "customer_shared"
                        ? "客户可见"
                        : "仅内部"}
                    </span>
                    <div className="shipment-document-actions">
                      <Link
                        className="button"
                        reloadDocument
                        to={`${base}/documents/${encodeURIComponent(document.id)}/download`}
                      >
                        <Download size={16} /> 下载
                      </Link>
                      <Form method="post">
                        <input type="hidden" name="intent" value="visibility" />
                        <input
                          type="hidden"
                          name="commandId"
                          value={commandId}
                        />
                        <input
                          type="hidden"
                          name="documentId"
                          value={document.id}
                        />
                        <input
                          type="hidden"
                          name="expectedVersion"
                          value={document.version}
                        />
                        <input
                          type="hidden"
                          name="visibility"
                          value={
                            document.visibility === "customer_shared"
                              ? "internal"
                              : "customer_shared"
                          }
                        />
                        <button
                          type="submit"
                          className="button"
                          disabled={busy}
                        >
                          {document.visibility === "customer_shared"
                            ? "撤销共享"
                            : "共享给客户"}
                        </button>
                      </Form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {(workspace.documentPage > 1 || workspace.hasMoreDocuments) && (
              <nav
                className="shipment-document-pagination"
                aria-label="批次文件分页"
              >
                {workspace.documentPage > 1 && (
                  <Link
                    to={`${base}?tab=files&page=${workspace.documentPage - 1}`}
                  >
                    上一页
                  </Link>
                )}
                <span>第 {workspace.documentPage} 页</span>
                {workspace.hasMoreDocuments && (
                  <Link
                    to={`${base}?tab=files&page=${workspace.documentPage + 1}`}
                  >
                    下一页
                  </Link>
                )}
              </nav>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
