import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/catalog-import";
import {
  maintainManualComponent,
  ManualComponentEntryRejected,
  manualAdapterWorksheet,
  manualFerruleWorksheet,
  manualHoseEndWorksheet,
  manualQuickCouplerWorksheet,
  type ManualComponentType,
} from "../../catalog/domain/catalog-manual-component";
import {
  maintainManualHose,
  ManualHoseEntryRejected,
} from "../../catalog/domain/catalog-manual-hose";
import {
  HoseMaintenanceRejected,
  maintainHoseSeries,
  maintainHoseVariant,
  validateHoseSeriesMaintenance,
  validateHoseVariantMaintenance,
  type HoseSeriesRecord,
  type HoseVariantInput,
} from "../../catalog/domain/catalog-hose-maintenance";
import {
  CatalogImageRejected,
  mediaVersionIdFromReference,
  prepareCatalogImage,
} from "../../catalog/domain/catalog-product-image";
import {
  productLifecycleState,
  productLifecycleStatuses,
  type ProductLifecycleStatus,
} from "../../catalog/domain/catalog-product-lifecycle";
import {
  catalogWorksheetContract,
  type CatalogWorkbookCell,
} from "../../catalog/domain/catalog-workbook";
import { importCatalogWorkbook } from "../../catalog/domain/catalog-workbook-import";
import { createD1CatalogManualHoseRepository } from "../../catalog/infrastructure/d1-catalog-manual-hose-repository";
import { createCloudflareCatalogImageProcessor } from "../../catalog/infrastructure/cloudflare-catalog-image-processor";
import { createD1R2CatalogImageRepository } from "../../catalog/infrastructure/d1-r2-catalog-image-repository";
import { createD1CatalogWorkbookImportRepository } from "../../catalog/infrastructure/d1-catalog-workbook-import-repository";
import { readCatalogWorkbook } from "../../catalog/infrastructure/read-catalog-workbook";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { CatalogManualComponentForm } from "../ui/catalog-manual-component-form";
import {
  CatalogHoseMaintenance,
  HoseMaintenanceActions,
} from "../ui/catalog-hose-maintenance";
import {
  AdminNavigation,
  type CatalogMaintenanceMode,
} from "../ui/admin-navigation";

const maximumWorkbookBytes = 10 * 1024 * 1024;

type ManualProductType = "hose" | ManualComponentType;

