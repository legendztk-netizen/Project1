import { AlertCircle, Image, Save, Search } from "lucide-react";
import { Form } from "react-router";

import {
  manualAdapterWorksheet,
  manualComponentSalesWorksheet,
  manualFerruleWorksheet,
  manualHoseEndWorksheet,
  manualQuickCouplerWorksheet,
  type ManualComponentRecord,
  type ManualComponentType,
} from "../../catalog/domain/catalog-manual-component";
import {
  reviewedAdapterImageReferences,
  reviewedFerruleImageReferences,
  reviewedHoseEndImageKeys,
  reviewedQuickCouplerImageReferences,
} from "../../catalog/domain/catalog-main-image";
import {
  inferProductLifecycleStatus,
  productLifecycleLabels,
  productLifecycleStatuses,
} from "../../catalog/domain/catalog-product-lifecycle";
import {
  catalogWorksheetContract,
  type CatalogFieldContract,
  type CatalogImportValidationResult,
  type CatalogWorkbookCell,
} from "../../catalog/domain/catalog-workbook";

const hiddenSalesFields = new Set([
  "baseSku",
  "catalogPublicationStatus",
  "currency",
  "factoryUnitPrice",
  "incotermPlace",
  "priceIncoterm",
  "productType",
  "rfqEligibility",
  "technicalDataStatus",
  "tierPrice",
  "tierQty",
]);

const hiddenMasterFields = new Set([
  "catalogPublicationStatus",
  "rfqEligibility",
  "seriesMainImageReference",
  "seriesName",
]);

function displayLabel(field: CatalogFieldContract) {
  return field.header.replace(/^\*\s*/u, "");
}

