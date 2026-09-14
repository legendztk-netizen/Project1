import type { QuoteRequestSnapshot } from "../../quote-request/domain/quote-request";
import type { QuoteCommercialTerms } from "./quote-commercial-terms";
import {
  commercialTotals,
  validateCommercialTerms,
} from "./quote-commercial-terms";
import { quoteLineTotals, type QuotedLinePrice } from "./quote-pricing";

export interface QuoteRevisionSnapshot {
  version: 1;
  requestId: string;
  revisionNumber: number;
  sourceHash: string;
  source: QuoteRequestSnapshot;
  preparationVersion: number;
  prices: QuotedLinePrice[];
  terms: QuoteCommercialTerms;
  totals: ReturnType<typeof commercialTotals>;
  issuedAt: string;
  issuedBy: string;
  factoryReviewConfirmed: boolean;
}

export function requiresFactoryReview(source: QuoteRequestSnapshot) {
  return source.lines.some(
    (line) =>
      line.lineKind === "configured_assembly" &&
      line.configuredAssembly.snapshot.review.outcome !== "ready",
  );
}

export function validateQuoteIssuance(
  draft: {
    source: QuoteRequestSnapshot;
    prices: QuotedLinePrice[];
    terms: QuoteCommercialTerms | null;
  },
  factoryReviewConfirmed: boolean,
) {
  if (!draft.terms || !draft.source.lines.length)
    throw new Error("Complete commercial terms and product lines");
  if (requiresFactoryReview(draft.source) && !factoryReviewConfirmed)
    throw new Error(
      "Confirm unresolved product matters were reviewed with the factory",
    );
  const terms = validateCommercialTerms(draft.terms, draft.source);
  return {
    terms,
    totals: commercialTotals(draft.source, draft.prices, terms.charges),
  };
}

export function customerRevisionProjection(revision: QuoteRevisionSnapshot) {
  const terms = revision.terms;
  return {
    revisionNumber: revision.revisionNumber,
    issuedAt: revision.issuedAt,
    currency: "USD" as const,
    lines: revision.source.lines.map((line, index) => ({
      id: line.id,
      sku: line.sku,
      displayName: line.displayName,
      quantity: line.quantity,
      salesUnit: line.salesUnit,
      lengthOrder:
        line.lineKind === "length_based_hose"
          ? {
              originalLengthValue: line.lengthOrder.originalLengthValue,
              originalLengthUnit: line.lengthOrder.originalLengthUnit,
              totalFootage: line.lengthOrder.totalFootage,
            }
          : null,
      price: revision.prices[index],
      totals: quoteLineTotals(line, revision.prices[index]),
    })),
    destination: terms.destination,
    shipmentMode: terms.shipmentMode,
    splitPlan: terms.splitPlan,
    transportMethod: terms.transportMethod,
    incoterm: terms.incoterm,
    namedPlace: terms.namedPlace,
    leadTime: terms.leadTime,
    taxTreatment: terms.taxTreatment,
    charges: terms.charges,
    totals: revision.totals,
  };
}
export type CustomerQuoteRevision = ReturnType<
  typeof customerRevisionProjection
>;
