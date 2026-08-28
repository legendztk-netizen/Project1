import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ExternalLink,
  HelpCircle,
  Ruler,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import type { LengthMeasurementMethod } from "../../configurator-reference/domain/configurator-reference";
import {
  evaluateFinishedAssemblyLength,
  selectMeasurementMethod,
  selectMeasurementNotSure,
  type FinishedAssemblyLengthSnapshot,
  type FinishedLengthManualReviewReason,
  type FinishedLengthUnit,
  type MeasurementSelectionSnapshot,
} from "../../configurator/domain/finished-assembly-length";

const manualReasonCopy: Record<FinishedLengthManualReviewReason, string> = {
  both_ends_required: "Both finished hose ends must be confirmed.",
  finer_than_1_8_in:
    "This inch value is finer than the guided 1/8-inch increment.",
  finer_than_1_mm:
    "This metric value is finer than the guided 1-millimetre increment.",
  over_50_ft:
    "Lengths over 50 ft require confirmation of production, handling, and freight.",
  tighter_tolerance_requested:
    "A tighter-than-standard tolerance requires factory confirmation.",
};

interface FinishedLengthStageProps {
  finishedLength: FinishedAssemblyLengthSnapshot | null;
  measurementMethods: LengthMeasurementMethod[];
  measurementSelection: MeasurementSelectionSnapshot | null;
  onBack: () => void;
  onInvalidateLength: () => void;
  onSaveLength: (length: FinishedAssemblyLengthSnapshot) => void;
  onSelectMeasurement: (selection: MeasurementSelectionSnapshot) => void;
}

