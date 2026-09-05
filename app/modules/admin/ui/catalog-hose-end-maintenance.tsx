import { Image, Pencil, Plus, Save, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Form, Link } from "react-router";

import { reviewedHoseEndImageKeys } from "../../catalog/domain/catalog-main-image";
import type {
  HoseEndSeriesRecord,
  HoseEndVariantRecord,
} from "../../catalog/domain/catalog-hose-end-maintenance";
import {
  productLifecycleLabels,
  productLifecycleStatuses,
} from "../../catalog/domain/catalog-product-lifecycle";
import type { CatalogImportValidationResult } from "../../catalog/domain/catalog-workbook";

const maintenanceBase =
  "/admin/catalog/import?mode=manual&productType=hose_end";

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

export function HoseEndMaintenanceActions() {
  return (
    <div aria-label="Hose End maintenance / 压接接头维护" role="group">
      <details className="catalog-product-action-menu">
        <summary
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            const details = event.currentTarget.parentElement;
            if (details instanceof HTMLDetailsElement) {
              details.open = !details.open;
            }
          }}
        >
          Hose End / 压接接头
        </summary>
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

function ReviewedImageSelect({
  currentReference,
  inherit,
  label,
}: {
  currentReference: string | null;
  inherit: boolean;
  label: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select defaultValue={currentReference ?? ""} name="mainImageReference">
        <option value="">
          {inherit
            ? "Inherit Series Image / 继承系列代表图"
            : "Select or upload / 选择或上传"}
        </option>
        {currentReference?.startsWith("media-version:") ? (
          <option value={currentReference}>
            {inherit
              ? "Current uploaded override / 当前上传覆盖图"
              : "Current uploaded image / 当前上传图片"}
          </option>
        ) : null}
        {reviewedHoseEndImageKeys.map((mediaKey) => (
          <option key={mediaKey} value={`hose-end-shape:${mediaKey}`}>
            {mediaKey} / 已审核图片
          </option>
        ))}
      </select>
    </label>
  );
}

