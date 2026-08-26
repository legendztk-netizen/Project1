import {
  AlertTriangle,
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
  type PublicVariantSelection,
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
  | { kind: "current"; sku: string }
  | { kind: "invalid"; sku: string }
  | { kind: "superseded"; sku: string }
  | { kind: "unavailable"; sku: string };

interface DirectSelectionCopy {
  detail: string;
  heading: string;
}

function directSelectionCopy(
  state: Exclude<DirectSelectionState, { kind: "none" }>,
): DirectSelectionCopy {
  switch (state.kind) {
    case "current":
      return {
        detail:
          "Select its series and exact size below to start a new configuration.",
        heading: "This link points to a current hose.",
      };
    case "unavailable":
      return {
        detail:
          "Choose an available series and size below to start a new configuration.",
        heading: "This hose is not currently selectable.",
      };
    case "superseded":
      return {
        detail:
          "Choose an available series and size below to start a new configuration.",
        heading: "This hose belongs to an older catalog release.",
      };
    case "invalid":
      return {
        detail:
          "Choose an available series and size below to start a new configuration.",
        heading: "This hose link is not in the current catalog.",
      };
  }
}

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
  if (requestedSku) {
    if (requested && !requested.canAddToQuote) {
      directSelection = { kind: "unavailable", sku: requestedSku };
    } else if (requested) {
      directSelection = { kind: "current", sku: requestedSku };
    } else if (
      await repository.wasHosePublishedInSupersededRelease(requestedSku)
    ) {
      directSelection = { kind: "superseded", sku: requestedSku };
    } else {
      directSelection = { kind: "invalid", sku: requestedSku };
    }
  }

  return {
    directSelection,
    families: groupCatalogFamilies(eligibleHoses),
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
  const selection = hoseSelection(item);
  return selection
    ? (hoseSizeLabel(selection.nominalIdIn, selection.dash) ??
        "Size not specified")
    : "Size not specified";
}

type PublicHoseSelection = Extract<PublicVariantSelection, { kind: "hose" }>;

function hoseSelection(item: PublicCatalogItem): PublicHoseSelection | null {
  const selection = item.variantSelection;
  return selection?.kind === "hose" ? selection : null;
}

function pressureLabel(item: PublicCatalogItem) {
  const selection = hoseSelection(item);
  if (!selection) return "Confirmed during review";
  const label = [
    selection.performance.workingPsi
      ? `${selection.performance.workingPsi} psi`
      : null,
    selection.performance.workingBar
      ? `${selection.performance.workingBar} bar`
      : null,
  ]
    .filter(Boolean)
    .join(" / ");
  return label || "Confirmed during review";
}

function temperatureLabel(item: PublicCatalogItem) {
  const selection = hoseSelection(item);
  if (
    !selection ||
    selection.performance.temperatureMinC === null ||
    selection.performance.temperatureMaxC === null
  ) {
    return "Confirmed during review";
  }
  return `${selection.performance.temperatureMinC}°C to ${selection.performance.temperatureMaxC}°C`;
}

type BuildAHoseLoaderData = Awaited<ReturnType<typeof loader>>;

export function BuildAHoseView({
  loaderData,
}: {
  loaderData: BuildAHoseLoaderData;
}) {
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(
    null,
  );
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
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
  const directCopy =
    loaderData.directSelection.kind === "none"
      ? null
      : directSelectionCopy(loaderData.directSelection);

  function chooseFamily(familyKey: string) {
    setSelectedFamilyKey(familyKey);
    setSelectedSku(null);
  }

  function chooseHose(item: PublicCatalogItem) {
    if (!item.canAddToQuote) return;
    setSelectedSku(item.sku);
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

        {directCopy && loaderData.directSelection.kind !== "none" ? (
          <div className="configurator-alert" role="status">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>{directCopy.heading}</strong>
              <p>
                {directCopy.detail} Requested SKU:{" "}
                {loaderData.directSelection.sku}
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
                    const selection = hoseSelection(family.representative);
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
                            {selection
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
                      const selection = hoseSelection(item);
                      const active = item.sku === selectedSku;
                      return (
                        <button
                          aria-label={`Select ${sizeLabel(item)}, ${selection ? `Dash ${selection.dash}` : item.sku}`}
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
                              {selection
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
                {draft ? (
                  <p className="configurator-ready" role="status">
                    <Check aria-hidden="true" size={17} />
                    <span>
                      <strong>Hose selection ready</strong>
                      <small>End A is the next configuration step.</small>
                    </span>
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

export default function BuildAHose({ loaderData }: Route.ComponentProps) {
  return <BuildAHoseView loaderData={loaderData} />;
}
