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
  bendRadiusMm: number | null;
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
  outsideDiameterMm: number | null;
  sku: string;
  weight: string;
  weightKgM: number | null;
  workingBar: number | null;
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
      const outsideDiameter = findSpecValue(variant, "Outside diameter");
      const weight = findSpecValue(variant, "Weight");
      const nominalIn =
        selection.nominalIdIn ?? nominalInchesFromDash(selection.dash);
      const nominalInch = formatNominalInch(
        selection.nominalIdIn,
        selection.dash,
      );
      return {
        bendRadius: bendRadius ?? "—",
        bendRadiusMm: parseLeadingNumber(bendRadius),
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
        odMm: outsideDiameter ?? "—",
        onlineAssembly: assemblyHoseSkus
          ? assemblyHoseSkus.has(variant.sku)
          : null,
        outsideDiameterMm: parseLeadingNumber(outsideDiameter),
        sku: variant.sku,
        weight: weight ?? "—",
        weightKgM: parseLeadingNumber(weight),
        workingBar: selection.performance.workingBar,
        workingPressure: formatDualPressure(
          selection.performance.workingPsi,
          selection.performance.workingBar,
        ),
      };
    });
}

interface Question {
  answer: ReactNode;
  question: string;
}

type RowPair = readonly [HoseSpecTableRow, HoseSpecTableRow];

/** What a series' text draws on: its own rows and those of the series it compares with. */
interface ReferenceContext {
  at: (dash: DashSize) => HoseSpecTableRow | undefined;
  bendAt: (dash: DashSize) => string;
  /** Rows of another series, when the page loader could read them. */
  compared: (series: string) => readonly HoseSpecTableRow[] | undefined;
  rows: readonly HoseSpecTableRow[];
  series: string;
  showAssembly: boolean;
  sizeAt: (dash: DashSize) => string;
  temperatureRange: string;
}

/**
 * The text one Hose Series shows below its size chart (ADR 0060). Numbers come from catalogue
 * rows; the remaining facts are the factory catalogue's.
 */
interface HoseSeriesContent {
  /** Series whose rows the questions compare with; the page loader reads them. */
  comparedSeries: readonly string[];
  /** The product as the lead sentence names it, such as `one-wire braided hydraulic hose`. */
  noun: string;
  questions: (context: ReferenceContext) => Question[];
  related: { description: string; eyebrow: string; title: string; to: string };
  sizeChartHeading: string;
  /** The sizes and factory facts the dash conversion card cites. */
  sizing: {
    /** The series' smallest size, measured across its cover. */
    cover: {
      dash: DashSize;
      width: (row: HoseSpecTableRow | undefined) => string;
    };
    /** An inside-diameter range from the series' factory catalogue page and the inch size it contains. */
    insideDiameter: { dash: DashSize; exact: string; range: string };
    metricExamples: readonly [DashSize, DashSize];
    /** Where the metric size comes from, such as `as the factory catalogue lists it`. */
    metricSource: string;
  };
  /** The standard as the Q&A heading writes it, such as `SAE 100R1AT`. */
  standardName: string;
}

/** `1/2" (-8)`. */
function sizeName(row: HoseSpecTableRow) {
  return `${row.nominalInch} (${row.dashLabel})`;
}

/** "about 0.6 in": an outside diameter in inches, for the measuring callout. */
function inchesAcross(row: HoseSpecTableRow | undefined) {
  return row?.outsideDiameterMm
    ? `about ${(row.outsideDiameterMm / 25.4).toFixed(1)} in`
    : "—";
}

/** Rows of two series paired by Dash size, for the sizes both list. */
function pairByDash(
  left: readonly HoseSpecTableRow[],
  right: readonly HoseSpecTableRow[],
): RowPair[] {
  return left.flatMap((row) => {
    const match = right.find((other) => other.dash === row.dash);
    return match ? [[row, match] as const] : [];
  });
}

/** True only when every pair has both values and they pass the test. */
function holdsForEvery(
  pairs: readonly RowPair[],
  value: (row: HoseSpecTableRow) => number | null,
  test: (left: number, right: number) => boolean,
) {
  return (
    pairs.length > 0 &&
    pairs.every(([left, right]) => {
      const leftValue = value(left);
      const rightValue = value(right);
      return (
        leftValue !== null && rightValue !== null && test(leftValue, rightValue)
      );
    })
  );
}

function joinSentences(
  sentences: readonly (string | false | null | undefined)[],
) {
  return sentences.filter(Boolean).join(" ");
}

