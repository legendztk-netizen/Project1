import type { CatalogItemPayload } from "./catalog-item-publication";
import type { ProductLifecycleStatus } from "./catalog-product-lifecycle";

export type LegacyRow = Record<string, unknown>;
export interface CutoverProduct {
  key: string;
  payload: CatalogItemPayload;
  targetState: ProductLifecycleStatus;
  original: LegacyRow;
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
export function draftDifference(
  baseline: unknown,
  draft: unknown,
  active: unknown,
  baselineKnown: boolean,
) {
  if (canonicalJson(draft) === canonicalJson(active)) return "already_current";
  if (!baselineKnown) return "ambiguous";
  if (canonicalJson(baseline) === canonicalJson(draft)) return "inherited";
  if (draft == null) return "ambiguous_deletion";
  return baseline == null ? "added" : "changed";
}
const variantTables = {
  hose: "catalog_hose_variants",
  hose_end: "catalog_hose_ends",
  ferrule: "catalog_ferrules",
  adapter: "catalog_adapters",
  quick_coupler: "catalog_quick_couplers",
} as const;
const seriesKeys = {
  hose: "hose_series",
  hose_end: "fitting_series",
  ferrule: "ferrule_series",
  adapter: "adapter_family_id",
  quick_coupler: "coupler_series",
} as const;
function camel(row: LegacyRow) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(
        ([k]) =>
          ![
            "id",
            "import_id",
            "updated_at",
            "updated_by",
            "created_at",
            "created_by",
            "source_worksheet",
          ].includes(k),
      )
      .map(([k, v]) => [
        k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
        v,
      ]),
  );
}
function lifecycle(row: LegacyRow): ProductLifecycleStatus {
  if (
    row.catalog_publication_status === "Archived" ||
    row.supply_availability === "discontinued"
  )
    return "discontinued";
  return row.catalog_publication_status === "Published" &&
    row.rfq_eligibility === "Eligible" &&
    row.supply_availability === "available_for_quote"
    ? "online"
    : "draft";
}
/** Read immutable release facts only; keep full raw rows beside the editable payload. */
export function releaseProducts(
  tables: Record<string, LegacyRow[]>,
): CutoverProduct[] {
  const rows = (table: string) => tables[table] ?? [];
  const result: CutoverProduct[] = [];
  const series = new Map<
    string,
    { type: keyof typeof variantTables; code: string }
  >();
  for (const sku of rows("catalog_skus")) {
    const type = sku.product_type as keyof typeof variantTables;
    if (!variantTables[type])
      throw new Error(`Unsupported legacy product type: ${type}`);
    const variant = rows(variantTables[type]).find(
      (r) => r.sku === sku.sku,
    ) ?? { sku: sku.sku, [seriesKeys[type]]: sku.hose_series ?? "" };
    const code = String(variant[seriesKeys[type]] ?? "");
    if (code) series.set(`${type}:${code}`, { type, code });
    const exact = rows("catalog_sku_price_packaging").find(
      (r) => r.sku === sku.sku,
    );
    const offers = rows("catalog_sales_offers").filter(
      (r) => r.base_sku === sku.sku,
    );
    const price = exact ?? offers[0];
    const image = rows("catalog_product_main_images").find(
      (r) => r.sku === sku.sku && r.assignment_kind === "override",
    );
    const payload = {
      kind: "sku",
      productType: type,
      variant: {
        ...camel(variant),
        technicalDataStatus: sku.technical_data_status,
      },
      price: price
        ? {
            ...camel(price),
            amount: price.reference_price_usd,
            currency: price.currency ?? "USD",
            packageLengthFt: price.package_length_ft ?? null,
          }
        : null,
      mediaVersionId: image?.media_version_id ?? null,
    } as unknown as CatalogItemPayload;
    result.push({
      key: `sku:${type}:${sku.sku}`,
      payload,
      targetState: lifecycle(sku),
      original: {
        sku,
        variant,
        exact: exact ?? null,
        offers,
        image: image ?? null,
      },
    });
  }
  for (const type of ["hose", "hose_end"] as const)
    for (const row of rows(
      type === "hose" ? "catalog_hose_series" : "catalog_hose_end_series",
    ))
      series.set(`${type}:${row.series_code}`, {
        type,
        code: String(row.series_code),
      });
  for (const row of rows("catalog_series_commercial_rules")) {
    const type = row.product_type as keyof typeof variantTables;
    if (variantTables[type])
      series.set(`${type}:${row.series_code}`, {
        type,
        code: String(row.series_code),
      });
  }
  for (const { type, code } of series.values()) {
    const raw = rows(
      type === "hose"
        ? "catalog_hose_series"
        : type === "hose_end"
          ? "catalog_hose_end_series"
          : "",
    ).find((r) => r.series_code === code);
    const rule = rows("catalog_series_commercial_rules").find(
      (r) => r.product_type === type && r.series_code === code,
    );
    const media = raw?.representative_media_version_id ?? null;
    const reference =
      rows("catalog_media_versions").find((r) => r.id === media)
        ?.approved_reference ?? (media ? `media-version:${media}` : "");
    const payload = {
      kind: "series",
      productType: type,
      series: {
        ...(raw ? camel(raw) : { seriesCode: code, seriesName: code }),
        ...(type === "hose_end"
          ? { interfaceStandard: raw?.connection_standard }
          : {}),
        representativeImageReference: reference,
      },
      commercialRule: rule ? camel(rule) : null,
      mediaVersionId: media,
    } as unknown as CatalogItemPayload;
    result.push({
      key: `series:${type}:${code}`,
      payload,
      targetState: "online",
      original: { series: raw ?? null, rule: rule ?? null },
    });
  }
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
