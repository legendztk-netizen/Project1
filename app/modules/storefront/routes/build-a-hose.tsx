import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Layers3,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  data,
  Link,
  useBeforeUnload,
  useBlocker,
  useNavigate,
} from "react-router";

import type { Route } from "./+types/build-a-hose";
import {
  captureAssemblySelectionBasis,
  captureHoseSelectionBasis,
  captureMeasurementSelectionBasis,
  captureProtectionSelectionBasis,
  isBlockingDraftValidationIssue,
  matchesHoseSelectionBasis,
  validateAssemblyDraft,
  type CompatibleCandidateSnapshot,
  type DraftSelectionProvenance,
  type DraftValidationIssue,
} from "../../configurator/domain/assembly-draft-validation";
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
import { evaluateAssemblyReview } from "../../configurator/domain/assembly-review";
import {
  createHoseConfigurationDraft,
  type HoseConfigurationDraft,
} from "../../configurator/domain/hose-configuration-draft";
import { serializedRegistrationConfigurationSnapshot } from "../../configurator/domain/registration-configuration";
import {
  attachFinishedLengthToDraft,
  attachMeasurementSelectionToDraft,
  type FinishedAssemblyLengthSnapshot,
  type MeasurementSelectionSnapshot,
} from "../../configurator/domain/finished-assembly-length";
import { attachProtectionAndApplicationToDraft } from "../../configurator/domain/protection-and-application";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";
import {
  groupCatalogFamilies,
  type PublicCatalogItem,
  type PublicVariantSelection,
} from "../../catalog/domain/public-catalog";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { createAnonymousQuoteListService } from "../../quote-list/application/anonymous-quote-list-service";
import { createCustomerIdentityService } from "../../customer-identity/application/customer-identity-service";
import { createSavedConfigurationService } from "../../customer-identity/application/saved-configuration-service";
import { QuoteListCommandRejected } from "../../quote-list/domain/anonymous-quote-list";
import { hoseSizeLabel } from "../domain/variant-label";
import { fetchCompatibleHoseEndCandidates } from "../infrastructure/compatible-hose-end-client";
import { CatalogMedia } from "../ui/catalog-media";
import { ClockingStage } from "../ui/clocking-stage";
import { CompatibleHoseEndStage } from "../ui/compatible-end-a-stage";
import { FinishedLengthStage } from "../ui/finished-length-stage";
import { LiveAssemblyPreview } from "../ui/live-assembly-preview";
import { AssemblyReviewStage } from "../ui/assembly-review-stage";
import {
  ProtectionApplicationStage,
  type ProtectionApplicationSelection,
} from "../ui/protection-application-stage";
import { StorefrontHeader } from "../ui/storefront-header";
import { UnsavedDraftExitDialog } from "../ui/unsaved-draft-exit-dialog";
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
  const url = new URL(request.url);
  const repository = createD1PublicCatalogRepository(env.DB);
  const referenceRepository = createD1ConfiguratorReferenceRepository(env.DB);
  const result = await repository.browse({ category: "hydraulic-hose" });
  const hoses = result.items.filter((item) => item.productType === "hose");
  const eligibleHoses = hoses.filter(
    (item) => item.rfqEligibility === "Eligible",
  );
  const requestedSku = url.searchParams.get("hose")?.trim();
  const requestedEndASku = url.searchParams.get("endA")?.trim();
  const requestedQuoteLineId = url.searchParams.get("quoteLine")?.trim();
  const requestedQuoteMode = url.searchParams.get("mode")?.trim();
  const requestedSavedConfigurationId = url.searchParams
    .get("savedConfiguration")
    ?.trim();
  const requested = requestedSku
    ? hoses.find((item) => item.sku === requestedSku)
    : null;
  const referenceSnapshot = await referenceRepository.findActiveSnapshot();
  const hasMatchingReferenceSnapshot = Boolean(
    referenceSnapshot &&
    hoses[0] &&
    referenceSnapshot.release.id === hoses[0].releaseId,
  );
  const measurementMethods =
    hasMatchingReferenceSnapshot && referenceSnapshot
      ? [...referenceSnapshot.measurementMethods].sort((left, right) =>
          left.code.localeCompare(right.code),
        )
      : [];
  const clockingConvention =
    hasMatchingReferenceSnapshot && referenceSnapshot
      ? referenceSnapshot.clockingConvention
      : null;
  const installedProtections =
    hasMatchingReferenceSnapshot && referenceSnapshot
      ? referenceSnapshot.installedProtections
      : [];
  const installedProtectionRules =
    hasMatchingReferenceSnapshot && referenceSnapshot
      ? referenceSnapshot.installedProtectionRules
      : [];
  const assemblyEstimateSchedule =
    hasMatchingReferenceSnapshot && referenceSnapshot
      ? referenceSnapshot.assemblyEstimateSchedule
      : null;
  const customerProfile =
    await createCustomerIdentityService(env).readSession(request);

  let savedConfigurationContext: Awaited<
    ReturnType<ReturnType<typeof createSavedConfigurationService>["find"]>
  > = null;
  let savedConfigurationError: string | null = null;
  if (requestedSavedConfigurationId) {
    savedConfigurationContext = await createSavedConfigurationService(env).find(
      {
        id: requestedSavedConfigurationId,
        request,
      },
    );
    if (!savedConfigurationContext) {
      savedConfigurationError =
        "This saved configuration is unavailable or does not belong to this account.";
    }
  }

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

  let quoteLineContext: {
    line: Awaited<
      ReturnType<
        ReturnType<
          typeof createAnonymousQuoteListService
        >["configuredAssemblyDraft"]
      >
    >["line"];
    mode: "duplicate" | "edit";
  } | null = null;
  let quoteLineError: string | null = null;
  let quoteLineSetCookie: string | null = null;
  if (
    requestedQuoteLineId &&
    (requestedQuoteMode === "edit" || requestedQuoteMode === "duplicate")
  ) {
    try {
      const saved = await createAnonymousQuoteListService(
        env,
      ).configuredAssemblyDraft(request, requestedQuoteLineId);
      quoteLineContext = { line: saved.line, mode: requestedQuoteMode };
      quoteLineSetCookie = saved.setCookie;
    } catch (error) {
      if (!(error instanceof QuoteListCommandRejected)) throw error;
      quoteLineError = error.message;
    }
  }

  const headers = new Headers();
  if (quoteLineSetCookie) headers.set("Set-Cookie", quoteLineSetCookie);
  return data(
    {
      assemblyEstimateSchedule,
      directSelection,
      clockingConvention,
      families: groupCatalogFamilies(eligibleHoses),
      measurementMethods,
      installedProtectionRules,
      installedProtections,
      isAuthenticated: Boolean(customerProfile),
      publishedHoseCount: hoses.length,
      quoteLineContext,
      quoteLineError,
      releaseId: hoses[0]?.releaseId ?? null,
      releaseNumber: hoses[0]?.releaseNumber ?? null,
      requestedEndASku: requestedEndASku ?? null,
      savedConfigurationContext,
      savedConfigurationError,
    },
    { headers },
  );
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

