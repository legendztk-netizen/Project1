import { ArrowLeft, Check, Filter, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Form, Link, redirect, useLocation, useNavigation } from "react-router";

import type { Route } from "./+types/catalog-review";
import {
  applyDraftSupplyAvailabilityChange,
  previewDraftSupplyAvailabilityChange,
  supplyAvailabilityValues,
  type DraftAvailabilityChangePreview,
  type DraftProductSelector,
  type SupplyAvailability,
} from "../../catalog/domain/catalog-draft-availability";
import { createD1CatalogDraftReviewRepository } from "../../catalog/infrastructure/d1-catalog-draft-review-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

const availabilityLabels: Record<SupplyAvailability, string> = {
  available_for_quote: "Available for Quote",
  discontinued: "Discontinued",
  temporarily_unavailable: "Temporarily Unavailable",
};

export function meta() {
  return [{ title: "Draft Catalog Review | Admin Backoffice" }];
}

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function selectorFromForm(form: FormData): DraftProductSelector {
  const mode = textValue(form, "selectorMode");
  if (mode === "worksheet") {
    return {
      mode,
      sourceWorksheet: textValue(form, "sourceWorksheet"),
    };
  }
  if (mode === "hose_series") {
    return { hoseSeries: textValue(form, "hoseSeries"), mode };
  }
  if (mode === "selected") {
    return {
      mode,
      skus: form
        .getAll("selectedSku")
        .filter((value): value is string => typeof value === "string"),
    };
  }
  throw new Error("Choose a bulk selection mode");
}

