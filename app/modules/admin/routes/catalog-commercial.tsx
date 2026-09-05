import { ArrowLeft } from "lucide-react";
import { Link, redirect } from "react-router";

import type { Route } from "./+types/catalog-commercial";
import {
  CatalogCommercialMaintenanceRejected,
  commercialProductTypes,
  maintainSeriesCommercialRule,
  maintainSkuPricePackaging,
  type CommercialProductType,
  type SeriesCommercialRule,
  type SkuPricePackaging,
} from "../../catalog/domain/catalog-commercial-maintenance";
import { createD1CatalogCommercialMaintenanceRepository } from "../../catalog/infrastructure/d1-catalog-commercial-maintenance-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { CatalogCommercialMaintenance } from "../ui/catalog-commercial-maintenance";

export function meta() {
  return [{ title: "销售、包装和价格 | Admin Backoffice" }];
}

function productType(value: string | null): CommercialProductType {
  return commercialProductTypes.includes(value as CommercialProductType)
    ? (value as CommercialProductType)
    : "hose";
}

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(form: FormData, key: string) {
  return text(form, key) || null;
}

function requiredNumber(form: FormData, key: string) {
  const raw = text(form, key);
  return raw ? Number(raw) : Number.NaN;
}

function optionalNumber(form: FormData, key: string) {
  const raw = text(form, key);
  return raw ? Number(raw) : null;
}

function ruleFromForm(form: FormData): SeriesCommercialRule {
  return {
    continuousLengthConfirmation: optionalText(
      form,
      "continuousLengthConfirmation",
    ),
    countryOfOrigin: text(form, "countryOfOrigin"),
    hsCode: optionalText(form, "hsCode"),
    leadTimeDays: requiredNumber(form, "leadTimeDays"),
    lengthIncrementFt: optionalNumber(form, "lengthIncrementFt"),
    minimumLengthPerPieceFt: optionalNumber(form, "minimumLengthPerPieceFt"),
    moq: requiredNumber(form, "moq"),
    notes: optionalText(form, "notes"),
    presetLength1Ft: optionalNumber(form, "presetLength1Ft"),
    presetLength2Ft: optionalNumber(form, "presetLength2Ft"),
    presetLength3Ft: optionalNumber(form, "presetLength3Ft"),
    productType: productType(text(form, "productType")),
    quantityInputMode: text(form, "quantityInputMode"),
    salesUnit: text(form, "salesUnit"),
    seriesCode: text(form, "seriesCode"),
  };
}

function packagingFromForm(form: FormData): SkuPricePackaging {
  const sku = text(form, "sku");
  return {
    cartonGrossWeightKg: optionalNumber(form, "cartonGrossWeightKg"),
    cartonHCm: optionalNumber(form, "cartonHCm"),
    cartonLCm: optionalNumber(form, "cartonLCm"),
    cartonWCm: optionalNumber(form, "cartonWCm"),
    currency: "USD",
    innerPackQty: optionalNumber(form, "innerPackQty"),
    masterCartonQty: optionalNumber(form, "masterCartonQty"),
    netUnitWeightKg: optionalNumber(form, "netUnitWeightKg"),
    packageLengthFt: optionalNumber(form, "packageLengthFt"),
    packingBasis: optionalText(form, "packingBasis"),
    referencePrice: optionalNumber(form, "referencePrice"),
    salesSku: sku,
    sku,
    unitsPerSalesPack: optionalNumber(form, "unitsPerSalesPack"),
  };
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const selectedProductType = productType(url.searchParams.get("productType"));
  const selectedSeries = (url.searchParams.get("series") ?? "")
    .trim()
    .toUpperCase();
  const sku = (url.searchParams.get("sku") ?? "").trim().toUpperCase();
  const repository = createD1CatalogCommercialMaintenanceRepository(env.DB);
  return {
    exact: sku ? await repository.findSkuPricePackaging(sku) : null,
    productType: selectedProductType,
    rule: selectedSeries
      ? await repository.findSeriesRule(selectedProductType, selectedSeries)
      : null,
    selectedSeries,
    series: await repository.listSeries(selectedProductType),
    sku,
    skuRecord: sku ? await repository.findSku(sku) : null,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  const form = await request.formData();
  const intent = text(form, "intent");
  const ipAddress = request.headers.get("cf-connecting-ip") ?? "local";
  const requestCorrelationId =
    request.headers.get("x-request-id") ??
    request.headers.get("cf-ray") ??
    crypto.randomUUID();
  const repository = createD1CatalogCommercialMaintenanceRepository(env.DB);
  try {
    if (intent === "save_series_rule") {
      const rule = ruleFromForm(form);
      await maintainSeriesCommercialRule(repository, {
        actorId: adminIdentity.id,
        ipAddress,
        requestCorrelationId,
        rule,
      });
      return redirect(
        `/admin/catalog/commercial?productType=${rule.productType}&series=${encodeURIComponent(rule.seriesCode)}&saved=rule`,
      );
    }
    if (intent === "save_sku_price") {
      const packaging = packagingFromForm(form);
      await maintainSkuPricePackaging(repository, {
        actorId: adminIdentity.id,
        ipAddress,
        packaging,
        requestCorrelationId,
        sku: packaging.sku,
      });
      return redirect(
        `/admin/catalog/commercial?sku=${encodeURIComponent(packaging.sku)}&saved=sku`,
      );
    }
    return { formError: "Unknown action / 未知操作" };
  } catch (error) {
    return {
      formError:
        error instanceof CatalogCommercialMaintenanceRejected ||
        error instanceof Error
          ? error.message
          : "Commercial data was not saved / 销售、包装和价格数据未保存",
    };
  }
}

export default function CatalogCommercial({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="imports" maintenanceMode="commercial" />
      <main className="catalog-import-page">
        <div className="diagnostic-toolbar">
          <Link className="button button-secondary" to="/admin">
            <ArrowLeft size={17} /> Back to overview / 返回总览
          </Link>
        </div>
        <header>
          <span className="eyebrow">Catalog operations / 目录操作</span>
          <h1>Sales, Packaging and Price / 销售、包装和价格</h1>
          <p>
            Maintain inherited series rules separately from exact-SKU retail
            price and optional packaging. /
            分开维护系列继承规则与子体零售价格和选填包装数据。
          </p>
        </header>
        <CatalogCommercialMaintenance
          exact={loaderData.exact}
          formError={actionData?.formError ?? null}
          productType={loaderData.productType}
          rule={loaderData.rule}
          selectedSeries={loaderData.selectedSeries}
          series={loaderData.series}
          sku={loaderData.sku}
          skuRecord={loaderData.skuRecord}
        />
      </main>
    </div>
  );
}
