import type { CatalogFamilyId } from "./catalog-family";
import type { SupplyAvailability } from "./catalog-draft-availability";
import type { RfqEligibility } from "./catalog-workbook";
import type { DashSize } from "./dash-size";
import type { CatalogRevisionBasis } from "./catalog-item-publication";
import {
  compareHoseShortNames,
  hoseStandardName,
  sortedCompatibleHoses,
  type CompatibleHose,
} from "./hose-name";

export type PublicProductType =
  "hose" | "hose_end" | "ferrule" | "adapter" | "quick_coupler";

export interface PublicCatalogSpec {
  label: string;
  value: string;
}

export interface PublicLengthOrdering {
  cuttingLabelingFee: {
    currency: "USD";
    ratePerPiece: number;
    scope: string;
    version: number;
  };
  incrementFt: number;
  minimumLengthFt: number;
  presetsFt: number[];
  unit: "ft";
}

export interface PublicHosePerformance {
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  workingBar: number | null;
  workingPsi: number | null;
}

export type PublicVariantSelection =
  | {
      dash: DashSize | null;
      equivalentStandard: string | null;
      hoseSeries: string;
      /** Inside diameter in mm (`id_mm`), present when read from a hose variant row. */
      idMm?: number | null;
      kind: "hose";
      nominalIdIn: number | null;
      performance: PublicHosePerformance;
      primaryStandard: string | null;
      reinforcement: string | null;
    }
  | {
      /** Hoses this size fits by the pairing rule; present on catalog page reads. */
      compatibleHoses?: CompatibleHose[];
      connectionDash: DashSize | null;
      hoseTailDash: DashSize | null;
      kind: "hose_end";
      thread: string | null;
    }
  | {
      ends: [PublicAdapterEnd, PublicAdapterEnd];
      kind: "adapter";
    }
  | {
      bodyDash: DashSize | null;
      bodySize: string | null;
      kind: "quick_coupler";
      portDash: DashSize | null;
      portGender: string | null;
      portInterface: string | null;
      portThread: string | null;
      role: string | null;
    };

export interface PublicAdapterEnd {
  dash: DashSize | null;
  /** `Male`, `Female`, or the stored connection form when it is neither. */
  form: string | null;
  /** Customer-facing interface name, such as `JIC 37°` or `NPTF`. */
  interfaceName: string | null;
  thread: string | null;
}

/** `Male JIC 37°`: how an adapter end reads in titles, picker legends and specifications. */
export function adapterEndName(end: PublicAdapterEnd) {
  return [end.form, end.interfaceName].filter(Boolean).join(" ") || null;
}

const quickCouplerRoleOrder = [
  "Coupler/Socket",
  "Plug/Nipple",
  "Complete Pair",
];

const quickCouplerRoleNames: Record<string, string> = {
  "Complete Pair": "Coupler + Nipple Set",
  "Coupler/Socket": "Coupler",
  "Plug/Nipple": "Nipple",
};

/** US names for the stored ISO roles: the female half is a coupler, the male half a nipple. */
export function quickCouplerRoleName(role: string | null) {
  return role ? (quickCouplerRoleNames[role] ?? role) : null;
}

export function compareQuickCouplerRoles(left: string, right: string) {
  const rank = (role: string) => {
    const index = quickCouplerRoleOrder.indexOf(role);
    return index < 0 ? quickCouplerRoleOrder.length : index;
  };
  return rank(left) - rank(right) || left.localeCompare(right);
}

export interface PublicCatalogItem {
  catalogBasis?: CatalogRevisionBasis;
  aliases: string[];
  canAddToQuote: boolean;
  category: CatalogFamilyId;
  displayName: string;
  familyKey: string;
  familyName: string;
  interfaceGroup: string | null;
  mainImageUrl?: string | null;
  mediaKey: string | null;
  offer: {
    currency: string;
    leadTimeDays: number;
    lengthOrdering: PublicLengthOrdering | null;
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
  variantSelection: PublicVariantSelection | null;
}

export interface PublicCatalogFamily {
  category: CatalogFamilyId;
  familyKey: string;
  familyName: string;
  interfaceGroup: string | null;
  representative: PublicCatalogItem;
  variants: PublicCatalogItem[];
}

export interface PublicCatalogFamilySummary extends Omit<
  PublicCatalogFamily,
  "variants"
> {
  variantCount: number;
  minimumReferencePrice: number | null;
}

export function summarizeCatalogFamilies(
  families: PublicCatalogFamily[],
): PublicCatalogFamilySummary[] {
  return families.map(({ variants, ...family }) => {
    const prices = variants.flatMap((variant) =>
      variant.offer?.referencePrice == null
        ? []
        : [variant.offer.referencePrice],
    );
    return {
      ...family,
      variantCount: variants.length,
      minimumReferencePrice: prices.length ? Math.min(...prices) : null,
    };
  });
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
  if (standard.includes("NPT") || standard.includes("NPSM")) {
    return "NPT / NPTF";
  }
  if (standard.includes("ORFS")) return "ORFS";
  if (standard.includes("BSPP") || standard.includes("BSPT")) {
    return "BSPP / BSPT";
  }
  if (standard.includes("ORB")) return "SAE ORB";
  if (
    standard.includes("CODE 61") ||
    standard.includes("CODE 62") ||
    standard.includes("SAE FLANGE")
  ) {
    return "SAE Flange";
  }
  return value;
}

export function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `… Hose End for R1, R2, R16 Hose`: every hose some size of the family fits, so customers can choose by hose. */
function familyNameWithHoses(family: PublicCatalogFamily) {
  const hoses = sortedCompatibleHoses(
    family.variants.flatMap((variant) =>
      variant.variantSelection?.kind === "hose_end"
        ? (variant.variantSelection.compatibleHoses ?? [])
        : [],
    ),
  );
  return hoses.length
    ? `${family.familyName} for ${hoses.map((hose) => hose.shortName).join(", ")} Hose`
    : family.familyName;
}

/** Hoses list as R1, R2, R4, R16, R17, 4SH rather than alphabetically by standard. */
function hoseShortName(family: PublicCatalogFamily) {
  const selection = family.representative.variantSelection;
  return selection?.kind === "hose"
    ? hoseStandardName(selection.hoseSeries, selection.primaryStandard)
        .shortName
    : null;
}

function compareHoseFamilies(a: PublicCatalogFamily, b: PublicCatalogFamily) {
  const [left, right] = [hoseShortName(a), hoseShortName(b)];
  return left && right ? compareHoseShortNames(left, right) : 0;
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
      familyName: familyNameWithHoses(family),
      variants: family.variants.toSorted((a, b) => a.sku.localeCompare(b.sku)),
    }))
    .toSorted(
      (a, b) =>
        categoryOrder[a.category] - categoryOrder[b.category] ||
        compareHoseFamilies(a, b) ||
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
