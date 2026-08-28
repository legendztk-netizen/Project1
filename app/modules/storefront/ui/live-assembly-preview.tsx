import type { DraftValidationIssue } from "../../configurator/domain/assembly-draft-validation";
import {
  classifyHoseEndAngle,
  evaluateAssemblyClockingApplicability,
} from "../../configurator/domain/assembly-clocking";
import type { HoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";
import { hoseSizeLabel } from "../domain/variant-label";
import { M08ClockingPreview } from "./m08-clocking-preview";

type EndForm =
  "straight" | "45-degree" | "90-degree" | "angled" | "unclassified";

const validationKindLabel: Record<DraftValidationIssue["kind"], string> = {
  manual_path: "Manual quote path",
  reconfirmation: "Reconfirmation required",
  retained_invalid: "Retained invalid selection",
  technical_review: "Technical review",
};

function endForm(angle: string | undefined): EndForm {
  if (!angle) return "unclassified";
  const classification = classifyHoseEndAngle(angle);
  if (classification === "straight") return "straight";
  if (classification === "unknown") return "unclassified";
  const numericAngle = Number(angle.trim().match(/^(\d{1,3})/u)?.[1]);
  if (numericAngle === 45) return "45-degree";
  if (numericAngle === 90) return "90-degree";
  return "angled";
}

function endFormText(form: EndForm) {
  switch (form) {
    case "45-degree":
      return "45 degree";
    case "90-degree":
      return "90 degree";
    case "straight":
      return "straight";
    case "angled":
      return "angled";
    case "unclassified":
      return "unclassified form";
  }
}

function endPath(form: EndForm, side: "a" | "b") {
  const direction = side === "a" ? -1 : 1;
  const x = (value: number) => 480 + direction * value;
  switch (form) {
    case "straight":
      return `M ${x(145)} 190 L ${x(245)} 190`;
    case "45-degree":
    case "angled":
      return `M ${x(145)} 190 L ${x(200)} 190 L ${x(255)} 135`;
    case "90-degree":
      return `M ${x(145)} 190 L ${x(205)} 190 L ${x(205)} 105`;
    case "unclassified":
      return `M ${x(145)} 190 L ${x(220)} 190`;
  }
}

function endTerminal(form: EndForm, side: "a" | "b") {
  const direction = side === "a" ? -1 : 1;
  switch (form) {
    case "straight":
      return { x: 480 + direction * 260, y: 190 };
    case "45-degree":
    case "angled":
      return { x: 480 + direction * 268, y: 122 };
    case "90-degree":
      return { x: 480 + direction * 205, y: 90 };
    case "unclassified":
      return { x: 480 + direction * 235, y: 190 };
  }
}

function finishedLengthLabel(draft: HoseConfigurationDraft) {
  return draft.finishedLength
    ? `${draft.finishedLength.originalValue} ${draft.finishedLength.originalUnit}`
    : "Not selected";
}

function measurementLabel(draft: HoseConfigurationDraft) {
  if (!draft.measurementSelection) return "Not selected";
  return draft.measurementSelection.state === "selected"
    ? `${draft.measurementSelection.method.code} · ${draft.measurementSelection.method.displayName}`
    : "Not Sure · Manual Technical Review";
}

function clockingLabel(draft: HoseConfigurationDraft) {
  if (!draft.endA || !draft.endB) return "Not applicable yet";
  if (draft.clocking?.validation === "retained_invalid") {
    return "Retained selection · Reconfirmation required";
  }
  const applicability = evaluateAssemblyClockingApplicability(draft);
  if (applicability.status === "manual_review") {
    return "Technical review required";
  }
  if (applicability.status === "not_applicable") return "Not applicable";
  if (!draft.clocking) return "Not selected";
  if (draft.clocking.status === "not_sure") {
    return "Not Sure · Manual Technical Review";
  }
  return `${draft.clocking.targetDisplay}° · ±${draft.clocking.standardToleranceDegrees}°`;
}

function applicationLabel(draft: HoseConfigurationDraft) {
  const application = draft.applicationRequirements;
  if (!application) return "Not provided (optional)";
  return [
    application.fluidMedium.replaceAll("_", " "),
    `${application.maximumWorkingPressure.originalValue} ${application.maximumWorkingPressure.originalUnit}`,
    `${application.minimumOperatingTemperature.originalValue}–${application.maximumOperatingTemperature.originalValue} °${application.minimumOperatingTemperature.originalUnit}`,
  ].join(" · ");
}

function hosePressureLabel(draft: HoseConfigurationDraft) {
  const values = [
    draft.hose.performance.workingPsi === null
      ? null
      : `${draft.hose.performance.workingPsi} psi`,
    draft.hose.performance.workingBar === null
      ? null
      : `${draft.hose.performance.workingBar} bar`,
  ].filter(Boolean);
  return values.length > 0 ? values.join(" / ") : "Confirmed during review";
}

function hoseTemperatureLabel(draft: HoseConfigurationDraft) {
  const performance = draft.hose.performance;
  if (
    performance.temperatureMinC === null ||
    performance.temperatureMaxC === null
  ) {
    return "Confirmed during review";
  }
  return `${performance.temperatureMinC}°C to ${performance.temperatureMaxC}°C`;
}

function draftHoseSizeLabel(draft: HoseConfigurationDraft) {
  if (draft.hose.nominalIdIn === null) return "Confirmed during review";
  const dash =
    draft.hose.dash && /^-\d+$/.test(draft.hose.dash)
      ? (draft.hose.dash as `-${number}`)
      : null;
  return (
    hoseSizeLabel(draft.hose.nominalIdIn, dash) ?? "Confirmed during review"
  );
}

function PreviewEnd({
  form,
  label,
  side,
}: {
  form: EndForm;
  label: string;
  side: "a" | "b";
}) {
  const terminal = endTerminal(form, side);
  return (
    <g className={`assembly-end assembly-end-${side}`}>
      <path d={endPath(form, side)} />
      <circle cx={terminal.x} cy={terminal.y} r="18" />
      {form === "unclassified" ? (
        <text x={terminal.x} y={terminal.y + 6} textAnchor="middle">
          ?
        </text>
      ) : null}
      <text
        className="assembly-end-label"
        textAnchor="middle"
        x={side === "a" ? 180 : 780}
        y="315"
      >
        {label}
      </text>
    </g>
  );
}

export function LiveAssemblyPreview({
  draft,
  issues,
}: {
  draft: HoseConfigurationDraft;
  issues: DraftValidationIssue[];
}) {
  const endAForm = endForm(draft.endA?.hoseEnd.angle);
  const endBForm = endForm(draft.endB?.hoseEnd.angle);
  const length = finishedLengthLabel(draft);
  const protection =
    draft.installedProtection?.publicName ?? "No protection selected";
  const hasInstalledProtection = Boolean(
    draft.installedProtection &&
    !draft.installedProtection.isNoAdditionalProtection,
  );
  const clockingAngle =
    draft.clocking?.status === "specified"
      ? draft.clocking.targetDegrees
      : null;
  const description = [
    "Live assembly preview.",
    `Hose ${draft.hose.sku}.`,
    draft.endA
      ? `End A ${draft.endA.hoseEnd.sku}, ${endFormText(endAForm)}.`
      : "End A not selected.",
    draft.endB
      ? `End B ${draft.endB.hoseEnd.sku}, ${endFormText(endBForm)}.`
      : "End B not selected.",
    `Finished length ${length}.`,
    `Protection ${protection}.`,
    `Clocking ${clockingLabel(draft)}.`,
    "Not to scale.",
  ].join(" ");

  return (
    <div className="live-assembly-preview">
      <p aria-atomic="true" className="sr-only" role="status">
        Assembly preview updated for Hose {draft.hose.sku}, End A{" "}
        {draft.endA?.hoseEnd.sku ?? "not selected"}, End B{" "}
        {draft.endB?.hoseEnd.sku ?? "not selected"}.
      </p>
      <figure className="assembly-schematic-frame">
        <svg
          aria-label={description}
          className="assembly-schematic"
          data-clocking={clockingLabel(draft)}
          data-end-a-form={endAForm}
          data-end-b-form={endBForm}
          data-protection={draft.installedProtection?.code ?? "none-selected"}
          role="img"
          viewBox="0 0 960 350"
        >
          <defs>
            <pattern
              height="12"
              id="assembly-protection-pattern"
              patternUnits="userSpaceOnUse"
              width="12"
            >
              <path d="M 0 12 L 12 0" />
            </pattern>
          </defs>
          <line
            className="assembly-hose-shadow"
            x1="335"
            x2="625"
            y1="190"
            y2="190"
          />
          <line className="assembly-hose" x1="335" x2="625" y1="190" y2="190" />
          {hasInstalledProtection ? (
            <line
              className="assembly-protection"
              x1="340"
              x2="620"
              y1="190"
              y2="190"
            />
          ) : null}
          <PreviewEnd form={endAForm} label="END A" side="a" />
          <PreviewEnd form={endBForm} label="END B" side="b" />
          <g className="assembly-length-callout">
            <line x1="275" x2="685" y1="55" y2="55" />
            <path d="M 275 55 l 18 -9 v 18 z" />
            <path d="M 685 55 l -18 -9 v 18 z" />
            <text textAnchor="middle" x="480" y="39">
              Finished length · {length}
            </text>
          </g>
          <text
            className="assembly-hose-label"
            textAnchor="middle"
            x="480"
            y="205"
          >
            HOSE
          </text>
          {hasInstalledProtection ? (
            <text
              className="assembly-protection-label"
              textAnchor="middle"
              x="480"
              y="252"
            >
              PROTECTION
            </text>
          ) : null}
        </svg>
        <figcaption>Assembly preview · Not to scale</figcaption>
      </figure>

      {draft.clocking ? (
        <section
          aria-label="Live M08 Clocking orientation"
          className="assembly-preview-clocking"
        >
          <header>
            <span>M08 Clocking</span>
            <strong>Live orientation · {clockingLabel(draft)}</strong>
          </header>
          <M08ClockingPreview angle={clockingAngle} />
        </section>
      ) : null}

      <section
        aria-label="Assembly specification"
        className="assembly-live-specification"
      >
        <header>
          <span className="eyebrow">Authoritative specification</span>
          <h3>Current assembly inputs</h3>
        </header>
        <dl>
          <div>
            <dt>Hose</dt>
            <dd>
              {draft.hose.familyName}
              <small>SKU {draft.hose.sku}</small>
            </dd>
          </div>
          <div>
            <dt>Hose size</dt>
            <dd>{draftHoseSizeLabel(draft)}</dd>
          </div>
          <div>
            <dt>Working pressure</dt>
            <dd>{hosePressureLabel(draft)}</dd>
          </div>
          <div>
            <dt>Temperature</dt>
            <dd>{hoseTemperatureLabel(draft)}</dd>
          </div>
          <div aria-label="Selected End A" role="region">
            <dt>End A</dt>
            <dd>
              {draft.endA?.hoseEnd.displayName ?? "Not selected"}
              {draft.endA ? (
                <>
                  <small>SKU {draft.endA.hoseEnd.sku}</small>
                  <small>Matched ferrule included</small>
                  <small>
                    {draft.endA.hoseEnd.thread} ·{" "}
                    {draft.endA.hoseEnd.sealingForm}
                  </small>
                </>
              ) : null}
            </dd>
          </div>
          <div aria-label="Selected End B" role="region">
            <dt>End B</dt>
            <dd>
              {draft.endB?.hoseEnd.displayName ?? "Not selected"}
              {draft.endB ? (
                <>
                  <small>SKU {draft.endB.hoseEnd.sku}</small>
                  <small>Matched ferrule included</small>
                  <small>
                    {draft.endB.hoseEnd.thread} ·{" "}
                    {draft.endB.hoseEnd.sealingForm}
                  </small>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Measurement</dt>
            <dd>{measurementLabel(draft)}</dd>
          </div>
          <div>
            <dt>Finished length</dt>
            <dd>{length}</dd>
          </div>
          <div>
            <dt>Protection</dt>
            <dd>{protection}</dd>
          </div>
          {draft.lengthReferencePricing ? (
            <div>
              <dt>Reference services</dt>
              <dd>
                Assembly{" "}
                {draft.lengthReferencePricing.assemblyServiceUsd === null
                  ? "confirmed with quote"
                  : `$${draft.lengthReferencePricing.assemblyServiceUsd.toFixed(2)}`}
                <small>
                  Protection{" "}
                  {draft.lengthReferencePricing.protectionUsd === null
                    ? "confirmed with quote"
                    : `$${draft.lengthReferencePricing.protectionUsd.toFixed(2)}`}
                </small>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Clocking</dt>
            <dd>
              {clockingLabel(draft)}
              {draft.clocking?.validation === "retained_invalid" ? (
                <small>
                  Previous Clocking:{" "}
                  {draft.clocking.status === "specified"
                    ? `${draft.clocking.targetDisplay}°`
                    : "Not Sure"}
                  . The Hose End selection changed; confirm this value again.
                </small>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Operating conditions</dt>
            <dd>{applicationLabel(draft)}</dd>
          </div>
        </dl>
        <div className="assembly-review-flags">
          <strong>Review flags</strong>
          {issues.length === 0 ? (
            <span>None</span>
          ) : (
            <ul>
              {issues.map((issue) => (
                <li key={issue.code}>
                  <span>{validationKindLabel[issue.kind]}</span>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
