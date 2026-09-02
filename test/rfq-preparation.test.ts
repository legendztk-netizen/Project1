import { describe, expect, it } from "vitest";

import {
  evaluateRfqPreparation,
  type RfqPreparationAmounts,
} from "../app/modules/quote-list/domain/rfq-preparation";
import type { PurchasingContextKind } from "../app/modules/customer-identity/domain/customer-account";

function amounts(
  merchandise: number,
  overrides: Partial<RfqPreparationAmounts> = {},
): RfqPreparationAmounts {
  return {
    duties: null,
    freight: null,
    importCharges: null,
    insurance: null,
    merchandise,
    serviceFees: 0,
    tax: null,
    ...overrides,
  };
}

function outcome(
  merchandise: number,
  purchasingContextKind: PurchasingContextKind,
) {
  return evaluateRfqPreparation({
    amounts: amounts(merchandise),
    pricingComplete: true,
    purchasingContextKind,
  }).outcome;
}

describe("RFQ preparation eligibility", () => {
  it.each([
    [99.99, "MINIMUM_NOT_MET"],
    [100, "INDIVIDUAL_DDP"],
    [3_000, "INDIVIDUAL_DDP"],
    [3_000.01, "INDIVIDUAL_DDP"],
    [4_500, "INDIVIDUAL_DDP"],
    [4_500.01, "ORGANIZATION_REQUIRED"],
  ] as const)(
    "evaluates an individual merchandise subtotal of USD %s",
    (merchandise, code) => {
      expect(outcome(merchandise, "individual").code).toBe(code);
    },
  );

  it.each([
    [99.99, "MINIMUM_NOT_MET", null],
    [100, "ORGANIZATION_DDP", "DDP"],
    [3_000, "ORGANIZATION_DDP", "DDP"],
    [3_000.01, "ORGANIZATION_DAP", "DAP"],
    [4_500, "ORGANIZATION_DAP", "DAP"],
    [4_500.01, "ORGANIZATION_DAP", "DAP"],
  ] as const)(
    "evaluates an organization merchandise subtotal of USD %s",
    (merchandise, code, fulfillmentTerm) => {
      const result = outcome(merchandise, "organization");
      expect(result.code).toBe(code);
      expect(result.fulfillmentTerm).toBe(fulfillmentTerm);
    },
  );

  it.each([
    ["service fees", { serviceFees: 10_000 }],
    ["freight", { freight: 10_000 }],
    ["tax", { tax: 10_000 }],
    ["duties", { duties: 10_000 }],
    ["import charges", { importCharges: 10_000 }],
    ["insurance", { insurance: 10_000 }],
  ] as const)("never counts %s toward the minimum", (_label, excluded) => {
    const result = evaluateRfqPreparation({
      amounts: amounts(99.99, excluded),
      pricingComplete: true,
      purchasingContextKind: "organization",
    });

    expect(result.merchandiseSubtotal).toBe(99.99);
    expect(result.outcome.code).toBe("MINIMUM_NOT_MET");
  });

  it("requires a purchasing context once the minimum is met", () => {
    expect(
      evaluateRfqPreparation({
        amounts: amounts(100),
        pricingComplete: true,
        purchasingContextKind: null,
      }).outcome.code,
    ).toBe("PURCHASING_CONTEXT_REQUIRED");
  });

  it("does not claim eligibility when current pricing is incomplete", () => {
    expect(
      evaluateRfqPreparation({
        amounts: amounts(5_000),
        pricingComplete: false,
        purchasingContextKind: "organization",
      }).outcome.code,
    ).toBe("INCOMPLETE_PRICING");
  });

  it.each([99.995, 3_000.004, 4_500.004])(
    "rejects the non-currency precision amount %s instead of rounding across a boundary",
    (merchandise) => {
      expect(() =>
        evaluateRfqPreparation({
          amounts: amounts(merchandise),
          pricingComplete: true,
          purchasingContextKind: "individual",
        }),
      ).toThrow("Merchandise subtotal must not contain fractional cents.");
    },
  );
});
