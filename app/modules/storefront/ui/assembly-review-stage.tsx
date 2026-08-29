import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ImageOff,
  Wrench,
} from "lucide-react";

import type {
  DraftValidationIssue,
  DraftValidationOwner,
} from "../../configurator/domain/assembly-draft-validation";
import type { AssemblyReviewResult } from "../../configurator/domain/assembly-review";
import type { HoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";
import { hoseEndMediaPath } from "./catalog-media";

type ConfiguredEnd = NonNullable<HoseConfigurationDraft["endA"]>;

const outcomeCopy: Record<
  AssemblyReviewResult["outcome"],
  { detail: string; heading: string }
> = {
  blocked: {
    detail:
      "Correct the highlighted item before this configuration can continue.",
    heading: "Configuration Blocked",
  },
  manual_quote: {
    detail:
      "This request is outside the guided configuration limits. Contact our team for a manual assembly quote.",
    heading: "Manual Assembly Quote Request",
  },
  ready: {
    detail: "The configuration is complete and ready for the Quote List step.",
    heading: "Ready for Quote List",
  },
  technical_review: {
    detail:
      "The configuration is complete and can continue with its review flags attached.",
    heading: "Technical Review Required",
  },
};

const ownerLabel: Record<DraftValidationOwner, string> = {
  hose: "Hose",
  "end-a": "End A",
  "end-b": "End B",
  length: "Finished Length",
  clocking: "Clocking",
  protection: "Protection",
};

const mediumLabel = {
  not_sure: "Not Sure",
  other: "Other",
  petroleum_hydraulic_fluid: "Petroleum-based hydraulic fluid",
  water_based_hydraulic_fluid: "Water-based hydraulic fluid",
};

function convertedLength(draft: HoseConfigurationDraft) {
  if (!draft.finishedLength) return "Not selected";
  const mm = Number(draft.finishedLength.canonicalMm);
  const inches = Number((mm / 25.4).toFixed(6));
  return `${draft.finishedLength.canonicalMm} mm · ${inches} in`;
}

function measurementLabel(draft: HoseConfigurationDraft) {
  const selection = draft.measurementSelection;
  if (!selection) return "Not selected";
  return selection.state === "selected"
    ? `${selection.method.code} · ${selection.method.displayName}`
    : "Not Sure · Technical Review Required";
}

function clockingLabel(draft: HoseConfigurationDraft) {
  if (!draft.clocking) return "Not applicable";
  return draft.clocking.status === "specified"
    ? `${draft.clocking.targetDisplay}° · ±${draft.clocking.standardToleranceDegrees}°`
    : "Not Sure · Manual Assembly Quote Request";
}

function applicationLabel(draft: HoseConfigurationDraft) {
  const application = draft.applicationRequirements;
  if (!application) return "Operating conditions not provided (optional)";
  return [
    mediumLabel[application.fluidMedium],
    `${application.maximumWorkingPressure.originalValue} ${application.maximumWorkingPressure.originalUnit}`,
    `${application.minimumOperatingTemperature.originalValue}–${application.maximumOperatingTemperature.originalValue} °${application.minimumOperatingTemperature.originalUnit}`,
  ].join(" · ");
}

function SelectedEndThumbnail({
  end,
  position,
}: {
  end: ConfiguredEnd | undefined;
  position: "End A" | "End B";
}) {
  const path = hoseEndMediaPath(end?.hoseEnd.mediaKey);
  if (!end || !path) {
    return (
      <div
        aria-label={`${position} technical image pending`}
        className="assembly-component-thumbnail assembly-component-thumbnail-fallback"
      >
        <ImageOff aria-hidden="true" size={22} />
        <span>Image pending</span>
      </div>
    );
  }
  return (
    <div className="assembly-component-thumbnail">
      <img alt={`${position}: ${end.hoseEnd.displayName}`} src={path} />
    </div>
  );
}

function ReviewIssue({
  issue,
  onEdit,
}: {
  issue: DraftValidationIssue;
  onEdit: (owner: DraftValidationOwner) => void;
}) {
  return (
    <li>
      <div>
        <strong>{ownerLabel[issue.owner]}</strong>
        <p>{issue.message}</p>
      </div>
      <button
        className="button button-secondary"
        onClick={() => onEdit(issue.owner)}
        type="button"
      >
        Edit {ownerLabel[issue.owner]}
      </button>
    </li>
  );
}

export function AssemblyReviewStage({
  actionLabel = "Add Assembly to Quote",
  addError,
  draft,
  isAdding,
  onAdd,
  onBack,
  onEdit,
  onQuantityChange,
  pendingLabel = "Checking Assembly...",
  quantityInput,
  result,
  validationIssues,
}: {
  actionLabel?: string;
  addError: string | null;
  draft: HoseConfigurationDraft;
  isAdding: boolean;
  onAdd: () => void;
  onBack: () => void;
  onEdit: (owner: DraftValidationOwner) => void;
  onQuantityChange: (value: string) => void;
  pendingLabel?: string;
  quantityInput: string;
  result: AssemblyReviewResult;
  validationIssues: DraftValidationIssue[];
}) {
  const status = outcomeCopy[result.outcome];
  const selectedMeasurement =
    draft.measurementSelection?.state === "selected"
      ? draft.measurementSelection
      : null;

  return (
    <section
      aria-label="Assembly review"
      className="assembly-review-stage"
      data-review-outcome={result.outcome}
    >
      <header className="end-a-stage-heading">
        <ClipboardList aria-hidden="true" size={24} />
        <div>
          <span className="eyebrow">Final configuration check</span>
          <h2>Review Your Assembly</h2>
          <p>Check each selection before continuing to the Quote List.</p>
        </div>
      </header>

      <div className="assembly-review-status" role="status">
        {result.outcome === "ready" ? (
          <CheckCircle2 aria-hidden="true" size={24} />
        ) : (
          <AlertTriangle aria-hidden="true" size={24} />
        )}
        <div>
          <strong>{status.heading}</strong>
          <p>{status.detail}</p>
        </div>
      </div>

      <section className="assembly-review-section">
        <header>
          <div>
            <span className="eyebrow">Build order</span>
            <h3>Ordered Components</h3>
          </div>
          <button
            className="button button-secondary"
            onClick={() => onEdit("hose")}
            type="button"
          >
            Edit Hose
          </button>
        </header>
        <ol className="assembly-component-order">
          <li>
            <span>1</span>
            <div className="assembly-component-details">
              <strong>{draft.hose.familyName}</strong>
              <small>SKU {draft.hose.sku}</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div className="assembly-component-details">
              <strong>
                {draft.endA?.hoseEnd.displayName ?? "End A missing"}
              </strong>
              <small>SKU {draft.endA?.hoseEnd.sku ?? "Not selected"}</small>
              {draft.endA ? <em>Matched ferrule included</em> : null}
            </div>
            <SelectedEndThumbnail end={draft.endA} position="End A" />
            <button onClick={() => onEdit("end-a")} type="button">
              Edit End A
            </button>
          </li>
          <li>
            <span>3</span>
            <div className="assembly-component-details">
              <strong>
                {draft.endB?.hoseEnd.displayName ?? "End B missing"}
              </strong>
              <small>SKU {draft.endB?.hoseEnd.sku ?? "Not selected"}</small>
              {draft.endB ? <em>Matched ferrule included</em> : null}
            </div>
            <SelectedEndThumbnail end={draft.endB} position="End B" />
            <button onClick={() => onEdit("end-b")} type="button">
              Edit End B
            </button>
          </li>
        </ol>
      </section>

      <section className="assembly-review-section">
        <header>
          <div>
            <span className="eyebrow">Production inputs</span>
            <h3>Measurement and Options</h3>
          </div>
        </header>
        <dl className="assembly-review-specs">
          <div>
            <dt>Measurement method</dt>
            <dd>{measurementLabel(draft)}</dd>
            <button onClick={() => onEdit("length")} type="button">
              Edit Finished Length
            </button>
          </div>
          <div>
            <dt>Finished length</dt>
            <dd>
              <strong>
                {draft.finishedLength
                  ? `${draft.finishedLength.originalValue} ${draft.finishedLength.originalUnit}`
                  : "Not selected"}
              </strong>
              <small>{convertedLength(draft)}</small>
            </dd>
          </div>
          <div>
            <dt>Standard tolerance</dt>
            <dd>
              {draft.finishedLength?.tolerance.display ?? "Not available"}
            </dd>
          </div>
          <div>
            <dt>Clocking</dt>
            <dd>{clockingLabel(draft)}</dd>
            {draft.clocking ? (
              <button onClick={() => onEdit("clocking")} type="button">
                Edit Clocking
              </button>
            ) : null}
          </div>
          <div>
            <dt>Installed protection</dt>
            <dd>{draft.installedProtection?.publicName ?? "Not selected"}</dd>
            <button onClick={() => onEdit("protection")} type="button">
              Edit Protection
            </button>
          </div>
          <div>
            <dt>Operating conditions</dt>
            <dd>{applicationLabel(draft)}</dd>
          </div>
        </dl>
      </section>

      <section className="assembly-review-section assembly-review-trace">
        <header>
          <div>
            <span className="eyebrow">Reference versions</span>
            <h3>Configuration Trace</h3>
          </div>
        </header>
        <dl>
          <div>
            <dt>Catalog release</dt>
            <dd>{draft.catalogRelease.number}</dd>
          </div>
          <div>
            <dt>Compatibility records</dt>
            <dd>
              {draft.endA?.compatibilityId ?? "Missing"} /{" "}
              {draft.endB?.compatibilityId ?? "Missing"}
            </dd>
          </div>
          <div>
            <dt>Measurement registry</dt>
            <dd>
              {selectedMeasurement
                ? `record v${selectedMeasurement.method.recordVersion} · diagram ${selectedMeasurement.diagram.assetVersion} · overlay ${selectedMeasurement.diagram.overlayVersion}`
                : "Not Sure"}
            </dd>
          </div>
          <div>
            <dt>Tolerance schedule</dt>
            <dd>
              {draft.finishedLength
                ? `${draft.finishedLength.tolerance.scheduleCode} v${draft.finishedLength.tolerance.scheduleVersion}`
                : "Missing"}
            </dd>
          </div>
          <div>
            <dt>Protection registry</dt>
            <dd>
              {draft.installedProtection
                ? `${draft.installedProtection.code} v${draft.installedProtection.recordVersion}`
                : "Missing"}
            </dd>
          </div>
          <div>
            <dt>Assembly estimate schedule</dt>
            <dd>
              {draft.lengthReferencePricing?.scheduleRecordVersion === null ||
              draft.lengthReferencePricing?.scheduleRecordVersion === undefined
                ? "Unavailable"
                : `v${draft.lengthReferencePricing.scheduleRecordVersion}`}
            </dd>
          </div>
          {draft.clocking ? (
            <div>
              <dt>Clocking convention</dt>
              <dd>
                M08 record v{draft.clocking.convention.recordVersion} · renderer{" "}
                {draft.clocking.convention.rendererVersion}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="assembly-review-section">
        <header>
          <div>
            <span className="eyebrow">Review flags</span>
            <h3>Items Requiring Attention</h3>
          </div>
        </header>
        {validationIssues.length > 0 ? (
          <ul className="assembly-review-issues">
            {validationIssues.map((issue) => (
              <ReviewIssue issue={issue} key={issue.code} onEdit={onEdit} />
            ))}
          </ul>
        ) : (
          <p className="assembly-review-empty-flags">
            No technical or manual review flags.
          </p>
        )}
      </section>

      <label className="assembly-review-quantity">
        <span>Assembly quantity</span>
        <input
          aria-label="Assembly quantity"
          aria-invalid={result.quantityError ? "true" : undefined}
          inputMode="numeric"
          min="1"
          onChange={(event) => onQuantityChange(event.target.value)}
          step="1"
          type="number"
          value={quantityInput}
        />
        <small>Enter a positive whole number.</small>
      </label>
      {result.quantityError ? (
        <div className="length-inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={19} />
          <p>
            <strong>Check quantity</strong>
            {result.quantityError}
          </p>
        </div>
      ) : null}

      {addError ? (
        <div className="length-inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={19} />
          <p>
            <strong>Assembly not added</strong>
            {addError}
          </p>
        </div>
      ) : null}

      {result.outcome === "manual_quote" ? (
        <div className="assembly-review-support">
          <Wrench aria-hidden="true" size={20} />
          <p>
            <strong>Manual assistance is required.</strong> Contact our team and
            keep this page open so the selected assembly can be reviewed with
            you. Support cannot change or submit the configuration.
          </p>
        </div>
      ) : null}

      <div
        aria-label="Review actions"
        className="configurator-action-dock"
        role="region"
      >
        <div className="configurator-action-dock-inner">
          <div className="configurator-action-dock-buttons">
            <button
              aria-label="Back to Protection"
              className="button button-secondary button-with-icon configurator-back"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={17} />
              <span className="configurator-back-label">
                Back to Protection
              </span>
              <span
                aria-hidden="true"
                className="configurator-back-label-short"
              >
                Back
              </span>
            </button>
            <button
              className="button button-primary configurator-next"
              disabled={!result.canAddConfiguredLine || isAdding}
              onClick={onAdd}
              type="button"
            >
              {isAdding ? pendingLabel : actionLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
