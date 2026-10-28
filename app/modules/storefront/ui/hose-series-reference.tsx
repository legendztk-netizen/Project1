import type { ReactNode } from "react";
import { Link } from "react-router";

import {
  compareDashSizes,
  nominalInchesFromDash,
  type DashSize,
} from "../../catalog/domain/dash-size";
import type {
  PublicCatalogFamily,
  PublicCatalogItem,
} from "../../catalog/domain/public-catalog";
import { displayDash, hoseSizeLabel } from "../domain/variant-label";

const PSI_PER_BAR = 14.5037738;
const numberFormatter = new Intl.NumberFormat("en-US");

function findSpecValue(item: PublicCatalogItem, label: string): string | null {
  const match = item.specs.find((spec) => spec.label === label);
  return match?.value?.trim() || null;
}

function parseLeadingNumber(value: string | null): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

function formatSignedDegrees(value: number, unit: "°C" | "°F"): string {
  return `${value > 0 ? `+${value}` : `${value}`}${unit}`;
}

export function formatDualTemperatureRange(
  minC: number | null,
  maxC: number | null,
): string {
  if (minC === null || maxC === null) return "—";
  const minF = celsiusToFahrenheit(minC);
  const maxF = celsiusToFahrenheit(maxC);
  return `${formatSignedDegrees(minC, "°C")} to ${formatSignedDegrees(maxC, "°C")} (${formatSignedDegrees(minF, "°F")} to ${formatSignedDegrees(maxF, "°F")})`;
}

export function formatDualPressure(
  psi: number | null,
  bar: number | null,
): string {
  if (psi === null && bar === null) return "—";
  const resolvedPsi =
    psi ?? (bar !== null ? Math.round(bar * PSI_PER_BAR) : null);
  if (resolvedPsi !== null && bar !== null) {
    return `${numberFormatter.format(resolvedPsi)} psi / ${numberFormatter.format(bar)} bar`;
  }
  if (resolvedPsi !== null) {
    return `${numberFormatter.format(resolvedPsi)} psi`;
  }
  return `${numberFormatter.format(bar!)} bar`;
}

/** `1/4"`, `1-1/4"` or `2"`: the fraction customers search by. */
function formatNominalInch(nominalIdIn: number | null, dash: DashSize | null) {
  const label = hoseSizeLabel(nominalIdIn, dash);
  return label ? `${label.replace(/\s+in$/, "").replace(/\s+/g, "-")}"` : "—";
}

