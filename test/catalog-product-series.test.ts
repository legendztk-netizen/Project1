import { describe, expect, it, vi } from "vitest";

import { CatalogProductSeriesRejected } from "../app/modules/catalog/domain/catalog-product-series";
import { createD1CatalogProductSeriesRepository } from "../app/modules/catalog/infrastructure/d1-catalog-product-series-repository";

describe("Catalog Product Series repository", () => {
  it("returns a bilingual domain rejection when a referenced series is deleted", async () => {
    const first = vi.fn().mockResolvedValue({
      source_import_id: "draft-import",
      status: "draft",
    });
    const run = vi
      .fn()
      .mockRejectedValue(new Error("Series is referenced by variants"));
    const database = {
      prepare: vi
        .fn()
        .mockReturnValueOnce({ bind: () => ({ first }) })
        .mockReturnValueOnce({ bind: () => ({ run }) }),
    } as unknown as D1Database;

    await expect(
      createD1CatalogProductSeriesRepository(database).deleteSeries({
        kind: "hose",
        releaseId: "draft-release",
        seriesCode: "601R1",
      }),
    ).rejects.toEqual(
      new CatalogProductSeriesRejected(
        "series_in_use",
        "Series is referenced by variants / 系列已被子体引用",
      ),
    );
  });
});