function inputValue(value: CatalogWorkbookCell | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function CatalogField({
  defaultValue,
  field,
  locked,
  prefix,
}: {
  defaultValue: CatalogWorkbookCell | undefined;
  field: CatalogFieldContract;
  locked?: boolean;
  prefix: "master" | "sales";
}) {
  const name = `${prefix}.${field.key}`;
  const label = displayLabel(field);
  if (field.controlledValues) {
    return (
      <label>
        <span>{label}</span>
        <select
          defaultValue={inputValue(defaultValue)}
          disabled={locked}
          name={name}
          required={field.required}
        >
          <option value="">Select…</option>
          {field.controlledValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {locked ? (
          <input name={name} type="hidden" value={inputValue(defaultValue)} />
        ) : null}
      </label>
    );
  }
  const isLongText = field.key === "notes";
  return (
    <label className={isLongText ? "catalog-manual-wide-field" : undefined}>
      <span>{label}</span>
      {isLongText ? (
        <textarea
          defaultValue={inputValue(defaultValue)}
          name={name}
          readOnly={locked}
          required={field.required}
          rows={3}
        />
      ) : (
        <input
          defaultValue={inputValue(defaultValue)}
          name={name}
          readOnly={locked}
          required={field.required}
          step={field.kind === "number" ? "any" : undefined}
          type={field.kind === "number" ? "number" : "text"}
        />
      )}
    </label>
  );
}

function productSettings(productType: ManualComponentType) {
  switch (productType) {
    case "hose_end":
      return {
        imageReferences: reviewedHoseEndImageKeys.map((key) => ({
          label: key,
          reference: `hose-end-shape:${key}`,
        })),
        label: "Hose End",
        placeholder: "e.g. JIC_F_SW_04_04",
        productType: "Hose End",
        skuKey: "sku",
        worksheetNumber: "02",
        worksheet: manualHoseEndWorksheet,
      } as const;
    case "ferrule":
      return {
        imageReferences: reviewedFerruleImageReferences,
        label: "Ferrule",
        placeholder: "e.g. 601R1_1WB_002",
        productType: "Ferrule",
        skuKey: "sku",
        worksheetNumber: "03",
        worksheet: manualFerruleWorksheet,
      } as const;
    case "adapter":
      return {
        imageReferences: reviewedAdapterImageReferences,
        label: "Adapter",
        placeholder: "e.g. ADP_ST_JIC_M_10_NPT_M_04",
        productType: "Adapter",
        skuKey: "adapterSku",
        worksheetNumber: "05",
        worksheet: manualAdapterWorksheet,
      } as const;
    case "quick_coupler":
      return {
        imageReferences: reviewedQuickCouplerImageReferences,
        label: "Quick Coupler",
        placeholder: "e.g. QDC_16028_SOC_04_FNPT_04",
        productType: "Quick Coupler",
        skuKey: "sku",
        worksheetNumber: "06",
        worksheet: manualQuickCouplerWorksheet,
      } as const;
  }
}

export function CatalogManualComponentForm({
  findings,
  formError,
  imageAffectedSkus = [],
  productType,
  record,
  requestedSku,
  saved,
}: {
  findings: CatalogImportValidationResult[];
  formError: string | null;
  imageAffectedSkus?: string[];
  productType: ManualComponentType;
  record: ManualComponentRecord | null;
  requestedSku: string;
  saved: "created" | "updated" | null;
}) {
  const settings = productSettings(productType);
  const contracts = {
    master: catalogWorksheetContract(settings.worksheet),
    sales: catalogWorksheetContract(manualComponentSalesWorksheet),
  };
  const values = {
    master: record ? { ...record.master } : {},
    sales: record ? { ...record.salesOffer } : {},
  } as {
    master: Record<string, CatalogWorkbookCell | undefined>;
    sales: Record<string, CatalogWorkbookCell | undefined>;
  };
  if (record && productType === "adapter") {
    values.master.adapterSku = record.master.sku;
  }
  if (!record && requestedSku) values.master[settings.skuKey] = requestedSku;
  if (!record) {
    values.master.catalogPublicationStatus = "Published";
    values.master.rfqEligibility = "Eligible";
    values.master.technicalDataStatus = "Complete";
    values.sales.productType = settings.productType;
    values.sales.salesUnit = "each";
    values.sales.unitsPerSalesPack = 1;
    values.sales.moq = 1;
    values.sales.currency = "USD";
    values.sales.quantityInputMode = "Units";
  }
  const editMode = Boolean(record);
  const lifecycleStatus = record
    ? inferProductLifecycleStatus({
        catalogPublicationStatus: record.master.catalogPublicationStatus,
        supplyAvailability: record.supplyAvailability,
      })
    : "online";

  return (
    <section
      aria-labelledby="manual-component-title"
      className="catalog-manual-panel"
    >
      <div className="catalog-manual-search">
        <div>
          <span className="eyebrow">Manual Add/Edit</span>
          <h2 id="manual-component-title">One exact {settings.label} SKU</h2>
          <p>
            Search an existing SKU to edit it, or leave the search empty to add
            one complete {settings.label} product.
          </p>
        </div>
        <Form method="get">
          <input name="mode" type="hidden" value="manual" />
          <input name="productType" type="hidden" value={productType} />
          <label>
            <span>Exact {settings.label} SKU</span>
            <input
              defaultValue={requestedSku}
              name="sku"
              placeholder={settings.placeholder}
              type="search"
            />
          </label>
          <button className="button button-secondary" type="submit">
            <Search size={17} /> Find exact SKU
          </button>
        </Form>
      </div>

      {requestedSku && !record ? (
        <p className="catalog-manual-notice">
          No current {settings.label} matches {requestedSku}. The form below
          will create a new SKU.
        </p>
      ) : null}
      {record ? (
        <p className="catalog-manual-notice">
          Loaded from {record.release.status === "draft" ? "draft" : "active"}{" "}
          release {record.release.releaseNumber}. SKU identity is locked.
        </p>
      ) : null}
      {saved ? (
        <p className="catalog-update-success" role="status">
          Saved {requestedSku} to the pending Catalog version. Open Product
          Review and Publication to inspect it before release.
        </p>
      ) : null}
      {imageAffectedSkus.length > 0 ? (
        <div className="catalog-manual-notice" role="status">
          <strong>Shared image replacement affects:</strong>{" "}
          {imageAffectedSkus.join(", ")}. The active catalog is unchanged until
          this draft is published.
        </div>
      ) : null}
      {formError ? (
        <p className="form-error" role="alert">
          <AlertCircle size={17} /> {formError}
        </p>
      ) : null}
      {findings.length > 0 ? (
        <div className="catalog-manual-findings" role="alert">
          <strong>Correct these fields:</strong>
          <ul>
            {findings.map((finding, index) => (
              <li key={`${finding.code}-${finding.field}-${index}`}>
                <strong>{finding.field}</strong>: {finding.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Form
        className="catalog-manual-form"
        encType="multipart/form-data"
        method="post"
      >
        <input name="intent" type="hidden" value="maintain_component" />
        <input name="productType" type="hidden" value={productType} />
        <input name="mode" type="hidden" value={editMode ? "edit" : "create"} />
        <input
          name="originalSku"
          type="hidden"
          value={record?.master.sku ?? ""}
        />
        <input
          name="originalSalesSku"
          type="hidden"
          value={record?.salesOffer.salesSku ?? ""}
        />
        <input
          name="currentMainImageReference"
          type="hidden"
          value={record?.mainImageReference ?? ""}
        />

        <fieldset>
          <legend>产品状态</legend>
          <p>价格发布状态和供货状态由这里自动同步，不需要分别设置。</p>
          <label>
            <span>使用状态</span>
            <select defaultValue={lifecycleStatus} name="lifecycleStatus">
              {productLifecycleStatuses.map((status) => (
                <option key={status} value={status}>
                  {productLifecycleLabels[status]}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>
            {settings.worksheetNumber} · {settings.label} master data
          </legend>
          <p>Fields marked by the approved worksheet contract are required.</p>
          <div className="catalog-manual-fields">
            {contracts.master.fields
              .filter((field) => !hiddenMasterFields.has(field.key))
              .map((field) => (
                <CatalogField
                  defaultValue={values.master[field.key]}
                  field={field}
                  key={field.key}
                  locked={editMode && field.key === settings.skuKey}
                  prefix="master"
                />
              ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Reviewed main image</legend>
          <div className="catalog-main-image-field">
            <Image aria-hidden="true" size={22} />
            <label>
              <span>Approved representative image</span>
              <select
                defaultValue={record?.mainImageReference ?? ""}
                name="mainImageReference"
              >
                <option value="">Select…</option>
                {settings.imageReferences.map((image) => (
                  <option key={image.reference} value={image.reference}>
                    {image.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>
            Reuse a reviewed representative, or upload a JPEG, PNG, or WebP.
            Uploads are normalized without cropping and become active only after
            catalog publication.
          </p>
          <div className="catalog-manual-fields">
            <label>
              <span>Upload replacement or new image</span>
              <input
                accept="image/jpeg,image/png,image/webp"
                name="mainImageUpload"
                type="file"
              />
            </label>
            <label>
              <span>Source notes (optional)</span>
              <input name="imageSourceNotes" type="text" />
            </label>
            <label>
              <span>Licence notes (optional)</span>
              <input name="imageLicenseNotes" type="text" />
            </label>
          </div>
          {record ? (
            <label className="catalog-main-image-replacement">
              <input name="replaceSharedImage" type="checkbox" value="yes" />
              Replace this shared image for every affected product in the draft
            </label>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>07 · Sales and Reference Price</legend>
          <p>
            Product type, Base SKU, USD currency, and status are synchronized
            automatically with the {settings.label} product.
          </p>
          <div className="catalog-manual-fields">
            {contracts.sales.fields
              .filter((field) => !hiddenSalesFields.has(field.key))
              .map((field) => (
                <CatalogField
                  defaultValue={values.sales[field.key]}
                  field={
                    field.key === "referencePriceUsd"
                      ? { ...field, required: true }
                      : field
                  }
                  key={field.key}
                  locked={editMode && field.key === "salesSku"}
                  prefix="sales"
                />
              ))}
          </div>
        </fieldset>

        <div className="catalog-manual-actions">
          <button className="button button-primary" type="submit">
            <Save size={17} /> Save complete product to pending version
          </button>
        </div>
      </Form>
    </section>
  );
}
