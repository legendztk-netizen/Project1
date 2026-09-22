import { AlertCircle, Image, Save, Search } from "lucide-react";
import { Form } from "react-router";

import {
  manualHoseWorksheet,
  manualSalesWorksheet,
  type ManualHoseRecord,
} from "../../catalog/domain/catalog-manual-hose";
import { reviewedHoseSeriesImageKeys } from "../../catalog/domain/catalog-main-image";
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

function recordValues(record: ManualHoseRecord | null) {
  return {
    hose: record ? { ...record.hose } : {},
    sales: record ? { ...record.salesOffer } : {},
  } as {
    hose: Record<string, CatalogWorkbookCell | undefined>;
    sales: Record<string, CatalogWorkbookCell | undefined>;
  };
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
  prefix: "hose" | "sales";
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
  const isLongText =
    field.key === "notes" || field.key === "fluidCompatibility";
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

export function CatalogManualHoseForm({
  findings,
  formError,
  imageAffectedSkus = [],
  record,
  requestedSku,
  saved,
}: {
  findings: CatalogImportValidationResult[];
  formError: string | null;
  imageAffectedSkus?: string[];
  record: ManualHoseRecord | null;
  requestedSku: string;
  saved: "created" | "updated" | null;
}) {
  const contracts = {
    hose: catalogWorksheetContract(manualHoseWorksheet),
    sales: catalogWorksheetContract(manualSalesWorksheet),
  };
  const values = recordValues(record);
  if (!record && requestedSku) values.hose.sku = requestedSku;
  if (!record) {
    values.hose.catalogPublicationStatus = "Published";
    values.hose.rfqEligibility = "Eligible";
    values.hose.technicalDataStatus = "Complete";
    values.sales.productType = "Hose Variant";
    values.sales.salesUnit = "ft";
    values.sales.unitsPerSalesPack = 1;
    values.sales.moq = 1;
    values.sales.currency = "USD";
    values.sales.quantityInputMode = "Length x Pieces";
  }
  const editMode = Boolean(record);
  const lifecycleStatus = record
    ? inferProductLifecycleStatus({
        catalogPublicationStatus: record.hose.catalogPublicationStatus,
        supplyAvailability: record.supplyAvailability,
      })
    : "online";

  return (
    <section
      className="catalog-manual-panel"
      aria-labelledby="manual-hose-title"
    >
      <div className="catalog-manual-search">
        <div>
          <span className="eyebrow">Manual Add/Edit</span>
          <h2 id="manual-hose-title">One exact Hose SKU</h2>
          <p>
            Search an existing SKU to edit it, or leave the search empty to add
            one complete Hose product.
          </p>
        </div>
        <Form method="get">
          <input name="mode" type="hidden" value="manual" />
          <label>
            <span>Exact Hose SKU</span>
            <input
              defaultValue={requestedSku}
              name="sku"
              placeholder="e.g. 601R1_001"
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
          No current Hose matches {requestedSku}. The form below will create a
          new SKU.
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
        <input name="intent" type="hidden" value="maintain_hose" />
        <input name="mode" type="hidden" value={editMode ? "edit" : "create"} />
        <input
          name="originalSku"
          type="hidden"
          value={record?.hose.sku ?? ""}
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
          <legend>01 · Hose master data</legend>
          <p>Fields marked by the approved worksheet contract are required.</p>
          <div className="catalog-manual-fields">
            {contracts.hose.fields
              .filter((field) => !hiddenMasterFields.has(field.key))
              .map((field) => (
                <CatalogField
                  defaultValue={values.hose[field.key]}
                  field={field}
                  key={field.key}
                  locked={editMode && field.key === "sku"}
                  prefix="hose"
                />
              ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Reviewed main image</legend>
          <div className="catalog-main-image-field">
            <Image aria-hidden="true" size={22} />
            <label>
              <span>Series representative image</span>
              <select
                defaultValue={record?.mainImageReference ?? ""}
                name="mainImageReference"
              >
                <option value="">Select…</option>
                {reviewedHoseSeriesImageKeys.map((series) => (
                  <option key={series} value={`hose-series:${series}`}>
                    {series} reviewed series image
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>
            Reuse the reviewed series image, or upload a JPEG, PNG, or WebP.
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
            automatically with the product.
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
