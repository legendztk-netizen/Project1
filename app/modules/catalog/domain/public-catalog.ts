import type { CatalogFamilyId } from "./catalog-family";
import type { SupplyAvailability } from "./catalog-draft-availability";
import type { RfqEligibility } from "./catalog-workbook";

export type PublicProductType =
  "hose" | "hose_end" | "ferrule" | "adapter" | "quick_coupler";

export interface PublicCatalogSpec {
  label: string;
  value: string;
}

export interface PublicCatalogItem {
  aliases: string[];
  canAddToQuote: boolean;
  category: CatalogFamilyId;
  displayName: string;
  familyKey: string;
  familyName: string;
  interfaceGroup: string | null;
  mediaKey: string | null;
  offer: {
    currency: string;
    leadTimeDays: number;
    madeToOrder: boolean;
    moq: number;
    referencePrice: number | null;
    salesUnit: string;
  } | null;
  productType: PublicProductType;
  releaseId: string;
  releaseNumber: string;
  rfqEligibility: RfqEligibility;
  sku: string;
  specs: PublicCatalogSpec[];
  supplyAvailability: SupplyAvailability;
}

export interface PublicCatalogFamily {
  category: CatalogFamilyId;
  familyKey: string;
  familyName: string;
  interfaceGroup: string | null;
  representative: PublicCatalogItem;
  variants: PublicCatalogItem[];
}

export const categoryByProductType: Record<PublicProductType, CatalogFamilyId> =
  {
    adapter: "adapters",
    ferrule: "ferrules",
    hose: "hydraulic-hose",
    hose_end: "hose-ends",
    quick_coupler: "quick-couplers",
  };

const categoryOrder: Record<CatalogFamilyId, number> = {
  "hydraulic-hose": 0,
  "hose-ends": 1,
  ferrules: 2,
  adapters: 3,
  "quick-couplers": 4,
};

export function interfaceGroup(value: string | null) {
  if (!value) return null;
  const standard = value.toUpperCase();
  if (standard.includes("JIC")) return "JIC 37°";
  if (standard.includes("NPT")) return "NPT / NPTF";
  if (standard.includes("ORFS")) return "ORFS";
  if (standard.includes("BSPP") || standard.includes("BSPT")) {
    return "BSPP / BSPT";
  }
  if (standard.includes("ORB")) return "SAE ORB";
  return value;
}

export function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function groupCatalogFamilies(items: PublicCatalogItem[]) {
  const groups = new Map<string, PublicCatalogFamily>();
  for (const item of items) {
    const key = `${item.category}:${item.familyKey}`;
    const family = groups.get(key);
    if (family) {
      family.variants.push(item);
    } else {
      groups.set(key, {
        category: item.category,
        familyKey: item.familyKey,
        familyName: item.familyName,
        interfaceGroup: item.interfaceGroup,
        representative: item,
        variants: [item],
      });
    }
  }
  return [...groups.values()]
    .map((family) => ({
      ...family,
      variants: family.variants.toSorted((a, b) => a.sku.localeCompare(b.sku)),
    }))
    .toSorted(
      (a, b) =>
        categoryOrder[a.category] - categoryOrder[b.category] ||
        a.familyName.localeCompare(b.familyName),
    );
}

export function matchesCatalogQuery(item: PublicCatalogItem, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = [
    item.sku,
    item.displayName,
    item.familyName,
    item.interfaceGroup ?? "",
    ...item.aliases,
    ...item.specs.flatMap((spec) => [spec.label, spec.value]),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(needle);
}