/** "-4, -6 and -8". */
function formatList(items: readonly string[]) {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export interface HoseSpecTableRow {
  bendRadius: string;
  burstPressure: string;
  dash: DashSize | null;
  dashLabel: string;
  /** EN 853 metric size designation (`id_mm`), not a measured bore. */
  metricSizeMm: number | null;
  nominalId: string;
  nominalIn: number | null;
  nominalInch: string;
  odMm: string;
  /** Null when the assembly list could not be read. */
  onlineAssembly: boolean | null;
  sku: string;
  weight: string;
  workingPressure: string;
}

export function buildHoseSpecTableRows(
  family: PublicCatalogFamily,
  assemblyHoseSkus: ReadonlySet<string> | null,
): HoseSpecTableRow[] {
  return family.variants
    .flatMap((variant) =>
      variant.variantSelection?.kind === "hose"
        ? [{ selection: variant.variantSelection, variant }]
        : [],
    )
    .toSorted((left, right) =>
      compareDashSizes(left.selection.dash, right.selection.dash),
    )
    .map(({ selection, variant }) => {
      const burstBar = parseLeadingNumber(
        findSpecValue(variant, "Minimum burst pressure"),
      );
      const bendRadius = findSpecValue(variant, "Minimum bend radius");
      const nominalIn =
        selection.nominalIdIn ?? nominalInchesFromDash(selection.dash);
      const nominalInch = formatNominalInch(
        selection.nominalIdIn,
        selection.dash,
      );
      return {
        bendRadius: bendRadius ?? "—",
        burstPressure:
          burstBar !== null ? formatDualPressure(null, burstBar) : "—",
        dash: selection.dash,
        dashLabel: displayDash(selection.dash),
        metricSizeMm: selection.idMm ?? null,
        nominalId:
          nominalIn === null || Number.isInteger(nominalIn)
            ? nominalInch
            : `${nominalInch} (${nominalIn} in)`,
        nominalIn,
        nominalInch,
        odMm: findSpecValue(variant, "Outside diameter") ?? "—",
        onlineAssembly: assemblyHoseSkus
          ? assemblyHoseSkus.has(variant.sku)
          : null,
        sku: variant.sku,
        weight: findSpecValue(variant, "Weight") ?? "—",
        workingPressure: formatDualPressure(
          selection.performance.workingPsi,
          selection.performance.workingBar,
        ),
      };
    });
}

export function HoseSeriesReference({
  assemblyHoseSkus,
  family,
  selected,
  selectionComplete,
  selectSku,
}: {
  assemblyHoseSkus: readonly string[] | null;
  family: PublicCatalogFamily;
  selected: PublicCatalogItem;
  selectionComplete: boolean;
  selectSku: (sku: string) => void;
}) {
  const repSelection = family.representative.variantSelection;
  if (
    repSelection?.kind !== "hose" ||
    repSelection.hoseSeries.toUpperCase() !== "601R1"
  ) {
    return null;
  }

  const rows = buildHoseSpecTableRows(
    family,
    assemblyHoseSkus ? new Set(assemblyHoseSkus) : null,
  );
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return null;
  const at = (dash: DashSize) => rows.find((row) => row.dash === dash);
  const bendAt = (dash: DashSize) => at(dash)?.bendRadius ?? "—";
  const sizeAt = (dash: DashSize) => {
    const row = at(dash);
    return row ? `${row.nominalInch} (${row.dashLabel})` : dash;
  };
  const metricAt = (dash: DashSize) => at(dash)?.metricSizeMm ?? "—";
  const showAssembly = rows.every((row) => row.onlineAssembly !== null);
  const assemblySizes = rows
    .filter((row) => row.onlineAssembly)
    .map((row) => row.dashLabel);
  const hoseOnlySizes = rows
    .filter((row) => row.onlineAssembly === false)
    .map((row) => row.dashLabel);
  const largeBore = rows.filter((row) => (row.nominalIn ?? 0) >= 1.5);
  const largeFirst = largeBore[0];
  const largeLast = largeBore.at(-1);
  const beyondStandardLargeBore = largeBore
    .filter((row) => (row.nominalIn ?? 0) > 2)
    .map((row) => row.dashLabel);

  const primaryStandard =
    repSelection.primaryStandard ??
    findSpecValue(family.representative, "Primary standard") ??
    "SAE 100 R1AT";
  const equivalentStandard =
    repSelection.equivalentStandard ??
    findSpecValue(family.representative, "Equivalent standard") ??
    "EN 853 1SN";
  const temperatureRange = formatDualTemperatureRange(
    repSelection.performance.temperatureMinC,
    repSelection.performance.temperatureMaxC,
  );
  const reinforcement =
    repSelection.reinforcement ??
    findSpecValue(family.representative, "Reinforcement") ??
    "—";
  const fluidCompatibility =
    findSpecValue(family.representative, "Fluid compatibility") ?? "—";

  const questions: { answer: ReactNode; question: string }[] = [
    ...(showAssembly
      ? [
          {
            question:
              "Which 601R1 sizes can be built as hose assemblies online?",
            answer: (
              <>
                {formatList(assemblySizes)} have matching crimp hose ends and
                can be configured by length in Build a Hose.
                {hoseOnlySizes.length > 0
                  ? ` ${formatList(hoseOnlySizes)} are sold as cut-length hose; contact our team for a manual assembly quote.`
                  : null}
              </>
            ),
          },
        ]
      : []),
    {
      question: "What does the minimum bend radius mean for routing?",
      answer: (
        <>
          It is the tightest bend the hose should take in service:{" "}
          {bendAt("-8")} for {sizeAt("-8")} and {bendAt("-12")} for{" "}
          {sizeAt("-12")}. The rated working pressure and expected service life
          assume the hose is not bent tighter, so check the radius against the
          available space before moving to a larger size.
        </>
      ),
    },
    {
      question: "When should I use 601R2 instead of 601R1?",
      answer: (
        <>
          When the system&apos;s maximum pressure, including the relief valve
          setting and pressure peaks, is above the 601R1 rating for the bore you
          need. 601R2 is two-wire braided (SAE 100R2AT / EN 853 2SN) and is
          rated higher at the same size.
        </>
      ),
    },
    ...(largeFirst && largeLast
      ? [
          {
            question: `Are the large-bore sizes (${largeFirst.dashLabel} to ${largeLast.dashLabel}) suitable for high-pressure lines?`,
            answer: (
              <>
                No. Working pressure falls from {largeFirst.workingPressure} on{" "}
                {largeFirst.dashLabel} to {largeLast.workingPressure} on{" "}
                {largeLast.dashLabel}, and the minimum bend radius rises from{" "}
                {largeFirst.bendRadius} to {largeLast.bendRadius}.
                {beyondStandardLargeBore.length > 0
                  ? ` ${formatList(beyondStandardLargeBore)} are beyond the SAE J517 and EN 853 size tables.`
                  : null}{" "}
                Use these sizes for low-pressure lines such as returns and
                transfer.
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="hose-series-reference" data-series-reference="601R1">
      {/* Block 1: Full-Size Specification Table */}
      <section
        aria-labelledby="hose-size-chart-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">
              Series 601R1 · {primaryStandard} / {equivalentStandard}
            </span>
            <h2 id="hose-size-chart-heading">
              SAE 100R1AT / EN 853 1SN Hydraulic Hose Size Chart &amp; Full
              Specifications
            </h2>
          </div>
          <span className="hose-section-badge">
            {rows.length} sizes · Dash {first.dashLabel} to {last.dashLabel}
          </span>
        </header>

        <p className="hose-reference-lead">
          All {rows.length} sizes of <strong>601R1</strong> one-wire braided
          hydraulic hose, from {first.nominalInch} ({first.dashLabel}) to{" "}
          {last.nominalInch} ({last.dashLabel}). Select a row to choose that
          size in the order panel above.
        </p>

        <dl className="hose-series-construction-bar">
          <div>
            <dt>Standards</dt>
            <dd>
              {primaryStandard} · {equivalentStandard}
            </dd>
          </div>
          <div>
            <dt>Reinforcement</dt>
            <dd>{reinforcement}</dd>
          </div>
          <div>
            <dt>Temperature Range</dt>
            <dd>{temperatureRange}</dd>
          </div>
          <div>
            <dt>Fluid Compatibility</dt>
            <dd>{fluidCompatibility}</dd>
          </div>
        </dl>

        <div className="hose-spec-table-scroll">
          <table className="hose-spec-table">
            <caption>
              601R1 dimensions, pressure ratings, bend radii and weights for all{" "}
              {rows.length} sizes.
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  Dash
                  <span>Size</span>
                </th>
                <th scope="col">
                  Nominal ID
                  <span>Inch</span>
                </th>
                <th scope="col">
                  Metric Size
                  <span>mm</span>
                </th>
                <th scope="col">
                  Outside Dia.
                  <span>OD (mm)</span>
                </th>
                <th scope="col">
                  Max Working Pressure
                  <span>psi / bar</span>
                </th>
                <th scope="col">
                  Min Burst Pressure
                  <span>psi / bar</span>
                </th>
                <th scope="col">
                  Min Bend
                  <span>Radius (mm)</span>
                </th>
                <th scope="col">
                  Weight
                  <span>kg/m</span>
                </th>
                {showAssembly ? (
                  <th scope="col">
                    Online Assembly
                    <span>Build a Hose</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected =
                  selectionComplete && row.sku === selected.sku;
                return (
                  <tr
                    className={isSelected ? "is-selected" : undefined}
                    data-spec-row-dash={row.dash ?? undefined}
                    key={row.sku}
                    onClick={() => selectSku(row.sku)}
                  >
                    <th scope="row">
                      <button
                        aria-label={`Select Dash ${row.dashLabel} (${row.nominalId})`}
                        className="hose-spec-row-select"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectSku(row.sku);
                        }}
                        type="button"
                      >
                        {row.dashLabel}
                      </button>
                    </th>
                    <td className="hose-spec-nominal">{row.nominalId}</td>
                    <td className="hose-spec-num">{row.metricSizeMm ?? "—"}</td>
                    <td className="hose-spec-num">{row.odMm}</td>
                    <td className="hose-spec-pressure">
                      <strong>{row.workingPressure}</strong>
                    </td>
                    <td className="hose-spec-pressure">{row.burstPressure}</td>
                    <td className="hose-spec-num">{row.bendRadius}</td>
                    <td className="hose-spec-num">{row.weight}</td>
                    {showAssembly ? (
                      <td className="hose-spec-assembly">
                        {row.onlineAssembly ? "Yes" : "Manual quote"}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {showAssembly && hoseOnlySizes.length > 0 ? (
          <p className="hose-spec-table-footnote">
            Online Assembly: sizes marked Yes have matching crimp hose ends in
            Build a Hose. The others are sold as cut-length hose; contact our
            team for a manual assembly quote.
          </p>
        ) : null}
      </section>

      {/* Block 2: Sizing Guide — Dash Conversion */}
      <section
        aria-labelledby="hose-selection-guide-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">Sizing Guide</span>
            <h2 id="hose-selection-guide-heading">Dash Size Conversion</h2>
          </div>
          <span className="hose-section-badge">
            Dash &divide; 16 · Metric Size
          </span>
        </header>

        <div className="hose-guide-stack">
          <article className="hose-guide-card">
            <div className="hose-guide-card-header">
              <span className="eyebrow">Identify the Size</span>
              <h3>How Dash Sizes Convert to Inches and Millimetres</h3>
            </div>
            <div className="hose-conversion-copy">
              <p>
                Dash numbers give the nominal inside diameter in sixteenths of
                an inch: <code>-4 = 4/16&quot; = 1/4&quot;</code>,{" "}
                <code>-6 = 3/8&quot;</code>, <code>-8 = 1/2&quot;</code>,{" "}
                <code>-12 = 3/4&quot;</code> and <code>-16 = 1&quot;</code>.
              </p>
              <p>
                The Metric Size column gives the same nominal size in
                millimetres, as EN 853 designates it: {metricAt("-6")} for -6,{" "}
                {metricAt("-8")} for -8. Neither number is a measurement; each
                size has an inside-diameter tolerance. For -8 the factory&apos;s
                range is 12.3 to 13.5 mm, so a hose measuring 12.7 mm (exactly
                1/2&quot;) is a normal -8. Match a measured hose to the nearest
                size, not to an exact conversion.
              </p>
              <p className="hose-conversion-callout">
                Measure the inside of the hose, not the cover: -4 is{" "}
                {at("-4")?.odMm ?? "—"} across the cover, about 1/2&quot;, but
                it is a 1/4&quot; hose.
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* Block 3: Series-Specific Q&A + 3 Internal Links */}
      <section
        aria-labelledby="hose-series-qa-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">601R1 Series Technical Q&amp;A</span>
            <h2 id="hose-series-qa-heading">
              SAE 100R1AT (601R1) Ordering &amp; Engineering Questions
            </h2>
          </div>
          <span className="hose-section-badge">
            {questions.length} Questions
          </span>
        </header>

        <div className="hose-qa-list">
          {questions.map(({ answer, question }, index) => (
            <article className="hose-qa-item" key={question}>
              <h3>
                {index + 1}. {question}
              </h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>

        <nav
          aria-label="Related hose tools and series"
          className="hose-next-steps-links"
        >
          <Link className="hose-next-step-card" to="/build-a-hose">
            <span className="eyebrow">Custom Assembly Configurator</span>
            <strong>Build a Hose Assembly by Length</strong>
            <span>
              {showAssembly && assemblySizes.length > 0
                ? `Configure 601R1 in ${formatList(assemblySizes)} with crimped hose ends.`
                : "Configure a 601R1 hose assembly with crimped hose ends."}
            </span>
          </Link>
          <Link
            className="hose-next-step-card"
            to="/assembly-measurement-guide"
          >
            <span className="eyebrow">Replacement Measurement Guide</span>
            <strong>How to Measure an Old Hose Assembly</strong>
            <span>
              Verify overall assembly length (OAL), sealing seat points, fitting
              orientation and hose ID before ordering.
            </span>
          </Link>
          <Link
            className="hose-next-step-card"
            to="/catalog/hydraulic-hose/601r2"
          >
            <span className="eyebrow">Higher-Pressure 2-Wire Alternative</span>
            <strong>Step Up to 601R2 (SAE 100R2AT / EN 853 2SN)</strong>
            <span>
              Compare 2-wire braided specifications when your working pressure
              exceeds 601R1 limits at the same hose bore.
            </span>
          </Link>
        </nav>
      </section>
    </div>
  );
}
