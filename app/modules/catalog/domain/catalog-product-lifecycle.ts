import type {
  CatalogPublicationStatus,
  RfqEligibility,
} from "./catalog-workbook";

export const productLifecycleStatuses = [
  "online",
  "draft",
  "discontinued",
] as const;

export type ProductLifecycleStatus = (typeof productLifecycleStatuses)[number];

export const productLifecycleLabels: Record<ProductLifecycleStatus, string> = {
  discontinued: "Discontinued / 停用",
  draft: "Draft / 草稿",
  online: "Online / 上线",
};

export function productLifecycleState(status: ProductLifecycleStatus): {
  catalogPublicationStatus: CatalogPublicationStatus;
  rfqEligibility: RfqEligibility;
  supplyAvailability:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
} {
  switch (status) {
    case "online":
      return {
        catalogPublicationStatus: "Published",
        rfqEligibility: "Eligible",
        supplyAvailability: "available_for_quote",
      };
    case "draft":
      return {
        catalogPublicationStatus: "Draft",
        rfqEligibility: "Eligible",
        supplyAvailability: "temporarily_unavailable",
      };
    case "discontinued":
      return {
        catalogPublicationStatus: "Archived",
        rfqEligibility: "Blocked",
        supplyAvailability: "discontinued",
      };
  }
}

export function inferProductLifecycleStatus(input: {
  catalogPublicationStatus: CatalogPublicationStatus;
  supplyAvailability?:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
}): ProductLifecycleStatus {
  if (
    input.catalogPublicationStatus === "Archived" ||
    input.supplyAvailability === "discontinued"
  ) {
    return "discontinued";
  }
  return input.catalogPublicationStatus === "Published" ? "online" : "draft";
}
