import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import { LAUNCH_RETURN_POLICY } from "../../after-sales/domain/return-policy";
import { StorefrontHeader } from "../ui/storefront-header";
import "../styles/measurement-guide.css";

const sections: ReadonlyArray<{ title: string; items: readonly string[] }> = [
  {
    title: "Standard products",
    items: [
      `Unused, uninstalled, uncut and complete standard products in original packaging may request return review within ${LAUNCH_RETURN_POLICY.requestWindowCalendarDays} calendar days after the actual delivery date of their Shipment.`,
      "The delivery date in US Eastern Time is day 0; requests close at 11:59 PM ET on day 14. For example, delivery on September 1 closes the window at 11:59 PM ET on September 15. Split Shipments each use their own delivery date.",
      "Start a request from your Order with Request Return or Report a Problem. A request opens a case for review; it does not authorize a return or approve a refund.",
      `Goods are accepted only under an issued Return Authorization and must arrive within ${LAUNCH_RETURN_POLICY.raArrivalCalendarDays} calendar days after it is issued. Packages sent without a Return Authorization are not accepted.`,
      "Approved convenience returns carry a 10% restocking fee on the discounted merchandise amount approved for return. You pay return shipping, and performed outbound DDP shipping, duties and import charges are not refunded. Applicable Sales Tax is adjusted separately.",
      "The same terms apply when inspection shows that a reported problem was caused by the buyer, for example incorrect selection, installation damage or misuse.",
      "A customer-caused refund may deduct only disclosed, documented, non-refundable third-party costs, shown gross-to-net, with no administrative markup.",
    ],
  },
  {
    title: "Seller error, damage or nonconforming products",
    items: [
      "Wrong items, transit damage, nonconforming products and inability to supply carry no restocking fee and are not limited by the 14-day convenience window.",
      "The seller covers reasonable return or replacement logistics and the Cutting & Labeling Fee where relevant, without payment-fee deductions.",
    ],
  },
  {
    title: "Made-to-order products",
    items: [
      "Hose assemblies and cut-length hose are not eligible for convenience return after Production Approval or cutting.",
      "Remedies for seller error, damage or a nonconforming product remain available.",
    ],
  },
  {
    title: "Inspection and refunds",
    items: [
      `Returned goods are inspected after receipt; we target a decision within ${LAUNCH_RETURN_POLICY.inspectionBusinessDays} US business days. Every decision includes a reason.`,
      `Approved refunds are initiated within ${LAUNCH_RETURN_POLICY.refundInitiationBusinessDays} US business days through the original payment channel where possible, to an account verified for the same buyer. We cannot promise the date your bank or PayPal posts the funds.`,
      "There are no cash or store-credit refunds.",
    ],
  },
];

export function meta() {
  return [
    { title: "Returns and Refunds Policy | Hydraulic Supply" },
    {
      name: "description",
      content:
        "Return window, restocking fee, made-to-order restrictions, inspection and refund timing.",
    },
  ];
}

export default function ReturnsPolicy() {
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="measurement-guide-page">
        <Link className="product-back-link" to="/catalog">
          <ArrowLeft size={17} /> Back to products
        </Link>
        <header className="measurement-guide-heading">
          <span className="eyebrow">Policy</span>
          <h1>Returns and Refunds</h1>
          <p>
            These terms are included in every Proforma Invoice. The return
            address is provided only in an issued Return Authorization.
          </p>
        </header>
        {sections.map((section) => (
          <section className="returns-policy-section" key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