/** The highest and lowest rated rows. */
function pressureExtremes(rows: readonly HoseSpecTableRow[]) {
  const rated = rows
    .filter((row) => row.workingBar !== null)
    .toSorted((left, right) => left.workingBar! - right.workingBar!);
  return { highest: rated.at(-1), lowest: rated[0] };
}

/** `3/4" (-12)`, or "-4, -6 and -8" when several sizes share that row's rating. */
function sizesRatedLike(
  rows: readonly HoseSpecTableRow[],
  rated: HoseSpecTableRow,
) {
  const matching = rows.filter((row) => row.workingBar === rated.workingBar);
  return matching.length > 1
    ? formatList(matching.map((row) => row.dashLabel))
    : sizeName(rated);
}

/** "For 1/2" (-8), 601R2 vs 601R1: 275 vs 160 bar working pressure, …", or null when a value is missing. */
function sizeComparison(
  [left, right]: RowPair,
  leftSeries: string,
  rightSeries: string,
) {
  if (
    left.workingBar === null ||
    right.workingBar === null ||
    left.outsideDiameterMm === null ||
    right.outsideDiameterMm === null ||
    left.weightKgM === null ||
    right.weightKgM === null ||
    left.bendRadiusMm === null ||
    right.bendRadiusMm === null
  ) {
    return null;
  }
  const pressure =
    left.workingBar === right.workingBar
      ? `${left.workingBar} bar working pressure for both`
      : `${left.workingBar} vs ${right.workingBar} bar working pressure`;
  const bend =
    left.bendRadiusMm === right.bendRadiusMm
      ? `${left.bendRadiusMm} mm minimum bend radius for both`
      : `${left.bendRadiusMm} vs ${right.bendRadiusMm} mm minimum bend radius`;
  return `For ${sizeName(left)}, ${leftSeries} vs ${rightSeries}: ${pressure}, ${left.outsideDiameterMm} vs ${right.outsideDiameterMm} mm outside diameter, ${left.weightKgM} vs ${right.weightKgM} kg/m, and ${bend}.`;
}

const COMPARED_VALUES: readonly {
  higher: string;
  lower: string;
  same: string;
  value: (row: HoseSpecTableRow) => number | null;
}[] = [
  {
    higher: "is rated for a higher working pressure",
    lower: "is rated for a lower working pressure",
    same: "working pressure",
    value: (row) => row.workingBar,
  },
  {
    higher: "has a larger outside diameter",
    lower: "has a smaller outside diameter",
    same: "outside diameter",
    value: (row) => row.outsideDiameterMm,
  },
  {
    higher: "needs a larger minimum bend radius",
    lower: "needs a smaller minimum bend radius",
    same: "minimum bend radius",
    value: (row) => row.bendRadiusMm,
  },
  {
    higher: "weighs more",
    lower: "weighs less",
    same: "weight",
    value: (row) => row.weightKgM,
  },
];

/**
 * Sentences comparing two series over the sizes both list. A difference is stated only when
 * every shared size agrees; a mixed working pressure is listed size by size.
 */
function comparisonSentences(
  pairs: readonly RowPair[],
  left: string,
  right: string,
) {
  const first = pairs[0]?.[0];
  const last = pairs.at(-1)?.[0];
  if (!first || !last) return [];
  const differences: string[] = [];
  const shared: string[] = [];
  for (const compared of COMPARED_VALUES) {
    if (holdsForEvery(pairs, compared.value, (a, b) => a > b)) {
      differences.push(compared.higher);
    } else if (holdsForEvery(pairs, compared.value, (a, b) => a < b)) {
      differences.push(compared.lower);
    } else if (holdsForEvery(pairs, compared.value, (a, b) => a === b)) {
      shared.push(compared.same);
    }
  }
  const ratedHigherAt = pairs
    .filter(
      ([a, b]) =>
        a.workingBar !== null &&
        b.workingBar !== null &&
        a.workingBar > b.workingBar,
    )
    .map(([row]) => row.dashLabel);
  const ratedLowerAt = pairs
    .filter(
      ([a, b]) =>
        a.workingBar !== null &&
        b.workingBar !== null &&
        a.workingBar < b.workingBar,
    )
    .map(([row]) => row.dashLabel);
  return [
    differences.length > 0 &&
      `Compared with ${right} at every size both list, from ${sizeName(first)} to ${sizeName(last)}, ${left} ${formatList(differences)}.`,
    ratedHigherAt.length > 0 &&
      ratedLowerAt.length > 0 &&
      `${left} is rated higher than ${right} at ${formatList(ratedHigherAt)} and lower at ${formatList(ratedLowerAt)}.`,
    shared.length > 0 &&
      `Both list the same ${formatList(shared)} at every size they share.`,
  ];
}

