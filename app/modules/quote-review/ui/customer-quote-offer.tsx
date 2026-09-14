import type { CustomerQuoteRevision } from "../domain/quote-revision";
import { QuoteRevisionChanges } from "./quote-revision-changes";

const usd = (cents: number | null) =>
  cents === null ? "Pending" : `USD ${(cents / 100).toFixed(2)}`;
export function CustomerQuoteOffer({
  offer,
}: {
  offer: CustomerQuoteRevision;
}) {
  return (
    <section
      className="customer-quote-section"
      aria-label="Current formal quote"
    >
      <h2>Quote Ready · Revision {offer.revisionNumber}</h2>
      <div className="customer-offer-lines">
        {offer.lines.map((line, index) => (
          <div key={line.id ?? index}>
            <strong>
              {line.displayName} · {line.sku}
            </strong>
            <span>
              Pricing quantity {line.totals.quantity} {line.salesUnit} · Unit
              price {usd(line.price.unitPriceCents)} / {line.salesUnit}
            </span>
            {line.lengthOrder ? (
              <span>
                {line.quantity} pieces · {line.lengthOrder.originalLengthValue}{" "}
                {line.lengthOrder.originalLengthUnit} per piece ·{" "}
                {line.lengthOrder.totalFootage} ft total
              </span>
            ) : null}
            <span>
              Discount {line.price.discountBasisPoints / 100}% · Line total{" "}
              {usd(line.totals.totalCents)}
            </span>
            {line.assemblyLength ? (
              <span>
                Finished length: {line.assemblyLength.originalValue}{" "}
                {line.assemblyLength.originalUnit}
              </span>
            ) : null}
            {line.quotedSpecificationOverrides.length ? (
              <div>
                <strong>Reviewed specification changes</strong>
                <dl>
                  {line.quotedSpecificationOverrides.map((spec) => (
                    <div key={spec.label}>
                      <dt>{spec.label}</dt>
                      <dd>{spec.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {offer.differences.length ? (
        <QuoteRevisionChanges changes={offer.differences} />
      ) : null}
      <dl className="customer-quote-summary">
        <div>
          <dt>Merchandise</dt>
          <dd>{usd(offer.totals.merchandiseCents)}</dd>
        </div>
        {Object.entries(offer.charges).map(([key, value]) => (
          <div key={key}>
            <dt>
              {
                (
                  {
                    freight: "Freight",
                    insurance: "Insurance",
                    dutiesImport: "Duties / import charges",
                    salesTax: "Sales tax",
                    cuttingLabeling: "Cutting / labeling",
                    assemblyService: "Assembly service",
                    protectionService: "Protection service",
                  } as Record<string, string>
                )[key]
              }
            </dt>
            <dd>{usd(value)}</dd>
          </div>
        ))}
        <div>
          <dt>Total</dt>
          <dd>{usd(offer.totals.totalCents)}</dd>
        </div>
        <div>
          <dt>Delivery terms</dt>
          <dd>
            {offer.incoterm} · {offer.namedPlace}
          </dd>
        </div>
        <div>
          <dt>Transport</dt>
          <dd>{offer.transportMethod}</dd>
        </div>
        <div>
          <dt>Shipment plan</dt>
          <dd>
            {offer.shipmentMode === "split" ? offer.splitPlan : "Ship together"}
          </dd>
        </div>
        <div>
          <dt>Lead time</dt>
          <dd>{offer.leadTime}</dd>
        </div>
        <div>
          <dt>Sales tax treatment</dt>
          <dd>{offer.taxTreatment}</dd>
        </div>
      </dl>
      <address>
        {offer.destination.recipientName}
        <br />
        {offer.destination.addressLine1} {offer.destination.addressLine2}
        <br />
        {offer.destination.city}, {offer.destination.stateProvince}{" "}
        {offer.destination.postalCode} · {offer.destination.countryCode}
      </address>
    </section>
  );
}
