import { CircleHelp, FileText, Search, Wrench } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/catalog-home";
import {
  catalogSetupStatus,
  initialCatalogFamilyId,
  launchCatalogFamilies,
} from "../../catalog/domain/catalog-family";
import { BrandMark } from "../../shared/ui/brand-mark";
import { cloudflareContext } from "#workers/context";

export function meta() {
  return [
    { title: "Hydraulic Supply | Hose and Fittings" },
    {
      name: "description",
      content:
        "Hydraulic hose, fittings and custom assembly quote preparation.",
    },
  ];
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { appName: env.PUBLIC_APP_NAME };
}

export default function CatalogHome({ loaderData }: Route.ComponentProps) {
  return (
    <div className="storefront-shell" data-surface="storefront">
      <header className="storefront-header">
        <BrandMark />
        <nav aria-label="Customer navigation">
          <Link to="/">Products</Link>
          <span aria-disabled="true">Build a Hose</span>
          <span aria-disabled="true">My Quotes</span>
        </nav>
        <span
          className="button button-secondary is-disabled"
          aria-disabled="true"
        >
          <CircleHelp size={18} />
          Help
        </span>
      </header>

      <main>
        <section className="catalog-toolbar" aria-labelledby="catalog-title">
          <div>
            <span className="eyebrow">{loaderData.appName}</span>
            <h1 id="catalog-title">Product catalog</h1>
          </div>
          <div className="catalog-search" role="search">
            <Search size={19} aria-hidden="true" />
            <label className="sr-only" htmlFor="catalog-query">
              Search products
            </label>
            <input
              id="catalog-query"
              name="q"
              type="search"
              placeholder="Search SKU, thread, standard or size"
              disabled
            />
            <button className="button button-primary" type="button" disabled>
              Search
            </button>
          </div>
        </section>

        <section className="catalog-layout" aria-label="Catalog workspace">
          <aside className="category-sidebar">
            <h2>Categories</h2>
            <ul>
              {launchCatalogFamilies.map((family) => (
                <li key={family.id}>
                  <span
                    className={
                      family.id === initialCatalogFamilyId ? "active" : ""
                    }
                  >
                    {family.label}
                  </span>
                </li>
              ))}
            </ul>
          </aside>

          <div className="catalog-content">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Launch assortment</span>
                <h2>Browse product families</h2>
              </div>
              <span className="release-status">Catalog setup in progress</span>
            </div>

            <div className="family-grid">
              {launchCatalogFamilies.map((family, index) => (
                <article className="family-card" key={family.id}>
                  <div className="family-card-topline">
                    <span className="family-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="status-dot">{catalogSetupStatus}</span>
                  </div>
                  <h3>{family.label}</h3>
                  <p>{family.description}</p>
                </article>
              ))}
            </div>

            <section
              className="featured-family"
              aria-labelledby="featured-title"
            >
              <div className="featured-media">
                <img
                  src="/images/601R2-structure.png"
                  alt="Cross-section of a two-wire hydraulic hose"
                />
              </div>
              <div className="featured-copy">
                <span className="eyebrow">601R2 / SAE 100 R2AT</span>
                <h2 id="featured-title">Two-wire hydraulic hose</h2>
                <dl>
                  <div>
                    <dt>Construction</dt>
                    <dd>Two high-tensile steel wire braids</dd>
                  </div>
                  <div>
                    <dt>Quote path</dt>
                    <dd>Standard length or custom assembly</dd>
                  </div>
                </dl>
                <div className="featured-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled
                  >
                    <Wrench size={18} />
                    Build a Hose
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled
                  >
                    <FileText size={18} />
                    View series
                  </button>
                </div>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