export function FinishedLengthStage({
  finishedLength,
  measurementMethods,
  measurementSelection,
  onBack,
  onInvalidateLength,
  onSaveLength,
  onSelectMeasurement,
}: FinishedLengthStageProps) {
  const [unit, setUnit] = useState<FinishedLengthUnit>(
    finishedLength?.originalUnit ?? "in",
  );
  const [value, setValue] = useState(finishedLength?.originalValue ?? "");
  const [requestedTighterTolerance, setRequestedTighterTolerance] = useState(
    finishedLength?.requestedTighterTolerance ?? false,
  );
  const evaluation = useMemo(
    () =>
      measurementSelection && value.trim()
        ? evaluateFinishedAssemblyLength({
            hasBothEnds: true,
            requestedTighterTolerance,
            unit,
            value,
          })
        : null,
    [measurementSelection, requestedTighterTolerance, unit, value],
  );

  function chooseUnit(nextUnit: FinishedLengthUnit) {
    if (nextUnit === unit) return;
    setUnit(nextUnit);
    setValue("");
    onInvalidateLength();
  }

  return (
    <section className="finished-length-stage" aria-labelledby="length-heading">
      <header className="finished-length-heading">
        <div>
          <span className="eyebrow">Step 4</span>
          <h2 id="length-heading">Set Finished Overall Assembly Length</h2>
          <p>
            Choose the diagram that matches how you will measure the finished
            hose, then enter the sealing-point-to-sealing-point length.
          </p>
        </div>
        <Link
          className="button button-secondary button-with-icon"
          target="_blank"
          to="/assembly-measurement-guide"
        >
          Measurement Guide
          <ExternalLink aria-hidden="true" size={16} />
        </Link>
      </header>

      <fieldset className="configurator-fieldset measurement-method-fieldset">
        <legend>1. Choose a Measurement Method</legend>
        <p>
          Review all endpoint examples in the guide. The system does not choose
          a method from your hose ends.
        </p>
        {measurementMethods.length > 0 ? (
          <div className="measurement-method-grid">
            {measurementMethods.map((method) => {
              const active =
                measurementSelection?.state === "selected" &&
                measurementSelection.method.code === method.code;
              return (
                <button
                  aria-pressed={active}
                  className="measurement-method-choice"
                  key={method.code}
                  onClick={() =>
                    onSelectMeasurement(selectMeasurementMethod(method))
                  }
                  type="button"
                >
                  <span className="measurement-code">{method.code}</span>
                  <span>
                    <strong>{method.displayName}</strong>
                    <small>{method.endpointRule}</small>
                  </span>
                  {active ? <Check aria-hidden="true" size={18} /> : null}
                </button>
              );
            })}
            <button
              aria-pressed={measurementSelection?.state === "not_sure"}
              className="measurement-method-choice measurement-not-sure"
              onClick={() => onSelectMeasurement(selectMeasurementNotSure())}
              type="button"
            >
              <span className="measurement-code">
                <HelpCircle aria-hidden="true" size={22} />
              </span>
              <span>
                <strong>Not Sure</strong>
                <small>
                  Save without an M-code for manual technical review.
                </small>
              </span>
              {measurementSelection?.state === "not_sure" ? (
                <Check aria-hidden="true" size={18} />
              ) : null}
            </button>
          </div>
        ) : (
          <div className="length-inline-alert" role="alert">
            <AlertTriangle aria-hidden="true" size={19} />
            <p>
              Measurement methods are not available in this catalog release. The
              length step cannot continue.
            </p>
          </div>
        )}
      </fieldset>

      <fieldset
        className="configurator-fieldset finished-length-fieldset"
        disabled={!measurementSelection}
      >
        <legend>2. Enter Finished Length</legend>
        <p>
          {measurementSelection
            ? "Use the selected method's endpoints. Minimum buildable length will be confirmed with your quote."
            : "Choose a measurement method or Not Sure to unlock the length input."}
        </p>
        <div className="length-entry-grid">
          <div>
            <span className="length-control-label">Specified unit</span>
            <div className="length-unit-control" aria-label="Length unit">
              <button
                aria-pressed={unit === "in"}
                onClick={() => chooseUnit("in")}
                type="button"
              >
                Inches
              </button>
              <button
                aria-pressed={unit === "mm"}
                onClick={() => chooseUnit("mm")}
                type="button"
              >
                Millimetres
              </button>
            </div>
          </div>
          <label className="finished-length-input">
            <span>Finished overall assembly length</span>
            <span className="finished-length-input-shell">
              <Ruler aria-hidden="true" size={19} />
              <input
                aria-describedby="finished-length-increment"
                inputMode="decimal"
                onChange={(event) => {
                  setValue(event.target.value);
                  onInvalidateLength();
                }}
                placeholder={unit === "in" ? "Example: 72" : "Example: 1829"}
                type="text"
                value={value}
              />
              <strong>{unit}</strong>
            </span>
            <small id="finished-length-increment">
              Guided increment: {unit === "in" ? "1/8 in" : "1 mm"}
            </small>
          </label>
        </div>

        <label className="tighter-tolerance-option">
          <input
            checked={requestedTighterTolerance}
            onChange={(event) => {
              setRequestedTighterTolerance(event.target.checked);
              onInvalidateLength();
            }}
            type="checkbox"
          />
          <span>
            <strong>I need a tighter tolerance than SAE J517</strong>
            <small>
              This remains quotable but requires manual confirmation.
            </small>
          </span>
        </label>

        {evaluation?.valid ? (
          <div className="length-result" aria-live="polite">
            <dl>
              <div>
                <dt>Exact conversion</dt>
                <dd>{evaluation.length.canonicalMm} mm</dd>
              </div>
              <div>
                <dt>SAE J517 assembly tolerance</dt>
                <dd>{evaluation.length.tolerance.display}</dd>
              </div>
            </dl>
            {measurementSelection?.state === "not_sure" ? (
              <div className="length-review-notice length-review-manual">
                <AlertTriangle aria-hidden="true" size={18} />
                <p>
                  <strong>Manual Technical Review Required</strong>
                  No measurement method or diagram will be assigned.
                </p>
              </div>
            ) : null}
            {evaluation.length.path === "manual_review" ? (
              <div className="length-review-notice length-review-manual">
                <AlertTriangle aria-hidden="true" size={18} />
                <p>
                  <strong>Manual Length Review Required</strong>
                  {evaluation.length.manualReviewReasons
                    .map((reason) => manualReasonCopy[reason])
                    .join(" ")}
                </p>
              </div>
            ) : (
              <div className="length-review-notice">
                <Check aria-hidden="true" size={18} />
                <p>
                  <strong>Guided length accepted</strong>
                  Length Feasibility Review Required before PI issuance.
                </p>
              </div>
            )}
          </div>
        ) : value.trim() && evaluation && !evaluation.valid ? (
          <div className="length-inline-alert" role="alert">
            <AlertTriangle aria-hidden="true" size={19} />
            <p>{evaluation.error}</p>
          </div>
        ) : null}
      </fieldset>
      <div
        aria-label="Finished length actions"
        className="configurator-action-dock"
        role="region"
      >
        <div className="configurator-action-dock-inner">
          <button
            aria-label="Back to End B"
            className="button button-secondary button-with-icon configurator-back"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            <span className="configurator-back-label">Back to End B</span>
            <span aria-hidden="true" className="configurator-back-label-short">
              Back
            </span>
          </button>
          {evaluation?.valid ? (
            <button
              className="button button-primary finished-length-save"
              onClick={() => onSaveLength(evaluation.length)}
              type="button"
            >
              {measurementSelection?.state === "not_sure" ||
              evaluation.length.path === "manual_review"
                ? "Save for Manual Review"
                : "Save Finished Length"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
