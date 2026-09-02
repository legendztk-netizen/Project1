import { describe, expect, it } from "vitest";

import type { AnonymousQuoteLine } from "../app/modules/quote-list/domain/anonymous-quote-list";
import type {
  ConfiguredAssemblyEstimateBasis,
  ConfiguredAssemblySnapshot,
} from "../app/modules/quote-list/domain/configured-assembly-quote";
import {
  discountedMerchandiseSubtotal,
  refreshConfiguredAssemblyQuoteLine,
  refreshLengthBasedHoseQuoteLine,
  refreshStandardQuoteLine,
} from "../app/modules/quote-list/domain/quote-list-refresh";
import { publicHoseFixture } from "./fixtures/public-hose";

const refreshedAt = "2026-08-31T08:00:00.000Z";

function common() {
  return {
    catalogReleaseId: "release-001",
    category: "hydraulic-hose" as const,
    currency: "USD",
    displayName: "601R1 Hydraulic Hose",
    id: "line-1",
    quantity: 2,
    refresh: null,
    salesUnit: "ft",
    sku: "601R1_001",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function standardLine(): Extract<AnonymousQuoteLine, { lineKind: "standard" }> {
  return {
    ...common(),
    currentEstimateAmount: null,
    cuttingLabelingFeeAmount: null,
    cuttingLabelingFeeRate: null,
    estimatedMerchandiseAmount: null,
    lengthOrder: null,
    lineKind: "standard",
    referenceUnitPrice: 10,
  };
}

function lengthLine(): Extract<
  AnonymousQuoteLine,
  { lineKind: "length_based_hose" }
> {
  return {
    ...common(),
    currentEstimateAmount: 202,
    cuttingLabelingFeeAmount: 2,
    cuttingLabelingFeeRate: 1,
    estimatedMerchandiseAmount: 200,
    lengthOrder: {
      normalizedLengthFt: 10,
      originalLengthUnit: "ft",
      originalLengthValue: 10,
      pieceCount: 2,
      totalFootage: 20,
    },
    lineKind: "length_based_hose",
    referenceUnitPrice: 10,
  };
}

function configuredMaterials() {
  const basis: ConfiguredAssemblyEstimateBasis = {
    assemblyServiceUsd: 1,
    basis: "versioned_reference_inputs",
    catalogReleaseId: "release-002",
    currency: "USD",
    ferruleAPriceUsd: 2,
    ferruleBPriceUsd: 2,
    finishedOverallLengthFeet: 2,
    hoseCutLengthFeet: 2,
    hoseEndAPriceUsd: 5,
    hoseEndBPriceUsd: 5,
    hosePricePerFootUsd: 3,
    protectionRecordVersion: 2,
    protectionUsd: 6,
    scheduleRecordVersion: 2,
  };
  const snapshot = {
    configuration: {
      installedProtection: {
        availability: "available",
        code: "NYLON",
        currency: "USD",
        isNoAdditionalProtection: false,
        publicName: "Nylon Protective Sleeving",
        recordVersion: 2,
        referenceBasePriceUsd: 2,
        referenceInstallationPricePerStartedFootUsd: 1,
        referenceMaterialPricePerFootUsd: 1,
        referencePriceUsd: null,
        specification: "Nylon sleeve",
      },
      lengthReferencePricing: {
        assemblyServiceUsd: 1,
        exactLengthFeet: 2,
        missingInputs: [],
        protectionUsd: 6,
        scheduleRecordVersion: 2,
        startedFeet: 2,
      },
    },
    review: { issues: [], outcome: "ready" },
    sourceCatalogRelease: { id: "release-002", number: "CAT-002" },
  } as unknown as ConfiguredAssemblySnapshot;
  return { basis, snapshot };
}

function configuredLine(): Extract<
  AnonymousQuoteLine,
  { lineKind: "configured_assembly" }
> {
  const { basis, snapshot } = configuredMaterials();
  return {
    ...common(),
    configuredAssembly: {
      currentIssue: null,
      estimateBasis: basis,
      snapshot,
      unitEstimateAmount: 27,
    },
    currentEstimateAmount: 54,
    cuttingLabelingFeeAmount: null,
    cuttingLabelingFeeRate: null,
    estimatedMerchandiseAmount: null,
    lengthOrder: null,
    lineKind: "configured_assembly",
    referenceUnitPrice: null,
  };
}

describe("Quote List refresh", () => {
  it("shows former and current standard-product estimates without changing the requested line", () => {
    const line = standardLine();
    const refresh = refreshStandardQuoteLine({
      line,
      product: publicHoseFixture({
        offer: {
          currency: "USD",
          leadTimeDays: 10,
          lengthOrdering: null,
          madeToOrder: false,
          moq: 1,
          referencePrice: 12,
          salesUnit: "ft",
        },
      }),
      refreshedAt,
    });

    expect(refresh.changed).toBe(true);
    expect(refresh.former.discountedMerchandiseAmount).toBe(20);
    expect(refresh.current.discountedMerchandiseAmount).toBe(24);
    expect(refresh.status).toBe("ready");
    expect(line.referenceUnitPrice).toBe(10);
  });

  it("re-evaluates a versioned current discount against the retained release discount", () => {
    const refresh = refreshStandardQuoteLine({
      currentDiscount: {
        discountPercent: 10,
        minimumQuantity: 2,
        recordVersion: 3,
      },
      formerDiscount: {
        discountPercent: 5,
        minimumQuantity: 2,
        recordVersion: 1,
      },
      line: standardLine(),
      product: publicHoseFixture({
        offer: {
          currency: "USD",
          leadTimeDays: 10,
          lengthOrdering: null,
          madeToOrder: false,
          moq: 1,
          referencePrice: 10,
          salesUnit: "ft",
        },
      }),
      refreshedAt,
    });

    expect(refresh.former.discountedMerchandiseAmount).toBe(19);
    expect(refresh.current.discountedMerchandiseAmount).toBe(18);
    expect(refresh.former.discountPercent).toBe(5);
    expect(refresh.current.discountRecordVersion).toBe(3);
  });

  it("blocks a current standard product with a missing reference price", () => {
    const refresh = refreshStandardQuoteLine({
      line: standardLine(),
      product: publicHoseFixture({
        offer: {
          currency: "USD",
          leadTimeDays: 10,
          lengthOrdering: null,
          madeToOrder: false,
          moq: 1,
          referencePrice: null,
          salesUnit: "ft",
        },
      }),
      refreshedAt,
    });

    expect(refresh.current.discountedMerchandiseAmount).toBeNull();
    expect(refresh.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "CURRENT_PRICE_MISSING" }),
    );
  });

  it("blocks a standard line when the current SKU changes ordering terms", () => {
    const refresh = refreshStandardQuoteLine({
      line: standardLine(),
      product: publicHoseFixture({
        offer: {
          currency: "USD",
          leadTimeDays: 10,
          lengthOrdering: {
            cuttingLabelingFee: {
              currency: "USD",
              ratePerPiece: 1,
              scope: "global",
              version: 2,
            },
            incrementFt: 1,
            minimumLengthFt: 1,
            presetsFt: [],
            unit: "ft",
          },
          madeToOrder: true,
          moq: 1,
          referencePrice: 10,
          salesUnit: "ft",
        },
      }),
      refreshedAt,
    });

    expect(refresh.status).toBe("blocked");
    expect(refresh.current.discountedMerchandiseAmount).toBeNull();
    expect(refresh.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "PRODUCT_TERMS_CHANGED" }),
    );
  });

  it("retains unavailable lines with an actionable blocking reason", () => {
    const refresh = refreshStandardQuoteLine({
      line: standardLine(),
      product: publicHoseFixture({
        canAddToQuote: false,
        supplyAvailability: "temporarily_unavailable",
      }),
      refreshedAt,
    });

    expect(refresh.status).toBe("blocked");
    expect(refresh.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "SUPPLY_TEMPORARILY_UNAVAILABLE" }),
    );
  });

  it("recalculates length merchandise and Cutting & Labeling separately", () => {
    const refresh = refreshLengthBasedHoseQuoteLine({
      line: lengthLine(),
      product: publicHoseFixture({
        offer: {
          currency: "USD",
          leadTimeDays: 10,
          lengthOrdering: {
            cuttingLabelingFee: {
              currency: "USD",
              ratePerPiece: 1.5,
              scope: "global",
              version: 3,
            },
            incrementFt: 1,
            minimumLengthFt: 1,
            presetsFt: [25, 50, 100],
            unit: "ft",
          },
          madeToOrder: true,
          moq: 1,
          referencePrice: 11,
          salesUnit: "ft",
        },
      }),
      refreshedAt,
    });

    expect(refresh.current.discountedMerchandiseAmount).toBe(220);
    expect(refresh.current.serviceFeeAmount).toBe(3);
    expect(refresh.current.serviceFeeRate).toBe(1.5);
    expect(refresh.current.serviceFeeRecordVersion).toBe(3);
    expect(refresh.current.serviceFeeScope).toBe("global");
    expect(refresh.current.totalReferenceAmount).toBe(223);
  });

  it("blocks a retained cut length that no longer matches current increments", () => {
    const refresh = refreshLengthBasedHoseQuoteLine({
      line: lengthLine(),
      product: publicHoseFixture({
        offer: {
          currency: "USD",
          leadTimeDays: 10,
          lengthOrdering: {
            cuttingLabelingFee: {
              currency: "USD",
              ratePerPiece: 1,
              scope: "global",
              version: 2,
            },
            incrementFt: 6,
            minimumLengthFt: 5,
            presetsFt: [],
            unit: "ft",
          },
          madeToOrder: true,
          moq: 1,
          referencePrice: 10,
          salesUnit: "ft",
        },
      }),
      refreshedAt,
    });

    expect(refresh.status).toBe("blocked");
    expect(refresh.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "LENGTH_ORDERING_CHANGED" }),
    );
    expect(refresh.current.discountedMerchandiseAmount).toBe(200);
  });

  it("keeps configured-assembly service charges out of merchandise subtotal", () => {
    const line = configuredLine();
    const { basis, snapshot } = configuredMaterials();
    const refresh = refreshConfiguredAssemblyQuoteLine({
      current: { basis, snapshot, unitEstimateAmount: 27 },
      issue: null,
      line,
      refreshedAt,
    });
    const refreshed = { ...line, refresh };

    expect(refresh.current.discountedMerchandiseAmount).toBe(48);
    expect(refresh.current.serviceFeeAmount).toBe(6);
    expect(refresh.current.totalReferenceAmount).toBe(54);
    expect(discountedMerchandiseSubtotal([refreshed])).toBe(48);
  });

  it("shows former and current assembly-service estimates separately", () => {
    const line = configuredLine();
    const { basis, snapshot } = configuredMaterials();
    const refresh = refreshConfiguredAssemblyQuoteLine({
      current: {
        basis: { ...basis, assemblyServiceUsd: 2 },
        snapshot,
        unitEstimateAmount: 28,
      },
      issue: null,
      line,
      refreshedAt,
    });

    expect(refresh.changed).toBe(true);
    expect(refresh.former.serviceFeeAmount).toBe(6);
    expect(refresh.current.serviceFeeAmount).toBe(8);
  });

  it("blocks invalid configured assemblies without removing their original snapshot", () => {
    const line = configuredLine();
    const refresh = refreshConfiguredAssemblyQuoteLine({
      current: null,
      issue: "End A is no longer compatible with the selected hose.",
      line,
      refreshedAt,
    });

    expect(refresh.status).toBe("blocked");
    expect(refresh.current.discountedMerchandiseAmount).toBeNull();
    expect(refresh.former.discountedMerchandiseAmount).toBe(48);
    expect(line.configuredAssembly.snapshot).toBeTruthy();
  });
});
