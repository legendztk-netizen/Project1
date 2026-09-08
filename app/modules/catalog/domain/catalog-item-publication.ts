import type {
  HoseSeriesRecord,
  HoseVariantInput,
} from "./catalog-hose-maintenance";
import type { SeriesCommercialRule } from "./catalog-commercial-maintenance";
import type { ProductLifecycleStatus } from "./catalog-product-lifecycle";

export const itemCurrencies = [
  "USD",
  "CNY",
  "EUR",
  "CAD",
  "GBP",
  "JPY",
] as const;
export interface ItemPrice {
  amount: number | null;
  currency: string;
  packageLengthFt: number | null;
  unitsPerSalesPack?: number | null;
  netUnitWeightKg?: number | null;
  innerPackQty?: number | null;
  masterCartonQty?: number | null;
  cartonGrossWeightKg?: number | null;
  cartonLCm?: number | null;
  cartonWCm?: number | null;
  cartonHCm?: number | null;
  packingBasis?: string | null;
}
export type CatalogItemPayload =
  | {
      kind: "series";
      productType: "hose";
      series: HoseSeriesRecord;
      commercialRule: SeriesCommercialRule | null;
      mediaVersionId: string | null;
    }
  | {
      kind: "sku";
      productType: "hose";
      variant: HoseVariantInput;
      price: ItemPrice | null;
      mediaVersionId: string | null;
    };
export interface CatalogItemCommand {
  commandId: string;
  actorId: string;
  ipAddress: string;
  payload: CatalogItemPayload;
  targetState: ProductLifecycleStatus;
  mode: "create" | "edit";
  baselineRevisionId: string | null;
  source: {
    channel: "manual" | "excel" | "migration";
    batchId?: string;
    row?: number;
  };
}
export interface CatalogItemResult {
  revisionId: string;
  sequence: number;
  targetState: ProductLifecycleStatus;
}
export interface CatalogRevisionBasis {
  generation: number;
  skuRevisionId: string;
  seriesRevisionId: string | null;
  mediaVersionId: string | null;
}
export class CatalogItemRejected extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CatalogItemRejected";
  }
}
export function normalizeItemPrice(price: ItemPrice): ItemPrice {
  if (
    !itemCurrencies.includes(price.currency as (typeof itemCurrencies)[number])
  )
    throw new CatalogItemRejected("Unsupported currency / 不支持的币种");
  if (
    price.amount !== null &&
    (!Number.isFinite(price.amount) || price.amount < 0)
  )
    throw new CatalogItemRejected("Invalid retail price / 零售价格无效");
  if (
    price.packageLengthFt !== null &&
    (!Number.isFinite(price.packageLengthFt) || price.packageLengthFt <= 0)
  )
    throw new CatalogItemRejected(
      "Package length must be positive / 包装长度必须大于零",
    );
  for (const key of [
    "unitsPerSalesPack",
    "netUnitWeightKg",
    "innerPackQty",
    "masterCartonQty",
    "cartonGrossWeightKg",
    "cartonLCm",
    "cartonWCm",
    "cartonHCm",
  ] as const) {
    const value = price[key];
    if (value != null && (!Number.isFinite(value) || value <= 0))
      throw new CatalogItemRejected(`Invalid packaging: ${key}`);
  }
  return {
    ...price,
    amount: price.amount,
    currency: price.currency,
    packageLengthFt: price.packageLengthFt,
  };
}
export function itemCompatibilityKey(input: {
  hoseSeries: string;
  dash: string;
  skiveRequirement: string | null;
  state: string;
}) {
  return JSON.stringify([
    input.hoseSeries,
    input.dash,
    input.skiveRequirement,
    input.state === "online",
  ]);
}
export function itemCode(payload: CatalogItemPayload) {
  return payload.kind === "series"
    ? payload.series.seriesCode
    : payload.variant.sku;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
export async function catalogCommandHash(input: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(input))),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
