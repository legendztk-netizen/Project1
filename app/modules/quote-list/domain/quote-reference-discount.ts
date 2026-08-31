import type { AnonymousQuoteLine } from "./anonymous-quote-list";

export interface QuoteReferenceDiscount {
  discountPercent: number;
  minimumQuantity: number;
  recordVersion: number;
}

export interface QuoteReferenceDiscountLookup {
  lineKind: AnonymousQuoteLine["lineKind"];
  quantity: number;
  releaseId: string;
  sku: string;
}

export const noQuoteReferenceDiscount: QuoteReferenceDiscount = {
  discountPercent: 0,
  minimumQuantity: 1,
  recordVersion: 0,
};
