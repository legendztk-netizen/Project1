import type { CatalogFamilyId } from "../../catalog/domain/catalog-family";

export interface AnonymousQuoteLine {
  category: CatalogFamilyId;
  currency: string;
  displayName: string;
  id: string;
  quantity: number;
  referenceUnitPrice: number | null;
  salesUnit: string;
  sku: string;
  updatedAt: string;
}

export interface AnonymousQuoteSession {
  expiresAt: string;
  id: string;
}

export class QuoteListCommandRejected extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_QUANTITY"
      | "LINE_NOT_FOUND"
      | "PRODUCT_NOT_AVAILABLE"
      | "STANDARD_PRODUCT_REQUIRED",
  ) {
    super(message);
    this.name = "QuoteListCommandRejected";
  }
}
