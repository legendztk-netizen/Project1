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
    performance: {
      temperatureMaxC: number | null;
      temperatureMinC: number | null;
      workingBar: number | null;
      workingPsi: number | null;
    };
    primaryStandard: string | null;
    reinforcement: string | null;
    series: string;
    sku: string;
  };
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
      performance: { ...selection.performance },
      primaryStandard: selection.primaryStandard,
      reinforcement: selection.reinforcement,
      series: selection.hoseSeries,
      sku: item.sku,
    },
  };
}