/** One series compared with another from their rows, with an example size and a link to the other chart. */
function seriesComparisonQuestion({
  example,
  intro,
  left,
  leftRows,
  question,
  right,
  rightRows,
  to,
}: {
  example: DashSize;
  intro: string;
  left: string;
  leftRows: readonly HoseSpecTableRow[] | undefined;
  question: string;
  right: string;
  rightRows: readonly HoseSpecTableRow[] | undefined;
  to: string;
}): Question[] {
  if (!leftRows?.length || !rightRows?.length) return [];
  const pairs = pairByDash(leftRows, rightRows);
  const examplePair = pairs.find(([row]) => row.dash === example);
  return [
    {
      question,
      answer: (
        <>
          {joinSentences([
            intro,
            ...comparisonSentences(pairs, left, right),
            examplePair ? sizeComparison(examplePair, left, right) : null,
          ])}{" "}
          See every size in the <Link to={to}>{right} size chart</Link>.
        </>
      ),
    },
  ];
}

function assemblyQuestion({
  rows,
  series,
  showAssembly,
}: ReferenceContext): Question[] {
  if (!showAssembly) return [];
  const assemblySizes = rows
    .filter((row) => row.onlineAssembly)
    .map((row) => row.dashLabel);
  const hoseOnlySizes = rows
    .filter((row) => row.onlineAssembly === false)
    .map((row) => row.dashLabel);
  return [
    {
      question: `Which ${series} sizes can be built as hose assemblies online?`,
      answer: (
        <>
          {formatList(assemblySizes)} have matching crimp hose ends and can be
          configured by length in Build a Hose.
          {hoseOnlySizes.length > 0
            ? ` ${formatList(hoseOnlySizes)} are sold as cut-length hose; contact our team for a manual assembly quote.`
            : null}
        </>
      ),
    },
  ];
}

/** Factory usage guide, printed p.53, with two of the series' sizes as examples. */
function bendRadiusQuestion(
  { bendAt, sizeAt }: ReferenceContext,
  [first, second]: readonly [DashSize, DashSize],
): Question {
  return {
    question: "What does the minimum bend radius mean for routing?",
    answer: (
      <>
        It is the tightest bend the hose may take in service: {bendAt(first)}{" "}
        for {sizeAt(first)} and {bendAt(second)} for {sizeAt(second)}. The
        factory&apos;s usage guide says a tighter bend restricts flow and
        shortens hose life, and that bending or twisting the hose right at the
        fitting fatigues the reinforcement.
      </>
    ),
  };
}

/** Factory usage guide, printed p.53. */
const PRESSURE_SPIKE_QUESTION: Question = {
  question: "Does the working pressure include pressure spikes?",
  answer: (
    <>
      Yes. The factory&apos;s usage guide says the pressure in the hose,
      including impulse pressure (a rapid rise in pressure), must not exceed the
      maximum working pressure in the size chart, and that working above it
      shortens hose life.
    </>
  ),
};

/** Factory catalogue p.15 and p.16: 601R1 has one braid, 601R2 two; the comparisons come from rows. */
function r2VersusR1({ compared, rows }: ReferenceContext): Question[] {
  const r1Rows = compared("601R1");
  if (!r1Rows?.length) return [];
  const pairs = pairByDash(rows, r1Rows);
  const upToOneInch = pairs.filter(
    ([row]) => row.nominalIn !== null && row.nominalIn <= 1,
  );
  const from = upToOneInch[0]?.[0];
  const to = upToOneInch.at(-1)?.[0];
  const ratedHigher =
    holdsForEvery(
      upToOneInch,
      (row) => row.workingBar,
      (r2, r1) => r2 > r1,
    ) &&
    holdsForEvery(
      upToOneInch,
      (row) => row.outsideDiameterMm,
      (r2, r1) => r2 > r1,
    ) &&
    holdsForEvery(
      upToOneInch,
      (row) => row.weightKgM,
      (r2, r1) => r2 > r1,
    );
  const sameBend = holdsForEvery(
    pairs,
    (row) => row.bendRadiusMm,
    (r2, r1) => r2 === r1,
  );
  const example = pairs.find(([row]) => row.dash === "-8");
  return [
    {
      question: "What is the difference between R2 and R1 hydraulic hose?",
      answer: (
        <>
          {joinSentences([
            "601R1 has one steel wire braid and is listed under EN 853 1SN and SAE 100R1AT; 601R2 has two braids and is listed under EN 853 2SN and SAE 100R2AT.",
            ratedHigher &&
              from &&
              to &&
              `From ${sizeName(from)} to ${sizeName(to)}, 601R2 is rated for a higher working pressure at every size, with a larger outside diameter and more weight.`,
            sameBend &&
              "The factory lists the same minimum bend radius for both at every size.",
            example ? sizeComparison(example, "601R2", "601R1") : null,
          ])}{" "}
          See every size in the{" "}
          <Link to="/catalog/hydraulic-hose/601r1">601R1 size chart</Link>.
        </>
      ),
    },
  ];
}

