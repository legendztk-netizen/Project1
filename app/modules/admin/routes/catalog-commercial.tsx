import { createD1CatalogItemRepository } from "../../catalog/infrastructure/d1-catalog-item-repository";
import { createD1ProductManagementRepository } from "../../catalog/infrastructure/d1-product-management-repository";
import type { CatalogItemPayload } from "../../catalog/domain/catalog-item-publication";
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
import {
  requireAdminRequestContext,
  requireCatalogWriteContext,
} from "../infrastructure/admin-request-context";
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
    currency: text(form, "currency") || "USD",
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
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const selectedProductType = productType(url.searchParams.get("productType"));
  const selectedSeries = (url.searchParams.get("series") ?? "").trim();
  const sku = (url.searchParams.get("sku") ?? "").trim().toUpperCase();
  const items = createD1CatalogItemRepository(env.DB);
  if ((await items.state()).mode === "items") {
    const rows = await createD1ProductManagementRepository(env.DB).all();
    const skuRow = rows.find((r) => r.kind === "sku" && r.code === sku);
    const actualType = skuRow?.productType ?? selectedProductType;
    const seriesPayload = selectedSeries
      ? await items.findProductPayload(
          actualType,
          "series",
          selectedSeries,
          true,
        )
      : null;
    const skuPayload = skuRow
      ? await items.findProductPayload(actualType, "sku", sku, true)
      : null;
    const price = skuPayload?.kind === "sku" ? skuPayload.price : null;
    return {
      exact: price
        ? ({
            ...price,
            sku,
            salesSku: sku,
            referencePrice: price.amount,
          } as SkuPricePackaging)
        : null,
      productType: actualType,
      rule:
        seriesPayload?.kind === "series" ? seriesPayload.commercialRule : null,
      selectedSeries,
      series: rows
        .filter((r) => r.kind === "series" && r.productType === actualType)
        .map((r) => ({
          productType: actualType,
          seriesCode: r.code,
          seriesName: r.name,
        })),
      sku,
      skuRecord: skuRow
        ? {
            sku,
            productType: actualType,
            seriesCode: skuRow.seriesCode,
            lifecycleStatus: skuRow.state as
              "online" | "draft" | "discontinued",
          }
        : null,
      seriesPayload,
      skuPayload,
      commandId: crypto.randomUUID(),
      canEdit: adminIdentity.catalogPermission !== "view",
      itemMode: true,
    };
  }
  const repository = createD1CatalogCommercialMaintenanceRepository(env.DB);
  return {
    seriesPayload: null,
    skuPayload: null,
    commandId: crypto.randomUUID(),
    canEdit: adminIdentity.catalogPermission !== "view",
    itemMode: false,
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
  const { adminIdentity, env } = requireCatalogWriteContext(context);
  const form = await request.formData();
  const intent = text(form, "intent");
  const ipAddress = request.headers.get("cf-connecting-ip") ?? "local";
  const requestCorrelationId =
    request.headers.get("x-request-id") ??
    request.headers.get("cf-ray") ??
    crypto.randomUUID();
  const repository = createD1CatalogCommercialMaintenanceRepository(env.DB);
  try {
    const items = createD1CatalogItemRepository(env.DB);
    if ((await items.state()).mode === "items") {
      const payload = JSON.parse(
        text(form, "basePayload"),
      ) as CatalogItemPayload;
      if (intent === "save_series_rule" && payload.kind === "series")
        payload.commercialRule = ruleFromForm(form);
      else if (intent === "save_sku_price" && payload.kind === "sku") {
        const {
          referencePrice,
          sku: _sku,
          salesSku: _salesSku,
          ...packaging
        } = packagingFromForm(form);
        payload.price = { ...packaging, amount: referencePrice };
      } else throw new Error("Invalid product command / 产品提交无效");
      const target =
        payload.kind === "sku"
          ? (await createD1ProductManagementRepository(env.DB).all()).find(
              (row) =>
                row.kind === "sku" &&
                row.code === payload.variant.sku &&
                row.productType === payload.productType,
            )
          : null;
      await items.apply({
        commandId: text(form, "commandId"),
        actorId: adminIdentity.id,
        ipAddress,
        payload,
        mode: "edit",
        targetState: (target?.state ?? "online") as
          "online" | "draft" | "discontinued",
        baselineRevisionId: text(form, "baselineRevisionId") || null,
        source: { channel: "manual" },
      });
      return redirect(
        `/admin/catalog/commercial?productType=${payload.productType}&series=${payload.kind === "series" ? encodeURIComponent(payload.series.seriesCode) : ""}&sku=${payload.kind === "sku" ? encodeURIComponent(payload.variant.sku) : ""}&saved=1`,
      );
    }
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
          commandId={loaderData.commandId}
          seriesPayload={loaderData.seriesPayload}
          skuPayload={loaderData.skuPayload}
          canEdit={loaderData.canEdit}
          itemMode={loaderData.itemMode}
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
