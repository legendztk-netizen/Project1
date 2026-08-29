import { describe, expect, it } from "vitest";

import {
  calculateConfiguredAssemblyEstimate,
  configuredAssemblyLineIdentity,
  type ConfiguredAssemblyEstimateInput,
} from "../app/modules/quote-list/domain/configured-assembly-quote";
import { catalogSalesUnitMatches } from "../app/modules/quote-list/application/prepare-configured-assembly";

function estimateInput(
  overrides: Partial<ConfiguredAssemblyEstimateInput> = {},
): ConfiguredAssemblyEstimateInput {
  return {
    assemblyServiceUsd: 1,
    ferruleAPriceUsd: 2,
    ferruleBPriceUsd: 2,
    finishedOverallLengthFeet: 2,
    hoseCutLengthFeet: 2,
    hoseEndAPriceUsd: 5,
    hoseEndBPriceUsd: 5,
    hosePricePerFootUsd: 3,
    protectionUsd: 0,
    ...overrides,
  };
}

describe("configured assembly Quote List domain", () => {
  it("recognizes imported EA and FT sales-unit aliases", () => {
    expect(catalogSalesUnitMatches("EA", "each")).toBe(true);
    expect(catalogSalesUnitMatches("FT", "ft")).toBe(true);
    expect(catalogSalesUnitMatches("EA", "ft")).toBe(false);
  });

  it("calculates one complete non-binding USD estimate", () => {
    expect(calculateConfiguredAssemblyEstimate(estimateInput())).toEqual({
      missingInputs: [],
      unitEstimateUsd: 21,
    });
  });

  it("withholds the entire amount when a required price is missing", () => {
    expect(
      calculateConfiguredAssemblyEstimate(
        estimateInput({ hoseEndBPriceUsd: null }),
      ),
    ).toEqual({
      missingInputs: ["hose_end_b"],
      unitEstimateUsd: null,
    });
  });

  it("does not substitute finished overall length for unknown cut length", () => {
    expect(
      calculateConfiguredAssemblyEstimate(
        estimateInput({ hoseCutLengthFeet: null }),
      ),
    ).toEqual({
      missingInputs: ["hose_cut_length"],
      unitEstimateUsd: null,
    });
  });

  it("uses a stable exact-configuration identity independent of key order", async () => {
    const first = await configuredAssemblyLineIdentity({
      endA: { sku: "JIC_F_SW_04_04" },
      hose: "601R1_001",
      length: "304.8",
    });
    const second = await configuredAssemblyLineIdentity({
      length: "304.8",
      hose: "601R1_001",
      endA: { sku: "JIC_F_SW_04_04" },
    });
    const changed = await configuredAssemblyLineIdentity({
      endA: { sku: "JIC_F_SW_04_04" },
      hose: "601R1_001",
      length: "609.6",
    });

    expect(second).toBe(first);
    expect(changed).not.toBe(first);
    expect(first).toMatch(/^configured:[a-f0-9]{64}$/u);
  });
});
