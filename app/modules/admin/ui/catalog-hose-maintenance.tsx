import { Image, Pencil, Plus, Save, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Form, Link } from "react-router";

import { reviewedHoseSeriesImageKeys } from "../../catalog/domain/catalog-main-image";
import type {
  HoseSeriesRecord,
  HoseVariantRecord,
} from "../../catalog/domain/catalog-hose-maintenance";
import {
  productLifecycleLabels,
  productLifecycleStatuses,
} from "../../catalog/domain/catalog-product-lifecycle";
import type { CatalogImportValidationResult } from "../../catalog/domain/catalog-workbook";

const maintenanceBase = "/admin/catalog/import?mode=manual&productType=hose";

function value(input: string | number | null | undefined) {
  return input === null || input === undefined ? "" : String(input);
}

function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);
  return ref;
}

function Field({
  defaultValue,
  label,
  name,
  required = false,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  required?: boolean;
  type?: "number" | "text";
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        defaultValue={value(defaultValue)}
        name={name}
        required={required}
        step={type === "number" ? "any" : undefined}
        type={type}
      />
    </label>
  );
}

export function HoseMaintenanceActions() {
  return (
    <div aria-label="Hose maintenance / 胶管维护" role="group">
      <details className="catalog-product-action-menu">
        <summary>Hose / 胶管</summary>
        <div className="catalog-product-action-menu-items">
          <Link to={`${maintenanceBase}&manualAction=series`}>
            <Plus aria-hidden="true" size={16} /> Add Series / 增加系列
          </Link>
          <Link to={`${maintenanceBase}&manualAction=variant`}>
            <Plus aria-hidden="true" size={16} /> Add Variant / 增加子体
          </Link>
        </div>
      </details>
    </div>
  );
}

