import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import type { CompatibleHoseEndCandidate } from "./compatible-end-a";
import type {
  FinishedAssemblyLengthSnapshot,
  MeasurementSelectionSnapshot,
} from "./finished-assembly-length";
import type { ClockingDraftSnapshot } from "./assembly-clocking";
import type {
  ApplicationRequirementsSnapshot,
  AssemblyLengthReferencePricing,
} from "./protection-and-application";
import type { InstalledProtection } from "../../configurator-reference/domain/configurator-reference";

interface ConfiguredHoseEnd {
  assemblyWorkingBar: number | null;
  compatibilityId: string;
  ferrule: CompatibleHoseEndCandidate["ferrule"];
  hoseEnd: Omit<
    CompatibleHoseEndCandidate,
    "assemblyWorkingBar" | "compatibilityId" | "ferrule" | "hoseEndSku"
  > & {
    sku: string;
  };
}

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
  endA?: ConfiguredHoseEnd;
  endB?: ConfiguredHoseEnd;
  clocking?: ClockingDraftSnapshot;
  finishedLength?: FinishedAssemblyLengthSnapshot;
  measurementSelection?: MeasurementSelectionSnapshot;
  applicationRequirements?: ApplicationRequirementsSnapshot;
  installedProtection?: InstalledProtection;
  lengthReferencePricing?: AssemblyLengthReferencePricing;
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
