import { ArrowLeft, Check, Clock3, FileText, PackageCheck } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/catalog-product-family";
import type { SupplyAvailability } from "../../catalog/domain/catalog-draft-availability";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { requireCatalogFamilyId } from "../domain/catalog-route";
import { CatalogMedia } from "../ui/catalog-media";
import { StorefrontHeader } from "../ui/storefront-header";
import "../styles/catalog.css";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const activeCategory = requireCatalogFamilyId(params.category);
  const sku = new URL(request.url).searchParams.get("sku");
  const result = await createD1PublicCatalogRepository(env.DB).findFamily({
    category: activeCategory,
    familyKey: params.familyKey,
    sku,
  });
  if (!result) throw new Response("Product family not found", { status: 404 });
  return { ...result, appName: env.PUBLIC_APP_NAME };
}

export function meta() {
  return [{ title: "Product Family | Hydraulic Supply" }];
}

const availabilityLabels: Record<SupplyAvailability, string> = {
  available_for_quote: "Available for Quote",
  discontinued: "Discontinued",
  temporarily_unavailable: "Temporarily Unavailable",
};

export default function CatalogProductFamily({
  loaderData,
}: Route.ComponentProps) {
  const { family, selected } = loaderData;
  const offer = selected.offer;
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="product-page">
        <Link className="product-back-link" to={`/catalog/${family.category}`}>
          <ArrowLeft size={17} /> Back to {family.category.replaceAll("-", " ")}
        </Link>

        <section className="product-overview">
          <div className="product-gallery">
            <CatalogMedia item={selected} />
          </div>
          <div className="product-summary">
            <span className="eyebrow">
              {family.interfaceGroup ?? family.category.replaceAll("-", " ")}
            </span>
            <h1>{selected.displayName}</h1>
            <p className="product-sku">
              SKU <strong>{selected.sku}</strong>
            </p>

            <div className="variant-picker">
              <label htmlFor="variant">Size / connection variant</label>
              <select
                id="variant"
                value={selected.sku}
                onChange={(event) => {
                  window.location.assign(
                    `?sku=${encodeURIComponent(event.currentTarget.value)}`,
                  );
                }}
              >
                {family.variants.map((variant) => (
                  <option key={variant.sku} value={variant.sku}>
                    {variant.sku}
                  </option>
                ))}
              </select>
            </div>

            <div className="product-commercials">
              <div>
                <span>Reference Price</span>
                <strong>
                  {offer?.referencePrice == null
                    ? "Price on quote"
                    : `USD ${offer.referencePrice.toFixed(2)}`}
                </strong>
                <small>
                  Non-binding reference; final pricing is confirmed in your
                  quote.
                </small>
              </div>
              <div>
                <span>Supply Availability</span>
                <strong>
                  {availabilityLabels[selected.supplyAvailability]}
                </strong>
                <small>
                  {offer
                    ? `${offer.leadTimeDays} business day processing estimate`
                    : "Processing time confirmed in quote"}
                </small>
              </div>
            </div>

            <button
              className="button button-primary product-quote-command"
              data-command="add-to-quote"
              data-sku={selected.sku}
              disabled={!selected.canAddToQuote}
              type="button"
            >
              <FileText size={18} /> Add to Quote
            </button>
            {!selected.canAddToQuote ? (
              <p className="availability-note">
                This variant can be viewed but is not currently available to add
                to a quote.
              </p>
            ) : null}
          </div>
        </section>

        <section className="product-information">
          <div className="product-specifications">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Exact variant</span>
                <h2>Technical specifications</h2>
              </div>
              <span className="release-status">Current catalog</span>
            </div>
            <dl>
              {selected.specs.map((spec) => (
                <div key={`${spec.label}:${spec.value}`}>
                  <dt>{spec.label}</dt>
                  <dd>{spec.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <aside className="product-policy-band">
            <div>
              <Clock3 size={20} />
              <p>
                <strong>Processing estimate</strong>
                <span>
                  {offer
                    ? `${offer.leadTimeDays} business days after payment confirmation`
                    : "Confirmed with your quote"}
                </span>
              </p>
            </div>
            <div>
              <PackageCheck size={20} />
              <p>
                <strong>Export packaging included</strong>
                <span>All orders use export-ready protective packaging.</span>
              </p>
            </div>
            <div>
              <Check size={20} />
              <p>
                <strong>
                  {offer?.madeToOrder ? "Made to order" : "Return eligibility"}
                </strong>
                <span>
                  {offer?.madeToOrder
                    ? "Convenience returns are unavailable after cutting or production approval. Remedies remain available for seller error or a nonconforming product."
                    : "Unused standard products may request return review within 14 calendar days of delivery. Approved convenience returns carry a 10% restocking fee; customer-paid return shipping applies."}
                </span>
              </p>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
