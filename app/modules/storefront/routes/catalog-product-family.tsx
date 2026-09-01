import { ArrowLeft, Check, Clock3, PackageCheck } from "lucide-react";
import { data, Link, redirect } from "react-router";

import type { Route } from "./+types/catalog-product-family";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { createAnonymousQuoteListService } from "../../quote-list/application/anonymous-quote-list-service";
import { QuoteListCommandRejected } from "../../quote-list/domain/anonymous-quote-list";
import { parseLengthBasedHoseOrder } from "../../quote-list/domain/length-based-hose";
import { requireCatalogFamilyId } from "../domain/catalog-route";
import { CatalogMedia } from "../ui/catalog-media";
import {
  ProductVariantSelector,
  useProductVariantSelection,
} from "../ui/product-variant-selector";
import { StorefrontHeader } from "../ui/storefront-header";
import "../styles/catalog.css";
import { cloudflareContext } from "#workers/context";

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function action({ context, request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  const form = await request.formData();
  const sku = textValue(form, "sku");
  const values = {
    lengthPerPiece: textValue(form, "lengthPerPiece"),
    lengthUnit: textValue(form, "lengthUnit"),
    pieceCount: textValue(form, "pieceCount"),
  };
  if (textValue(form, "intent") !== "add-length-hose") {
    return data(
      { formError: "Unknown product command.", sku, values },
      { status: 400 },
    );
  }

  const { env } = context.get(cloudflareContext);
  const product = await createD1PublicCatalogRepository(env.DB).findItem(sku);
  const ordering = product?.offer?.lengthOrdering;
  if (
    !product ||
    !product.canAddToQuote ||
    product.productType !== "hose" ||
    !product.offer?.madeToOrder ||
    !ordering
  ) {
    return data(
      {
        formError: "This hose is not currently available for length ordering.",
        sku,
        values,
      },
      { status: 409 },
    );
  }

  const parsed = parseLengthBasedHoseOrder(
    {
      lengthPerPiece: form.get("lengthPerPiece"),
      lengthUnit: form.get("lengthUnit"),
      pieceCount: form.get("pieceCount"),
    },
    ordering,
  );
  if (!parsed.ok) {
    return data(
      { fieldErrors: parsed.fieldErrors, sku, values },
      { status: 422 },
    );
  }

  try {
    const result = await createAnonymousQuoteListService(
      env,
    ).addLengthBasedHose(request, sku, parsed.value);
    const headers = new Headers();
    if (result.setCookie) headers.set("Set-Cookie", result.setCookie);
    return redirect("/quote-list", { headers });
  } catch (error) {
    if (error instanceof QuoteListCommandRejected) {
      if (error.code === "INVALID_QUANTITY") {
        return data(
          {
            fieldErrors: { pieceCount: error.message },
            sku,
            values,
          },
          { status: 422 },
        );
      }
      return data({ formError: error.message, sku, values }, { status: 409 });
    }
    throw error;
  }
}

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
