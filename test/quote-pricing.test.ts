import { expect, it } from "vitest";
import {
  initialQuotePrices,
  parseUsdCents,
  parseDiscount,
  quoteLineTotals,
  submittedReferencePrice,
  referencePriceAdjustment,
} from "../app/modules/quote-review/domain/quote-pricing";

it("shows the reference discount for a USD 2 final price without reducing the USD 200 total", () => {
  const line = {
    lineKind: "standard",
    currency: "USD",
    referenceUnitPrice: 2.26,
    quantity: 100,
  } as Parameters<typeof quoteLineTotals>[0];
  const totals = quoteLineTotals(line, {
    unitPriceCents: 200,
    discountBasisPoints: 0,
  });
  expect(totals.totalCents).toBe(20000);
  expect(referencePriceAdjustment(line, totals.totalCents)?.toFixed(2)).toBe(
    "11.50",
  );
  expect(
    referencePriceAdjustment(
      { ...line, referenceUnitPrice: 0 },
      totals.totalCents,
    ),
  ).toBeNull();
});
import type { QuoteRequestLine } from "../app/modules/quote-request/domain/quote-request";

it("compares final merchandise with captured reference merchandise, excluding service fees", () => {
  const line = {
    lineKind: "length_based_hose",
    currency: "USD",
    estimatedMerchandiseAmount: 108,
    currentEstimateAmount: 145.5,
    refresh: null,
  } as QuoteRequestLine;
  expect(referencePriceAdjustment(line, 10000)).toBeCloseTo(7.407407);
  expect(referencePriceAdjustment(line, 12000)).toBeCloseTo(-11.111111);
  expect(referencePriceAdjustment(line, 10800)).toBe(0);
  expect(
    referencePriceAdjustment({ ...line, currency: "CNY" }, 10000),
  ).toBeNull();
  expect(
    referencePriceAdjustment(
      { ...line, estimatedMerchandiseAmount: null } as QuoteRequestLine,
      10000,
    ),
  ).toBeNull();
  expect(
    referencePriceAdjustment(
      { ...line, estimatedMerchandiseAmount: 0 } as QuoteRequestLine,
      10000,
    ),
  ).toBeNull();
  const assembly = {
    lineKind: "configured_assembly",
    currency: "USD",
    refresh: {
      current: {
        merchandiseAmount: 200,
        totalReferenceAmount: 250,
        currency: "USD",
      },
    },
  } as QuoteRequestLine;
  expect(referencePriceAdjustment(assembly, 18000)).toBeCloseTo(10);
  expect(referencePriceAdjustment(assembly, null)).toBeNull();
});

it("shows captured reference totals without turning them into final prices", () => {
  const standard = {
    lineKind: "standard",
    quantity: 2,
    currency: "CNY",
    referenceUnitPrice: 12,
    refresh: null,
  } as QuoteRequestLine;
  expect(submittedReferencePrice(standard)).toEqual({
    currency: "CNY",
    amount: 24,
  });
  for (const lineKind of [
    "configured_assembly",
    "length_based_hose",
  ] as const) {
    const line = {
      ...standard,
      lineKind,
      referenceUnitPrice: null,
      currentEstimateAmount: 141.84,
    } as QuoteRequestLine;
    expect(submittedReferencePrice(line).amount).toBe(141.84);
    expect(
      submittedReferencePrice({
        ...line,
        currentEstimateAmount: null,
      } as QuoteRequestLine).amount,
    ).toBeNull();
  }
  const refreshed = {
    ...standard,
    refresh: {
      current: {
        currency: "USD",
        totalReferenceAmount: 20,
      },
    },
  } as QuoteRequestLine;
  expect(submittedReferencePrice(refreshed)).toEqual({
    currency: "USD",
    amount: 20,
  });
  expect(
    submittedReferencePrice({
      ...refreshed,
      refresh: {
        current: {
          totalReferenceAmount: null,
        },
      },
    } as QuoteRequestLine).amount,
  ).toBeNull();
  expect(initialQuotePrices([standard])[0].unitPriceCents).toBeNull();
});

it("keeps reference currency separate and requires explicit final USD pricing", () => {
  const source = {
    lineKind: "standard",
    quantity: 3,
    referenceUnitPrice: 20,
    currency: "CNY",
  } as QuoteRequestLine;
  expect(initialQuotePrices([source])).toEqual([
    { unitPriceCents: null, discountBasisPoints: 0 },
  ]);
  expect(source.referenceUnitPrice).toBe(20);
  expect(
    quoteLineTotals(source, { unitPriceCents: 250, discountBasisPoints: 1000 }),
  ).toEqual({
    quantity: 3,
    undiscountedCents: 750,
    discountCents: 75,
    totalCents: 675,
  });
});
it("prices captured total footage and assembly quantities without premature length rounding", () => {
  const hose = {
    lineKind: "length_based_hose",
    quantity: 3,
    lengthOrder: { totalFootage: 2.5 },
  } as QuoteRequestLine;
  expect(
    quoteLineTotals(hose, { unitPriceCents: 199, discountBasisPoints: 0 })
      .totalCents,
  ).toBe(498);
  const assembly = {
    lineKind: "configured_assembly",
    quantity: 2,
  } as QuoteRequestLine;
  expect(
    quoteLineTotals(assembly, { unitPriceCents: 7092, discountBasisPoints: 0 })
      .totalCents,
  ).toBe(14184);
});
it("rejects invalid prices and discounts", () => {
  expect(parseUsdCents("12.30")).toBe(1230);
  expect(parseDiscount("12.25")).toBe(1225);
  for (const value of ["-1", "NaN", "1.001", "1e5", ""])
    expect(() => parseUsdCents(value)).toThrow();
  expect(() => parseDiscount("101")).toThrow();
});
