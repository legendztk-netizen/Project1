import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";

export interface HoseConfigurationDraft {
  catalogRelease: {
    id: string;
    number: string;
  };
  hose: {
    dash: string | null;
    equivalentStandard: string | null;
    familyKey: string;
    familyName: string;
    mediaKey: string | null;
    nominalIdIn: number | null;
    primaryStandard: string | null;
    reinforcement: string | null;
    series: string;
    sku: string;
    temperatureMaxC: number | null;
    temperatureMinC: number | null;
    workingBar: number | null;
    workingPsi: number | null;
  };
  status: "hose_selected";
}

export function createHoseConfigurationDraft(
  item: PublicCatalogItem,
): HoseConfigurationDraft | null {
  const selection = item.variantSelection;
  if (
    item.productType !== "hose" ||
    !item.canAddToQuote ||
    selection?.kind !== "hose"
  ) {
    return null;
  }

  return {
    catalogRelease: {
      id: item.releaseId,
      number: item.releaseNumber,
    },
    hose: {
      dash: selection.dash,
      equivalentStandard: selection.equivalentStandard,
      familyKey: item.familyKey,
      familyName: item.familyName,
      mediaKey: item.mediaKey,
      nominalIdIn: selection.nominalIdIn,
      primaryStandard: selection.primaryStandard,
      reinforcement: selection.reinforcement,
      series: selection.hoseSeries,
      sku: item.sku,
      temperatureMaxC: selection.temperatureMaxC,
      temperatureMinC: selection.temperatureMinC,
      workingBar: selection.workingBar,
      workingPsi: selection.workingPsi,
    },
    status: "hose_selected",
  };
}