/**
 * Factory catalogue p.18: 601R16 is compact, with one or two braids per hose design. Shown on
 * both the 601R2 and the 601R16 page, each linking to the other series' chart.
 */
function r16VersusR2(
  r16Rows: readonly HoseSpecTableRow[] | undefined,
  r2Rows: readonly HoseSpecTableRow[] | undefined,
  link: { label: string; to: string },
): Question[] {
  if (!r16Rows?.length || !r2Rows?.length) return [];
  const pairs = pairByDash(r16Rows, r2Rows);
  const compact =
    pairs.length === r16Rows.length &&
    holdsForEvery(
      pairs,
      (row) => row.workingBar,
      (r16, r2) => r16 === r2,
    ) &&
    holdsForEvery(
      pairs,
      (row) => row.outsideDiameterMm,
      (r16, r2) => r16 < r2,
    ) &&
    holdsForEvery(
      pairs,
      (row) => row.bendRadiusMm,
      (r16, r2) => r16 / r2 >= 0.45 && r16 / r2 <= 0.55,
    ) &&
    holdsForEvery(
      pairs,
      (row) => row.weightKgM,
      (r16, r2) => r16 < r2,
    );
  const example = pairs.find(([row]) => row.dash === "-8");
  return [
    {
      question: "How does 100R16 compare with 100R2?",
      answer: (
        <>
          {joinSentences([
            `601R16 (SAE 100R16) is a compact hose with one or two steel wire braids, depending on the hose design; we offer it in ${formatList(r16Rows.map((row) => row.dashLabel))}.`,
            compact &&
              "At each of these sizes it has the same working pressure in bar as 601R2, a smaller outside diameter, about half the minimum bend radius and less weight.",
            example ? sizeComparison(example, "601R16", "601R2") : null,
          ])}{" "}
          See every size in the <Link to={link.to}>{link.label}</Link>.
        </>
      ),
    },
  ];
}

/** The pressure and bend radius range of the sizes from 1-1/2 inch up, taken from rows as stored. */
function largeBorePressures({
  at,
  rows,
  series,
  showAssembly,
}: ReferenceContext): Question[] {
  const large = rows.filter((row) => (row.nominalIn ?? 0) >= 1.5);
  const first = large[0];
  const last = large.at(-1);
  const byBend = large
    .filter((row) => row.bendRadiusMm !== null)
    .toSorted((left, right) => left.bendRadiusMm! - right.bendRadiusMm!);
  const { highest, lowest } = pressureExtremes(large);
  if (!first || !last || first === last || !lowest || !highest) return [];
  const reference = at("-8");
  const bendFrom = byBend[0];
  const bendTo = byBend.at(-1);
  const online = large
    .filter((row) => row.onlineAssembly)
    .map((row) => row.dashLabel);
  const hoseOnly = large
    .filter((row) => row.onlineAssembly === false)
    .map((row) => row.dashLabel);
  return [
    {
      question: `What working pressures do the large-bore ${series} sizes (${first.dashLabel} to ${last.dashLabel}) carry?`,
      answer: joinSentences([
        `Between ${lowest.workingPressure} and ${highest.workingPressure}${reference ? `, against ${reference.workingPressure} for ${sizeName(reference)}` : ""}${bendFrom && bendTo ? `; the minimum bend radius is ${bendFrom.bendRadius} to ${bendTo.bendRadius}` : ""}.`,
        showAssembly &&
          online.length > 0 &&
          hoseOnly.length > 0 &&
          `${formatList(online)} can be built online; ${formatList(hoseOnly)} are sold as cut-length hose with assemblies quoted by our team.`,
        showAssembly &&
          online.length === 0 &&
          "They are sold as cut-length hose with assemblies quoted by our team.",
        showAssembly &&
          hoseOnly.length === 0 &&
          "All of them can be built online.",
      ]),
    },
  ];
}

