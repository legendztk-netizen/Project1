export type CatalogProductSeriesKind = "hose" | "hose_end";

export class CatalogProductSeriesRejected extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "not_draft"
      | "series_code_immutable"
      | "series_in_use",
    message: string,
  ) {
    super(message);
    this.name = "CatalogProductSeriesRejected";
  }
}

export interface CatalogProductSeriesRepository {
  deleteSeries(input: {
    kind: CatalogProductSeriesKind;
    releaseId: string;
    seriesCode: string;
  }): Promise<void>;
}