type BuildAHoseLoaderData = Route.ComponentProps["loaderData"];

type ConfiguredEnd = NonNullable<HoseConfigurationDraft["endA"]>;

function candidateFromConfiguredEnd(
  end: ConfiguredEnd | undefined,
): CompatibleHoseEndCandidate | null {
  if (!end) return null;
  return {
    ...end.hoseEnd,
    assemblyWorkingBar: end.assemblyWorkingBar,
    compatibilityId: end.compatibilityId,
    ferrule: { ...end.ferrule },
    hoseEndSku: end.hoseEnd.sku,
  };
}

function hoseOnlyDraft(draft: HoseConfigurationDraft): HoseConfigurationDraft {
  return {
    catalogRelease: { ...draft.catalogRelease },
    hose: {
      ...draft.hose,
      performance: { ...draft.hose.performance },
    },
  };
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortedJsonValue(entry)]),
    );
  }
  return value;
}

function managedDraftFingerprint(
  draft: HoseConfigurationDraft,
  quantityInput: string,
) {
  return JSON.stringify(
    sortedJsonValue({ configuration: draft, quantityInput }),
  );
}

function restoredProvenance(
  draft: HoseConfigurationDraft,
  schedule: BuildAHoseLoaderData["assemblyEstimateSchedule"],
): DraftSelectionProvenance {
  const hoseBasis = captureHoseSelectionBasis(draft);
  const assemblyBasis = captureAssemblySelectionBasis(draft);
  const protectionBasis = captureProtectionSelectionBasis(draft, schedule);
  const savedScheduleRecordVersion =
    draft.lengthReferencePricing?.scheduleRecordVersion ?? null;
  return {
    endA: draft.endA ? hoseBasis : undefined,
    endB: draft.endB ? hoseBasis : undefined,
    finishedLength:
      assemblyBasis && draft.measurementSelection && draft.finishedLength
        ? {
            ...assemblyBasis,
            measurement: captureMeasurementSelectionBasis(
              draft.measurementSelection,
            ),
          }
        : undefined,
    protection: protectionBasis
      ? {
          ...protectionBasis,
          scheduleRecordVersion: savedScheduleRecordVersion,
        }
      : undefined,
  };
}

type ConfiguratorStage =
  "hose" | "end-a" | "end-b" | "length" | "clocking" | "protection" | "review";

const validationKindLabel: Record<DraftValidationIssue["kind"], string> = {
  manual_path: "Manual review",
  reconfirmation: "Reconfirmation required",
  retained_invalid: "Retained invalid selection",
  technical_review: "Technical review",
};

