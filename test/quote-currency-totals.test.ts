import { describe, expect, it } from "vitest";
import {
  quoteCurrencyTotals,
  formatQuoteAmounts,
} from "../app/modules/quote-list/domain/quote-currency-totals";
import { calculateLengthBasedHoseEstimate } from "../app/modules/quote-list/domain/length-based-hose";
import type { AnonymousQuoteLine } from "../app/modules/quote-list/domain/anonymous-quote-list";
const line = (currency: string, amount: number, fee = 0) =>
  ({
    lineKind: "standard",
    currency,
    refresh: {
      current: {
        currency,
        discountedMerchandiseAmount: amount,
        serviceFeeAmount: fee,
      },
    },
  }) as AnonymousQuoteLine;
describe("currency-safe quote totals", () => {
  it("groups original currencies and never constructs a mixed merchandise total", () => {
    const result = quoteCurrencyTotals([
      line("CNY", 100),
      line("CNY", 20),
      line("EUR", 15),
      line("USD", 110),
    ]);
    expect(result).toEqual({
      manualReview: true,
      groups: [
        { currency: "CNY", merchandiseSubtotal: 120, serviceFeeTotal: 0 },
        { currency: "EUR", merchandiseSubtotal: 15, serviceFeeTotal: 0 },
        { currency: "USD", merchandiseSubtotal: 110, serviceFeeTotal: 0 },
      ],
    });
  });
  it("reserves automated commercial evaluation for a complete USD subtotal", () => {
    expect(quoteCurrencyTotals([line("USD", 100)]).manualReview).toBe(false);
    expect(quoteCurrencyTotals([line("CNY", 100)]).manualReview).toBe(true);
  });
  it("keeps USD cutting fees separate from CNY hose prices", () => {
    const calculation = calculateLengthBasedHoseEstimate({
      currency: "CNY",
      feeRatePerPiece: 2,
      referencePricePerFoot: 10,
      order: {
        normalizedLengthFt: 5,
        originalLengthUnit: "ft",
        originalLengthValue: 5,
        pieceCount: 2,
        totalFootage: 10,
      },
    });
    expect(calculation).toEqual({
      estimatedMerchandiseAmount: 100,
      cuttingLabelingFeeAmount: 4,
      currentEstimateAmount: null,
    });
    expect(quoteCurrencyTotals([line("CNY", 100, 4)]).groups).toEqual([
      { currency: "CNY", merchandiseSubtotal: 100, serviceFeeTotal: 0 },
      { currency: "USD", merchandiseSubtotal: 0, serviceFeeTotal: 4 },
    ]);
  });
  it("continues to format historical USD snapshots without groups", () => {
    expect(
      formatQuoteAmounts({ currency: "USD", merchandiseSubtotal: 123 }),
    ).toBe("USD 123.00");
  });
});
