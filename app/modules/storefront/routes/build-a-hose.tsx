import {
  AlertTriangle,
  ArrowRight,
  Check,
  Gauge,
  Layers3,
  Thermometer,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/build-a-hose";
import { createHoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";
import {
  groupCatalogFamilies,
  type PublicCatalogItem,
} from "../../catalog/domain/public-catalog";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { hoseSizeLabel } from "../domain/variant-label";
import { CatalogMedia } from "../ui/catalog-media";
import { StorefrontHeader } from "../ui/storefront-header";
import "../styles/catalog.css";
import "../styles/configurator.css";
import { cloudflareContext } from "#workers/context";

type DirectSelectionState =
  | { kind: "none" }
  | { kind: "invalid"; sku: string }
  | { kind: "unavailable"; sku: string };

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const repository = createD1PublicCatalogRepository(env.DB);
  const result = await repository.browse({ category: "hydraulic-hose" });
  const hoses = result.items.filter((item) => item.productType === "hose");
  const eligibleHoses = hoses.filter(
    (item) => item.rfqEligibility === "Eligible",
  );
  const requestedSku = new URL(request.url).searchParams.get("hose")?.trim();
  const requested = requestedSku
    ? hoses.find((item) => item.sku === requestedSku)
    : null;

  let directSelection: DirectSelectionState = { kind: "none" };
  let initialSku: string | null = null;
  if (requestedSku) {
    if (!requested) {
      directSelection = { kind: "invalid", sku: requestedSku };
    } else if (!requested.canAddToQuote) {
      directSelection = { kind: "unavailable", sku: requestedSku };
    } else {
      initialSku = requested.sku;
    }
  }

  return {
    directSelection,
    families: groupCatalogFamilies(eligibleHoses),
    initialSku,
    publishedHoseCount: hoses.length,
    releaseNumber: hoses[0]?.releaseNumber ?? null,
  };
}

export function meta() {
  return [
    { title: "Build a Hydraulic Hose | Hydraulic Supply" },
    {
      name: "description",
      content: "Configure a hydraulic hose assembly from an exact hose SKU.",
    },
  ];
}

function sizeLabel(item: PublicCatalogItem) {
  const selection = item.variantSelection;
  return selection?.kind === "hose"
    ? (hoseSizeLabel(selection.nominalIdIn, selection.dash) ??
        "Size not specified")
    : "Size not specified";
}

function pressureLabel(item: PublicCatalogItem) {
  const selection = item.variantSelection;
  if (selection?.kind !== "hose") return "Confirmed during review";
  return [
    selection.workingPsi ? `${selection.workingPsi} psi` : null,
    selection.workingBar ? `${selection.workingBar} bar` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function temperatureLabel(item: PublicCatalogItem) {
  const selection = item.variantSelection;
  if (
    selection?.kind !== "hose" ||
    selection.temperatureMinC === null ||
    selection.temperatureMaxC === null
  ) {
    return "Confirmed during review";
  }
  return `${selection.temperatureMinC}°C to ${selection.temperatureMaxC}°C`;
}

export default function BuildAHose({ loaderData }: Route.ComponentProps) {
  const initialItem = loaderData.initialSku
    ? loaderData.families
        .flatMap((family) => family.variants)
        .find((item) => item.sku === loaderData.initialSku)
    : null;
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(
    initialItem?.familyKey ?? null,
  );
  const [selectedSku, setSelectedSku] = useState<string | null>(
    initialItem?.sku ?? null,
  );
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const selectedFamily = loaderData.families.find(
    (family) => family.familyKey === selectedFamilyKey,
  );
  const selectedItem = selectedFamily?.variants.find(
    (item) => item.sku === selectedSku,
  );
  const draft = useMemo(
    () => (selectedItem ? createHoseConfigurationDraft(selectedItem) : null),
    [selectedItem],
  );
  const hasSelectableHose = loaderData.families.some((family) =>
    family.variants.some((variant) => variant.canAddToQuote),
  );
  const visualItem = selectedItem ?? selectedFamily?.representative ?? null;

  function chooseFamily(familyKey: string) {
    setSelectedFamilyKey(familyKey);
    setSelectedSku(null);
    setSelectionConfirmed(false);
  }

  function chooseHose(item: PublicCatalogItem) {
    if (!item.canAddToQuote) return;
    setSelectedSku(item.sku);
    setSelectionConfirmed(false);
  }

  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="configurator-page">
        <header className="configurator-heading">
          <div>
            <span className="eyebrow">Custom hydraulic assembly</span>
            <h1>Build a Hose</h1>
            <p>Start with the hose series and exact inside diameter.</p>
          </div>
          <div className="configurator-release">
            <span>Catalog release</span>
            <strong>{loaderData.releaseNumber ?? "Not available"}</strong>
          </div>
        </header>

        <ol className="configurator-progress" aria-label="Assembly steps">
          <li aria-current="step">
            <span>1</span>
            <strong>Hose</strong>
          </li>
          {["End A", "End B", "Length", "Protection", "Review"].map(
            (label, index) => (
              <li key={label}>
                <span>{index + 2}</span>
                <strong>{label}</strong>
              </li>
            ),
          )}
        </ol>

        {loaderData.directSelection.kind !== "none" ? (
          <div className="configurator-alert" role="status">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>
                {loaderData.directSelection.kind === "unavailable"
                  ? "This hose is not currently selectable."
                  : "This hose link is not in the current catalog."}
              </strong>
              <p>
                Choose an available series and size below to start a new
                configuration. Requested SKU: {loaderData.directSelection.sku}
              </p>
            </div>
          </div>
        ) : null}

        {loaderData.publishedHoseCount === 0 ? (
          <section className="configurator-empty">
            <Layers3 aria-hidden="true" size={30} />
            <h2>No published hydraulic hoses</h2>
            <p>The current catalog does not contain a hose to configure.</p>
            <Link
              className="button button-secondary"
              to="/catalog/hydraulic-hose"
            >
              Browse hydraulic hose
            </Link>
          </section>
        ) : !hasSelectableHose ? (
          <section className="configurator-empty">
            <AlertTriangle aria-hidden="true" size={30} />
            <h2>Hose configuration is temporarily unavailable</h2>
            <p>
              Published hoses are visible, but none can start a quote today.
            </p>
            <Link
              className="button button-secondary"
              to="/catalog/hydraulic-hose"
            >
              View published hoses
            </Link>
          </section>
        ) : (
          <div className="configurator-workspace">
            <section className="configurator-controls">
              <fieldset className="configurator-fieldset">
                <legend>1. Choose a Hose Series</legend>
                <p>Series determines construction and performance range.</p>
                <div className="hose-series-grid">
                  {loaderData.families.map((family) => {
                    const active = family.familyKey === selectedFamilyKey;
                    const availableCount = family.variants.filter(
                      (variant) => variant.canAddToQuote,
                    ).length;
                    const selection = family.representative.variantSelection;
                    return (
                      <button
                        aria-pressed={active}
                        className="hose-series-choice"
                        data-hose-series={family.familyKey}
                        disabled={availableCount === 0}
                        key={family.familyKey}
                        onClick={() => chooseFamily(family.familyKey)}
                        type="button"
                      >
                        <span>
                          <strong>{family.familyName}</strong>
                          <small>
                            {selection?.kind === "hose"
                              ? (selection.primaryStandard ??
                                selection.equivalentStandard ??
                                "Hydraulic hose")
                              : "Hydraulic hose"}
                          </small>
                        </span>
                        <span className="hose-series-count">
                          {availableCount === 1
                            ? "1 size"
                            : `${availableCount} sizes`}
                        </span>
                        {active ? <Check aria-hidden="true" size={18} /> : null}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {selectedFamily ? (
                <fieldset className="configurator-fieldset">
                  <legend>2. Choose Hose Inside Diameter</legend>
                  <p>
                    Only an exact available SKU can start the assembly draft.
                  </p>
                  <div className="hose-size-grid">
                    {selectedFamily.variants.map((item) => {
                      const selection = item.variantSelection;
                      const active = item.sku === selectedSku;
                      return (
                        <button
                          aria-label={`Select ${sizeLabel(item)}, ${selection?.kind === "hose" ? `Dash ${selection.dash}` : item.sku}`}
                          aria-pressed={active}
                          className="hose-size-choice"
                          data-hose-sku={item.sku}
                          disabled={!item.canAddToQuote}
                          key={item.sku}
                          onClick={() => chooseHose(item)}
                          type="button"
                        >
                          <span>
                            <strong>{sizeLabel(item)}</strong>
                            <small>
                              {selection?.kind === "hose"
                                ? `Hose ID · Dash ${selection.dash}`
                                : item.sku}
                            </small>
                          </span>
                          {item.canAddToQuote ? (
                            active ? (
                              <Check aria-hidden="true" size={18} />
                            ) : null
                          ) : (
                            <small>Unavailable</small>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : (
                <div className="configurator-stage-prompt">
                  <span>2</span>
                  <p>Choose a series to see its exact hose sizes.</p>
                </div>
              )}
            </section>

            <aside className="configurator-summary" aria-live="polite">
              <div className="configurator-media">
                {visualItem ? (
                  <CatalogMedia item={visualItem} />
                ) : (
                  <div className="configurator-media-placeholder">
                    <Layers3 aria-hidden="true" size={42} />
                    <span>Select a hose series</span>
                  </div>
                )}
              </div>
              <div className="configurator-summary-copy">
                <span className="eyebrow">Current selection</span>
                <h2>{draft?.hose.familyName ?? "No hose selected"}</h2>
                {selectedItem && draft ? (
                  <>
                    <p className="configurator-sku">SKU {draft.hose.sku}</p>
                    <dl>
                      <div>
                        <dt>
                          <Layers3 aria-hidden="true" size={17} /> Size
                        </dt>
                        <dd>{sizeLabel(selectedItem)}</dd>
                      </div>
                      <div>
                        <dt>
                          <Gauge aria-hidden="true" size={17} /> Working
                          pressure
                        </dt>
                        <dd>{pressureLabel(selectedItem)}</dd>
                      </div>
                      <div>
                        <dt>
                          <Thermometer aria-hidden="true" size={17} />{" "}
                          Temperature
                        </dt>
                        <dd>{temperatureLabel(selectedItem)}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p className="configurator-summary-prompt">
                    Select a series, then an exact inside diameter.
                  </p>
                )}
                <button
                  className="button button-primary configurator-next"
                  disabled={!draft}
                  onClick={() => setSelectionConfirmed(true)}
                  type="button"
                >
                  Continue to End A <ArrowRight aria-hidden="true" size={18} />
                </button>
                {selectionConfirmed && draft ? (
                  <p className="configurator-confirmation" role="status">
                    <Check aria-hidden="true" size={16} /> Hose saved in this
                    page session.
                  </p>
                ) : null}
                <p className="configurator-session-note">
                  This unfinished configuration is kept only in this page
                  session and has not been added to your Quote List.
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