function Feedback({
  findings,
  formError,
}: {
  findings: CatalogImportValidationResult[];
  formError: string | null;
}) {
  if (!formError && findings.length === 0) return null;
  return (
    <div className="catalog-manual-findings" role="alert">
      <strong>Correct the highlighted information / 请更正以下信息</strong>
      {formError ? <p>{formError}</p> : null}
      {findings.length > 0 ? (
        <ul>
          {findings.map((finding, index) => (
            <li key={`${finding.code}-${finding.field}-${index}`}>
              <strong>{finding.field}</strong>: {finding.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SeriesImageFields({ series }: { series: HoseSeriesRecord | null }) {
  return (
    <fieldset>
      <legend>Representative Image / 系列代表图</legend>
      <p>
        Select an approved image or upload JPEG, PNG, or WebP /
        选择已审核图片，或上传 JPEG、PNG、WebP
      </p>
      <div className="catalog-main-image-field">
        <Image aria-hidden="true" size={20} />
        <label>
          <span>Representative Image / 系列代表图</span>
          <select
            defaultValue={series?.representativeImageReference ?? ""}
            name="mainImageReference"
          >
            <option value="">Select or upload / 选择或上传</option>
            {series?.representativeImageReference.startsWith(
              "media-version:",
            ) ? (
              <option value={series.representativeImageReference}>
                Current uploaded image / 当前上传图片
              </option>
            ) : null}
            {reviewedHoseSeriesImageKeys.map((seriesCode) => (
              <option key={seriesCode} value={`hose-series:${seriesCode}`}>
                {seriesCode} reviewed image / 已审核图片
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="catalog-manual-fields">
        <label>
          <span>Upload Image / 上传图片</span>
          <input
            accept="image/jpeg,image/png,image/webp"
            name="mainImageUpload"
            type="file"
          />
        </label>
      </div>
    </fieldset>
  );
}

function SeriesModal({
  findings,
  formError,
  selectedSeries,
}: {
  findings: CatalogImportValidationResult[];
  formError: string | null;
  selectedSeries: HoseSeriesRecord | null;
}) {
  const editMode = Boolean(selectedSeries);
  const dialogRef = useModalDialog();
  return (
    <dialog
      aria-labelledby="hose-series-dialog-title"
      aria-modal="true"
      className="catalog-maintenance-dialog"
      ref={dialogRef}
    >
      <div className="catalog-maintenance-dialog-header">
        <div>
          <span className="eyebrow">Hose Series / 胶管系列</span>
          <h2 id="hose-series-dialog-title">
            {editMode
              ? "Edit Hose Series / 编辑胶管系列"
              : "Add Hose Series / 增加胶管系列"}
          </h2>
        </div>
        <Link aria-label="Close / 关闭" to={maintenanceBase}>
          <X aria-hidden="true" size={20} />
        </Link>
      </div>
      <p>
        Fields marked required must be completed before saving /
        标记为必填的字段必须填写后才能保存
      </p>
      <Feedback findings={findings} formError={formError} />
      <Form
        className="catalog-manual-form"
        encType="multipart/form-data"
        method="post"
        noValidate
      >
        <input name="intent" type="hidden" value="maintain_hose_series" />
        <input name="mode" type="hidden" value={editMode ? "edit" : "create"} />
        <input
          name="originalSeriesCode"
          type="hidden"
          value={selectedSeries?.seriesCode ?? ""}
        />
        <input
          name="currentMainImageReference"
          type="hidden"
          value={selectedSeries?.representativeImageReference ?? ""}
        />
        <fieldset>
          <legend>Series Data / 系列资料</legend>
          <div className="catalog-manual-fields">
            <label>
              <span>Series Code / 系列编号</span>
              <input
                defaultValue={selectedSeries?.seriesCode ?? ""}
                name="series.seriesCode"
                readOnly={editMode}
                required
              />
            </label>
            <Field
              defaultValue={selectedSeries?.seriesName}
              label="Series Name / 系列名称"
              name="series.seriesName"
              required
            />
            <Field
              defaultValue={selectedSeries?.primaryStandard}
              label="Primary Standard / 主标准"
              name="series.primaryStandard"
              required
            />
            <Field
              defaultValue={selectedSeries?.equivalentStandard}
              label="Equivalent Standard / 等效标准"
              name="series.equivalentStandard"
              required
            />
            <Field
              defaultValue={selectedSeries?.tempMinC}
              label="Temp Min °C / 最低温度"
              name="series.tempMinC"
              required
              type="number"
            />
            <Field
              defaultValue={selectedSeries?.tempMaxC}
              label="Temp Max °C / 最高温度"
              name="series.tempMaxC"
              required
              type="number"
            />
            <Field
              defaultValue={selectedSeries?.tubeMaterial}
              label="Tube Material / 内胶材料"
              name="series.tubeMaterial"
            />
            <Field
              defaultValue={selectedSeries?.reinforcement}
              label="Reinforcement / 增强层"
              name="series.reinforcement"
            />
            <Field
              defaultValue={selectedSeries?.coverMaterial}
              label="Cover Material / 外胶材料"
              name="series.coverMaterial"
            />
            <Field
              defaultValue={selectedSeries?.coverColor}
              label="Cover Color / 外胶颜色"
              name="series.coverColor"
            />
            <Field
              defaultValue={selectedSeries?.coverFinish}
              label="Cover Finish / 表面"
              name="series.coverFinish"
            />
            <Field
              defaultValue={selectedSeries?.fluidCompatibility}
              label="Fluid Compatibility / 介质兼容"
              name="series.fluidCompatibility"
            />
          </div>
        </fieldset>
        <SeriesImageFields series={selectedSeries} />
        <div className="catalog-manual-actions">
          <Link className="button button-secondary" to={maintenanceBase}>
            Cancel / 取消
          </Link>
          <button className="button button-primary" type="submit">
            <Save aria-hidden="true" size={17} /> Save Series / 保存系列
          </button>
        </div>
      </Form>
    </dialog>
  );
}

function VariantModal({
  findings,
  formError,
  series,
  variant,
}: {
  findings: CatalogImportValidationResult[];
  formError: string | null;
  series: HoseSeriesRecord[];
  variant: HoseVariantRecord | null;
}) {
  const editMode = Boolean(variant);
  const dialogRef = useModalDialog();
  return (
    <dialog
      aria-labelledby="hose-variant-dialog-title"
      aria-modal="true"
      className="catalog-maintenance-dialog"
      ref={dialogRef}
    >
      <div className="catalog-maintenance-dialog-header">
        <div>
          <span className="eyebrow">Hose Variant / 胶管子体</span>
          <h2 id="hose-variant-dialog-title">
            {editMode
              ? "Edit Hose Variant / 编辑胶管子体"
              : "Add Hose Variant / 增加胶管子体"}
          </h2>
        </div>
        <Link aria-label="Close / 关闭" to={maintenanceBase}>
          <X aria-hidden="true" size={20} />
        </Link>
      </div>
      <p>
        Shared technical data and the representative image come from the
        selected series / 共享技术参数和代表图来自所选系列
      </p>
      <Feedback findings={findings} formError={formError} />
      <Form
        className="catalog-manual-form"
        encType="multipart/form-data"
        method="post"
        noValidate
      >
        <input name="intent" type="hidden" value="maintain_hose_variant" />
        <input name="mode" type="hidden" value={editMode ? "edit" : "create"} />
        <input name="originalSku" type="hidden" value={variant?.sku ?? ""} />
        <input
          name="currentMainImageReference"
          type="hidden"
          value={variant?.imageOverrideReference ?? ""}
        />
        <fieldset>
          <legend>Variant Data / 子体资料</legend>
          <div className="catalog-manual-fields">
            <label>
              <span>Product Status / 产品状态</span>
              <select
                defaultValue={variant?.lifecycleStatus ?? "draft"}
                name="lifecycleStatus"
                required
              >
                {productLifecycleStatuses.map((status) => (
                  <option key={status} value={status}>
                    {productLifecycleLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Hose Series / 胶管系列</span>
              <select
                defaultValue={variant?.hoseSeries ?? ""}
                name="variant.hoseSeries"
                required
              >
                <option value="">Select Series / 选择系列</option>
                {series.map((item) => (
                  <option key={item.seriesCode} value={item.seriesCode}>
                    {item.seriesCode} · {item.seriesName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Hose SKU / 胶管SKU</span>
              <input
                defaultValue={variant?.sku ?? ""}
                name="variant.sku"
                readOnly={editMode}
                required
              />
            </label>
            <Field
              defaultValue={variant?.dash}
              label="Hose Dash / 胶管Dash"
              name="variant.dash"
              required
            />
            <Field
              defaultValue={variant?.nominalIdIn}
              label="Nominal ID in / 公称内径英寸"
              name="variant.nominalIdIn"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.idMm}
              label="ID mm / 内径毫米"
              name="variant.idMm"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.odMm}
              label="OD mm / 外径毫米"
              name="variant.odMm"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.workingBar}
              label="Working Pressure bar / 工作压力"
              name="variant.workingBar"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.workingPsi}
              label="Working Pressure psi / 工作压力"
              name="variant.workingPsi"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.burstBar}
              label="Minimum Burst bar / 最小爆破压力"
              name="variant.burstBar"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.bendRadiusMm}
              label="Min Bend Radius mm / 最小弯曲半径"
              name="variant.bendRadiusMm"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.weightKgM}
              label="Weight kg/m / 米重"
              name="variant.weightKgM"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.notes}
              label="Notes / 备注"
              name="variant.notes"
              required
            />
            <Field
              defaultValue={variant?.source}
              label="Source Document/Page / 来源文件页码"
              name="variant.source"
            />
            <label>
              <span>Technical Data Status / 技术资料状态</span>
              <select
                defaultValue={variant?.technicalDataStatus ?? ""}
                name="variant.technicalDataStatus"
              >
                <option value="">Not set / 未设置</option>
                <option value="Complete">Complete / 完整</option>
                <option value="Inherited">Inherited / 继承</option>
                <option value="Pending">Pending / 待补充</option>
              </select>
            </label>
            <Field
              defaultValue={variant?.mshaMarking}
              label="MSHA Marking / MSHA标识"
              name="variant.mshaMarking"
            />
            <Field
              defaultValue={variant?.skiveRequirement}
              label="Skive Requirement / 剥胶要求"
              name="variant.skiveRequirement"
            />
          </div>
        </fieldset>
        <fieldset>
          <legend>Variant Image Override / 子体图片覆盖</legend>
          <p>Leave blank to inherit the series image / 留空则继承系列代表图</p>
          <label>
            <span>Variant Image Override / 子体图片覆盖</span>
            <select
              defaultValue={variant?.imageOverrideReference ?? ""}
              name="mainImageReference"
            >
              <option value="">Inherit Series Image / 继承系列代表图</option>
              {variant?.imageOverrideReference?.startsWith("media-version:") ? (
                <option value={variant.imageOverrideReference}>
                  Current uploaded override / 当前上传覆盖图
                </option>
              ) : null}
              {reviewedHoseSeriesImageKeys.map((seriesCode) => (
                <option key={seriesCode} value={`hose-series:${seriesCode}`}>
                  {seriesCode} reviewed image / 已审核图片
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Upload Override / 上传覆盖图片</span>
            <input
              accept="image/jpeg,image/png,image/webp"
              name="mainImageUpload"
              type="file"
            />
          </label>
        </fieldset>
        <div className="catalog-manual-actions">
          <Link className="button button-secondary" to={maintenanceBase}>
            Cancel / 取消
          </Link>
          <button className="button button-primary" type="submit">
            <Save aria-hidden="true" size={17} /> Save Variant / 保存子体
          </button>
        </div>
      </Form>
    </dialog>
  );
}

export function CatalogHoseMaintenance({
  action,
  findings,
  formError,
  requestedSku,
  saved,
  selectedSeries,
  series,
  variant,
}: {
  action: "series" | "variant" | null;
  findings: CatalogImportValidationResult[];
  formError: string | null;
  requestedSku: string;
  saved: {
    identifier: string;
    kind: "series" | "variant";
    mode: "created" | "updated";
  } | null;
  selectedSeries: HoseSeriesRecord | null;
  series: HoseSeriesRecord[];
  variant: HoseVariantRecord | null;
}) {
  return (
    <section
      className="catalog-manual-panel"
      aria-labelledby="hose-maintenance-title"
    >
      <div className="catalog-manual-search">
        <div>
          <span className="eyebrow">Hose Maintenance / 胶管维护</span>
          <h2 id="hose-maintenance-title">
            Hose Series and Variants / 胶管系列和子体
          </h2>
          <p>
            Maintain series-owned data separately from exact SKU data /
            分别维护系列共享资料和具体SKU资料
          </p>
        </div>
        <Form method="get">
          <input name="mode" type="hidden" value="manual" />
          <input name="productType" type="hidden" value="hose" />
          <input name="manualAction" type="hidden" value="variant" />
          <label>
            <span>Exact Hose SKU / 精确胶管SKU</span>
            <input
              defaultValue={requestedSku}
              name="sku"
              placeholder="e.g. 601R1_001"
              type="search"
            />
          </label>
          <button className="button button-secondary" type="submit">
            <Search aria-hidden="true" size={17} /> Find Variant / 查找子体
          </button>
        </Form>
      </div>
      {saved ? (
        <p className="catalog-update-success" role="status">
          {saved.kind === "series" ? "Hose Series" : "Hose Variant"}{" "}
          {saved.identifier} saved to the Catalog draft / 已保存到产品目录草稿
        </p>
      ) : null}
      <div className="catalog-series-list">
        <h3>Existing Hose Series / 已有胶管系列</h3>
        <ul>
          {series.map((item) => (
            <li key={item.seriesCode}>
              <span>
                {item.seriesCode} · {item.seriesName}
              </span>
              <Link
                aria-label={`Edit ${item.seriesCode} / 编辑 ${item.seriesCode}`}
                to={`${maintenanceBase}&manualAction=series&series=${encodeURIComponent(item.seriesCode)}`}
              >
                <Pencil aria-hidden="true" size={15} /> Edit / 编辑
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {action === "series" ? (
        <SeriesModal
          findings={findings}
          formError={formError}
          selectedSeries={selectedSeries}
        />
      ) : null}
      {action === "variant" ? (
        <VariantModal
          findings={findings}
          formError={formError}
          series={series}
          variant={variant}
        />
      ) : null}
    </section>
  );
}
