import type { QuoteRevisionSnapshot } from "../../quote-review/domain/quote-revision";
import type { PiConditions } from "./proforma-invoice";

// Approved product rules: web-application-scope.md cancellation section and
// docs/policies/returns.md. These versions are frozen into each issued PI.
const cancellation = {
  version: "pi-cancellation-2026-09-14-v1",
  text: "Cancellation requires seller review and approval. Standard products cannot be cancelled for convenience after shipment. Hose assemblies have no self-service cancellation or specification change after Production Approval; contact Support for administrative review. For cut-to-length hose, cancellation may be approved before cutting begins, but not for convenience after cutting begins. Approved pre-cut cancellation refunds the Cutting & Labeling Fee in full. Approved specifications are never edited; corrected assemblies require a new quote and order.",
};
const refund = {
  version: "pi-refund-2026-09-14-v1",
  text: "Eligible standard-product returns require authorization requested within 30 calendar days after delivery; goods must be unused, uninstalled, uncut, complete and in original packaging. Convenience returns are at the customer's shipping expense; original cross-border freight, duties, import taxes and clearance charges are not refundable. No restocking fee applies to complete, resalable returns. Customer-caused refunds may deduct only disclosed, documented, non-refundable third-party costs where permitted, with no administrative markup. Seller error, nonconforming goods or inability to supply retain the applicable remedies and full approved seller-caused refund without payment-fee deductions. Made-to-order goods are not eligible for convenience returns after approval.",
};

export function conditionsForQuote(
  revision: QuoteRevisionSnapshot,
): PiConditions {
  return {
    cancellation: { ...cancellation },
    refund: { ...refund },
    generalAcknowledgement: {
      version: "pi-commercial-ack-2026-09-14-v1",
      text: "I confirm the buyer and delivery information, final quoted specifications, quantities, USD prices, charges, tax and import terms, lead time, validity deadline, cancellation and refund conditions in this PI.",
    },
    madeToOrderAcknowledgements: revision.source.lines
      .filter(
        (line) =>
          line.lineKind !== "standard" ||
          line.productSnapshot.offer?.madeToOrder === true,
      )
      .map((line) => ({
        lineId: line.id,
        version: "pi-made-to-order-ack-2026-09-14-v1",
        text: "I confirm the identified made-to-order product's final specifications, dimensions, quantities and any selected measurement, Clocking and installed protection. I understand its cancellation and convenience-return restrictions and that corrections require seller review, not editing this approved specification.",
      })),
  };
}
