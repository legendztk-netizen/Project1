import {
  AlertTriangle,
  ArrowRight,
  Check,
  Gauge,
  Layers3,
  Thermometer,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/build-a-hose";
import {
  attachClockingToDraft,
  confirmClockingForDraft,
  evaluateAssemblyClockingApplicability,
  requiresAssemblyClocking,
  type ClockingDraftSnapshot,
  type ClockingSelectionSnapshot,
} from "../../configurator/domain/assembly-clocking";
import {
  attachEndAToDraft,
  attachEndBToDraft,
  type CompatibleHoseEndCandidate,
} from "../../configurator/domain/compatible-end-a";
import {
  createHoseConfigurationDraft,
  type HoseConfigurationDraft,
} from "../../configurator/domain/hose-configuration-draft";
import {
  attachFinishedLengthToDraft,
  attachMeasurementSelectionToDraft,
  type FinishedAssemblyLengthSnapshot,
  type MeasurementSelectionSnapshot,
} from "../../configurator/domain/finished-assembly-length";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";
import {
  groupCatalogFamilies,
  type PublicCatalogItem,
  type PublicVariantSelection,
} from "../../catalog/domain/public-catalog";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { hoseSizeLabel } from "../domain/variant-label";
import { CatalogMedia } from "../ui/catalog-media";
import { ClockingStage } from "../ui/clocking-stage";
import { CompatibleHoseEndStage } from "../ui/compatible-end-a-stage";
import { FinishedLengthStage } from "../ui/finished-length-stage";
import { StorefrontHeader } from "../ui/storefront-header";
import "../styles/catalog.css";
import "../styles/clocking-preview.css";
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
  const referenceRepository = createD1ConfiguratorReferenceRepository(env.DB);
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
  const referenceSnapshot = await referenceRepository.findActiveSnapshot();
  const measurementMethods =
    referenceSnapshot?.release.id === hoses[0]?.releaseId
      ? [...referenceSnapshot.measurementMethods].sort((left, right) =>
          left.code.localeCompare(right.code),
        )
      : [];
  const clockingConvention =
    referenceSnapshot?.release.id === hoses[0]?.releaseId
      ? referenceSnapshot.clockingConvention
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
    clockingConvention,
    families: groupCatalogFamilies(eligibleHoses),
    measurementMethods,
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

type ConfiguratorStage = "hose" | "end-a" | "end-b" | "length" | "clocking";

function ConfiguredEndSummary({
  end,
  role,
}: {
  end: NonNullable<HoseConfigurationDraft["endA"]>;
  role: "A" | "B";
}) {
  return (
    <section className="end-a-summary" aria-label={`Selected End ${role}`}>
      <span className="eyebrow">End {role}</span>
      <h3>{end.hoseEnd.displayName}</h3>
      <p>SKU {end.hoseEnd.sku}</p>
      <dl>
        <div>
          <dt>Thread</dt>
          <dd>{end.hoseEnd.thread}</dd>
        </div>
        <div>
          <dt>Exact standard</dt>
          <dd>{end.hoseEnd.connectionStandard}</dd>
        </div>
        <div>
          <dt>Seal</dt>
          <dd>{end.hoseEnd.sealingForm}</dd>
        </div>
        <div>
          <dt>Derived ferrule</dt>
          <dd>{end.ferrule.sku}</dd>
        </div>
      </dl>
      <p className="end-a-ferrule-note">
        The ferrule is resolved automatically from exact compatibility data and
        is not customer-selectable.
      </p>
    </section>
  );
}

function LaterStagePreview({ showOrientation }: { showOrientation: boolean }) {
  return (
    <section
      className="later-stage-preview"
      aria-label="Remaining configuration"
    >
      <header>
        <span className="eyebrow">Next steps</span>
        <h3>Complete the assembly details</h3>
        <p>No measurement method or option has been selected automatically.</p>
      </header>
      <div>
        {[
          ...(showOrientation ? ["Orientation"] : []),
          "Protection",
          "Application",
        ].map((label) => (
          <article key={label}>
            <strong>{label}</strong>
            <span>Not selected</span>
          </article>
        ))}
      </div>
    </section>
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
  const [selectedEndA, setSelectedEndA] =
    useState<CompatibleHoseEndCandidate | null>(null);
  const [selectedEndB, setSelectedEndB] =
    useState<CompatibleHoseEndCandidate | null>(null);
  const [measurementSelection, setMeasurementSelection] =
    useState<MeasurementSelectionSnapshot | null>(null);
  const [finishedLength, setFinishedLength] =
    useState<FinishedAssemblyLengthSnapshot | null>(null);
  const [clockingSelection, setClockingSelection] =
    useState<ClockingDraftSnapshot | null>(null);
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
  const draft = useMemo(() => {
    if (!hoseDraft) return null;
    const withEndA = selectedEndA
      ? attachEndAToDraft(hoseDraft, selectedEndA)
      : hoseDraft;
    const withEndB = selectedEndB
      ? attachEndBToDraft(withEndA, selectedEndB)
      : withEndA;
    const withMeasurement = measurementSelection
      ? attachMeasurementSelectionToDraft(withEndB, measurementSelection)
      : withEndB;
    const withLength = finishedLength
      ? attachFinishedLengthToDraft(withMeasurement, finishedLength)
      : withMeasurement;
    return clockingSelection
      ? attachClockingToDraft(withLength, clockingSelection)
      : withLength;
  }, [
    clockingSelection,
    finishedLength,
    hoseDraft,
    measurementSelection,
    selectedEndA,
    selectedEndB,
  ]);
  const clockingApplicability = draft
    ? evaluateAssemblyClockingApplicability(draft)
    : { status: "not_applicable" as const };
  const clockingRequired = clockingApplicability.status === "required";
  const hasSelectableHose = loaderData.families.some((family) =>
    family.variants.some((variant) => variant.canAddToQuote),
  );
  const visualItem = selectedItem ?? selectedFamily?.representative ?? null;
  const directCopy =
    loaderData.directSelection.kind === "none"
      ? null
      : directSelectionCopy(loaderData.directSelection);
  useEffect(() => {
    if (stage !== "hose") window.scrollTo({ behavior: "auto", top: 0 });
  }, [stage]);

  function retainClockingForReconfirmation() {
    setClockingSelection((current) =>
      current ? { ...current, validation: "retained_invalid" } : null,
    );
  }

  function chooseFamily(familyKey: string) {
    if (familyKey !== selectedFamilyKey) retainClockingForReconfirmation();
    setSelectedFamilyKey(familyKey);
    setSelectedSku(null);
    setSelectedEndA(null);
    setSelectedEndB(null);
    setMeasurementSelection(null);
    setFinishedLength(null);
  }

  function chooseHose(item: PublicCatalogItem) {
    if (!item.canAddToQuote) return;
    if (item.sku !== selectedSku) retainClockingForReconfirmation();
    setSelectedSku(item.sku);
    setSelectedEndA(null);
    setSelectedEndB(null);
    setMeasurementSelection(null);
    setFinishedLength(null);
  }

  function continueToEndA() {
    if (!hoseDraft) return;
    setStage("end-a");
  }

  function backToHose() {
    setStage("hose");
  }

  function continueToEndB() {
    if (!draft?.endA) return;
    setStage("end-b");
  }

  function backToEndA() {
    setStage("end-a");
  }

  function chooseEndA(candidate: CompatibleHoseEndCandidate) {
    if (
      selectedEndA &&
      (candidate.hoseEndSku !== selectedEndA.hoseEndSku ||
        candidate.angle !== selectedEndA.angle)
    ) {
      retainClockingForReconfirmation();
    }
    setSelectedEndA(candidate);
  }

  function chooseEndB(candidate: CompatibleHoseEndCandidate) {
    if (
      selectedEndB &&
      (candidate.hoseEndSku !== selectedEndB.hoseEndSku ||
        candidate.angle !== selectedEndB.angle)
    ) {
      retainClockingForReconfirmation();
    }
    setSelectedEndB(candidate);
  }

  function continueToLength() {
    if (!draft?.endA || !draft.endB) return;
    setStage("length");
  }

  function backToEndB() {
    setStage("end-b");
  }

  function chooseMeasurement(selection: MeasurementSelectionSnapshot) {
    setMeasurementSelection(selection);
    setFinishedLength(null);
  }

  function saveFinishedLength(length: FinishedAssemblyLengthSnapshot) {
    setFinishedLength(length);
    if (draft && requiresAssemblyClocking(draft)) setStage("clocking");
  }

  function backToLength() {
    setStage("length");
  }

  function saveClocking(selection: ClockingSelectionSnapshot) {
    if (!draft) return;
    const confirmed = confirmClockingForDraft(draft, selection);
    if (confirmed) setClockingSelection(confirmed);
  }

  const nextAction =
    stage === "hose" && draft
      ? { label: "Continue to End A", onClick: continueToEndA }
      : stage === "end-a" && draft?.endA
        ? { label: "Continue to End B", onClick: continueToEndB }
        : stage === "end-b" && draft?.endB
          ? {
              label: "Continue to Finished Length",
              onClick: continueToLength,
            }
          : null;

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

        <ol
          className="configurator-progress"
          data-has-clocking={clockingRequired}
          aria-label="Assembly steps"
        >
          {[
            "Hose",
            "End A",
            "End B",
            "Length",
            ...(clockingRequired ? ["Orientation"] : []),
            "Protection",
            "Review",
          ].map((label, index) => {
            const active =
              (stage === "hose" && index === 0) ||
              (stage === "end-a" && index === 1) ||
              (stage === "end-b" && index === 2) ||
              (stage === "length" && index === 3) ||
              (stage === "clocking" && label === "Orientation");
            return (
              <li aria-current={active ? "step" : undefined} key={label}>
                <span>{index + 1}</span>
                <strong>{label}</strong>
              </li>
            );
          })}
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
          <>
            <div className="configurator-workspace">
              <section className="configurator-controls">
                {stage === "hose" ? (
                  <>
                    <fieldset className="configurator-fieldset">
                      <legend>1. Choose a Hose Series</legend>
                      <p>
                        Series determines construction and performance range.
                      </p>
                      <div className="hose-series-grid">
                        {loaderData.families.map((family) => {
                          const active = family.familyKey === selectedFamilyKey;
                          const availableCount = family.variants.filter(
                            (variant) => variant.canAddToQuote,
                          ).length;
                          const selection = hoseSelection(
                            family.representative,
                          );
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
                ) : stage === "end-a" ? (
                  <CompatibleHoseEndStage
                    endRole="A"
                    hoseSku={hoseDraft?.hose.sku ?? ""}
                    onBack={backToHose}
                    onSelect={chooseEndA}
                    releaseId={hoseDraft?.catalogRelease.id ?? ""}
                    requestedEndSku={loaderData.requestedEndASku}
                    selected={selectedEndA}
                  />
                ) : stage === "end-b" ? (
                  <>
                    <CompatibleHoseEndStage
                      copyFromEndA={selectedEndA}
                      endRole="B"
                      hoseSku={hoseDraft?.hose.sku ?? ""}
                      onBack={backToEndA}
                      onSelect={chooseEndB}
                      releaseId={hoseDraft?.catalogRelease.id ?? ""}
                      requestedEndSku={null}
                      selected={selectedEndB}
                    />
                    {draft?.endA && draft.endB ? (
                      <LaterStagePreview showOrientation={clockingRequired} />
                    ) : null}
                  </>
                ) : stage === "length" ? (
                  <>
                    <FinishedLengthStage
                      finishedLength={finishedLength}
                      measurementMethods={loaderData.measurementMethods}
                      measurementSelection={measurementSelection}
                      onBack={backToEndB}
                      onInvalidateLength={() => setFinishedLength(null)}
                      onSaveLength={saveFinishedLength}
                      onSelectMeasurement={chooseMeasurement}
                    />
                    {finishedLength ? (
                      <LaterStagePreview showOrientation={clockingRequired} />
                    ) : null}
                  </>
                ) : (
                  <ClockingStage
                    convention={loaderData.clockingConvention}
                    onBack={backToLength}
                    onInvalidate={() => setClockingSelection(null)}
                    onSave={saveClocking}
                    selection={clockingSelection}
                  />
                )}
                {clockingApplicability.status === "manual_review" ? (
                  <div className="length-inline-alert" role="alert">
                    <AlertTriangle aria-hidden="true" size={19} />
                    <p>
                      <strong>Orientation Technical Review Required</strong>
                      One selected Hose End has an unclassified angle. No M08
                      angle is assumed or requested automatically.
                    </p>
                  </div>
                ) : null}
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
                        <ConfiguredEndSummary end={draft.endA} role="A" />
                      ) : null}
                      {draft.endB ? (
                        <ConfiguredEndSummary end={draft.endB} role="B" />
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
                  {draft?.endB && stage === "end-b" ? (
                    <p className="configurator-ready" role="status">
                      <Check aria-hidden="true" size={17} />
                      <span>
                        <strong>Both hose ends are ready</strong>
                        <small>
                          End A and End B remain separate ordered selections.
                        </small>
                      </span>
                    </p>
                  ) : null}
                  {draft?.measurementSelection ? (
                    <section className="configured-length-summary">
                      <span className="eyebrow">Measurement</span>
                      <h3>
                        {draft.measurementSelection.state === "selected"
                          ? `${draft.measurementSelection.method.code} · ${draft.measurementSelection.method.displayName}`
                          : "Not Sure · Manual Technical Review"}
                      </h3>
                      {draft.finishedLength ? (
                        <dl>
                          <div>
                            <dt>Finished length</dt>
                            <dd>
                              {draft.finishedLength.originalValue}{" "}
                              {draft.finishedLength.originalUnit}
                            </dd>
                          </div>
                          <div>
                            <dt>Exact conversion</dt>
                            <dd>{draft.finishedLength.canonicalMm} mm</dd>
                          </div>
                          <div>
                            <dt>SAE J517 tolerance</dt>
                            <dd>{draft.finishedLength.tolerance.display}</dd>
                          </div>
                        </dl>
                      ) : (
                        <p>Finished length has not been saved.</p>
                      )}
                    </section>
                  ) : null}
                  {draft?.clocking ? (
                    <section className="configured-length-summary">
                      <span className="eyebrow">M08 Clocking</span>
                      <h3>
                        {draft.clocking.validation === "retained_invalid"
                          ? "Retained selection · Reconfirmation required"
                          : draft.clocking.status === "specified"
                            ? `${draft.clocking.targetDisplay}° · ±${draft.clocking.standardToleranceDegrees}°`
                            : "Not Sure · Manual Technical Review"}
                      </h3>
                      <p>
                        {draft.clocking.validation === "retained_invalid"
                          ? `Previous Clocking: ${draft.clocking.status === "specified" ? `${draft.clocking.targetDisplay}°` : "Not Sure"}. The selected hose ends changed, so this value is not valid until you confirm it again.`
                          : "View End A toward End B. End B is 000° at 6 o'clock; measure clockwise."}
                      </p>
                    </section>
                  ) : null}
                  <p className="configurator-session-note">
                    This unfinished configuration is kept only in this page
                    session and has not been added to your Quote List.
                  </p>
                </div>
              </aside>
            </div>
            {nextAction ? (
              <div
                aria-label="Continue configuration"
                className="configurator-action-dock"
                role="region"
              >
                <div className="configurator-action-dock-inner">
                  <button
                    className="button button-primary configurator-next"
                    onClick={nextAction.onClick}
                    type="button"
                  >
                    {nextAction.label}
                    <ArrowRight aria-hidden="true" size={18} />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

export default function BuildAHose({ loaderData }: Route.ComponentProps) {
  return <BuildAHoseView loaderData={loaderData} />;
}
