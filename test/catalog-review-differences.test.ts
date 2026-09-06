import { describe, expect, it } from "vitest";

import { filterDraftReviewToPublicationDifferences } from "../app/modules/admin/routes/catalog-review";
import type { DraftCatalogReview } from "../app/modules/catalog/domain/catalog-draft-availability";
import type { CatalogPublicationPreview } from "../app/modules/catalog/domain/catalog-publication";

function differenceGroup(changes: string[] = []) {
  return { additions: [], changes, removals: [] };
}

describe("Catalog draft review differences", () => {
  it("intersects explicit review results with the selected Draft changes", () => {
    const product = (sku: string): DraftCatalogReview["products"][number] => ({
      catalogPublicationStatus: "Published",
      costBasisCurrency: null,
      factoryUnitPrice: null,
      hoseSeries: "601R1",
      priceIncoterm: null,
      productType: "hose",
      referencePriceUsd: 2.16,
      rfqEligibility: "Eligible",
      sku,
      sourceWorksheet: "01_胶管主数据",
      supplyAvailability: "available_for_quote",
      technicalDataStatus: "Complete",
    });
    const relationship = (
      compatibilityId: string,
    ): DraftCatalogReview["compatibilities"][number] => ({
      catalogPublicationStatus: "Published",
      compatibilityId,
      ferruleSku: "FERRULE-1",
      hoseEndSku: "END-1",
      hoseSku: "SKU-CHANGED",
      productionApprovalStatus: "not_approved",
      qualificationStatus: "Not Tested",
      rfqEligibility: "Eligible",
      technicalDataStatus: "Pending",
    });
    const review = {
      compatibilities: [relationship("COMP-CHANGED"), relationship("COMP-OLD")],
      filters: { hoseSeries: null, sku: "SKU", sourceWorksheet: null },
      hoseSeriesOptions: ["601R1"],
      products: [product("SKU-CHANGED"), product("SKU-OLD")],
      release: {
        createdAt: "2026-09-06T00:00:00.000Z",
        id: "draft-1",
        releaseNumber: "DRAFT-1",
        sourceImportId: "import-1",
        status: "draft",
      },
      totalCount: 2,
      worksheetOptions: ["01_胶管主数据"],
    } satisfies DraftCatalogReview;
    const preview = {
      images: differenceGroup(),
      prices: differenceGroup(),
      products: differenceGroup(["SKU-CHANGED"]),
      relationships: differenceGroup(["Compatibility COMP-CHANGED"]),
    } satisfies Pick<
      CatalogPublicationPreview,
      "images" | "prices" | "products" | "relationships"
    >;

    expect(filterDraftReviewToPublicationDifferences(review, preview)).toEqual(
      expect.objectContaining({
        compatibilities: [relationship("COMP-CHANGED")],
        products: [product("SKU-CHANGED")],
        totalCount: 1,
      }),
    );
  });
});
