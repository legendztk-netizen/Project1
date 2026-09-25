import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Form, Link } from "react-router";
import { Download, FilePlus2, Plus, Trash2 } from "lucide-react";
import type {
  createShipmentDocumentsService,
  ShipmentDocumentKind,
} from "../application/shipment-documents-service";
import {
  changeCartonDimensionUnit,
  changeCartonWeightUnit,
  changeDivisorDimensionUnit,
  changeDivisorWeightUnit,
  type CartonGroup,
  type DimensionUnit,
  type ShipmentPackingDraft,
  type WeightUnit,
} from "../domain/shipment-packing";
import "./shipment-documents.css";

export type AdminShipmentDocumentsData = {
  orderId: string;
  shipmentId: string;
  workspace: Awaited<
    ReturnType<ReturnType<typeof createShipmentDocumentsService>["adminList"]>
  >;
  commandId: string;
  selectedTab: "packing" | "files";
  saved: boolean;
};

export const documentKinds: { value: ShipmentDocumentKind; label: string }[] = [
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

type FormLike = ComponentType<{
  method: "post";
  encType?: "multipart/form-data";
  className?: string;
  children: ReactNode;
}>;

export function AdminShipmentDocumentsWorkspace({
  loaderData,
  actionData,
  busy,
  FormComponent = Form as FormLike,
  hiddenFields,
  onPageChange,
}: {
  loaderData: AdminShipmentDocumentsData;
  actionData?: { error?: string; retryCommandId?: string };
  busy: boolean;
  FormComponent?: FormLike;
  hiddenFields?: ReactNode;
  onPageChange?: (page: number) => void;
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
  const pageLink = (page: number, label: string) =>
    onPageChange ? (
      <button
        type="button"
        className="shipment-link-button"
        onClick={() => onPageChange(page)}
      >
        {label}
      </button>
    ) : (
      <Link to={`${base}?tab=files&page=${page}`}>{label}</Link>
    );

  return (
    <>
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
          <FormComponent method="post" className="shipment-packing-form">
            {hiddenFields}
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
                            event.target.value as CartonGroup["dimensionUnit"],
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
                        current ? changeDivisorWeightUnit(current, unit) : null,
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
          </FormComponent>
        </section>
      )}
      {tab === "files" && (
        <section
          id="shipment-files-panel"
          role="tabpanel"
          className="shipment-documents-panel"
        >
          <h2>上传批次文件</h2>
          <FormComponent
            method="post"
            encType="multipart/form-data"
            className="shipment-file-upload"
          >
            {hiddenFields}
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
          </FormComponent>
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
                    <FormComponent method="post">
                      {hiddenFields}
                      <input type="hidden" name="intent" value="visibility" />
                      <input type="hidden" name="commandId" value={commandId} />
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
                      <button type="submit" className="button" disabled={busy}>
                        {document.visibility === "customer_shared"
                          ? "撤销共享"
                          : "共享给客户"}
                      </button>
                    </FormComponent>
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
              {workspace.documentPage > 1 &&
                pageLink(workspace.documentPage - 1, "上一页")}
              <span>第 {workspace.documentPage} 页</span>
              {workspace.hasMoreDocuments &&
                pageLink(workspace.documentPage + 1, "下一页")}
            </nav>
          )}
        </section>
      )}
    </>
  );
}