function ImageFields({
  currentReference,
  inherit = false,
}: {
  currentReference: string | null;
  inherit?: boolean;
}) {
  const label = inherit
    ? "Variant Image Override / 子体图片覆盖"
    : "Representative Image / 系列代表图";
  return (
    <fieldset>
      <legend>{label}</legend>
      <p>
        {inherit
          ? "Leave blank to inherit the series image / 留空则继承系列代表图"
          : "Select a reviewed image or upload JPEG, PNG, or WebP / 选择已审核图片，或上传 JPEG、PNG、WebP"}
      </p>
      <div className="catalog-main-image-field">
        <Image aria-hidden="true" size={20} />
        <ReviewedImageSelect
          currentReference={currentReference}
          inherit={inherit}
          label={label}
        />
      </div>
      <label>
        <span>
          {inherit ? "Upload Override / 上传覆盖图" : "Upload Image / 上传图片"}
        </span>
        <input
          accept="image/jpeg,image/png,image/webp"
          name="mainImageUpload"
          type="file"
        />
      </label>
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
  selectedSeries: HoseEndSeriesRecord | null;
}) {
  const editMode = Boolean(selectedSeries);
  const dialogRef = useModalDialog();
  return (
    <dialog
      aria-labelledby="hose-end-series-dialog-title"
      aria-modal="true"
      className="catalog-maintenance-dialog"
      ref={dialogRef}
    >
      <div className="catalog-maintenance-dialog-header">
        <div>
          <span className="eyebrow">Hose End Series / 压接接头系列</span>
          <h2 id="hose-end-series-dialog-title">
            {editMode
              ? "Edit Hose End Series / 编辑压接接头系列"
              : "Add Hose End Series / 增加压接接头系列"}
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
        <input name="intent" type="hidden" value="maintain_hose_end_series" />
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
              defaultValue={selectedSeries?.interfaceFamily}
              label="Interface Family / 接口体系"
              name="series.interfaceFamily"
              required
            />
            <Field
              defaultValue={selectedSeries?.interfaceStandard}
              label="Interface Standard / 接口标准"
              name="series.interfaceStandard"
              required
            />
            <Field
              defaultValue={selectedSeries?.gender}
              label="Gender / 公母"
              name="series.gender"
              required
            />
            <Field
              defaultValue={selectedSeries?.swivelForm}
              label="Swivel/Fixed / 旋转或固定"
              name="series.swivelForm"
              required
            />
            <Field
              defaultValue={selectedSeries?.angle}
              label="Angle / 角度"
              name="series.angle"
              required
            />
            <Field
              defaultValue={selectedSeries?.sealingForm}
              label="Sealing Form / 密封形式"
              name="series.sealingForm"
              required
            />
          </div>
        </fieldset>
        <ImageFields
          currentReference={
            selectedSeries?.representativeImageReference ?? null
          }
        />
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
  series: HoseEndSeriesRecord[];
  variant: HoseEndVariantRecord | null;
}) {
  const editMode = Boolean(variant);
  const dialogRef = useModalDialog();
  return (
    <dialog
      aria-labelledby="hose-end-variant-dialog-title"
      aria-modal="true"
      className="catalog-maintenance-dialog"
      ref={dialogRef}
    >
      <div className="catalog-maintenance-dialog-header">
        <div>
          <span className="eyebrow">Hose End Variant / 压接接头子体</span>
          <h2 id="hose-end-variant-dialog-title">
            {editMode
              ? "Edit Hose End Variant / 编辑压接接头子体"
              : "Add Hose End Variant / 增加压接接头子体"}
          </h2>
        </div>
        <Link aria-label="Close / 关闭" to={maintenanceBase}>
          <X aria-hidden="true" size={20} />
        </Link>
      </div>
      <p>
        Interface identity and the representative image come from the selected
        series / 接口身份与代表图来自所选系列
      </p>
      <Feedback findings={findings} formError={formError} />
      <Form
        className="catalog-manual-form"
        encType="multipart/form-data"
        method="post"
        noValidate
      >
        <input name="intent" type="hidden" value="maintain_hose_end_variant" />
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
              <span>Fitting Series / 接头系列</span>
              <select
                defaultValue={variant?.fittingSeries ?? ""}
                name="variant.fittingSeries"
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
              <span>Hose End SKU / 接头SKU</span>
              <input
                defaultValue={variant?.sku ?? ""}
                name="variant.sku"
                readOnly={editMode}
                required
              />
            </label>
            <Field
              defaultValue={variant?.thread}
              label="Thread / 螺纹"
              name="variant.thread"
              required
            />
            <Field
              defaultValue={variant?.connectionDash}
              label="Connection Dash / 接口Dash"
              name="variant.connectionDash"
              required
            />
            <Field
              defaultValue={variant?.hoseTailDash}
              label="Hose Tail Dash / 胶管尾Dash"
              name="variant.hoseTailDash"
              required
            />
            <Field
              defaultValue={variant?.material}
              label="Material / 材质"
              name="variant.material"
              required
            />
            <Field
              defaultValue={variant?.coating}
              label="Coating / 表面处理"
              name="variant.coating"
              required
            />
            <Field
              defaultValue={variant?.saltSprayHours}
              label="Salt Spray h / 盐雾小时"
              name="variant.saltSprayHours"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.maxWorkingBar}
              label="Max Working bar / 最大工作压力"
              name="variant.maxWorkingBar"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.dimensionAMm}
              label="Dimension A mm / 总长A"
              name="variant.dimensionAMm"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.cutoffBMm}
              label="Cut-off B mm / 扣除量B"
              name="variant.cutoffBMm"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.hex1Mm}
              label="Hex 1 mm / 六角1"
              name="variant.hex1Mm"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.hex2Mm}
              label="Hex 2 mm / 六角2"
              name="variant.hex2Mm"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.minimumBoreMm}
              label="Minimum Bore mm / 最小通径"
              name="variant.minimumBoreMm"
              required
              type="number"
            />
            <Field
              defaultValue={variant?.unitWeightG}
              label="Unit Weight g / 单重"
              name="variant.unitWeightG"
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
              defaultValue={variant?.competitorPartNumber}
              label="Competitor Part No. / 竞品参考料号"
              name="variant.competitorPartNumber"
            />
            <Field
              defaultValue={variant?.drawingNumber}
              label="Drawing No. / 图纸号"
              name="variant.drawingNumber"
            />
            <Field
              defaultValue={variant?.drawingRevision}
              label="Drawing Rev / 图纸版本"
              name="variant.drawingRevision"
            />
            <Field
              defaultValue={variant?.source}
              label="Source Document/Page / 来源"
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
          </div>
        </fieldset>
        <ImageFields
          currentReference={variant?.imageOverrideReference ?? null}
          inherit
        />
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

export function CatalogHoseEndMaintenance({
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
  selectedSeries: HoseEndSeriesRecord | null;
  series: HoseEndSeriesRecord[];
  variant: HoseEndVariantRecord | null;
}) {
  return (
    <section
      className="catalog-manual-panel"
      aria-labelledby="hose-end-maintenance-title"
    >
      <div className="catalog-manual-search">
        <div>
          <span className="eyebrow">Hose End Maintenance / 压接接头维护</span>
          <h2 id="hose-end-maintenance-title">
            Hose End Series and Variants / 压接接头系列和子体
          </h2>
          <p>
            Maintain series identity separately from exact SKU data /
            分别维护系列身份和具体SKU资料
          </p>
        </div>
        <Form method="get">
          <input name="mode" type="hidden" value="manual" />
          <input name="productType" type="hidden" value="hose_end" />
          <input name="manualAction" type="hidden" value="variant" />
          <label>
            <span>Exact Hose End SKU / 精确接头SKU</span>
            <input
              defaultValue={requestedSku}
              name="sku"
              placeholder="e.g. / 例如 FJX-04-04"
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
          {saved.kind === "series"
            ? "Hose End Series / 压接接头系列"
            : "Hose End Variant / 压接接头子体"}{" "}
          {saved.identifier} saved to the Catalog draft / 已保存到产品目录草稿
        </p>
      ) : null}
      <div className="catalog-series-list">
        <h3>Existing Hose End Series / 已有压接接头系列</h3>
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
