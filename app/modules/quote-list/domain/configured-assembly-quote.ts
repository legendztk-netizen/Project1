import type { DraftValidationIssue } from "../../configurator/domain/assembly-draft-validation";
import type { AssemblyReviewOutcome } from "../../configurator/domain/assembly-review";
import type { HoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";

export interface ConfiguredAssemblySnapshot {
  configuration: HoseConfigurationDraft;
  review: {
    issues: DraftValidationIssue[];
    outcome: AssemblyReviewOutcome;
  };
  sourceCatalogRelease: {
    id: string;
    number: string;
  };
}

export interface ConfiguredAssemblyEstimateInput {
  assemblyServiceUsd: number | null;
  ferruleAPriceUsd: number | null;
  ferruleBPriceUsd: number | null;
  finishedOverallLengthFeet: number;
  hoseCutLengthFeet: number | null;
  hoseEndAPriceUsd: number | null;
  hoseEndBPriceUsd: number | null;
  hosePricePerFootUsd: number | null;
  protectionUsd: number | null;
}

export interface ConfiguredAssemblyEstimateBasis extends ConfiguredAssemblyEstimateInput {
  basis: "versioned_reference_inputs";
  catalogReleaseId: string;
  currency: "USD";
  protectionRecordVersion: number;
  scheduleRecordVersion: number;
}

export function calculateConfiguredAssemblyEstimate(
  input: ConfiguredAssemblyEstimateInput,
) {
  const pricedInputs = [
    ["hose", input.hosePricePerFootUsd],
    ["hose_cut_length", input.hoseCutLengthFeet],
    ["hose_end_a", input.hoseEndAPriceUsd],
    ["hose_end_b", input.hoseEndBPriceUsd],
    ["ferrule_a", input.ferruleAPriceUsd],
    ["ferrule_b", input.ferruleBPriceUsd],
    ["assembly_service", input.assemblyServiceUsd],
    ["installed_protection", input.protectionUsd],
  ] as const;
  const missingInputs = pricedInputs.flatMap(([name, price]) =>
    price === null ? [name] : [],
  );
  if (missingInputs.length > 0) {
    return { missingInputs, unitEstimateUsd: null };
  }
  const total =
    (input.hoseCutLengthFeet ?? 0) * (input.hosePricePerFootUsd ?? 0) +
    (input.hoseEndAPriceUsd ?? 0) +
    (input.hoseEndBPriceUsd ?? 0) +
    (input.ferruleAPriceUsd ?? 0) +
    (input.ferruleBPriceUsd ?? 0) +
    (input.assemblyServiceUsd ?? 0) +
    (input.protectionUsd ?? 0);
  return {
    missingInputs,
    unitEstimateUsd: Math.round((total + Number.EPSILON) * 100) / 100,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export async function configuredAssemblyLineIdentity(material: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(material)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `configured:${hash}`;
}
