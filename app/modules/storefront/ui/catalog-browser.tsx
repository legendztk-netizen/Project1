import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Form, Link } from "react-router";

import {
  launchCatalogFamilies,
  type CatalogFamilyId,
} from "../../catalog/domain/catalog-family";
import type { PublicCatalogFamilySummary } from "../../catalog/domain/public-catalog";
import {
  catalogFamilyHref,
  catalogPageHref,
  catalogPageSizes,
  catalogPageWindow,
  defaultCatalogPageSize,
  type CatalogPageSize,
  type CatalogPagination,
} from "../domain/catalog-pagination";
import { CatalogMedia } from "./catalog-media";
import { StorefrontFooter } from "./storefront-footer";
import { StorefrontHeader } from "./storefront-header";
import "../styles/catalog.css";

export interface CatalogBrowserData {
  activeCategory: CatalogFamilyId | null;
  appName: string;
  /** The families on the current page only. */
  families: PublicCatalogFamilySummary[];
  pagination: CatalogPagination;
  query: string;
}

function price(family: PublicCatalogFamilySummary) {
  return family.minimumReferencePrice !== null
    ? `From USD ${family.minimumReferencePrice.toFixed(2)}`
    : "Price on quote";
}

function CatalogPager({
  path,
  pagination,
  query,
}: {
  path: string;
  pagination: CatalogPagination;
  query: string;
}) {
  const { page, pageCount, perPage, total } = pagination;
  const href = (target: number, size: CatalogPageSize = perPage) =>
    catalogPageHref(path, query, target, size);
  return (
    <nav aria-label="Catalog pages" className="catalog-pager">
      {pageCount > 1 ? (
        <div className="catalog-pages">
          {page > 1 ? (
            <Link aria-label="Previous page" rel="prev" to={href(page - 1)}>
              <ChevronLeft aria-hidden="true" size={17} /> Previous
            </Link>
          ) : null}
          {catalogPageWindow(pagination).map((target, index) =>
            target === null ? (
              <span
                aria-hidden="true"
                className="catalog-page-gap"
                key={`gap-${index}`}
              >
                …
              </span>
            ) : (
              <Link
                aria-current={target === page ? "page" : undefined}
                aria-label={`Page ${target}`}
                key={target}
                to={href(target)}
              >
                {target}
              </Link>
            ),
          )}
          {page < pageCount ? (
            <Link aria-label="Next page" rel="next" to={href(page + 1)}>
              Next <ChevronRight aria-hidden="true" size={17} />
            </Link>
          ) : null}
        </div>
      ) : null}
      {total > catalogPageSizes[0] ? (
        <div className="catalog-page-size">
          <span>Per page</span>
          {catalogPageSizes.map((size) => (
            <Link
              aria-current={size === perPage ? "true" : undefined}
              aria-label={`Show ${size} per page`}
              key={size}
              to={href(1, size)}
            >
              {size}
            </Link>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

export function CatalogBrowser({ data }: { data: CatalogBrowserData }) {
  const listPath = data.activeCategory
    ? `/catalog/${data.activeCategory}`
    : "/catalog";
  // Product pages link back to this exact list page.
  const listHref = catalogPageHref(
    listPath,
    data.query,
    data.pagination.page,
    data.pagination.perPage,
  );
  const activeLabel = data.activeCategory
    ? launchCatalogFamilies.find((family) => family.id === data.activeCategory)
        ?.label
    : "All Products";
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader floating />
      <main>
        <section className="catalog-toolbar" aria-labelledby="catalog-title">
          <div>
            <span className="eyebrow">{data.appName}</span>
            <h1 id="catalog-title">{activeLabel}</h1>
          </div>
          <Form className="catalog-search" role="search" method="get">
            {data.pagination.perPage !== defaultCatalogPageSize ? (
              <input
                name="perPage"
                type="hidden"
                value={data.pagination.perPage}
              />
            ) : null}
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
                <Link
                  className={!data.activeCategory ? "active" : ""}
                  to="/catalog"
                >
                  All Products
                </Link>
              </li>
              {launchCatalogFamilies
                // Crimp fittings are one-piece (ADR 0056); old ferrule pages keep their route.
                .filter((family) => family.id !== "ferrules")
                .map((family) => (
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
              <h2>
                {data.query
                  ? `Results for “${data.query}”`
                  : "Browse product families"}
              </h2>
            </div>

            {data.families.length ? (
              <>
                <div className="product-family-grid">
                  {data.families.map((family, index) => {
                    const familyUrl = catalogFamilyHref(
                      family.category,
                      family.familyKey,
                      listHref,
                    );
                    return (
                      <article
                        className="product-family-card"
                        key={`${family.category}:${family.familyKey}`}
                      >
                        <Link className="product-family-media" to={familyUrl}>
                          <CatalogMedia
                            compact
                            item={family.representative}
                            loading={index < 3 ? "eager" : "lazy"}
                          />
                        </Link>
                        <div className="product-family-copy">
                          <div className="family-card-topline">
                            <span className="eyebrow">
                              {family.interfaceGroup ??
                                family.category.replaceAll("-", " ")}
                            </span>
                            <span className="variant-count">
                              {family.variantCount} variants
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
                <CatalogPager
                  path={listPath}
                  pagination={data.pagination}
                  query={data.query}
                />
              </>
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
                      : "/catalog"
                  }
                >
                  Clear search
                </Link>
              </section>
            )}
          </div>
        </section>
      </main>
      <StorefrontFooter appName={data.appName} />
    </div>
  );
}
