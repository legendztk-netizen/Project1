import { ChevronRight, Search } from "lucide-react";
import { Form, Link } from "react-router";

import {
  launchCatalogFamilies,
  type CatalogFamilyId,
} from "../../catalog/domain/catalog-family";
import type { PublicCatalogFamily } from "../../catalog/domain/public-catalog";
import { CatalogMedia } from "./catalog-media";
import { StorefrontHeader } from "./storefront-header";
import "../styles/catalog.css";

export interface CatalogBrowserData {
  activeCategory: CatalogFamilyId | null;
  appName: string;
  families: PublicCatalogFamily[];
  query: string;
  releaseNumber: string | null;
}

function price(family: PublicCatalogFamily) {
  const values = family.variants.flatMap((variant) => {
    const value = variant.offer?.referencePrice;
    return value === null || value === undefined ? [] : [value];
  });
  return values.length
    ? `From USD ${Math.min(...values).toFixed(2)}`
    : "Price on quote";
}

export function CatalogBrowser({ data }: { data: CatalogBrowserData }) {
  const activeLabel = data.activeCategory
    ? launchCatalogFamilies.find((family) => family.id === data.activeCategory)
        ?.label
    : "All Products";
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main>
        <section className="catalog-toolbar" aria-labelledby="catalog-title">
          <div>
            <span className="eyebrow">{data.appName}</span>
            <h1 id="catalog-title">{activeLabel}</h1>
          </div>
          <Form className="catalog-search" role="search" method="get">
            <Search size={19} aria-hidden="true" />
            <label className="sr-only" htmlFor="catalog-query">
              Search products
            </label>
            <input
              id="catalog-query"
              defaultValue={data.query}
              name="q"
              type="search"
              placeholder="Search SKU, thread, standard or size"
            />
            <button className="button button-primary" type="submit">
              Search
            </button>
          </Form>
        </section>

        <section className="catalog-layout" aria-label="Catalog workspace">
          <aside className="category-sidebar">
            <h2>Categories</h2>
            <ul>
              <li>
                <Link className={!data.activeCategory ? "active" : ""} to="/">
                  All Products
                </Link>
              </li>
              {launchCatalogFamilies.map((family) => (
                <li key={family.id}>
                  <Link
                    className={
                      family.id === data.activeCategory ? "active" : ""
                    }
                    to={`/catalog/${family.id}`}
                  >
                    {family.label}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>

          <div className="catalog-content">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Published assortment</span>
                <h2>
                  {data.query
                    ? `Results for “${data.query}”`
                    : "Browse product families"}
                </h2>
              </div>
              <span className="release-status">
                {data.releaseNumber
                  ? `${data.families.length} families · Current catalog`
                  : "No published catalog"}
              </span>
            </div>

            {data.families.length ? (
              <div className="product-family-grid">
                {data.families.map((family) => {
                  const familyUrl = `/catalog/${family.category}/${family.familyKey}`;
                  return (
                    <article
                      className="product-family-card"
                      key={`${family.category}:${family.familyKey}`}
                    >
                      <Link className="product-family-media" to={familyUrl}>
                        <CatalogMedia compact item={family.representative} />
                      </Link>
                      <div className="product-family-copy">
                        <div className="family-card-topline">
                          <span className="eyebrow">
                            {family.interfaceGroup ??
                              family.category.replaceAll("-", " ")}
                          </span>
                          <span className="variant-count">
                            {family.variants.length} variants
                          </span>
                        </div>
                        <h3>
                          <Link to={familyUrl}>{family.familyName}</Link>
                        </h3>
                        <p>
                          {family.representative.specs
                            .slice(0, 2)
                            .map((spec) => spec.value)
                            .join(" · ")}
                        </p>
                        <div className="family-card-footer">
                          <strong>{price(family)}</strong>
                          <Link
                            aria-label={`View ${family.familyName}`}
                            className="icon-link"
                            title="View product family"
                            to={familyUrl}
                          >
                            <ChevronRight size={19} />
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <section className="catalog-empty">
                <Search size={30} />
                <h2>No published products found</h2>
                <p>Try another SKU, interface, thread standard or size.</p>
                <Link
                  className="button button-secondary"
                  to={
                    data.activeCategory
                      ? `/catalog/${data.activeCategory}`
                      : "/"
                  }
                >
                  Clear search
                </Link>
              </section>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