/** Factory catalogue p.34: 601R4 is rated for low-pressure and vacuum service only. */
function suctionAndReturnQuestion({ rows }: ReferenceContext): Question[] {
  const { highest, lowest } = pressureExtremes(rows);
  if (!highest || !lowest || highest === lowest) return [];
  return [
    {
      question: "Can 601R4 be used as a suction and return hose?",
      answer: `The factory catalogue rates 601R4 for low-pressure and vacuum service and gives no separate rating for return lines. Whatever the line, the pressure in the hose must stay within the working pressure in the size chart: ${highest.workingPressure} for ${sizesRatedLike(rows, highest)} down to ${lowest.workingPressure} for ${sizesRatedLike(rows, lowest)}.`,
    },
  ];
}

/** Factory catalogue p.19 lists 601R17 as a 21 MPa hose; the sentence holds only while every row agrees. */
function r17WorkingPressureQuestion({
  rows,
  series,
}: ReferenceContext): Question[] {
  const first = rows[0];
  const last = rows.at(-1);
  const { highest, lowest } = pressureExtremes(rows);
  if (!first || !last || !highest || !lowest) return [];
  const uniform =
    rows.every((row) => row.workingBar !== null) &&
    highest.workingBar === lowest.workingBar;
  return [
    {
      question: "What working pressure does 100R17 hydraulic hose carry?",
      answer: uniform
        ? `Every ${series} size, from ${sizeName(first)} to ${sizeName(last)}, has the same maximum working pressure: ${first.workingPressure}. The factory catalogue lists 601R17 as a 21 MPa compact wire-braided hose.`
        : `Working pressure runs from ${highest.workingPressure} for ${sizesRatedLike(rows, highest)} to ${lowest.workingPressure} for ${sizesRatedLike(rows, lowest)}.`,
    },
  ];
}

const EN_853_SIZING: HoseSeriesContent["sizing"] = {
  cover: { dash: "-4", width: inchesAcross },
  insideDiameter: {
    dash: "-8",
    exact: '12.7 mm (exactly 1/2")',
    range: "12.3 to 13.5 mm",
  },
  metricExamples: ["-6", "-8"],
  metricSource: "as EN 853 designates it",
};

const TWO_WIRE_ALTERNATIVE: HoseSeriesContent["related"] = {
  description:
    "Compare the two-wire braided series size by size: outside diameter, bend radius and weight.",
  eyebrow: "Two-Wire Braided Alternative",
  title: "Compare 601R2 (SAE 100R2AT / EN 853 2SN)",
  to: "/catalog/hydraulic-hose/601r2",
};

const COMPACT_ALTERNATIVE: HoseSeriesContent["related"] = {
  description:
    "Compare the compact series size by size: outside diameter, bend radius and weight.",
  eyebrow: "Compact Alternative",
  title: "Compare 601R16 (SAE 100R16)",
  to: "/catalog/hydraulic-hose/601r16",
};

