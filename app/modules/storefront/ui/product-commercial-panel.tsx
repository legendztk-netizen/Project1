import { FileText } from "lucide-react";
import { Form } from "react-router";

import type { SupplyAvailability } from "../../catalog/domain/catalog-draft-availability";
import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";

const availabilityLabels: Record<SupplyAvailability, string> = {
  available_for_quote: "Available for Quote",
  discontinued: "Discontinued",
  temporarily_unavailable: "Temporarily Unavailable",
};

export function ProductCommercialPanel({
  selectionComplete,
  selected,
}: {
  selectionComplete: boolean;
  selected: PublicCatalogItem;
}) {
  const offer = selectionComplete ? selected.offer : null;
  const standardProductReady = Boolean(
    selectionComplete && selected.canAddToQuote && offer && !offer.madeToOrder,
  );
  return (
    <>
      <div className="product-commercials">
        <div>
          <span>Reference Price</span>
          <strong>
            {!selectionComplete
              ? "Complete size selection"
              : offer?.referencePrice == null
                ? "Price on quote"
                : `USD ${offer.referencePrice.toFixed(2)}`}
          </strong>
          <small>
            Non-binding reference; final pricing is confirmed in your quote.
          </small>
        </div>
        <div>
          <span>Supply Availability</span>
          <strong>
            {selectionComplete
              ? availabilityLabels[selected.supplyAvailability]
              : "Complete size selection"}
          </strong>
          <small>
            {selectionComplete && offer
              ? `${offer.leadTimeDays} business day processing estimate`
              : "Processing time confirmed after size selection"}
          </small>
        </div>
      </div>

      <Form action="/quote-list" method="post">
        <input name="intent" type="hidden" value="add" />
        <input name="sku" type="hidden" value={selected.sku} />
        <input name="quantity" type="hidden" value="1" />
        <button
          className="button button-primary product-quote-command"
          data-command="add-to-quote"
          data-sku={selectionComplete ? selected.sku : undefined}
          disabled={!standardProductReady}
          type="submit"
        >
          <FileText size={18} /> Add to Quote
        </button>
      </Form>
      {!selectionComplete ? (
        <p className="availability-note">
          Complete the size selection before adding this product to your quote.
        </p>
      ) : offer?.madeToOrder ? (
        <p className="availability-note">
          Select a cut length before adding this hose to your quote.
        </p>
      ) : !selected.canAddToQuote ? (
        <p className="availability-note">
          This variant can be viewed but is not currently available to add to a
          quote.
        </p>
      ) : null}
    </>
  );
}
