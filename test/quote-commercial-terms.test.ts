import { expect, it } from "vitest";
import {
  validateCommercialTerms,
  commercialTotals,
} from "../app/modules/quote-review/domain/quote-commercial-terms";
import type { QuoteRequestSnapshot } from "../app/modules/quote-request/domain/quote-request";
import {
  commercialAddress,
  commercialTerms,
} from "./fixtures/quote-commercial";
const source = {
  destination: commercialAddress,
  amounts: { manualCommercialReview: false },
  importResponsibility: { fulfillmentTerm: "DDP" },
  lines: [{ lineKind: "standard", quantity: 2, currency: "USD" }],
} as QuoteRequestSnapshot;
it("requires explicit address, shipment, packing, tax and lead-time review", () => {
  expect(validateCommercialTerms(commercialTerms(), source).shipmentMode).toBe(
    "together",
  );
  for (const input of [
    { ...commercialTerms(), addressConfirmed: false },
    {
      ...commercialTerms(),
      destination: { ...commercialAddress, city: "Boston" },
    },
    { ...commercialTerms(), shipmentMode: "split" as const },
    { ...commercialTerms(), packingEstimate: "" },
    { ...commercialTerms(), freightReviewConfirmed: false },
    { ...commercialTerms(), leadTime: "" },
    { ...commercialTerms(), incoterm: "DAP" as const },
    { ...commercialTerms(), taxTreatment: "Exempt" as const },
  ])
    expect(() => validateCommercialTerms(input, source)).toThrow();
  expect(
    validateCommercialTerms(
      {
        ...commercialTerms(),
        shipmentMode: "split",
        splitPlan: "One shipment per product line",
        incoterm: "DAP",
        termReplacementReason: "Customer-approved import responsibility",
      },
      source,
    ).incoterm,
  ).toBe("DAP");
});
it("preserves reviewed address replacements, DAP, split plans and optional actual packing", () => {
  const input = {
    ...commercialTerms(),
    destination: { ...commercialAddress, city: "Boston" },
    addressReplacementReason: "Buyer confirmed relocation",
    incoterm: "DAP" as const,
    shipmentMode: "split" as const,
    splitPlan: "10 pieces on day 5; remaining 90 on day 20",
    leadTime: "100 pieces: 20 days; split dates as quoted",
    actualPacking: "2 cartons; 19.5 kg gross; 50 x 40 x 30 cm each",
  };
  const result = validateCommercialTerms(input, {
    ...source,
    importResponsibility: {
      fulfillmentTerm: "DAP",
      version: "organization-dap-v1",
    },
    acknowledgements: {
      ...source.acknowledgements,
      version: "organization-request-v1",
    },
    purchasingContext: {
      ...source.purchasingContext,
      kind: "organization",
      countryCode: "US",
      legalName: "Test Company",
    },
  });
  expect(result).toEqual(input);
  expect(validateCommercialTerms(commercialTerms(), source).actualPacking).toBe(
    "",
  );
});
it("keeps explicit fees in reproducible totals and never presumes tax exemption or FX", () => {
  const input = commercialTerms();
  expect(
    commercialTotals(
      source,
      [{ unitPriceCents: 10000, discountBasisPoints: 1000 }],
      input.charges,
    ),
  ).toEqual({
    currency: "USD",
    merchandiseCents: 18000,
    discountCents: 2000,
    totalCents: 20800,
  });
  expect(() =>
    validateCommercialTerms(
      { ...input, charges: { ...input.charges, salesTax: 100 } },
      source,
    ),
  ).toThrow(/Tax amount/);
  expect(() =>
    validateCommercialTerms(
      { ...input, manualCurrencyConfirmed: false },
      {
        ...source,
        amounts: { ...source.amounts, manualCommercialReview: true },
      },
    ),
  ).toThrow(/manual USD/);
  expect(
    validateCommercialTerms(
      {
        ...input,
        taxTreatment: "Collected",
        charges: { ...input.charges, salesTax: 100 },
      },
      source,
    ).charges.salesTax,
  ).toBe(100);
});