function targetFromForm(form: FormData) {
  const value = textValue(form, "target");
  if (!supplyAvailabilityValues.includes(value as SupplyAvailability)) {
    throw new Error("Choose a valid Supply Availability target");
  }
  return value as SupplyAvailability;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const repository = createD1CatalogDraftReviewRepository(env.DB);
  return {
    review: await repository.findDraftCatalogReview(
      url.searchParams.get("release"),
      {
        hoseSeries: url.searchParams.get("series"),
        sku: url.searchParams.get("sku"),
        sourceWorksheet: url.searchParams.get("worksheet"),
      },
    ),
    updatedCount: Number(url.searchParams.get("updated")) || 0,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const form = await request.formData();
  const releaseId = textValue(form, "releaseId");
  const intent = textValue(form, "intent");
  const repository = createD1CatalogDraftReviewRepository(env.DB);

  try {
    const selector = selectorFromForm(form);
    const target = targetFromForm(form);
    if (intent === "preview") {
      return {
        preview: await previewDraftSupplyAvailabilityChange(repository, {
          releaseId,
          selector,
          target,
        }),
      };
    }
    if (intent === "apply") {
      const result = await applyDraftSupplyAvailabilityChange(repository, {
        actorId: adminIdentity.id,
        releaseId,
        selector,
        target,
      });
      if (!result.applied) {
        return {
          formError: "No draft products require this change.",
          preview: result,
        };
      }
      return redirect(
        `/admin/catalog/review?release=${encodeURIComponent(releaseId)}&updated=${result.affectedCount}`,
      );
    }
    return { formError: "Unknown catalog command." };
  } catch (error) {
    return {
      formError:
        error instanceof Error ? error.message : "Catalog command failed.",
    };
  }
}

function SelectorFields({ selector }: { selector: DraftProductSelector }) {
  if (selector.mode === "worksheet") {
    return (
      <input
        name="sourceWorksheet"
        type="hidden"
        value={selector.sourceWorksheet}
      />
    );
  }
  if (selector.mode === "hose_series") {
    return (
      <input name="hoseSeries" type="hidden" value={selector.hoseSeries} />
    );
  }
  return selector.skus.map((sku) => (
    <input key={sku} name="selectedSku" type="hidden" value={sku} />
  ));
}

function ConfirmationPanel({
  cancelTo,
  preview,
}: {
  cancelTo: string;
  preview: DraftAvailabilityChangePreview;
}) {
  return (
    <section
      className="catalog-change-confirmation"
      aria-live="polite"
      data-affected-count={preview.affectedCount}
      data-matched-count={preview.matchedCount}
    >
      <div>
        <ShieldCheck size={22} />
        <div>
          <span className="eyebrow">Confirm bulk change</span>
          <h2>{availabilityLabels[preview.target]}</h2>
        </div>
      </div>
      <p>
        {preview.matchedCount} products matched.{" "}
        <strong>{preview.affectedCount}</strong> products will change; products
        already in the target state remain unchanged.
      </p>
      <div className="confirmation-actions">
        {preview.affectedCount > 0 ? (
          <Form method="post">
            <input name="intent" type="hidden" value="apply" />
            <input name="releaseId" type="hidden" value={preview.releaseId} />
            <input
              name="selectorMode"
              type="hidden"
              value={preview.selector.mode}
            />
            <input name="target" type="hidden" value={preview.target} />
            <SelectorFields selector={preview.selector} />
            <button className="button button-primary" type="submit">
              <Check size={17} /> Apply to {preview.affectedCount} products
            </button>
          </Form>
        ) : null}
        <Link className="button button-secondary" to={cancelTo}>
          Cancel
        </Link>
      </div>
    </section>
  );
}

function money(value: number | null, currency = "USD") {
  return value === null ? "Not set" : `${currency} ${value.toFixed(2)}`;
}

export default function CatalogReview({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const review = loaderData.review;
  const location = useLocation();
  const navigation = useNavigation();
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const selected = new Set(selectedSkus);
  const busy = navigation.state === "submitting";

  if (!review) {
    return (
      <main className="catalog-review-page" data-surface="admin">
        <Link className="button button-secondary" to="/admin">
          <ArrowLeft size={17} /> Back to overview
        </Link>
        <section className="catalog-review-empty">
          <h1>No workbook draft available</h1>
          <p>
            Import and validate the approved workbook before reviewing products.
          </p>
          <Link className="button button-primary" to="/admin/catalog/import">
            Import workbook
          </Link>
        </section>
      </main>
    );
  }

  const allVisibleSelected =
    review.products.length > 0 &&
    review.products.every((product) => selected.has(product.sku));

  return (
    <main className="catalog-review-page" data-surface="admin">
      <div className="diagnostic-toolbar">
        <Link className="button button-secondary" to="/admin">
          <ArrowLeft size={17} /> Back to overview
        </Link>
      </div>

      <header className="catalog-review-header">
        <div>
          <span className="eyebrow">Catalog operations</span>
          <h1>Review draft products</h1>
          <p>
            {review.release.releaseNumber} · {review.totalCount} matching
            products
          </p>
        </div>
        <span className="release-status">Draft only</span>
      </header>

      <div className="catalog-review-next-action">
        <Link
          className="button button-secondary"
          to={`/admin/catalog/releases?release=${encodeURIComponent(review.release.id)}`}
        >
          Review for publication
        </Link>
      </div>

      {loaderData.updatedCount > 0 ? (
        <p className="catalog-update-success" role="status">
          <Check size={17} /> Updated {loaderData.updatedCount} draft products.
        </p>
      ) : null}
      {actionData?.formError ? (
        <p className="form-error" role="alert">
          {actionData.formError}
        </p>
      ) : null}
      {actionData?.preview ? (
        <ConfirmationPanel
          cancelTo={`${location.pathname}${location.search}`}
          preview={actionData.preview}
        />
      ) : null}

      <section className="catalog-review-filters">
        <div>
          <Filter size={20} />
          <div>
            <h2>Filter draft</h2>
            <p>
              Filters change the review list and define category bulk targets.
            </p>
          </div>
        </div>
        <Form method="get">
          <input name="release" type="hidden" value={review.release.id} />
          <label>
            <span>Worksheet category</span>
            <select
              defaultValue={review.filters.sourceWorksheet ?? ""}
              name="worksheet"
            >
              <option value="">All worksheets</option>
              {review.worksheetOptions.map((worksheet) => (
                <option key={worksheet} value={worksheet}>
                  {worksheet}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Hose Series</span>
            <select
              defaultValue={review.filters.hoseSeries ?? ""}
              name="series"
            >
              <option value="">All series</option>
              {review.hoseSeriesOptions.map((series) => (
                <option key={series} value={series}>
                  {series}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Exact SKU</span>
            <input
              defaultValue={review.filters.sku ?? ""}
              name="sku"
              placeholder="e.g. 601R2_001"
              type="search"
            />
          </label>
          <button className="button button-primary" type="submit">
            <Search size={17} /> Apply filters
          </button>
          <Link
            className="button button-secondary"
            to={`/admin/catalog/review?release=${encodeURIComponent(review.release.id)}`}
          >
            Clear
          </Link>
        </Form>
      </section>

      <Form className="catalog-bulk-form" method="post">
        <input name="intent" type="hidden" value="preview" />
        <input name="releaseId" type="hidden" value={review.release.id} />
        <input
          name="sourceWorksheet"
          type="hidden"
          value={review.filters.sourceWorksheet ?? ""}
        />
        <input
          name="hoseSeries"
          type="hidden"
          value={review.filters.hoseSeries ?? ""}
        />

        <div className="catalog-bulk-toolbar">
          <label>
            <span>Set Supply Availability</span>
            <select defaultValue="available_for_quote" name="target">
              {supplyAvailabilityValues.map((value) => (
                <option key={value} value={value}>
                  {availabilityLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <div className="catalog-bulk-actions">
            <button
              className="button button-secondary"
              disabled={!review.filters.sourceWorksheet || busy}
              name="selectorMode"
              type="submit"
              value="worksheet"
            >
              Preview current worksheet
            </button>
            <button
              className="button button-secondary"
              disabled={!review.filters.hoseSeries || busy}
              name="selectorMode"
              type="submit"
              value="hose_series"
            >
              Preview current Hose Series
            </button>
            <button
              className="button button-primary"
              disabled={selectedSkus.length === 0 || busy}
              name="selectorMode"
              type="submit"
              value="selected"
            >
              Preview {selectedSkus.length} selected
            </button>
          </div>
        </div>

        <div className="catalog-review-table-wrap">
          <table className="catalog-review-table">
            <thead>
              <tr>
                <th className="selection-cell">
                  <input
                    aria-label="Select all visible products"
                    checked={allVisibleSelected}
                    onChange={(event) =>
                      setSelectedSkus(
                        event.target.checked
                          ? review.products.map((product) => product.sku)
                          : [],
                      )
                    }
                    type="checkbox"
                  />
                </th>
                <th>SKU</th>
                <th>Category</th>
                <th>Series</th>
                <th>Supply Availability</th>
                <th>Reference Price</th>
                <th>Cost Basis</th>
                <th>RFQ / Technical</th>
              </tr>
            </thead>
            <tbody>
              {review.products.map((product) => (
                <tr key={product.sku}>
                  <td className="selection-cell">
                    <input
                      aria-label={`Select ${product.sku}`}
                      checked={selected.has(product.sku)}
                      name="selectedSku"
                      onChange={(event) =>
                        setSelectedSkus((current) =>
                          event.target.checked
                            ? [...current, product.sku]
                            : current.filter((sku) => sku !== product.sku),
                        )
                      }
                      type="checkbox"
                      value={product.sku}
                    />
                  </td>
                  <td>
                    <strong>{product.sku}</strong>
                    <small>{product.productType}</small>
                  </td>
                  <td>{product.sourceWorksheet}</td>
                  <td>{product.hoseSeries ?? "—"}</td>
                  <td>
                    <span
                      className={`availability-badge ${product.supplyAvailability}`}
                    >
                      {availabilityLabels[product.supplyAvailability]}
                    </span>
                  </td>
                  <td>{money(product.referencePriceUsd)}</td>
                  <td>
                    {money(
                      product.factoryUnitPrice,
                      product.costBasisCurrency ?? "USD",
                    )}
                    {product.priceIncoterm ? (
                      <small>{product.priceIncoterm}</small>
                    ) : null}
                  </td>
                  <td>
                    {product.rfqEligibility}
                    <small>{product.technicalDataStatus}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {review.products.length === 0 ? (
            <p className="catalog-review-no-results">
              No draft products match these filters.
            </p>
          ) : null}
        </div>
      </Form>
    </main>
  );
}
