import { ArrowLeft, Check, Clock3, PackageCheck } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/catalog-product-family";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { requireCatalogFamilyId } from "../domain/catalog-route";
import { CatalogMedia } from "../ui/catalog-media";
import {
  ProductVariantSelector,
  useProductVariantSelection,
} from "../ui/product-variant-selector";
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
  return {
    ...result,
    appName: env.PUBLIC_APP_NAME,
    selectionRequested: Boolean(sku),
  };
}

export function meta() {
  return [{ title: "Product Family | Hydraulic Supply" }];
}

export default function CatalogProductFamily({
  loaderData,
}: Route.ComponentProps) {
  const { family, selected } = loaderData;
  const offer = selected.offer;
  const variantSelection = useProductVariantSelection({
    selected,
    selectionRequested: loaderData.selectionRequested,
  });
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
            <ProductVariantSelector
              family={family}
              selected={selected}
              selection={variantSelection}
            />
          </div>
        </section>

        {variantSelection.selectionComplete ? (
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
                    {offer?.madeToOrder
                      ? "Made to order"
                      : "Return eligibility"}
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
        ) : null}
      </main>
    </div>
  );
}