const validationOwnerLabel: Record<DraftValidationIssue["owner"], string> = {
  hose: "Hose",
  "end-a": "End A",
  "end-b": "End B",
  length: "Finished Length",
  clocking: "Clocking",
  protection: "Protection",
};

function DraftValidationNotice({ issues }: { issues: DraftValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <section
      aria-label="Configuration validation issues"
      aria-live="polite"
      className="draft-validation-notice"
    >
      <header>
        <AlertTriangle aria-hidden="true" size={22} />
        <div>
          <h2>Configuration needs attention</h2>
          <p>
            Your previous choices are retained. Nothing has been removed or
            replaced automatically.
          </p>
        </div>
      </header>
      <ul>
        {issues.map((issue) => (
          <li data-validation-owner={issue.owner} key={issue.code}>
            <span>{validationOwnerLabel[issue.owner]}</span>
            <div>
              <strong>{validationKindLabel[issue.kind]}</strong>
              <p>{issue.message}</p>
            </div>
          </li>
        ))}
      </ul>
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
  const navigate = useNavigate();
  const savedLine = loaderData.quoteLineContext?.line ?? null;
  const accountSnapshot = loaderData.savedConfigurationContext?.snapshot;
  const savedDraft =
    savedLine?.configuredAssembly.snapshot.configuration ??
    accountSnapshot?.configuration ??
    undefined;
  const [stage, setStage] = useState<ConfiguratorStage>(
    savedLine ? "review" : (accountSnapshot?.stage ?? "hose"),
  );
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(
    accountSnapshot?.selectedFamilyKey ?? savedDraft?.hose.familyKey ?? null,
  );
  const [selectedSku, setSelectedSku] = useState<string | null>(
    accountSnapshot?.selectedSku ?? savedDraft?.hose.sku ?? null,
  );
  const [retainedHoseItem, setRetainedHoseItem] =
    useState<PublicCatalogItem | null>(null);
  const [retainedHoseDraft, setRetainedHoseDraft] =
    useState<HoseConfigurationDraft | null>(
      savedDraft ? hoseOnlyDraft(savedDraft) : null,
    );
  const [selectedEndA, setSelectedEndA] =
    useState<CompatibleHoseEndCandidate | null>(
      candidateFromConfiguredEnd(savedDraft?.endA),
    );
  const [selectedEndB, setSelectedEndB] =
    useState<CompatibleHoseEndCandidate | null>(
      candidateFromConfiguredEnd(savedDraft?.endB),
    );
  const [measurementSelection, setMeasurementSelection] =
    useState<MeasurementSelectionSnapshot | null>(
      savedDraft?.measurementSelection ?? null,
    );
  const [finishedLength, setFinishedLength] =
    useState<FinishedAssemblyLengthSnapshot | null>(
      savedDraft?.finishedLength ?? null,
    );
  const [clockingSelection, setClockingSelection] =
    useState<ClockingDraftSnapshot | null>(savedDraft?.clocking ?? null);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [protectionApplicationSelection, setProtectionApplicationSelection] =
    useState<ProtectionApplicationSelection | null>(
      savedDraft?.installedProtection && savedDraft.lengthReferencePricing
        ? {
            application: savedDraft.applicationRequirements ?? null,
            pricing: savedDraft.lengthReferencePricing,
            protection: savedDraft.installedProtection,
          }
        : null,
    );
  const [quantityInput, setQuantityInput] = useState(
    accountSnapshot?.quantityInput ?? String(savedLine?.quantity ?? 1),
  );
  const [reviewVisited, setReviewVisited] = useState(Boolean(savedDraft));
  const [quoteCommand, setQuoteCommand] = useState<{
    error: string | null;
    pending: boolean;
  }>({ error: null, pending: false });
  const allowNavigationRef = useRef(false);
  const saveCommandIdRef = useRef<{
    id: string;
    snapshot: string;
  } | null>(null);
  const [selectionProvenance, setSelectionProvenance] =
    useState<DraftSelectionProvenance>(
      accountSnapshot
        ? accountSnapshot.selectionProvenance
        : savedDraft
          ? restoredProvenance(savedDraft, loaderData.assemblyEstimateSchedule)
          : {},
    );
  const [compatibleCandidateSnapshot, setCompatibleCandidateSnapshot] =
    useState<CompatibleCandidateSnapshot | null>(null);
  const [compatibilityCheckFailure, setCompatibilityCheckFailure] = useState<
    DraftSelectionProvenance["endA"] | null
  >(null);
  const [saveCommand, setSaveCommand] = useState<{
    error: string | null;
    pending: boolean;
  }>({ error: null, pending: false });
  const selectedFamily = loaderData.families.find(
    (family) => family.familyKey === selectedFamilyKey,
  );
  const currentHoses = useMemo(
    () => loaderData.families.flatMap(({ variants }) => variants),
    [loaderData.families],
  );
  const currentSelectedItem = currentHoses.find(
    (item) => item.sku === selectedSku,
  );
  const selectedItem = currentSelectedItem ?? retainedHoseItem;
  const hoseDraft = useMemo(
    () =>
      retainedHoseDraft ??
      (selectedItem ? createHoseConfigurationDraft(selectedItem) : null),
    [retainedHoseDraft, selectedItem],
  );
  const currentHoseBasis = hoseDraft
    ? captureHoseSelectionBasis(hoseDraft)
    : null;
  const currentCompatibilitySnapshotAvailable = Boolean(
    currentHoseBasis &&
    ((compatibleCandidateSnapshot?.hoseSku === currentHoseBasis.hoseSku &&
      compatibleCandidateSnapshot.releaseId ===
        currentHoseBasis.catalogReleaseId) ||
      matchesHoseSelectionBasis(
        compatibilityCheckFailure ?? undefined,
        currentHoseBasis,
      )),
  );
  const retainedEndNeedsCompatibilityRefresh = Boolean(
    currentHoseBasis &&
    (selectedEndA || selectedEndB) &&
    !currentCompatibilitySnapshotAvailable,
  );

  useEffect(() => {
    if (!hoseDraft || !retainedEndNeedsCompatibilityRefresh) return;
    const controller = new AbortController();
    const hoseBasis = captureHoseSelectionBasis(hoseDraft);
    setCompatibleCandidateSnapshot(null);
    setCompatibilityCheckFailure(null);
    fetchCompatibleHoseEndCandidates({
      hoseSku: hoseBasis.hoseSku,
      releaseId: hoseBasis.catalogReleaseId,
      signal: controller.signal,
    })
      .then((candidates) => {
        setCompatibleCandidateSnapshot({
          candidates,
          hoseSku: hoseBasis.hoseSku,
          releaseId: hoseBasis.catalogReleaseId,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setCompatibilityCheckFailure(hoseBasis);
      });
    return () => controller.abort();
  }, [hoseDraft, retainedEndNeedsCompatibilityRefresh]);
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
    const withClocking = clockingSelection
      ? attachClockingToDraft(withLength, clockingSelection)
      : withLength;
    return protectionApplicationSelection && withClocking.finishedLength
      ? attachProtectionAndApplicationToDraft(
          withClocking,
          protectionApplicationSelection,
        )
      : withClocking;
  }, [
    clockingSelection,
    finishedLength,
    hoseDraft,
    measurementSelection,
    protectionApplicationSelection,
    selectedEndA,
    selectedEndB,
  ]);
  const clockingApplicability = draft
    ? evaluateAssemblyClockingApplicability(draft)
    : { status: "not_applicable" as const };
  const clockingRequired = clockingApplicability.status === "required";
  const draftValidation = useMemo(
    () =>
      draft
        ? validateAssemblyDraft(draft, selectionProvenance, {
            activeCatalogRelease: currentHoses[0]
              ? {
                  id: currentHoses[0].releaseId,
                  number: currentHoses[0].releaseNumber,
                }
              : null,
            assemblyEstimateSchedule: loaderData.assemblyEstimateSchedule,
            clockingConvention: loaderData.clockingConvention,
            compatibleCandidates: compatibleCandidateSnapshot,
            compatibilityCheckFailure,
            currentHoses,
            installedProtectionRules: loaderData.installedProtectionRules,
            installedProtections: loaderData.installedProtections,
            measurementMethods: loaderData.measurementMethods,
          })
        : { blocking: false, issues: [], status: "current" as const },
    [
      compatibleCandidateSnapshot,
      compatibilityCheckFailure,
      currentHoses,
      draft,
      loaderData.assemblyEstimateSchedule,
      loaderData.clockingConvention,
      loaderData.installedProtectionRules,
      loaderData.installedProtections,
      loaderData.measurementMethods,
      selectionProvenance,
    ],
  );
  const reviewResult = useMemo(
    () =>
      draft
        ? evaluateAssemblyReview({
            draft,
            quantityInput,
            validation: draftValidation,
          })
        : null,
    [draft, draftValidation, quantityInput],
  );
  const currentManagedDraftFingerprint = useMemo(
    () => (draft ? managedDraftFingerprint(draft, quantityInput) : null),
    [draft, quantityInput],
  );
  const originalManagedDraftFingerprint = useMemo(
    () =>
      savedDraft
        ? managedDraftFingerprint(savedDraft, String(savedLine?.quantity ?? 1))
        : null,
    [savedDraft, savedLine?.quantity],
  );
  const registrationDraftSnapshot = useMemo(() => {
    if (loaderData.quoteLineContext) return "";
    if (!selectedFamilyKey && !draft) return "";
    const accountConfigurationUnchanged =
      accountSnapshot &&
      (accountSnapshot.configuration
        ? draft &&
          managedDraftFingerprint(
            accountSnapshot.configuration,
            accountSnapshot.quantityInput,
          ) === managedDraftFingerprint(draft, quantityInput)
        : !draft && accountSnapshot.quantityInput === quantityInput);
    if (
      accountSnapshot &&
      accountConfigurationUnchanged &&
      accountSnapshot.selectedFamilyKey === selectedFamilyKey &&
      accountSnapshot.selectedSku === selectedSku &&
      accountSnapshot.stage === stage &&
      JSON.stringify(sortedJsonValue(accountSnapshot.selectionProvenance)) ===
        JSON.stringify(sortedJsonValue(selectionProvenance))
    ) {
      return JSON.stringify(accountSnapshot);
    }
    return serializedRegistrationConfigurationSnapshot({
      catalogContext: {
        releaseId: draft?.catalogRelease.id ?? loaderData.releaseId,
        releaseNumber: draft?.catalogRelease.number ?? loaderData.releaseNumber,
      },
      configuration: draft,
      quantityInput,
      referenceContext: {
        assemblyEstimateScheduleVersion:
          loaderData.assemblyEstimateSchedule?.recordVersion ?? null,
        clockingConventionVersion:
          loaderData.clockingConvention?.recordVersion ?? null,
        installedProtectionVersion:
          draft?.installedProtection?.recordVersion ?? null,
        measurementDiagramAssetVersion:
          draft?.measurementSelection?.state === "selected"
            ? draft.measurementSelection.diagram.assetVersion
            : null,
        measurementMethodVersion:
          draft?.measurementSelection?.state === "selected"
            ? draft.measurementSelection.method.recordVersion
            : null,
        measurementOverlayVersion:
          draft?.measurementSelection?.state === "selected"
            ? draft.measurementSelection.diagram.overlayVersion
            : null,
      },
      selectedFamilyKey,
      selectedSku,
      selectionProvenance,
      stage,
      version: 1,
    });
  }, [
    accountSnapshot,
    draft,
    loaderData.quoteLineContext,
    loaderData.assemblyEstimateSchedule?.recordVersion,
    loaderData.clockingConvention?.recordVersion,
    loaderData.releaseId,
    loaderData.releaseNumber,
    quantityInput,
    selectedFamilyKey,
    selectedSku,
    selectionProvenance,
    stage,
  ]);
  const hasUnsavedDraft =
    loaderData.quoteLineContext?.mode === "edit"
      ? Boolean(
          selectedFamilyKey !== savedDraft?.hose.familyKey ||
          (draft &&
            currentManagedDraftFingerprint !== originalManagedDraftFingerprint),
        )
      : accountSnapshot
        ? registrationDraftSnapshot !== JSON.stringify(accountSnapshot)
        : Boolean(selectedFamilyKey || draft);
  const navigationBlocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedDraft &&
      !allowNavigationRef.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!hasUnsavedDraft || allowNavigationRef.current) return;
        event.preventDefault();
        event.returnValue = "";
      },
      [hasUnsavedDraft],
    ),
  );
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
    setSelectedFamilyKey(familyKey);
  }

  function chooseHose(item: PublicCatalogItem) {
    if (!item.canAddToQuote) return;
    if (item.sku !== selectedSku) retainClockingForReconfirmation();
    setSelectedSku(item.sku);
    setRetainedHoseItem(item);
    setRetainedHoseDraft(null);
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
    if (hoseDraft) {
      setSelectionProvenance((current) => ({
        ...current,
        endA: captureHoseSelectionBasis(hoseDraft),
      }));
    }
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
    if (hoseDraft) {
      setSelectionProvenance((current) => ({
        ...current,
        endB: captureHoseSelectionBasis(hoseDraft),
      }));
    }
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
  }

  function saveFinishedLength(length: FinishedAssemblyLengthSnapshot) {
    if (!draft?.endA || !draft.endB || !measurementSelection) return;
    setFinishedLength(length);
    const assemblyBasis = captureAssemblySelectionBasis(draft);
    if (assemblyBasis) {
      setSelectionProvenance((current) => ({
        ...current,
        finishedLength: {
          ...assemblyBasis,
          measurement: captureMeasurementSelectionBasis(measurementSelection),
        },
      }));
    }
    if (requiresAssemblyClocking(draft)) setStage("clocking");
    else setStage("protection");
  }

  function backToLength() {
    setStage("length");
  }

  function saveClocking(selection: ClockingSelectionSnapshot) {
    if (!draft) return;
    const confirmed = confirmClockingForDraft(draft, selection);
    if (confirmed) {
      setClockingSelection(confirmed);
      setStage("protection");
    }
  }

  function backFromProtection() {
    setStage(clockingRequired ? "clocking" : "length");
  }

  function saveProtectionAndApplication(
    selection: ProtectionApplicationSelection,
  ) {
    setProtectionApplicationSelection(selection);
    if (!draft?.finishedLength) return;
    const selectedDraft = attachProtectionAndApplicationToDraft(
      draft,
      selection,
    );
    const protectionBasis = captureProtectionSelectionBasis(
      selectedDraft,
      loaderData.assemblyEstimateSchedule,
    );
    if (!protectionBasis) return;
    setSelectionProvenance((current) => ({
      ...current,
      protection: protectionBasis,
    }));
    setReviewVisited(true);
    setStage("review");
  }

  function editFromReview(owner: DraftValidationIssue["owner"]) {
    if (owner === "clocking" && !clockingRequired) {
      setClockingSelection(null);
      return;
    }
    setStage(owner);
  }

  async function addAssemblyToQuote() {
    if (!draft || !reviewResult?.canAddConfiguredLine || quoteCommand.pending) {
      return;
    }
    setQuoteCommand({ error: null, pending: true });
    const form = new FormData();
    form.set("intent", "add-configured-assembly");
    form.set("draft", JSON.stringify(draft));
    form.set("quantity", quantityInput);
    if (loaderData.quoteLineContext?.mode === "edit") {
      form.set("replaceLineId", loaderData.quoteLineContext.line.id);
    }
    try {
      const response = await fetch("/api/configurator/quote-assembly", {
        body: form,
        method: "POST",
      });
      const result = (await response.json()) as {
        error: string | null;
        ok: boolean;
      };
      if (!response.ok || !result.ok) {
        setQuoteCommand({
          error:
            result.error ??
            "The assembly could not be added. Review it and try again.",
          pending: false,
        });
        return;
      }
      allowNavigationRef.current = true;
      navigate("/quote-list");
    } catch {
      setQuoteCommand({
        error:
          "The assembly could not be added. Check your connection and try again.",
        pending: false,
      });
    }
  }

  async function saveCurrentConfiguration(leaveAfterSave = false) {
    if (!registrationDraftSnapshot || saveCommand.pending) return;
    setSaveCommand({ error: null, pending: true });
    const form = new FormData();
    if (saveCommandIdRef.current?.snapshot !== registrationDraftSnapshot) {
      saveCommandIdRef.current = {
        id: crypto.randomUUID(),
        snapshot: registrationDraftSnapshot,
      };
    }
    form.set("commandId", saveCommandIdRef.current.id);
    form.set("snapshot", registrationDraftSnapshot);
    try {
      const response = await fetch("/api/configurator/saved-configurations", {
        body: form,
        method: "POST",
      });
      const result = (await response.json()) as {
        error: string | null;
        id?: string;
        ok: boolean;
      };
      if (!response.ok || !result.ok) {
        setSaveCommand({
          error: result.error ?? "The configuration could not be saved.",
          pending: false,
        });
        return;
      }
      allowNavigationRef.current = true;
      if (leaveAfterSave && navigationBlocker.state === "blocked") {
        navigationBlocker.proceed();
      } else {
        navigate("/account?view=saved-configurations&saved=1");
      }
    } catch {
      setSaveCommand({
        error:
          "The configuration could not be saved. Check your connection and try again.",
        pending: false,
      });
    }
  }

  function discardInPageDraftAndLeave() {
    if (navigationBlocker.state !== "blocked") return;
    allowNavigationRef.current = true;
    setSelectedFamilyKey(null);
    setSelectedSku(null);
    setRetainedHoseItem(null);
    setRetainedHoseDraft(null);
    setSelectedEndA(null);
    setSelectedEndB(null);
    setMeasurementSelection(null);
    setFinishedLength(null);
    setClockingSelection(null);
    setProtectionApplicationSelection(null);
    setSelectionProvenance({});
    setCompatibleCandidateSnapshot(null);
    setCompatibilityCheckFailure(null);
    setQuantityInput("1");
    setReviewVisited(false);
    setStage("hose");
    navigationBlocker.proceed();
  }

  const stayOnConfigurator = useCallback(() => {
    if (navigationBlocker.state === "blocked") navigationBlocker.reset();
  }, [navigationBlocker]);

  function registerToSaveDraft() {
    allowNavigationRef.current = true;
  }

  const receiveCompatibleCandidates = useMemo(
    () => (snapshot: CompatibleCandidateSnapshot) => {
      setCompatibleCandidateSnapshot(snapshot);
      setCompatibilityCheckFailure(null);
    },
    [],
  );

  const hasBlockingIssueFor = (...owners: DraftValidationIssue["owner"][]) =>
    draftValidation.issues.some(
      (issue) =>
        owners.includes(issue.owner) && isBlockingDraftValidationIssue(issue),
    );

  const nextAction =
    stage === "hose" && draft && !hasBlockingIssueFor("hose")
      ? { label: "Continue to End A", onClick: continueToEndA }
      : stage === "end-a" && draft?.endA && !hasBlockingIssueFor("end-a")
        ? { label: "Continue to End B", onClick: continueToEndB }
        : stage === "end-b" &&
            draft?.endB &&
            !hasBlockingIssueFor("end-a", "end-b")
          ? {
              label: "Continue to Finished Length",
              onClick: continueToLength,
            }
          : null;
  const backAction =
    stage === "end-a"
      ? { label: "Back to Hose", onClick: backToHose }
      : stage === "end-b"
        ? { label: "Back to End A", onClick: backToEndA }
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
          <div className="configurator-heading-actions">
            {loaderData.isAuthenticated && registrationDraftSnapshot ? (
              <button
                className="button button-secondary button-with-icon"
                disabled={saveCommand.pending}
                onClick={() => void saveCurrentConfiguration()}
                type="button"
              >
                <Save aria-hidden="true" size={18} />
                {saveCommand.pending ? "Saving..." : "Save Configuration"}
              </button>
            ) : null}
            <div className="configurator-release">
              <span>Catalog release</span>
              <strong>{loaderData.releaseNumber ?? "Not available"}</strong>
            </div>
          </div>
        </header>

        {saveCommand.error ? (
          <div className="configurator-alert" role="alert">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>Configuration not saved</strong>
              <p>{saveCommand.error}</p>
            </div>
          </div>
        ) : null}

        {loaderData.savedConfigurationContext ? (
          <section className="configurator-edit-context" role="status">
            <div>
              <span className="eyebrow">Resumed saved configuration</span>
              <strong>
                This is an isolated working copy. The saved record remains
                unchanged until you delete it.
              </strong>
            </div>
            <Link
              className="button button-secondary"
              to="/account?view=saved-configurations"
            >
              Back to Saved Configurations
            </Link>
          </section>
        ) : loaderData.savedConfigurationError ? (
          <div className="configurator-alert" role="alert">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>Saved configuration unavailable</strong>
              <p>{loaderData.savedConfigurationError}</p>
            </div>
          </div>
        ) : loaderData.quoteLineContext ? (
          <section className="configurator-edit-context" role="status">
            <div>
              <span className="eyebrow">
                {loaderData.quoteLineContext.mode === "edit"
                  ? "Editing Quote List assembly"
                  : "Duplicating Quote List assembly"}
              </span>
              <strong>
                {loaderData.quoteLineContext.mode === "edit"
                  ? "Changes remain isolated until you select Save Changes."
                  : "The original line stays unchanged until you add this copy."}
              </strong>
              {loaderData.quoteLineContext.line.configuredAssembly
                .currentIssue ? (
                <p>
                  {
                    loaderData.quoteLineContext.line.configuredAssembly
                      .currentIssue
                  }
                </p>
              ) : null}
            </div>
            <Link className="button button-secondary" to="/quote-list">
              Cancel
            </Link>
          </section>
        ) : loaderData.quoteLineError ? (
          <div className="configurator-alert" role="alert">
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>Saved configuration unavailable</strong>
              <p>{loaderData.quoteLineError}</p>
            </div>
          </div>
        ) : null}

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
              (stage === "clocking" && label === "Orientation") ||
              (stage === "protection" && label === "Protection") ||
              (stage === "review" && label === "Review");
            return (
              <li aria-current={active ? "step" : undefined} key={label}>
                <span>{index + 1}</span>
                {label === "Review" && reviewVisited && stage !== "review" ? (
                  <button onClick={() => setStage("review")} type="button">
                    Return to Review
                  </button>
                ) : (
                  <strong>{label}</strong>
                )}
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

        {stage !== "review" ? (
          <DraftValidationNotice issues={draftValidation.issues} />
        ) : null}

        {!savedDraft && loaderData.publishedHoseCount === 0 ? (
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
        ) : !savedDraft && !hasSelectableHose ? (
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
                    onCandidatesLoaded={receiveCompatibleCandidates}
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
                      onCandidatesLoaded={receiveCompatibleCandidates}
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
                ) : stage === "clocking" ? (
                  <ClockingStage
                    convention={loaderData.clockingConvention}
                    onBack={backToLength}
                    onInvalidate={() => setClockingSelection(null)}
                    onSave={saveClocking}
                    selection={clockingSelection}
                  />
                ) : stage === "protection" && draft?.finishedLength ? (
                  <ProtectionApplicationStage
                    draft={draft}
                    installedProtections={loaderData.installedProtections}
                    installedProtectionRules={
                      loaderData.installedProtectionRules
                    }
                    onBack={backFromProtection}
                    onSave={saveProtectionAndApplication}
                    schedule={loaderData.assemblyEstimateSchedule}
                    selection={protectionApplicationSelection}
                  />
                ) : stage === "review" && draft && reviewResult ? (
                  <AssemblyReviewStage
                    actionLabel={
                      loaderData.quoteLineContext?.mode === "edit"
                        ? "Save Changes"
                        : loaderData.quoteLineContext?.mode === "duplicate"
                          ? "Add Duplicate to Quote"
                          : undefined
                    }
                    addError={quoteCommand.error}
                    draft={draft}
                    isAdding={quoteCommand.pending}
                    onAdd={addAssemblyToQuote}
                    onBack={() => setStage("protection")}
                    onEdit={editFromReview}
                    onQuantityChange={setQuantityInput}
                    pendingLabel={
                      loaderData.quoteLineContext?.mode === "edit"
                        ? "Saving Changes..."
                        : undefined
                    }
                    quantityInput={quantityInput}
                    result={reviewResult}
                    validationIssues={draftValidation.issues}
                  />
                ) : null}
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

              {draft ? (
                <button
                  aria-controls="live-assembly-summary"
                  aria-expanded={mobilePreviewOpen}
                  className="mobile-assembly-preview-toggle"
                  data-current-stage={stage}
                  onClick={() => setMobilePreviewOpen((open) => !open)}
                  type="button"
                >
                  <Layers3 aria-hidden="true" size={18} />
                  {mobilePreviewOpen
                    ? "Close assembly preview"
                    : "View assembly preview"}
                </button>
              ) : null}
              <aside
                className="configurator-summary"
                data-current-stage={stage}
                data-mobile-open={mobilePreviewOpen ? "true" : "false"}
                id="live-assembly-summary"
              >
                {draft ? (
                  <LiveAssemblyPreview
                    draft={draft}
                    issues={draftValidation.issues}
                  />
                ) : (
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
                )}
                <div className="configurator-summary-copy">
                  {!draft ? (
                    <>
                      <span className="eyebrow">Current selection</span>
                      <h2>No hose selected</h2>
                      <p className="configurator-summary-prompt">
                        Select a series, then an exact inside diameter.
                      </p>
                    </>
                  ) : null}
                  {draft && stage === "hose" ? (
                    <p className="configurator-ready" role="status">
                      <Check aria-hidden="true" size={17} />
                      <span>
                        <strong>Hose selection ready</strong>
                        <small>End A is the next configuration step.</small>
                      </span>
                    </p>
                  ) : null}
                  {draft?.endA &&
                  stage === "end-a" &&
                  !hasBlockingIssueFor("end-a") ? (
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
                  {draft?.endB &&
                  stage === "end-b" &&
                  !hasBlockingIssueFor("end-a", "end-b") ? (
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
                  <p className="configurator-session-note">
                    This unfinished configuration is kept only in this page
                    session and has not been added to your Quote List.
                  </p>
                </div>
              </aside>
            </div>
            {nextAction || backAction ? (
              <div
                aria-label="Configuration actions"
                className="configurator-action-dock"
                role="region"
              >
                <div className="configurator-action-dock-inner">
                  <div className="configurator-action-dock-buttons">
                    {backAction ? (
                      <button
                        aria-label={backAction.label}
                        className="button button-secondary button-with-icon configurator-back"
                        onClick={backAction.onClick}
                        type="button"
                      >
                        <ArrowLeft aria-hidden="true" size={18} />
                        <span className="configurator-back-label">
                          {backAction.label}
                        </span>
                        <span
                          aria-hidden="true"
                          className="configurator-back-label-short"
                        >
                          Back
                        </span>
                      </button>
                    ) : null}
                    {nextAction ? (
                      <button
                        className="button button-primary configurator-next"
                        onClick={nextAction.onClick}
                        type="button"
                      >
                        {nextAction.label}
                        <ArrowRight aria-hidden="true" size={18} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </main>
      {navigationBlocker.state === "blocked" ? (
        <UnsavedDraftExitDialog
          canRegister={!loaderData.isAuthenticated}
          canSave={loaderData.isAuthenticated}
          draftSnapshot={registrationDraftSnapshot}
          onLeave={discardInPageDraftAndLeave}
          onRegister={registerToSaveDraft}
          onSave={() => void saveCurrentConfiguration(true)}
          onStay={stayOnConfigurator}
          saveError={saveCommand.error}
          saving={saveCommand.pending}
          returnTo={`${navigationBlocker.location.pathname}${navigationBlocker.location.search}${navigationBlocker.location.hash}`}
        />
      ) : null}
    </div>
  );
}

export default function BuildAHose({ loaderData }: Route.ComponentProps) {
  return <BuildAHoseView loaderData={loaderData} />;
}