export function meta() {
  return [{ title: "产品数据维护 | Admin Backoffice" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const repository = createD1CatalogWorkbookImportRepository(env.DB);
  const manualRepository = createD1CatalogManualHoseRepository(env.DB);
  const importId = url.searchParams.get("import");
  const requestedSku = (url.searchParams.get("sku") ?? "").trim().toUpperCase();
  const requestedSeries = (url.searchParams.get("series") ?? "")
    .trim()
    .toUpperCase();
  const manualAction =
    url.searchParams.get("manualAction") === "series" ||
    url.searchParams.get("manualAction") === "variant"
      ? (url.searchParams.get("manualAction") as "series" | "variant")
      : null;
  const requestedProductType = url.searchParams.get("productType");
  const productType: ManualProductType =
    requestedProductType === "hose_end" ||
    requestedProductType === "ferrule" ||
    requestedProductType === "adapter" ||
    requestedProductType === "quick_coupler"
      ? requestedProductType
      : "hose";
  const mode: CatalogMaintenanceMode =
    url.searchParams.get("mode") === "manual" ? "manual" : "excel";
  return {
    imageAffectedSkus: (url.searchParams.get("imageAffected") ?? "")
      .split(",")
      .map((sku) => sku.trim())
      .filter(Boolean),
    manualComponent:
      requestedSku && productType !== "hose"
        ? await manualRepository.findComponentByExactSku(
            productType,
            requestedSku,
          )
        : null,
    hoseSeries:
      mode === "manual" && productType === "hose"
        ? await manualRepository.listHoseSeries()
        : [],
    manualAction:
      mode === "manual" && productType === "hose" ? manualAction : null,
    manualHoseVariant:
      mode === "manual" && requestedSku && productType === "hose"
        ? await manualRepository.findHoseVariant(requestedSku)
        : null,
    mode,
    productType,
    requestedSku,
    selectedHoseSeries:
      mode === "manual" && requestedSeries && productType === "hose"
        ? await manualRepository.findHoseSeries(requestedSeries)
        : null,
    seriesImageReference: url.searchParams.get("seriesImageReference"),
    review: importId
      ? await repository.findImportReviewById(importId)
      : await repository.findLatestImportReview(),
    hoseSaved:
      (url.searchParams.get("saved") === "created" ||
        url.searchParams.get("saved") === "updated") &&
      (url.searchParams.get("savedKind") === "series" ||
        url.searchParams.get("savedKind") === "variant")
        ? {
            identifier: url.searchParams.get("identifier") ?? "",
            kind: url.searchParams.get("savedKind") as "series" | "variant",
            mode: url.searchParams.get("saved") as "created" | "updated",
          }
        : null,
    saved:
      url.searchParams.get("saved") === "created" ||
      url.searchParams.get("saved") === "updated"
        ? (url.searchParams.get("saved") as "created" | "updated")
        : null,
  };
}

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(form: FormData, key: string) {
  const raw = textValue(form, key);
  return raw ? Number(raw) : Number.NaN;
}

function optionalTextValue(form: FormData, key: string) {
  return textValue(form, key) || null;
}

function hoseSeriesSubmission(
  form: FormData,
  representativeImageReference: string,
): HoseSeriesRecord {
  return {
    coverColor: optionalTextValue(form, "series.coverColor"),
    coverFinish: optionalTextValue(form, "series.coverFinish"),
    coverMaterial: optionalTextValue(form, "series.coverMaterial"),
    equivalentStandard: textValue(form, "series.equivalentStandard"),
    fluidCompatibility: optionalTextValue(form, "series.fluidCompatibility"),
    primaryStandard: textValue(form, "series.primaryStandard"),
    reinforcement: optionalTextValue(form, "series.reinforcement"),
    representativeImageReference,
    seriesCode: textValue(form, "series.seriesCode"),
    seriesName: textValue(form, "series.seriesName"),
    tempMaxC: numberValue(form, "series.tempMaxC"),
    tempMinC: numberValue(form, "series.tempMinC"),
    tubeMaterial: optionalTextValue(form, "series.tubeMaterial"),
  };
}

function hoseVariantSubmission(form: FormData): HoseVariantInput {
  const technicalDataStatus = textValue(form, "variant.technicalDataStatus");
  return {
    bendRadiusMm: numberValue(form, "variant.bendRadiusMm"),
    burstBar: numberValue(form, "variant.burstBar"),
    dash: textValue(form, "variant.dash"),
    hoseSeries: textValue(form, "variant.hoseSeries"),
    idMm: numberValue(form, "variant.idMm"),
    mshaMarking: optionalTextValue(form, "variant.mshaMarking"),
    nominalIdIn: numberValue(form, "variant.nominalIdIn"),
    notes: textValue(form, "variant.notes"),
    odMm: numberValue(form, "variant.odMm"),
    skiveRequirement: optionalTextValue(form, "variant.skiveRequirement"),
    sku: textValue(form, "variant.sku"),
    source: optionalTextValue(form, "variant.source"),
    technicalDataStatus:
      technicalDataStatus === "Complete" ||
      technicalDataStatus === "Inherited" ||
      technicalDataStatus === "Pending"
        ? technicalDataStatus
        : null,
    weightKgM: numberValue(form, "variant.weightKgM"),
    workingBar: numberValue(form, "variant.workingBar"),
    workingPsi: numberValue(form, "variant.workingPsi"),
  };
}

function worksheetValues(form: FormData, prefix: string, worksheet: string) {
  const values: Record<string, CatalogWorkbookCell | undefined> = {};
  for (const field of catalogWorksheetContract(worksheet).fields) {
    const raw = textValue(form, `${prefix}.${field.key}`);
    if (!raw) {
      values[field.key] = null;
    } else if (field.kind === "number") {
      const parsed = Number(raw);
      values[field.key] = Number.isFinite(parsed) ? parsed : raw;
    } else {
      values[field.key] = raw;
    }
  }
  return values;
}

function lifecycleStatus(form: FormData): ProductLifecycleStatus {
  const value = textValue(form, "lifecycleStatus");
  if (!productLifecycleStatuses.includes(value as ProductLifecycleStatus)) {
    throw new Error(
      "Choose Online / 上线, Draft / 草稿, or Discontinued / 停用",
    );
  }
  return value as ProductLifecycleStatus;
}

function applyLifecycle(
  form: FormData,
  masterValues: Record<string, CatalogWorkbookCell | undefined>,
  salesValues: Record<string, CatalogWorkbookCell | undefined>,
) {
  const status = lifecycleStatus(form);
  const lifecycle = productLifecycleState(status);
  masterValues.catalogPublicationStatus = lifecycle.catalogPublicationStatus;
  masterValues.rfqEligibility = lifecycle.rfqEligibility;
  salesValues.catalogPublicationStatus = lifecycle.catalogPublicationStatus;
  salesValues.rfqEligibility = lifecycle.rfqEligibility;
  return status;
}

function manualHoseSubmission(form: FormData) {
  const hoseValues = worksheetValues(form, "hose", "01_胶管主数据");
  const salesValues = worksheetValues(form, "sales", "07_价格包装");
  salesValues.baseSku = hoseValues.sku;
  salesValues.productType = "Hose Variant";
  salesValues.currency = "USD";
  for (const key of [
    "catalogPublicationStatus",
    "rfqEligibility",
    "technicalDataStatus",
  ]) {
    salesValues[key] = hoseValues[key];
  }
  const status = applyLifecycle(form, hoseValues, salesValues);
  return {
    hoseValues,
    mainImageReference: textValue(form, "mainImageReference"),
    mode:
      textValue(form, "mode") === "edit"
        ? ("edit" as const)
        : ("create" as const),
    originalSalesSku: textValue(form, "originalSalesSku") || null,
    originalSku: textValue(form, "originalSku") || null,
    replaceSharedImageFrom:
      textValue(form, "replaceSharedImage") === "yes"
        ? textValue(form, "currentMainImageReference") || null
        : null,
    salesValues,
    lifecycleStatus: status,
  };
}

function manualComponentSubmission(form: FormData) {
  const requestedProductType = textValue(form, "productType");
  const productType: ManualComponentType =
    requestedProductType === "ferrule" ||
    requestedProductType === "adapter" ||
    requestedProductType === "quick_coupler"
      ? requestedProductType
      : "hose_end";
  const settings = {
    adapter: { productType: "Adapter", worksheet: manualAdapterWorksheet },
    ferrule: { productType: "Ferrule", worksheet: manualFerruleWorksheet },
    hose_end: { productType: "Hose End", worksheet: manualHoseEndWorksheet },
    quick_coupler: {
      productType: "Quick Coupler",
      worksheet: manualQuickCouplerWorksheet,
    },
  }[productType];
  const masterValues = worksheetValues(form, "master", settings.worksheet);
  const salesValues = worksheetValues(form, "sales", "07_价格包装");
  salesValues.baseSku =
    productType === "adapter" ? masterValues.adapterSku : masterValues.sku;
  salesValues.productType =
    productType === "quick_coupler" && masterValues.role === "Plug/Nipple"
      ? "Quick Plug"
      : settings.productType;
  salesValues.currency = "USD";
  for (const key of [
    "catalogPublicationStatus",
    "rfqEligibility",
    "technicalDataStatus",
  ]) {
    salesValues[key] = masterValues[key];
  }
  const status = applyLifecycle(form, masterValues, salesValues);
  return {
    lifecycleStatus: status,
    mainImageReference: textValue(form, "mainImageReference"),
    masterValues,
    mode:
      textValue(form, "mode") === "edit"
        ? ("edit" as const)
        : ("create" as const),
    originalSalesSku: textValue(form, "originalSalesSku") || null,
    originalSku: textValue(form, "originalSku") || null,
    replaceSharedImageFrom:
      textValue(form, "replaceSharedImage") === "yes"
        ? textValue(form, "currentMainImageReference") || null
        : null,
    productType,
    salesValues,
  };
}

async function uploadedMainImageReference(
  env: CloudflareBindings,
  actorId: string,
  form: FormData,
) {
  const file = form.get("mainImageUpload");
  if (!(file instanceof File) || file.size === 0) {
    return textValue(form, "mainImageReference");
  }
  const prepared = await prepareCatalogImage(
    createCloudflareCatalogImageProcessor(env.IMAGES),
    new Uint8Array(await file.arrayBuffer()),
  );
  const currentReference = textValue(form, "currentMainImageReference");
  let lineageId: string | null = null;
  if (textValue(form, "replaceSharedImage") === "yes" && currentReference) {
    const existing = await env.DB.prepare(
      `SELECT lineage.id
       FROM catalog_media_lineages lineage
       INNER JOIN catalog_media_versions media ON media.lineage_id = lineage.id
       WHERE media.id = ? OR media.approved_reference = ?
       LIMIT 1`,
    )
      .bind(
        currentReference.startsWith("media-version:")
          ? currentReference.slice("media-version:".length)
          : "",
        currentReference,
      )
      .first<{ id: string }>();
    lineageId = existing?.id ?? null;
  }
  const stored = await createD1R2CatalogImageRepository(
    env.DB,
    env.PRIVATE_FILES,
  ).storeUploadedVersion({
    actorId,
    licenseNotes: textValue(form, "imageLicenseNotes") || null,
    lineageId,
    mediaVersionId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    prepared,
    sourceNotes: textValue(form, "imageSourceNotes") || null,
  });
  return stored.reference;
}

function hasMainImageUpload(form: FormData) {
  const file = form.get("mainImageUpload");
  return file instanceof File && file.size > 0;
}

function validationImageReference(form: FormData) {
  return hasMainImageUpload(form)
    ? "media-version:pending-upload"
    : textValue(form, "mainImageReference");
}

async function discardUploadedMainImage(
  env: CloudflareBindings,
  reference: string | null,
) {
  const mediaVersionId = reference
    ? mediaVersionIdFromReference(reference)
    : null;
  if (!mediaVersionId) return;
  const media = await env.DB.prepare(
    `SELECT lineage_id, master_object_key, storefront_object_key,
            thumbnail_object_key
     FROM catalog_media_versions WHERE id = ? AND source_kind = 'uploaded'`,
  )
    .bind(mediaVersionId)
    .first<{
      lineage_id: string;
      master_object_key: string | null;
      storefront_object_key: string | null;
      thumbnail_object_key: string | null;
    }>();
  if (!media) return;
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM catalog_media_versions
       WHERE id = ? AND source_kind = 'uploaded'`,
    ).bind(mediaVersionId),
    env.DB.prepare(
      `DELETE FROM catalog_media_lineages
       WHERE id = ?
         AND NOT EXISTS (
           SELECT 1 FROM catalog_media_versions WHERE lineage_id = ?
         )`,
    ).bind(media.lineage_id, media.lineage_id),
  ]);
  await Promise.allSettled(
    [
      media.master_object_key,
      media.storefront_object_key,
      media.thumbnail_object_key,
    ]
      .filter((key): key is string => Boolean(key))
      .map((key) => env.PRIVATE_FILES.delete(key)),
  );
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const form = await request.formData();
  const intent = textValue(form, "intent");
  if (intent === "upload_workbook_series_image") {
    const file = form.get("mainImageUpload");
    if (!(file instanceof File) || file.size === 0) {
      return {
        formError: "Select a JPEG, PNG, or WebP image for the new series.",
        validationFindings: [],
      };
    }
    try {
      const reference = await uploadedMainImageReference(
        env,
        adminIdentity.id,
        form,
      );
      const query = new URLSearchParams({
        mode: "excel",
        seriesImageReference: reference,
      });
      return redirect(`/admin/catalog/import?${query.toString()}`);
    } catch (error) {
      return {
        formError:
          error instanceof CatalogImageRejected
            ? error.message
            : "The new-series image could not be stored.",
        validationFindings: [],
      };
    }
  }
  if (intent === "maintain_hose_series") {
    let uploadedReference: string | null = null;
    try {
      const repository = createD1CatalogManualHoseRepository(env.DB);
      const input = {
        actorId: adminIdentity.id,
        mode:
          textValue(form, "mode") === "edit"
            ? ("edit" as const)
            : ("create" as const),
        originalSeriesCode: optionalTextValue(form, "originalSeriesCode"),
        series: hoseSeriesSubmission(form, validationImageReference(form)),
      };
      await validateHoseSeriesMaintenance(repository, input);
      const representativeImageReference = await uploadedMainImageReference(
        env,
        adminIdentity.id,
        form,
      );
      if (hasMainImageUpload(form))
        uploadedReference = representativeImageReference;
      const result = await maintainHoseSeries(repository, {
        ...input,
        series: hoseSeriesSubmission(form, representativeImageReference),
      });
      const query = new URLSearchParams({
        identifier: result.seriesCode,
        mode: "manual",
        productType: "hose",
        saved: result.mode,
        savedKind: "series",
      });
      return redirect(`/admin/catalog/import?${query.toString()}`);
    } catch (error) {
      await discardUploadedMainImage(env, uploadedReference).catch(
        () => undefined,
      );
      if (
        error instanceof HoseMaintenanceRejected ||
        error instanceof CatalogImageRejected
      ) {
        return {
          formError: error.message,
          validationFindings:
            error instanceof HoseMaintenanceRejected ? error.findings : [],
        };
      }
      return {
        formError:
          error instanceof Error
            ? error.message
            : "Hose Series was not saved / 胶管系列未保存",
        validationFindings: [],
      };
    }
  }
  if (intent === "maintain_hose_variant") {
    let uploadedReference: string | null = null;
    try {
      const repository = createD1CatalogManualHoseRepository(env.DB);
      const input = {
        actorId: adminIdentity.id,
        imageOverrideReference: validationImageReference(form) || null,
        lifecycleStatus: lifecycleStatus(form),
        mode:
          textValue(form, "mode") === "edit"
            ? ("edit" as const)
            : ("create" as const),
        originalSku: optionalTextValue(form, "originalSku"),
        variant: hoseVariantSubmission(form),
      };
      await validateHoseVariantMaintenance(repository, input);
      const imageOverrideReference = await uploadedMainImageReference(
        env,
        adminIdentity.id,
        form,
      );
      if (hasMainImageUpload(form)) uploadedReference = imageOverrideReference;
      const result = await maintainHoseVariant(repository, {
        ...input,
        imageOverrideReference: imageOverrideReference || null,
      });
      const query = new URLSearchParams({
        identifier: result.sku,
        mode: "manual",
        productType: "hose",
        saved: result.mode,
        savedKind: "variant",
      });
      return redirect(`/admin/catalog/import?${query.toString()}`);
    } catch (error) {
      await discardUploadedMainImage(env, uploadedReference).catch(
        () => undefined,
      );
      if (
        error instanceof HoseMaintenanceRejected ||
        error instanceof CatalogImageRejected
      ) {
        return {
          formError: error.message,
          validationFindings:
            error instanceof HoseMaintenanceRejected ? error.findings : [],
        };
      }
      return {
        formError:
          error instanceof Error
            ? error.message
            : "Hose Variant was not saved / 胶管子体未保存",
        validationFindings: [],
      };
    }
  }
  if (intent === "maintain_component") {
    const repository = createD1CatalogManualHoseRepository(env.DB);
    try {
      const submission = manualComponentSubmission(form);
      submission.mainImageReference = await uploadedMainImageReference(
        env,
        adminIdentity.id,
        form,
      );
      const result = await maintainManualComponent(repository, {
        actorId: adminIdentity.id,
        ...submission,
      });
      const query = new URLSearchParams({
        mode: "manual",
        productType: result.productType,
        saved: result.mode,
        sku: result.sku,
      });
      if ((result.imageAffectedSkus?.length ?? 0) > 0) {
        query.set("imageAffected", result.imageAffectedSkus!.join(","));
      }
      return redirect(`/admin/catalog/import?${query.toString()}`);
    } catch (error) {
      if (
        error instanceof ManualComponentEntryRejected ||
        error instanceof CatalogImageRejected
      ) {
        return {
          formError: error.message,
          validationFindings:
            error instanceof ManualComponentEntryRejected ? error.findings : [],
        };
      }
      return {
        formError:
          error instanceof Error
            ? error.message
            : "The component product was not saved.",
        validationFindings: [],
      };
    }
  }
  if (intent === "maintain_hose") {
    try {
      const submission = manualHoseSubmission(form);
      submission.mainImageReference = await uploadedMainImageReference(
        env,
        adminIdentity.id,
        form,
      );
      const result = await maintainManualHose(
        createD1CatalogManualHoseRepository(env.DB),
        {
          actorId: adminIdentity.id,
          ...submission,
        },
      );
      const query = new URLSearchParams({
        mode: "manual",
        saved: result.mode,
        sku: result.sku,
      });
      if ((result.imageAffectedSkus?.length ?? 0) > 0) {
        query.set("imageAffected", result.imageAffectedSkus!.join(","));
      }
      return redirect(`/admin/catalog/import?${query.toString()}`);
    } catch (error) {
      if (
        error instanceof ManualHoseEntryRejected ||
        error instanceof CatalogImageRejected
      ) {
        return {
          formError: error.message,
          validationFindings:
            error instanceof ManualHoseEntryRejected ? error.findings : [],
        };
      }
      return {
        formError:
          error instanceof Error
            ? error.message
            : "The Hose product was not saved.",
        validationFindings: [],
      };
    }
  }
  if (intent !== "import_workbook") {
    return {
      formError: "Unknown catalog maintenance action.",
      validationFindings: [],
    };
  }

  const file = form.get("workbook");
  if (!(file instanceof File) || file.size === 0) {
    return { formError: "Select the approved .xlsx workbook." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { formError: "Only .xlsx workbooks are accepted." };
  }
  if (file.size > maximumWorkbookBytes) {
    return { formError: "The workbook exceeds the 10 MB upload limit." };
  }

  let sheets;
  try {
    sheets = await readCatalogWorkbook(await file.arrayBuffer());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown workbook error";
    return { formError: `The workbook could not be read: ${message}` };
  }

  const repository = createD1CatalogWorkbookImportRepository(env.DB);
  const review = await importCatalogWorkbook(repository, {
    actorId: adminIdentity.id,
    fileName: file.name,
    fileSizeBytes: file.size,
    sheets,
  });
  return redirect(`/admin/catalog/import?import=${review.id}`);
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function CatalogImport({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const review = loaderData.review;
  const importing = navigation.state === "submitting";
  const findings =
    actionData && "validationFindings" in actionData
      ? (actionData.validationFindings ?? [])
      : [];
  const formError = actionData?.formError ?? null;

  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="imports" maintenanceMode={loaderData.mode} />
      <main className="catalog-import-page">
        <div className="diagnostic-toolbar">
          <Link className="button button-secondary" to="/admin">
            <ArrowLeft size={17} /> Back to overview
          </Link>
        </div>

        <header>
          <span className="eyebrow">Catalog operations</span>
          <h1>产品数据维护</h1>
          <p>
            Use Excel for complete series and large changes, or maintain one
            exact product through Manual Add/Edit. Both paths write only to the
            pending Catalog version.
          </p>
        </header>

        {loaderData.mode === "manual" ? (
          <>
            <nav
              aria-label="Manual data type"
              className="catalog-manual-product-types"
            >
              <HoseMaintenanceActions />
              {[
                ["hose_end", "压接接头"],
                ["ferrule", "套筒"],
                ["adapter", "过渡接头"],
                ["quick_coupler", "快速接头"],
              ].map(([type, label]) => (
                <Link
                  aria-current={
                    loaderData.productType === type ? "page" : undefined
                  }
                  className={`catalog-manual-product-type${loaderData.productType === type ? " active" : ""}`}
                  key={type}
                  to={`/admin/catalog/import?mode=manual&productType=${type}`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            {loaderData.productType === "hose" ? (
              <CatalogHoseMaintenance
                action={loaderData.manualAction}
                findings={findings}
                formError={formError}
                requestedSku={loaderData.requestedSku}
                saved={loaderData.hoseSaved}
                selectedSeries={loaderData.selectedHoseSeries}
                series={loaderData.hoseSeries}
                variant={loaderData.manualHoseVariant}
              />
            ) : (
              <CatalogManualComponentForm
                findings={findings}
                formError={formError}
                imageAffectedSkus={loaderData.imageAffectedSkus}
                productType={loaderData.productType}
                record={loaderData.manualComponent}
                requestedSku={loaderData.requestedSku}
                saved={loaderData.saved}
              />
            )}
          </>
        ) : (
          <section className="catalog-upload-panel">
            <div>
              <FileSpreadsheet size={24} />
              <div>
                <h2>Approved workbook</h2>
                <p>
                  Imports Hose, Hose End, Ferrule, compatibility, Adapter, Quick
                  Coupler, and USD pricing data.
                </p>
              </div>
            </div>
            <Form encType="multipart/form-data" method="post">
              <input name="intent" type="hidden" value="import_workbook" />
              <label className="file-field">
                <span>Excel workbook</span>
                <input accept=".xlsx" name="workbook" required type="file" />
              </label>
              <button
                className="button button-primary"
                disabled={importing}
                type="submit"
              >
                <Upload size={17} />{" "}
                {importing ? "Validating..." : "Upload and validate"}
              </button>
            </Form>
            <div className="catalog-series-image-upload">
              <h3>New-series reviewed image</h3>
              <p>
                Upload and normalize the representative image before importing a
                new Hose or Fitting Series. Copy the returned reference into the
                series image-reference column in worksheet 01 or 02.
              </p>
              <Form encType="multipart/form-data" method="post">
                <input
                  name="intent"
                  type="hidden"
                  value="upload_workbook_series_image"
                />
                <label className="file-field">
                  <span>JPEG, PNG, or WebP image</span>
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    name="mainImageUpload"
                    required
                    type="file"
                  />
                </label>
                <button
                  className="button button-secondary"
                  disabled={importing}
                  type="submit"
                >
                  <Upload size={17} /> Upload reviewed image
                </button>
              </Form>
              {loaderData.seriesImageReference ? (
                <p className="catalog-series-image-reference" role="status">
                  Workbook reference:{" "}
                  <code>{loaderData.seriesImageReference}</code>
                </p>
              ) : null}
            </div>
            {actionData?.formError ? (
              <p className="form-error" role="alert">
                <AlertCircle size={17} /> {actionData.formError}
              </p>
            ) : null}
          </section>
        )}

        {loaderData.mode === "excel" && review ? (
          <section className="catalog-import-review" aria-live="polite">
            <div className={`import-result-heading ${review.status}`}>
              {review.status === "completed" ? (
                <CheckCircle2 size={23} />
              ) : (
                <AlertCircle size={23} />
              )}
              <div>
                <span className="eyebrow">Latest import</span>
                <h2>
                  {review.status === "completed"
                    ? "Draft release created"
                    : "Import blocked"}
                </h2>
              </div>
            </div>

            <dl className="import-metadata">
              <div>
                <dt>Source file</dt>
                <dd>{review.sourceFileName}</dd>
              </div>
              <div>
                <dt>File size</dt>
                <dd>{formatBytes(review.sourceFileSizeBytes)}</dd>
              </div>
              <div>
                <dt>Draft release</dt>
                <dd>{review.draftReleaseNumber ?? "Not created"}</dd>
              </div>
              <div>
                <dt>Validation</dt>
                <dd>
                  {review.errorCount} errors · {review.warningCount} warnings
                </dd>
              </div>
            </dl>

            {review.status === "completed" ? (
              <>
                <div className="import-summary-grid">
                  <article>
                    <span>Hose series</span>
                    <strong>{review.summary.hoseSeriesCount}</strong>
                  </article>
                  <article>
                    <span>Hose variants</span>
                    <strong>{review.summary.hoseVariantCount}</strong>
                  </article>
                  <article>
                    <span>Hose ends</span>
                    <strong>{review.summary.hoseEndCount}</strong>
                  </article>
                  <article>
                    <span>Ferrules</span>
                    <strong>{review.summary.ferruleCount}</strong>
                  </article>
                  <article>
                    <span>Adapter families</span>
                    <strong>{review.summary.adapterFamilyCount}</strong>
                  </article>
                  <article>
                    <span>Adapter SKUs</span>
                    <strong>{review.summary.adapterCount}</strong>
                  </article>
                  <article>
                    <span>Quick couplers</span>
                    <strong>{review.summary.quickCouplerCount}</strong>
                  </article>
                  <article>
                    <span>Exact combinations</span>
                    <strong>{review.summary.compatibilityCount}</strong>
                  </article>
                  <article>
                    <span>Sales offers</span>
                    <strong>{review.summary.salesOfferCount}</strong>
                  </article>
                  <article>
                    <span>USD reference prices</span>
                    <strong>{review.summary.referencePriceCount}</strong>
                  </article>
                  <article>
                    <span>Cost basis priced</span>
                    <strong>{review.summary.costBasisPriceCount}</strong>
                  </article>
                  <article>
                    <span>Total sale SKUs</span>
                    <strong>{review.summary.skuCount}</strong>
                  </article>
                </div>
                <p className="import-safety-note">
                  All imported SKUs start Temporarily Unavailable. RFQ
                  eligibility does not mean production approval; only Approved +
                  Complete compatibility data is production-approved.
                </p>
                <Link
                  className="button button-primary"
                  to={`/admin/catalog/review?release=${encodeURIComponent(review.draftReleaseId ?? "")}`}
                >
                  Open Product Review and Publication
                </Link>
              </>
            ) : null}

            {review.validationResults.length > 0 ? (
              <div className="validation-table-wrap">
                <table className="validation-table">
                  <thead>
                    <tr>
                      <th>Worksheet</th>
                      <th>Row</th>
                      <th>Field</th>
                      <th>SKU</th>
                      <th>Severity</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.validationResults.map((result, index) => (
                      <tr key={`${result.code}-${result.row}-${index}`}>
                        <td>{result.worksheet}</td>
                        <td>{result.row || "N/A"}</td>
                        <td>{result.field}</td>
                        <td>{result.sku ?? "N/A"}</td>
                        <td>
                          <span className={`severity-badge ${result.severity}`}>
                            {result.severity}
                          </span>
                        </td>
                        <td>{result.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        {loaderData.mode === "manual" ? (
          <aside className="catalog-manual-boundary">
            <Database size={20} />
            <p>
              Incomplete forms remain only in this browser. The server stores no
              partial record, and the active customer catalog is unchanged until
              Product Review and Publication completes.
            </p>
          </aside>
        ) : null}
      </main>
    </div>
  );
}
