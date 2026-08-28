import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  PackageCheck,
  Shield,
} from "lucide-react";
import { useMemo, useState } from "react";

import type {
  AssemblyEstimateSchedule,
  InstalledProtection,
  InstalledProtectionRule,
} from "../../configurator-reference/domain/configurator-reference";
import { resolveInstalledProtectionOptionsFromEntries } from "../../configurator-reference/domain/configurator-reference";
import type { HoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";
import {
  calculateAssemblyLengthReferencePricing,
  evaluateApplicationRequirements,
  type ApplicationRequirementsSnapshot,
  type AssemblyLengthReferencePricing,
  type FluidMediumCode,
  type PressureUnit,
  type TemperatureUnit,
} from "../../configurator/domain/protection-and-application";

export interface ProtectionApplicationSelection {
  application: ApplicationRequirementsSnapshot | null;
  pricing: AssemblyLengthReferencePricing;
  protection: InstalledProtection;
}

const mediumOptions: Array<{ code: FluidMediumCode; label: string }> = [
  {
    code: "petroleum_hydraulic_fluid",
    label: "Petroleum-based hydraulic fluid",
  },
  { code: "water_based_hydraulic_fluid", label: "Water-based hydraulic fluid" },
  { code: "other", label: "Other" },
  { code: "not_sure", label: "Not Sure" },
];

function money(value: number | null) {
  return value === null ? "Confirmed with quote" : `$${value.toFixed(2)}`;
}

export function ProtectionApplicationStage({
  draft,
  installedProtections,
  installedProtectionRules,
  onBack,
  onSave,
  schedule,
  selection,
}: {
  draft: HoseConfigurationDraft;
  installedProtections: InstalledProtection[];
  installedProtectionRules: InstalledProtectionRule[];
  onBack: () => void;
  onSave: (selection: ProtectionApplicationSelection) => void;
  schedule: AssemblyEstimateSchedule | null;
  selection: ProtectionApplicationSelection | null;
}) {
  const [collectApplication, setCollectApplication] = useState(
    selection?.application !== null && selection?.application !== undefined,
  );
  const [fluidMedium, setFluidMedium] = useState<FluidMediumCode | "">(
    selection?.application?.fluidMedium ?? "",
  );
  const [pressure, setPressure] = useState(
    selection?.application?.maximumWorkingPressure.originalValue ?? "",
  );
  const [pressureUnit, setPressureUnit] = useState<PressureUnit>(
    selection?.application?.maximumWorkingPressure.originalUnit ?? "psi",
  );
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>(
    selection?.application?.minimumOperatingTemperature.originalUnit ?? "F",
  );
  const [minimumTemperature, setMinimumTemperature] = useState(
    selection?.application?.minimumOperatingTemperature.originalValue ?? "",
  );
  const [maximumTemperature, setMaximumTemperature] = useState(
    selection?.application?.maximumOperatingTemperature.originalValue ?? "",
  );
  const [protectionCode, setProtectionCode] = useState(
    selection?.protection.code ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const availableProtections = useMemo(
    () =>
      resolveInstalledProtectionOptionsFromEntries(
        installedProtections,
        installedProtectionRules,
        {
          applicationCode: collectApplication ? fluidMedium || null : null,
          hoseSeries: draft.hose.series,
        },
      ),
    [
      collectApplication,
      draft.hose.series,
      fluidMedium,
      installedProtectionRules,
      installedProtections,
    ],
  );
  const selectedProtection = installedProtections.find(
    ({ code }) => code === protectionCode,
  );
  const selectedProtectionIsAllowed = availableProtections.some(
    ({ code }) => code === protectionCode,
  );
  const previewPricing =
    selectedProtection && draft.finishedLength
      ? calculateAssemblyLengthReferencePricing({
          canonicalLengthMm: draft.finishedLength.canonicalMm,
          protection: selectedProtection,
          schedule,
        })
      : null;

  function save() {
    setError(null);
    if (!selectedProtection || !selectedProtectionIsAllowed) {
      setError("Choose an available installed protection option.");
      return;
    }
    if (!previewPricing) {
      setError("Save Finished Length before installed protection.");
      return;
    }
    let application: ApplicationRequirementsSnapshot | null = null;
    if (collectApplication) {
      if (!fluidMedium) {
        setError(
          "Choose the fluid medium, or select Not Sure for technical review.",
        );
        return;
      }
      const evaluated = evaluateApplicationRequirements({
        componentWorkingBarLimits: [
          draft.endA?.assemblyWorkingBar ?? null,
          draft.endA?.hoseEnd.maximumWorkingBar ?? null,
          draft.endB?.assemblyWorkingBar ?? null,
          draft.endB?.hoseEnd.maximumWorkingBar ?? null,
        ],
        fluidMedium,
        hoseLimits: draft.hose.performance,
        maximumOperatingTemperature: maximumTemperature,
        maximumWorkingPressure: pressure,
        minimumOperatingTemperature: minimumTemperature,
        pressureUnit,
        temperatureUnit,
      });
      if (!evaluated.valid) {
        setError(evaluated.error);
        return;
      }
      application = evaluated.application;
    }
    onSave({
      application,
      pricing: previewPricing,
      protection: selectedProtection,
    });
  }

  return (
    <section className="protection-application-stage">
      <header className="end-a-stage-heading">
        <div>
          <span className="eyebrow">Installed protection</span>
          <h2>Choose installed protection</h2>
          <p>
            Operating conditions are optional and can be confirmed during quote
            review.
          </p>
        </div>
      </header>

      <div className="export-packaging-notice">
        <PackageCheck aria-hidden="true" size={22} />
        <div>
          <strong>Standard Export Packaging included</strong>
          <p>
            This protects the shipment in transit and is separate from
            protection installed on the hose.
          </p>
        </div>
      </div>

      <fieldset className="configurator-fieldset">
        <legend>1. Installed Protection</legend>
        <p>Choose what will remain installed on the finished hose assembly.</p>
        <div className="protection-choice-grid">
          {availableProtections.map((option) => {
            const active = option.code === protectionCode;
            return (
              <button
                aria-pressed={active}
                className="protection-choice"
                key={option.code}
                onClick={() => setProtectionCode(option.code)}
                type="button"
              >
                <Shield aria-hidden="true" size={22} />
                <span>
                  <strong>{option.publicName}</strong>
                  <small>{option.specification}</small>
                </span>
                {active ? <Check aria-hidden="true" size={19} /> : null}
              </button>
            );
          })}
        </div>
        {protectionCode && !selectedProtectionIsAllowed ? (
          <div className="length-inline-alert" role="alert">
            <AlertTriangle aria-hidden="true" size={19} />
            <p>
              <strong>Choose another protection option</strong>This application
              rule requires installed protection; the retained choice is no
              longer valid.
            </p>
          </div>
        ) : null}
      </fieldset>

      <details
        className="application-optional-panel"
        onToggle={(event) => setCollectApplication(event.currentTarget.open)}
        open={collectApplication}
      >
        <summary>
          <span>
            <strong>2. Operating Conditions</strong>
            <small>Provide these details only if you know them.</small>
          </span>
          <span className="application-optional-meta">
            <span className="optional-badge">Optional</span>
            <ChevronDown aria-hidden="true" size={18} />
          </span>
        </summary>
        <div className="application-optional-content">
          <p>
            Other and Not Sure remain quotable and are marked for Technical
            Review.
          </p>
          <div className="application-form-grid">
            <label className="application-field application-field-wide">
              <span>Fluid medium</span>
              <select
                value={fluidMedium}
                onChange={(event) =>
                  setFluidMedium(event.target.value as FluidMediumCode)
                }
              >
                <option disabled value="">
                  Choose fluid medium
                </option>
                {mediumOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="application-field">
              <span>Maximum system working pressure</span>
              <input
                inputMode="decimal"
                onChange={(event) => setPressure(event.target.value)}
                placeholder="Example: 3000"
                value={pressure}
              />
            </label>
            <label className="application-field application-unit-field">
              <span>Pressure unit</span>
              <select
                value={pressureUnit}
                onChange={(event) =>
                  setPressureUnit(event.target.value as PressureUnit)
                }
              >
                <option value="psi">psi</option>
                <option value="bar">bar</option>
              </select>
            </label>
            <label className="application-field">
              <span>Minimum operating temperature</span>
              <input
                inputMode="decimal"
                onChange={(event) => setMinimumTemperature(event.target.value)}
                placeholder="Example: -40"
                value={minimumTemperature}
              />
            </label>
            <label className="application-field">
              <span>Maximum operating temperature</span>
              <input
                inputMode="decimal"
                onChange={(event) => setMaximumTemperature(event.target.value)}
                placeholder="Example: 212"
                value={maximumTemperature}
              />
            </label>
            <label className="application-field application-unit-field">
              <span>Temperature unit</span>
              <select
                value={temperatureUnit}
                onChange={(event) =>
                  setTemperatureUnit(event.target.value as TemperatureUnit)
                }
              >
                <option value="F">°F</option>
                <option value="C">°C</option>
              </select>
            </label>
          </div>
        </div>
      </details>

      {previewPricing ? (
        <section
          className="protection-price-preview"
          aria-label="Length-based reference pricing"
        >
          <div>
            <span>Assembly service</span>
            <strong>{money(previewPricing.assemblyServiceUsd)}</strong>
          </div>
          <div>
            <span>Installed protection</span>
            <strong>{money(previewPricing.protectionUsd)}</strong>
          </div>
          <p>
            Based on {previewPricing.exactLengthFeet.toFixed(3)} exact ft;
            installation terms use {previewPricing.startedFeet} started ft.
            Component pricing is added later.
          </p>
        </section>
      ) : null}
      {error ? (
        <div className="length-inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={19} />
          <p>
            <strong>Check these inputs</strong>
            {error}
          </p>
        </div>
      ) : null}
      {selection ? (
        <p className="configurator-ready" role="status">
          <Check aria-hidden="true" size={17} />
          <span>
            <strong>Protection saved</strong>
            <small>
              {selection.application === null
                ? "Operating conditions not provided (optional)"
                : selection.application.technicalReviewRequired
                  ? "Technical Review Required"
                  : "Ready for the next step"}
            </small>
          </span>
        </p>
      ) : null}

      <div
        aria-label="Save installed protection"
        className="configurator-action-dock"
        role="region"
      >
        <div className="configurator-action-dock-inner">
          <button
            aria-label="Back to Finished Length"
            className="button button-secondary button-with-icon configurator-back"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            <span className="configurator-back-label">
              Back to Finished Length
            </span>
            <span aria-hidden="true" className="configurator-back-label-short">
              Back
            </span>
          </button>
          <button
            className="button button-primary configurator-next"
            onClick={save}
            type="button"
          >
            Save Protection
          </button>
        </div>
      </div>
    </section>
  );
}
