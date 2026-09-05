import {
  CatalogProductSeriesRejected,
  type CatalogProductSeriesRepository,
} from "../domain/catalog-product-series";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createD1CatalogProductSeriesRepository(
  database: D1Database,
): CatalogProductSeriesRepository {
  return {
    async deleteSeries(input) {
      const release = await database
        .prepare(
          `SELECT source_import_id, status FROM catalog_releases WHERE id = ?`,
        )
        .bind(input.releaseId)
        .first<{ source_import_id: string; status: string }>();
      if (!release) {
        throw new CatalogProductSeriesRejected(
          "not_found",
          "Catalog draft was not found / 未找到产品目录草稿",
        );
      }
      if (release.status !== "draft") {
        throw new CatalogProductSeriesRejected(
          "not_draft",
          "Product Series can be changed only in a Catalog draft / 产品系列只能在产品目录草稿中修改",
        );
      }

      const table =
        input.kind === "hose"
          ? "catalog_hose_series"
          : "catalog_hose_end_series";
      try {
        const result = await database
          .prepare(
            `DELETE FROM ${table} WHERE import_id = ? AND series_code = ?`,
          )
          .bind(release.source_import_id, input.seriesCode)
          .run();
        if ((result.meta.changes ?? 0) === 0) {
          throw new CatalogProductSeriesRejected(
            "not_found",
            "Product Series was not found / 未找到产品系列",
          );
        }
      } catch (error) {
        if (error instanceof CatalogProductSeriesRejected) throw error;
        const message = messageFrom(error);
        if (message.includes("Series is referenced by variants")) {
          throw new CatalogProductSeriesRejected(
            "series_in_use",
            "Series is referenced by variants / 系列已被子体引用",
          );
        }
        throw error;
      }
    },
  };
}
