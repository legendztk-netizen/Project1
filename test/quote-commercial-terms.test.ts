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
  lines: [{ id: "line-1", lineKind: "standard", quantity: 2, currency: "USD" }],
} as QuoteRequestSnapshot;
const splitGroups = (incoterm: "DDP" | "DAP", namedPlace: string) =>
  [1, 2].map((index) => ({
    id: `batch-${index}`,
    label: `Batch ${index}`,
    allocations: [{ lineId: "line-1", physicalQuantity: 1 }],
    freightCents: index === 1 ? 2000 : 0,
    insuranceCents: index === 1 ? 100 : 0,
    dutiesImportCents: index === 1 ? 300 : 0,
    transportMethod: "Air freight",
    incoterm,
    namedPlace,
  }));
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
        shipmentGroups: splitGroups("DAP", "New York, US"),
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
    shipmentGroups: splitGroups("DAP", "New York, US"),
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
  expect(result).toMatchObject(input);
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
it("requires manual currency confirmation for amended assemblies with captured non-USD component offers", () => {
  const amended = {
    ...source,
    lines: [
      {
        id: "assembly-1",
        lineKind: "configured_assembly",
        quantity: 2,
        currency: "USD",
        configuredAssembly: {
          snapshot: {
            productBasis: [
              { sku: "END", offer: { currency: "CNY", referencePrice: 100 } },
            ],
          },
        },
      },
    ],
  } as unknown as QuoteRequestSnapshot;
  expect(() =>
    validateCommercialTerms(
      { ...commercialTerms(), manualCurrencyConfirmed: false },
      amended,
    ),
  ).toThrow(/manual USD/);
  expect(
    validateCommercialTerms(
      { ...commercialTerms(), manualCurrencyConfirmed: true },
      amended,
    ).manualCurrencyConfirmed,
  ).toBe(true);
});

it("keeps new shipment commitments at least as long as the longest reviewed line", () => {
  expect(() =>
    validateCommercialTerms(
      {
        ...commercialTerms(),
        readySchedule: { kind: "china_business_days", days: 9 },
      },
      source,
      { requireReadySchedule: true },
    ),
  ).toThrow(/longest preparation/);
  const mixed = {
    ...source,
    lines: [
      ...source.lines,
      {
        id: "assembly-1",
        sku: "ASSEMBLY",
        lineKind: "configured_assembly",
        quantity: 1,
        configuredAssembly: { snapshot: { productBasis: [] } },
      },
    ],
  } as unknown as QuoteRequestSnapshot;
  const terms = {
    ...commercialTerms(),
    preparationDaysByLine: { "line-1": 10, "assembly-1": 15 },
    readySchedule: { kind: "china_business_days" as const, days: 15 },
  };
  expect(() =>
    validateCommercialTerms(terms, mixed, { requireReadySchedule: true }),
  ).toThrow(/Sales must confirm assembly/);
  expect(
    validateCommercialTerms({ ...terms, assemblyLeadConfirmed: true }, mixed, {
      requireReadySchedule: true,
    }).preparationDaysByLine,
  ).toEqual({ "line-1": 10, "assembly-1": 15 });
  expect(() =>
    validateCommercialTerms(
      {
        ...terms,
        assemblyLeadConfirmed: true,
        readySchedule: { kind: "china_business_days", days: 14 },
      },
      mixed,
      { requireReadySchedule: true },
    ),
  ).toThrow(/longest preparation/);
});
