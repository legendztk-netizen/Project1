import { expect, it } from "vitest";
import type { QuoteRequestSnapshot } from "../app/modules/quote-request/domain/quote-request";
import { validateQuoteIssuance } from "../app/modules/quote-review/domain/quote-revision";
import {
  commercialAddress,
  commercialTerms,
} from "./fixtures/quote-commercial";

const source = {
  destination: commercialAddress,
  amounts: { manualCommercialReview: true },
  importResponsibility: { fulfillmentTerm: "DDP" },
  lines: [{ lineKind: "standard", quantity: 2, currency: "CNY" }],
} as QuoteRequestSnapshot;
it("blocks incomplete prices or commercial review without automatic reference conversion", () => {
  const draft = {
    source,
    prices: [{ unitPriceCents: 1500, discountBasisPoints: 0 }],
    terms: commercialTerms(),
  };
  expect(validateQuoteIssuance(draft, false).totals.totalCents).toBe(5800);
  expect(() => validateQuoteIssuance({ ...draft, terms: null }, true)).toThrow(
    /terms/,
  );
  expect(() =>
    validateQuoteIssuance(
      { ...draft, prices: [{ unitPriceCents: null, discountBasisPoints: 0 }] },
      true,
    ),
  ).toThrow(/prices/);
  expect(() =>
    validateQuoteIssuance(
      {
        ...draft,
        terms: { ...commercialTerms(), manualCurrencyConfirmed: false },
      },
      true,
    ),
  ).toThrow(/manual USD/);
  expect(() =>
    validateQuoteIssuance(
      { ...draft, terms: { ...commercialTerms(), addressConfirmed: false } },
      true,
    ),
  ).toThrow(/address/);
  expect(() =>
    validateQuoteIssuance(
      {
        ...draft,
        terms: { ...commercialTerms(), freightReviewConfirmed: false },
      },
      true,
    ),
  ).toThrow(/freight/);
});
