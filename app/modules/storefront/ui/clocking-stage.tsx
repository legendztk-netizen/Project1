import {
  AlertTriangle,
  ArrowLeft,
  Check,
  HelpCircle,
  RotateCw,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { ClockingConvention } from "../../configurator-reference/domain/configurator-reference";
import {
  selectClockingNotSure,
  specifyClocking,
  standardClockingToleranceDegrees,
  type ClockingSelectionSnapshot,
} from "../../configurator/domain/assembly-clocking";
import { M08ClockingPreview } from "./m08-clocking-preview";

interface ClockingStageProps {
  convention: ClockingConvention | null;
  onBack: () => void;
  onInvalidate: () => void;
  onSave: (selection: ClockingSelectionSnapshot) => void;
  selection: ClockingSelectionSnapshot | null;
}

export function ClockingStage({
  convention,
  onBack,
  onInvalidate,
  onSave,
  selection,
}: ClockingStageProps) {
  const [rawAngle, setRawAngle] = useState(
    selection?.status === "specified" ? selection.targetDisplay : "",
  );
  const [notSure, setNotSure] = useState(selection?.status === "not_sure");
  const evaluation = useMemo(
    () =>
      notSure
        ? selectClockingNotSure(convention)
        : specifyClocking(convention, rawAngle),
    [convention, notSure, rawAngle],
  );
  const previewAngle =
    evaluation.valid && evaluation.selection.status === "specified"
      ? evaluation.selection.targetDegrees
      : null;
  const conventionError =
    convention &&
    convention.standardToleranceDegrees !== standardClockingToleranceDegrees
      ? `Clocking Convention M08 is unavailable because its published tolerance is not the required ±${standardClockingToleranceDegrees}°.`
      : null;

  function chooseAngle(value: number) {
    setNotSure(false);
    setRawAngle(String(value).padStart(3, "0"));
    onInvalidate();
  }

  function chooseNotSure() {
    setNotSure(true);
    setRawAngle("");
    onInvalidate();
  }

  return (
    <section className="clocking-stage" aria-labelledby="clocking-heading">
      <header className="clocking-stage-heading">
        <div>
          <span className="eyebrow">Step 5 · M08</span>
          <h2 id="clocking-heading">Set Double-Elbow Clocking</h2>
          <p>
            Orientation is required because End A and End B are both angled.
          </p>
        </div>
      </header>

      {!convention || conventionError ? (
        <div className="length-inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={19} />
          <p>
            {conventionError ??
              "Clocking Convention M08 is unavailable for this catalog release."}
          </p>
        </div>
      ) : (
        <div className="clocking-stage-layout">
          <M08ClockingPreview angle={previewAngle} />
          <div className="clocking-stage-controls">
            <ol className="clocking-instructions">
              <li>View the assembly from End A toward End B.</li>
              <li>Hold End B at 6 o'clock as 000 degrees.</li>
              <li>
                Measure the End A angle clockwise from 000 to 359 degrees.
              </li>
            </ol>

            <fieldset className="configurator-fieldset clocking-angle-fieldset">
              <legend>Choose an angle</legend>
              <p>
                {selection
                  ? "Review the retained angle or choose a new one. "
                  : "No angle is preselected. "}
                Standard Clocking tolerance is ±
                {convention.standardToleranceDegrees}°.
              </p>
              <div
                aria-label="Clocking angle presets"
                className="configurator-clocking-presets"
              >
                {convention.presets.map((preset) => (
                  <button
                    aria-pressed={!notSure && previewAngle === preset}
                    key={preset}
                    onClick={() => chooseAngle(preset)}
                    type="button"
                  >
                    {String(preset).padStart(3, "0")}°
                  </button>
                ))}
              </div>
              <label className="configurator-clocking-input">
                <span>Any whole degree</span>
                <span>
                  <input
                    aria-describedby="clocking-angle-help"
                    inputMode="numeric"
                    maxLength={3}
                    onChange={(event) => {
                      setNotSure(false);
                      setRawAngle(event.target.value);
                      onInvalidate();
                    }}
                    placeholder="000–359"
                    type="text"
                    value={rawAngle}
                  />
                  <strong>degrees</strong>
                </span>
                <small id="clocking-angle-help">
                  Enter 000 through 359. Whole degrees only.
                </small>
              </label>

              <button
                aria-pressed={notSure}
                className="clocking-not-sure"
                onClick={chooseNotSure}
                type="button"
              >
                <HelpCircle aria-hidden="true" size={22} />
                <span>
                  <strong>Not Sure</strong>
                  <small>
                    Save without an angle for manual technical review.
                  </small>
                </span>
                {notSure ? <Check aria-hidden="true" size={18} /> : null}
              </button>

              {!conventionError &&
              !notSure &&
              rawAngle.trim() &&
              !evaluation.valid ? (
                <div className="length-inline-alert" role="alert">
                  <AlertTriangle aria-hidden="true" size={19} />
                  <p>{evaluation.error}</p>
                </div>
              ) : null}
              {evaluation.valid ? (
                <div
                  className={`clocking-result ${evaluation.selection.status === "not_sure" ? "manual" : ""}`}
                  aria-live="polite"
                >
                  {evaluation.selection.status === "specified" ? (
                    <>
                      <RotateCw aria-hidden="true" size={19} />
                      <p>
                        <strong>
                          {evaluation.selection.targetDisplay}° Clocking
                        </strong>
                        Standard tolerance ±
                        {evaluation.selection.standardToleranceDegrees}°.
                      </p>
                    </>
                  ) : (
                    <>
                      <AlertTriangle aria-hidden="true" size={19} />
                      <p>
                        <strong>Manual Technical Review Required</strong>No
                        Clocking angle will be assumed.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </fieldset>
          </div>
        </div>
      )}

      <div
        aria-label="Clocking actions"
        className="configurator-action-dock clocking-action-dock"
        role="region"
      >
        <div className="configurator-action-dock-inner">
          <button
            className="button button-secondary button-with-icon clocking-back"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            Back to Finished Length
          </button>
          {evaluation.valid ? (
            <button
              className="button button-primary clocking-save"
              onClick={() => onSave(evaluation.selection)}
              type="button"
            >
              {evaluation.selection.status === "not_sure"
                ? "Save for Manual Review"
                : "Save Clocking"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
