import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Gauge,
  Layers3,
  Search,
  Thermometer,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/build-a-hose";
import {
  attachEndAToDraft,
  filterCompatibleEndACandidates,
  type CompatibleEndACandidate,
  type EndAFilters,
} from "../../configurator/domain/compatible-end-a";
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
  const requestedEndASku = new URL(request.url).searchParams
    .get("endA")
    ?.trim();
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
    requestedEndASku: requestedEndASku ?? null,
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

type ConfiguratorStage = "hose" | "end-a";
type EndALoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { candidates: CompatibleEndACandidate[]; kind: "ready" };

const emptyEndAFilters: EndAFilters = {
  angle: "",
  connectionDash: "",
  gender: "",
  interfaceGroup: "",
  query: "",
  swivelForm: "",
};

function uniqueCandidateValues(
  candidates: CompatibleEndACandidate[],
  select: (candidate: CompatibleEndACandidate) => string | null,
) {
  return [...new Set(candidates.map(select).filter(Boolean) as string[])].sort(
    (left, right) => left.localeCompare(right, undefined, { numeric: true }),
  );
}

function EndAFilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="end-a-filter">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BuildAHoseView({
  loaderData,
}: {
  loaderData: BuildAHoseLoaderData;
}) {
  const [stage, setStage] = useState<ConfiguratorStage>("hose");
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(
    null,
  );
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [endALoadState, setEndALoadState] = useState<EndALoadState>({
    kind: "idle",
  });
  const [endAFilters, setEndAFilters] = useState<EndAFilters>(emptyEndAFilters);
  const [selectedEndACompatibilityId, setSelectedEndACompatibilityId] =
    useState<string | null>(null);
  const selectedFamily = loaderData.families.find(
    (family) => family.familyKey === selectedFamilyKey,
  );
  const selectedItem = selectedFamily?.variants.find(
    (item) => item.sku === selectedSku,
  );
  const hoseDraft = useMemo(
    () => (selectedItem ? createHoseConfigurationDraft(selectedItem) : null),
    [selectedItem],
  );
  const endACandidates =
    endALoadState.kind === "ready" ? endALoadState.candidates : [];
  const selectedEndA = endACandidates.find(
    (candidate) => candidate.compatibilityId === selectedEndACompatibilityId,
  );
  const draft = useMemo(
    () =>
      hoseDraft && selectedEndA
        ? attachEndAToDraft(hoseDraft, selectedEndA)
        : hoseDraft,
    [hoseDraft, selectedEndA],
  );
  const filteredEndACandidates = useMemo(
    () => filterCompatibleEndACandidates(endACandidates, endAFilters),
    [endACandidates, endAFilters],
  );
  const hasSelectableHose = loaderData.families.some((family) =>
    family.variants.some((variant) => variant.canAddToQuote),
  );
  const visualItem = selectedItem ?? selectedFamily?.representative ?? null;
  const directCopy =
    loaderData.directSelection.kind === "none"
      ? null
      : directSelectionCopy(loaderData.directSelection);
  const endAFilterOptions = {
    angle: uniqueCandidateValues(
      endACandidates,
      (candidate) => candidate.angle,
    ),
    connectionDash: uniqueCandidateValues(
      endACandidates,
      (candidate) => candidate.connectionDash,
    ),
    gender: uniqueCandidateValues(
      endACandidates,
      (candidate) => candidate.gender,
    ),
    interfaceGroup: uniqueCandidateValues(
      endACandidates,
      (candidate) => candidate.interfaceGroup,
    ),
    swivelForm: uniqueCandidateValues(
      endACandidates,
      (candidate) => candidate.swivelForm,
    ),
  };
  const selectedEndAHidden = Boolean(
    selectedEndA &&
    !filteredEndACandidates.some(
      (candidate) => candidate.compatibilityId === selectedEndA.compatibilityId,
    ),
  );
  const requestedEndAState = loaderData.requestedEndASku
    ? endACandidates.some(
        (candidate) => candidate.hoseEndSku === loaderData.requestedEndASku,
      )
      ? "compatible"
      : "invalid"
    : null;

  useEffect(() => {
    if (stage !== "end-a" || !hoseDraft) return;
    const controller = new AbortController();
    setEndALoadState({ kind: "loading" });
    fetch(
      `/api/configurator/compatible-end-a?hose=${encodeURIComponent(hoseDraft.hose.sku)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Compatible fittings could not be loaded.");
        return (await response.json()) as {
          candidates: CompatibleEndACandidate[];
        };
      })
      .then(({ candidates }) => {
        setEndALoadState({ candidates, kind: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setEndALoadState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Compatible fittings could not be loaded.",
        });
      });
    return () => controller.abort();
  }, [hoseDraft, stage]);

  useEffect(() => {
    if (stage === "end-a") window.scrollTo({ behavior: "auto", top: 0 });
  }, [stage]);

  function chooseFamily(familyKey: string) {
    setSelectedFamilyKey(familyKey);
    setSelectedSku(null);
    setSelectedEndACompatibilityId(null);
    setEndALoadState({ kind: "idle" });
  }

  function chooseHose(item: PublicCatalogItem) {
    if (!item.canAddToQuote) return;
    setSelectedSku(item.sku);
    setSelectedEndACompatibilityId(null);
    setEndALoadState({ kind: "idle" });
  }

  function continueToEndA() {
    if (!hoseDraft) return;
    setEndAFilters(emptyEndAFilters);
    setStage("end-a");
  }

  function backToHose() {
    setStage("hose");
  }

  function updateEndAFilter(key: keyof EndAFilters, value: string) {
    setEndAFilters((current) => ({ ...current, [key]: value }));
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
          {["Hose", "End A", "End B", "Length", "Protection", "Review"].map(
            (label, index) => {
              const active =
                (stage === "hose" && index === 0) ||
                (stage === "end-a" && index === 1);
              return (
                <li aria-current={active ? "step" : undefined} key={label}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                </li>
              );
            },
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
              {stage === "hose" ? (
                <>
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
                            {active ? (
                              <Check aria-hidden="true" size={18} />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  {selectedFamily ? (
                    <fieldset className="configurator-fieldset">
                      <legend>2. Choose Hose Inside Diameter</legend>
                      <p>
                        Only an exact available SKU can start the assembly
                        draft.
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
                </>
              ) : (
                <section
                  className="end-a-stage"
                  aria-labelledby="end-a-heading"
                >
                  <header className="end-a-stage-heading">
                    <button
                      className="button button-secondary button-with-icon"
                      onClick={backToHose}
                      type="button"
                    >
                      <ArrowLeft aria-hidden="true" size={18} />
                      Back to Hose
                    </button>
                    <div>
                      <span className="eyebrow">Step 2</span>
                      <h2 id="end-a-heading">Choose End A</h2>
                      <p>
                        Every result below is an exact compatible combination
                        for {draft?.hose.sku}.
                      </p>
                    </div>
                  </header>

                  {endALoadState.kind === "loading" ? (
                    <div className="configurator-stage-prompt" role="status">
                      <span>2</span>
                      <p>Loading compatible End A fittings...</p>
                    </div>
                  ) : endALoadState.kind === "error" ? (
                    <div className="configurator-alert" role="alert">
                      <AlertTriangle aria-hidden="true" size={20} />
                      <div>
                        <strong>Compatible fittings could not be loaded</strong>
                        <p>
                          {endALoadState.message} Return to Hose and try again.
                        </p>
                      </div>
                    </div>
                  ) : endALoadState.kind === "ready" ? (
                    <>
                      {loaderData.requestedEndASku ? (
                        <div className="configurator-alert" role="status">
                          <AlertTriangle aria-hidden="true" size={20} />
                          <div>
                            <strong>
                              {requestedEndAState === "compatible"
                                ? "This link points to a compatible End A."
                                : "This End A is not compatible with the selected hose."}
                            </strong>
                            <p>
                              Requested SKU: {loaderData.requestedEndASku}.
                              Choose an exact supported result below.
                            </p>
                          </div>
                        </div>
                      ) : null}

                      <div className="end-a-finder">
                        <label className="end-a-search">
                          <span>Search compatible fittings</span>
                          <span className="end-a-search-input">
                            <Search aria-hidden="true" size={18} />
                            <input
                              onChange={(event) =>
                                updateEndAFilter("query", event.target.value)
                              }
                              placeholder="SKU, alias, thread, or dash"
                              type="search"
                              value={endAFilters.query}
                            />
                          </span>
                        </label>
                        <div className="end-a-filter-grid">
                          <EndAFilterSelect
                            label="Interface family"
                            onChange={(value) =>
                              updateEndAFilter("interfaceGroup", value)
                            }
                            options={endAFilterOptions.interfaceGroup}
                            value={endAFilters.interfaceGroup ?? ""}
                          />
                          <EndAFilterSelect
                            label="Shape"
                            onChange={(value) =>
                              updateEndAFilter("angle", value)
                            }
                            options={endAFilterOptions.angle}
                            value={endAFilters.angle ?? ""}
                          />
                          <EndAFilterSelect
                            label="Gender"
                            onChange={(value) =>
                              updateEndAFilter("gender", value)
                            }
                            options={endAFilterOptions.gender}
                            value={endAFilters.gender ?? ""}
                          />
                          <EndAFilterSelect
                            label="Swivel / fixed"
                            onChange={(value) =>
                              updateEndAFilter("swivelForm", value)
                            }
                            options={endAFilterOptions.swivelForm}
                            value={endAFilters.swivelForm ?? ""}
                          />
                          <EndAFilterSelect
                            label="Connection size"
                            onChange={(value) =>
                              updateEndAFilter("connectionDash", value)
                            }
                            options={endAFilterOptions.connectionDash}
                            value={endAFilters.connectionDash ?? ""}
                          />
                        </div>
                        <div className="end-a-result-bar" aria-live="polite">
                          <span>
                            {filteredEndACandidates.length} of{" "}
                            {endACandidates.length} compatible fittings
                          </span>
                          <button
                            onClick={() => setEndAFilters(emptyEndAFilters)}
                            type="button"
                          >
                            Clear filters
                          </button>
                        </div>
                      </div>

                      {selectedEndAHidden ? (
                        <div className="configurator-alert" role="status">
                          <AlertTriangle aria-hidden="true" size={20} />
                          <div>
                            <strong>
                              Your selected End A is hidden by these filters.
                            </strong>
                            <p>
                              The selection is retained. Clear filters to see it
                              again.
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {filteredEndACandidates.length === 0 ? (
                        <div className="end-a-empty">
                          <Search aria-hidden="true" size={28} />
                          <h3>No compatible fittings match these filters</h3>
                          <p>
                            Clear one or more filters. Unsupported catalogue
                            fittings are intentionally excluded.
                          </p>
                          <button
                            className="button button-secondary"
                            onClick={() => setEndAFilters(emptyEndAFilters)}
                            type="button"
                          >
                            Clear filters
                          </button>
                        </div>
                      ) : (
                        <div
                          aria-label="Compatible End A fittings"
                          className="end-a-results"
                        >
                          {filteredEndACandidates.map((candidate) => {
                            const active =
                              candidate.compatibilityId ===
                              selectedEndACompatibilityId;
                            return (
                              <button
                                aria-label={`Select ${candidate.displayName}, ${candidate.thread}, connection ${candidate.connectionDash}`}
                                aria-pressed={active}
                                className="end-a-choice"
                                data-hose-end-sku={candidate.hoseEndSku}
                                key={candidate.compatibilityId}
                                onClick={() =>
                                  setSelectedEndACompatibilityId(
                                    candidate.compatibilityId,
                                  )
                                }
                                type="button"
                              >
                                <span className="end-a-choice-title">
                                  <span>
                                    <strong>{candidate.displayName}</strong>
                                    <small>SKU {candidate.hoseEndSku}</small>
                                  </span>
                                  {active ? (
                                    <Check aria-hidden="true" size={19} />
                                  ) : null}
                                </span>
                                <dl>
                                  <div>
                                    <dt>Connection</dt>
                                    <dd>
                                      {candidate.connectionDash} ·{" "}
                                      {candidate.thread}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Exact standard</dt>
                                    <dd>{candidate.connectionStandard}</dd>
                                  </div>
                                  <div>
                                    <dt>Seal</dt>
                                    <dd>{candidate.sealingForm}</dd>
                                  </div>
                                  <div>
                                    <dt>Hose tail</dt>
                                    <dd>{candidate.hoseTailDash}</dd>
                                  </div>
                                </dl>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : null}
                </section>
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
                    {draft.endA ? (
                      <section
                        className="end-a-summary"
                        aria-label="Selected End A"
                      >
                        <span className="eyebrow">End A</span>
                        <h3>{draft.endA.hoseEnd.displayName}</h3>
                        <p>SKU {draft.endA.hoseEnd.sku}</p>
                        <dl>
                          <div>
                            <dt>Thread</dt>
                            <dd>{draft.endA.hoseEnd.thread}</dd>
                          </div>
                          <div>
                            <dt>Exact standard</dt>
                            <dd>{draft.endA.hoseEnd.connectionStandard}</dd>
                          </div>
                          <div>
                            <dt>Seal</dt>
                            <dd>{draft.endA.hoseEnd.sealingForm}</dd>
                          </div>
                          <div>
                            <dt>Derived ferrule</dt>
                            <dd>{draft.endA.ferrule.sku}</dd>
                          </div>
                        </dl>
                        <p className="end-a-ferrule-note">
                          The ferrule is resolved automatically from
                          compatibility data and is not customer-selectable.
                        </p>
                      </section>
                    ) : null}
                  </>
                ) : (
                  <p className="configurator-summary-prompt">
                    Select a series, then an exact inside diameter.
                  </p>
                )}
                {draft && stage === "hose" ? (
                  <p className="configurator-ready" role="status">
                    <Check aria-hidden="true" size={17} />
                    <span>
                      <strong>Hose selection ready</strong>
                      <small>End A is the next configuration step.</small>
                    </span>
                  </p>
                ) : null}
                {draft && stage === "hose" ? (
                  <button
                    className="button button-primary configurator-next"
                    onClick={continueToEndA}
                    type="button"
                  >
                    Continue to End A
                    <ArrowRight aria-hidden="true" size={18} />
                  </button>
                ) : null}
                {draft?.endA && stage === "end-a" ? (
                  <p className="configurator-ready" role="status">
                    <Check aria-hidden="true" size={17} />
                    <span>
                      <strong>End A selection ready</strong>
                      <small>
                        Exact Hose End and Ferrule saved in this draft.
                      </small>
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
