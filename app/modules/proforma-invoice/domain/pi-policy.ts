import type { QuoteRevisionSnapshot } from "../../quote-review/domain/quote-revision";
import type { PiConditions } from "./proforma-invoice";

// Approved product rules: web-application-scope.md cancellation section and
// docs/policies/returns.md (single launch return policy, Spec 7). These versions are frozen into each issued PI.
const cancellation = {
  version: "pi-cancellation-2026-09-14-v1",
  text: "Cancellation requires seller review and approval. Standard products cannot be cancelled for convenience after shipment. Hose assemblies have no self-service cancellation or specification change after Production Approval; contact Support for administrative review. For cut-to-length hose, cancellation may be approved before cutting begins, but not for convenience after cutting begins. Approved pre-cut cancellation refunds the Cutting & Labeling Fee in full. Approved specifications are never edited; corrected assemblies require a new quote and order.",
};
const refund = {
  version: "pi-refund-2026-09-27-v1",
  text: "Unused, uninstalled, uncut and complete standard products in original packaging may request return review within 14 calendar days after the actual delivery date of their Shipment (the delivery date in US Eastern Time is day 0; requests close at 11:59 PM ET on day 14). A request does not authorize a return: goods are accepted only under an issued Return Authorization, must arrive within 30 calendar days after issuance, and are inspected before any refund decision. Approved convenience returns carry a 10% restocking fee on the discounted merchandise amount approved for return; the customer pays return shipping, and performed outbound DDP shipping, duties and import charges are not refunded. Applicable Sales Tax is adjusted separately. Customer-caused refunds may deduct only disclosed, documented, non-refundable third-party costs, with no administrative markup. Seller error, damage in transit, nonconforming goods or inability to supply carry no restocking fee and retain the applicable remedies, including reasonable logistics and the Cutting & Labeling Fee where relevant, without payment-fee deductions. Made-to-order hose assemblies and cut-length hose are not eligible for convenience return after Production Approval or cutting. Approved refunds are initiated within 10 US business days through the original payment channel where possible; there are no cash or store-credit refunds.",
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
