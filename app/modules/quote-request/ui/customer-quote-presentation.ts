import type { CustomerQuoteProjection } from "../domain/quote-request";

export const customerQuoteDateTime = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
  timeZoneName: "short",
  year: "numeric",
});

export function quotePurchasingAs(quoteRequest: CustomerQuoteProjection) {
  return quoteRequest.snapshot.purchasingContext.kind === "organization"
    ? quoteRequest.snapshot.purchasingContext.legalName
    : "Individual purchase";
}

export function quoteImportHandling(quoteRequest: CustomerQuoteProjection) {
  return quoteRequest.snapshot.importResponsibility.fulfillmentTerm === "DDP"
    ? "Seller-managed import handling (DDP)"
    : "Customer-managed import clearance (DAP)";
}
