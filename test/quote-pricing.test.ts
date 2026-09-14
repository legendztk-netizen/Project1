import { expect, it } from "vitest";
import {
  initialQuotePrices,
  parseUsdCents,
  parseDiscount,
  quoteLineTotals,
} from "../app/modules/quote-review/domain/quote-pricing";
import type { QuoteRequestLine } from "../app/modules/quote-request/domain/quote-request";

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