const SERIES_REFERENCE_CONTENT: Readonly<Record<string, HoseSeriesContent>> = {
  "601R1": {
    comparedSeries: [],
    noun: "one-wire braided hydraulic hose",
    questions: (context) => {
      const { bendAt, rows, sizeAt } = context;
      const largeBore = rows.filter((row) => (row.nominalIn ?? 0) >= 1.5);
      const largeFirst = largeBore[0];
      const largeLast = largeBore.at(-1);
      const beyondStandardLargeBore = largeBore
        .filter((row) => (row.nominalIn ?? 0) > 2)
        .map((row) => row.dashLabel);
      return [
        ...assemblyQuestion(context),
        {
          question: "What does the minimum bend radius mean for routing?",
          answer: (
            <>
              It is the tightest bend the hose should take in service:{" "}
              {bendAt("-8")} for {sizeAt("-8")} and {bendAt("-12")} for{" "}
              {sizeAt("-12")}. The rated working pressure and expected service
              life assume the hose is not bent tighter, so check the radius
              against the available space before moving to a larger size.
            </>
          ),
        },
        {
          question: "When should I use 601R2 instead of 601R1?",
          answer: (
            <>
              When the system&apos;s maximum pressure, including the relief
              valve setting and pressure peaks, is above the 601R1 rating for
              the bore you need. 601R2 is two-wire braided (SAE 100R2AT / EN 853
              2SN) and is rated higher at the same size.
            </>
          ),
        },
        ...(largeFirst && largeLast
          ? [
              {
                question: `Are the large-bore sizes (${largeFirst.dashLabel} to ${largeLast.dashLabel}) suitable for high-pressure lines?`,
                answer: (
                  <>
                    No. Working pressure falls from {largeFirst.workingPressure}{" "}
                    on {largeFirst.dashLabel} to {largeLast.workingPressure} on{" "}
                    {largeLast.dashLabel}, and the minimum bend radius rises
                    from {largeFirst.bendRadius} to {largeLast.bendRadius}.
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
    },
    related: {
      description:
        "Compare 2-wire braided specifications when your working pressure exceeds 601R1 limits at the same hose bore.",
      eyebrow: "Higher-Pressure 2-Wire Alternative",
      title: "Step Up to 601R2 (SAE 100R2AT / EN 853 2SN)",
      to: "/catalog/hydraulic-hose/601r2",
    },
    sizeChartHeading:
      "SAE 100R1AT / EN 853 1SN Hydraulic Hose Size Chart & Full Specifications",
    sizing: {
      ...EN_853_SIZING,
      cover: { dash: "-4", width: () => 'about 1/2"' },
    },
    standardName: "SAE 100R1AT",
  },
  "601R2": {
    comparedSeries: ["601R1", "601R16"],
    noun: "two-wire braided hydraulic hose",
    questions: (context) => [
      ...assemblyQuestion(context),
      ...r2VersusR1(context),
      ...r16VersusR2(context.compared("601R16"), context.rows, {
        label: "601R16 size chart",
        to: "/catalog/hydraulic-hose/601r16",
      }),
      bendRadiusQuestion(context, ["-8", "-12"]),
      PRESSURE_SPIKE_QUESTION,
      ...largeBorePressures(context),
    ],
    related: COMPACT_ALTERNATIVE,
    sizeChartHeading:
      "SAE 100R2AT / EN 853 2SN Hydraulic Hose Size Chart & Full Specifications",
    sizing: EN_853_SIZING,
    standardName: "SAE 100R2AT",
  },
  "601R4": {
    comparedSeries: [],
    noun: "wire-inserted hydraulic suction hose",
    questions: (context) => [
      ...assemblyQuestion(context),
      {
        // Factory catalogue p.34.
        question: "What is SAE 100R4 hydraulic hose used for?",
        answer: `The factory catalogue lists 601R4 under SAE 100R4 as a wire-inserted hydraulic suction hose for low-pressure and vacuum applications. Its reinforcement is a ply or plies of woven or braided textile fibre with a spiral of body steel wire, and it carries petroleum-based hydraulic fluids, air and water-based fluids from ${context.temperatureRange}.`,
      },
      ...suctionAndReturnQuestion(context),
      bendRadiusQuestion(context, ["-12", "-32"]),
      PRESSURE_SPIKE_QUESTION,
    ],
    related: {
      description: "Browse every hydraulic hose series we carry.",
      eyebrow: "All Hose Series",
      title: "Compare Every Hydraulic Hose Series",
      to: "/catalog/hydraulic-hose",
    },
    sizeChartHeading:
      "SAE 100R4 Hydraulic Suction Hose Size Chart & Full Specifications",
    sizing: {
      cover: { dash: "-12", width: inchesAcross },
      // Factory catalogue p.34.
      insideDiameter: {
        dash: "-16",
        exact: '25.4 mm (exactly 1")',
        range: "24.6 to 26.2 mm",
      },
      metricExamples: ["-12", "-16"],
      metricSource: "as the factory catalogue lists it",
    },
    standardName: "SAE 100R4",
  },
  "601R16": {
    comparedSeries: ["601R2"],
    noun: "compact wire-braided hydraulic hose",
    questions: (context) => [
      ...assemblyQuestion(context),
      ...r16VersusR2(context.rows, context.compared("601R2"), {
        label: "601R2 size chart",
        to: "/catalog/hydraulic-hose/601r2",
      }),
      bendRadiusQuestion(context, ["-8", "-12"]),
      PRESSURE_SPIKE_QUESTION,
    ],
    related: TWO_WIRE_ALTERNATIVE,
    sizeChartHeading:
      "SAE 100R16 Hydraulic Hose Size Chart & Full Specifications",
    // Factory catalogue p.18 prints the same -8 range as 601R1 and 601R2.
    sizing: {
      ...EN_853_SIZING,
      metricSource: "as the factory catalogue lists it",
    },
    standardName: "SAE 100R16",
  },
  "601R17": {
    comparedSeries: ["601R16"],
    noun: "compact wire-braided hydraulic hose",
    questions: (context) => [
      ...assemblyQuestion(context),
      ...r17WorkingPressureQuestion(context),
      ...seriesComparisonQuestion({
        example: "-8",
        // Factory catalogue p.18 and p.19.
        intro:
          "Both are compact wire-braided hoses in the factory catalogue: 601R17 under SAE 100R17 and 601R16 under SAE 100R16.",
        left: "601R17",
        leftRows: context.rows,
        question: "How does 100R17 compare with 100R16?",
        right: "601R16",
        rightRows: context.compared("601R16"),
        to: "/catalog/hydraulic-hose/601r16",
      }),
      bendRadiusQuestion(context, ["-8", "-12"]),
      PRESSURE_SPIKE_QUESTION,
    ],
    related: COMPACT_ALTERNATIVE,
    sizeChartHeading:
      "SAE 100R17 Hydraulic Hose Size Chart & Full Specifications",
    // Factory catalogue p.19 prints the same -8 range as 601R1 and 601R2.
    sizing: {
      ...EN_853_SIZING,
      metricSource: "as the factory catalogue lists it",
    },
    standardName: "SAE 100R17",
  },
  EN4SH: {
    comparedSeries: ["601R2"],
    noun: "four-spiral hydraulic hose",
    questions: (context) => [
      ...assemblyQuestion(context),
      {
        // Factory catalogue p.2.
        question: "What is EN 856 4SH hydraulic hose?",
        answer: `The factory catalogue lists EN4SH under EN 856 4SH and China's GB/T 10544 4SH as a four-spiral extra-high-pressure hose: an oil- and water-resistant synthetic rubber lining, four spiral plies of steel wire wrapped in alternating directions and an oil- and weather-resistant synthetic rubber cover, for petroleum- and water-based hydraulic fluids from ${context.temperatureRange}.`,
      },
      ...seriesComparisonQuestion({
        example: "-12",
        // Factory catalogue p.2 and p.16.
        intro:
          "601R2 is a two-wire braided hose listed under EN 853 2SN and SAE 100R2AT; EN4SH has four spiral plies of steel wire.",
        left: "EN4SH",
        leftRows: context.rows,
        question:
          "How does 4SH hydraulic hose compare with two-wire braided hose?",
        right: "601R2",
        rightRows: context.compared("601R2"),
        to: "/catalog/hydraulic-hose/601r2",
      }),
      bendRadiusQuestion(context, ["-12", "-32"]),
      PRESSURE_SPIKE_QUESTION,
    ],
    related: TWO_WIRE_ALTERNATIVE,
    sizeChartHeading:
      "EN 856 4SH Hydraulic Hose Size Chart & Full Specifications",
    sizing: {
      cover: { dash: "-12", width: inchesAcross },
      // Factory catalogue p.2.
      insideDiameter: {
        dash: "-16",
        exact: '25.4 mm (exactly 1")',
        range: "25.0 to 26.0 mm",
      },
      metricExamples: ["-12", "-16"],
      metricSource: "as the factory catalogue lists it",
    },
    standardName: "EN 856 4SH",
  },
};

/** The series a Hose Series' reference text compares with, which the page loader reads for it. */
export function hoseSeriesComparedWith(
  series: string | null | undefined,
): readonly string[] {
  return series
    ? (SERIES_REFERENCE_CONTENT[series.toUpperCase()]?.comparedSeries ?? [])
    : [];
}

export function HoseSeriesReference({
  assemblyHoseSkus,
  comparisonRows = {},
  family,
  selected,
  selectionComplete,
  selectSku,
}: {
  assemblyHoseSkus: readonly string[] | null;
  /** Rows of the series named by `hoseSeriesComparedWith`, keyed by series code. */
  comparisonRows?: Readonly<Record<string, readonly HoseSpecTableRow[]>>;
  family: PublicCatalogFamily;
  selected: PublicCatalogItem;
  selectionComplete: boolean;
  selectSku: (sku: string) => void;
}) {
  const repSelection = family.representative.variantSelection;
  if (repSelection?.kind !== "hose") return null;
  const series = repSelection.hoseSeries.toUpperCase();
  const content = SERIES_REFERENCE_CONTENT[series];
  if (!content) return null;

  const rows = buildHoseSpecTableRows(
    family,
    assemblyHoseSkus ? new Set(assemblyHoseSkus) : null,
  );
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return null;
  const at = (dash: DashSize) => rows.find((row) => row.dash === dash);
  const metricAt = (dash: DashSize) => at(dash)?.metricSizeMm ?? "—";
  const showAssembly = rows.every((row) => row.onlineAssembly !== null);
  const assemblySizes = rows
    .filter((row) => row.onlineAssembly)
    .map((row) => row.dashLabel);
  const hoseOnlySizes = rows
    .filter((row) => row.onlineAssembly === false)
    .map((row) => row.dashLabel);
  const { cover, insideDiameter, metricExamples, metricSource } =
    content.sizing;
  const coverRow = at(cover.dash);

  const primaryStandard =
    repSelection.primaryStandard ??
    findSpecValue(family.representative, "Primary standard") ??
    content.standardName;
  // The catalogue stores "N/A" for a series with no equivalent standard.
  const equivalentStandard = [
    repSelection.equivalentStandard,
    findSpecValue(family.representative, "Equivalent standard"),
  ].find((value) => value && !/^n\/a$/i.test(value.trim()));
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

  const questions = content.questions({
    at,
    bendAt: (dash) => at(dash)?.bendRadius ?? "—",
    compared: (code) => comparisonRows[code.toUpperCase()],
    rows,
    series,
    showAssembly,
    sizeAt: (dash) => {
      const row = at(dash);
      return row ? sizeName(row) : dash;
    },
    temperatureRange,
  });

  return (
    <div className="hose-series-reference" data-series-reference={series}>
      {/* Block 1: Full-Size Specification Table */}
      <section
        aria-labelledby="hose-size-chart-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">
              Series {series} ·{" "}
              {[primaryStandard, equivalentStandard]
                .filter(Boolean)
                .join(" / ")}
            </span>
            <h2 id="hose-size-chart-heading">{content.sizeChartHeading}</h2>
          </div>
          <span className="hose-section-badge">
            {rows.length} sizes · Dash {first.dashLabel} to {last.dashLabel}
          </span>
        </header>

        <p className="hose-reference-lead">
          All {rows.length} sizes of <strong>{series}</strong> {content.noun},
          from {first.nominalInch} ({first.dashLabel}) to {last.nominalInch} (
          {last.dashLabel}). Select a row to choose that size in the order panel
          above.
        </p>

        <dl className="hose-series-construction-bar">
          <div>
            <dt>Standards</dt>
            <dd>
              {[primaryStandard, equivalentStandard]
                .filter(Boolean)
                .join(" · ")}
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
              {series} dimensions, pressure ratings, bend radii and weights for
              all {rows.length} sizes.
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
                millimetres, {metricSource}: {metricAt(metricExamples[0])} for{" "}
                {metricExamples[0]}, {metricAt(metricExamples[1])} for{" "}
                {metricExamples[1]}. Neither number is a measurement; each size
                has an inside-diameter tolerance. For {insideDiameter.dash} the
                factory&apos;s range is {insideDiameter.range}, so a hose
                measuring {insideDiameter.exact} is a normal{" "}
                {insideDiameter.dash}. Match a measured hose to the nearest
                size, not to an exact conversion.
              </p>
              <p className="hose-conversion-callout">
                Measure the inside of the hose, not the cover: {cover.dash} is{" "}
                {coverRow?.odMm ?? "—"} across the cover,{" "}
                {cover.width(coverRow)}, but it is a{" "}
                {coverRow?.nominalInch ?? "—"} hose.
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
            <span className="eyebrow">{series} Series Technical Q&amp;A</span>
            <h2 id="hose-series-qa-heading">
              {`${content.standardName} (${series}) Ordering & Engineering Questions`}
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
                ? `Configure ${series} in ${formatList(assemblySizes)} with crimped hose ends.`
                : `Configure a ${series} hose assembly with crimped hose ends.`}
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
          <Link className="hose-next-step-card" to={content.related.to}>
            <span className="eyebrow">{content.related.eyebrow}</span>
            <strong>{content.related.title}</strong>
            <span>{content.related.description}</span>
          </Link>
        </nav>
      </section>
    </div>
  );
}
