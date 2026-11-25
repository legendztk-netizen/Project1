import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import {
  compareDashSizes,
  type DashSize,
} from "../../catalog/domain/dash-size";
import {
  fittingLineOfSeriesCode,
  type FittingLine,
} from "../../catalog/domain/fitting-line";
import { hoseEndThread } from "../../catalog/domain/hose-end-presentation";
import {
  sortedCompatibleHoses,
  type CompatibleHose,
} from "../../catalog/domain/hose-name";
import type {
  PublicCatalogFamily,
  PublicCatalogFamilySummary,
  PublicCatalogItem,
} from "../../catalog/domain/public-catalog";
import {
  resolveHoseEndInterfaceFilter,
  hoseEndInterfaceFilters,
} from "../domain/catalog-pagination";
import { displayDash, hoseSizeLabel } from "../domain/variant-label";
import { formatDualPressure } from "./hose-series-reference";

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

/** `1/4"`, `1-1/4"` or `2"`: nominal fraction from Dash ÷ 16. */
function formatNominalInch(dash: DashSize | null) {
  const label = hoseSizeLabel(null, dash);
  return label ? `${label.replace(/\s+in$/, "").replace(/\s+/g, "-")}"` : null;
}

function formatDashWithInch(dash: DashSize | null, dashLabel: string) {
  const nominal = formatNominalInch(dash);
  return nominal ? `${dashLabel} (${nominal})` : dashLabel;
}

function formatList(items: readonly string[], conjunction = "and") {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

function uniqueOrderedDashes(dashes: readonly (DashSize | null)[]): DashSize[] {
  return [
    ...new Set(dashes.filter((dash): dash is DashSize => dash !== null)),
  ].toSorted(compareDashSizes);
}

interface CrimpProfile {
  crimpSummary: string;
  isStainless: boolean;
  requiresExternalSkive: boolean;
  shortStyle: string;
  skiveLabel: string;
}

/** Customer-facing crimp descriptions per ADR 0056 and CONTEXT.md (internal line codes never shown). */
const CRIMP_PROFILES: Readonly<Record<FittingLine, CrimpProfile>> = {
  B: {
    crimpSummary: "One-Piece Braided Crimp",
    isStainless: false,
    requiresExternalSkive: false,
    shortStyle: "Braided",
    skiveLabel: "No-Skive",
  },
  W: {
    crimpSummary: "One-Piece Bite-the-Wire Crimp",
    isStainless: false,
    requiresExternalSkive: false,
    shortStyle: "Bite-the-Wire",
    skiveLabel: "No-Skive",
  },
  JJ: {
    crimpSummary: "One-Piece Skive Crimp",
    isStainless: false,
    requiresExternalSkive: true,
    shortStyle: "Skive",
    skiveLabel: "External Skive",
  },
  SS: {
    crimpSummary: "Stainless One-Piece Braided Crimp",
    isStainless: true,
    requiresExternalSkive: false,
    shortStyle: "Stainless Braided",
    skiveLabel: "No-Skive",
  },
  SSW: {
    crimpSummary: "Stainless One-Piece Bite-the-Wire Crimp",
    isStainless: true,
    requiresExternalSkive: false,
    shortStyle: "Stainless Bite-the-Wire",
    skiveLabel: "No-Skive",
  },
};

export function resolveHoseEndFittingLine(
  item: PublicCatalogItem,
): FittingLine | null {
  for (const candidate of [item.sku, ...item.aliases]) {
    const line = fittingLineOfSeriesCode(candidate);
    if (line) return line;
  }
  return null;
}

export interface HoseEndSiblingSummary {
  baseName: string;
  crimpStyle: string;
  familyKey: string;
  familyName: string;
  sameShape: boolean;
  variantCount: number;
}

/** Extracts compact sibling metadata on the server so the full 116-family summary list is not sent to the client. */
export function selectHoseEndSiblings(
  current: PublicCatalogFamily,
  summaries: readonly PublicCatalogFamilySummary[],
): HoseEndSiblingSummary[] {
  const currentMediaKey = current.representative.mediaKey;
  const toSibling = (
    summary: PublicCatalogFamilySummary,
    sameShape: boolean,
  ): HoseEndSiblingSummary => {
    const line = resolveHoseEndFittingLine(summary.representative);
    return {
      baseName: summary.representative.familyName,
      crimpStyle: line ? CRIMP_PROFILES[line].shortStyle : "Standard",
      familyKey: summary.familyKey,
      familyName: summary.familyName,
      sameShape,
      variantCount: summary.variantCount,
    };
  };

  const sameShape = currentMediaKey
    ? summaries
        .filter(
          (candidate) =>
            candidate.familyKey !== current.familyKey &&
            candidate.representative.mediaKey === currentMediaKey,
        )
        .map((candidate) => toSibling(candidate, true))
    : [];
  if (sameShape.length > 0) return sameShape;

  const sameInterface = summaries.find(
    (candidate) =>
      candidate.familyKey !== current.familyKey &&
      candidate.interfaceGroup !== null &&
      candidate.interfaceGroup === current.interfaceGroup,
  );
  return sameInterface ? [toSibling(sameInterface, false)] : [];
}

export interface HoseEndSpecTableRow {
  compatibleHoses: CompatibleHose[];
  compatibleShortList: string;
  connectionDash: DashSize | null;
  connectionDashLabel: string;
  connectionSizeLabel: string;
  cutoffB: string | null;
  dimensionA: string | null;
  hex1: string | null;
  hoseTailDash: DashSize | null;
  hoseTailDashLabel: string;
  hoseTailSizeLabel: string;
  isSameDash: boolean;
  maxWorkingPressure: string | null;
  pairingCode: string;
  pairingType: "Same dash" | "Jump size";
  portSpec: string;
  sku: string;
  thread: string | null;
}

export function buildHoseEndSpecTableRows(
  family: PublicCatalogFamily,
): HoseEndSpecTableRow[] {
  const repSeal = findSpecValue(family.representative, "Sealing form");
  const repStandard = findSpecValue(
    family.representative,
    "Connection standard",
  );
  return family.variants
    .flatMap((variant) =>
      variant.variantSelection?.kind === "hose_end"
        ? [{ selection: variant.variantSelection, variant }]
        : [],
    )
    .toSorted(
      (left, right) =>
        compareDashSizes(
          left.selection.connectionDash,
          right.selection.connectionDash,
        ) ||
        compareDashSizes(
          left.selection.hoseTailDash,
          right.selection.hoseTailDash,
        ) ||
        left.variant.sku.localeCompare(right.variant.sku),
    )
    .map(({ selection, variant }) => {
      const connectionDashLabel = displayDash(selection.connectionDash);
      const hoseTailDashLabel = displayDash(selection.hoseTailDash);
      const isSameDash = Boolean(
        selection.connectionDash &&
        selection.hoseTailDash &&
        selection.connectionDash === selection.hoseTailDash,
      );
      const cleanThread = hoseEndThread(selection.thread);
      const compatibleHoses = sortedCompatibleHoses(
        selection.compatibleHoses ?? [],
      );
      const workingBar = parseLeadingNumber(
        findSpecValue(variant, "Maximum working pressure"),
      );
      const sealFallback =
        findSpecValue(variant, "Sealing form") ??
        repSeal ??
        repStandard ??
        "Port connection";
      return {
        compatibleHoses,
        compatibleShortList: compatibleHoses.length
          ? compatibleHoses.map((hose) => hose.shortName).join(", ")
          : "Confirm in quote",
        connectionDash: selection.connectionDash,
        connectionDashLabel,
        connectionSizeLabel: formatDashWithInch(
          selection.connectionDash,
          connectionDashLabel,
        ),
        cutoffB: findSpecValue(variant, "Cutoff B"),
        dimensionA: findSpecValue(variant, "Dimension A"),
        hex1: findSpecValue(variant, "Hex 1"),
        hoseTailDash: selection.hoseTailDash,
        hoseTailDashLabel,
        hoseTailSizeLabel: formatDashWithInch(
          selection.hoseTailDash,
          hoseTailDashLabel,
        ),
        isSameDash,
        maxWorkingPressure:
          workingBar !== null ? formatDualPressure(null, workingBar) : null,
        pairingCode: `${connectionDashLabel} × ${hoseTailDashLabel}`,
        pairingType: isSameDash ? "Same dash" : "Jump size",
        portSpec: cleanThread ?? sealFallback,
        sku: variant.sku,
        thread: cleanThread,
      };
    });
}

const CORE_HOSE_PATHS: Readonly<Record<string, string>> = {
  R1: "/catalog/hydraulic-hose/601r1",
  R2: "/catalog/hydraulic-hose/601r2",
  R4: "/catalog/hydraulic-hose/601r4",
  R16: "/catalog/hydraulic-hose/601r16",
  R17: "/catalog/hydraulic-hose/601r17",
  "4SH": "/catalog/hydraulic-hose/en4sh",
};

function renderHoseLinks(hoses: readonly CompatibleHose[]) {
  if (!hoses.length) return "compatible hydraulic hoses";
  return hoses.map((hose, index) => {
    const label = hose.standard
      ? `${hose.standard} (${hose.shortName})`
      : hose.shortName;
    const to = CORE_HOSE_PATHS[hose.shortName];
    const separator =
      index === 0 ? "" : index === hoses.length - 1 ? " and " : ", ";
    return (
      <span key={hose.shortName}>
        {separator}
        {to ? <Link to={to}>{label}</Link> : label}
      </span>
    );
  });
}

interface Question {
  answer: ReactNode;
  question: string;
}

function interfacePortGuide(
  interfaceName: string,
  connectionStandard: string | null,
  sealingForm: string | null,
  threadSample: string | null,
  lengthProfile: string | null,
  angle: string | null,
) {
  const dropNote = lengthProfile ? (
    <p>
      This series uses a <strong>{lengthProfile}</strong> drop profile
      {angle ? ` (${angle})` : ""} so parallel hoses can clear adjacent fittings
      or manifold ports without rubbing.
    </p>
  ) : null;

  switch (interfaceName) {
    case "JIC 37°":
      return (
        <>
          <p>
            <strong>Connection Dash</strong> sizes the <code>SAE J514</code> 37°
            flare cone connection (straight Unified thread
            {threadSample ? (
              <>
                , such as <code>{threadSample}</code>
              </>
            ) : null}
            ), sealing metal-to-metal on the 37° cone rather than on the
            threads.
          </p>
          <p>
            <strong>Hose Tail Dash</strong> gives nominal hose inside diameter
            in sixteenths of an inch (<code>-4 = 1/4&quot;</code>,{" "}
            <code>-8 = 1/2&quot;</code>, <code>-16 = 1&quot;</code>) and must
            match the hose Dash size 1-for-1.
          </p>
          {dropNote}
        </>
      );
    case "ORFS":
      return (
        <>
          <p>
            <strong>Connection Dash</strong> sizes the <code>SAE J1453</code>{" "}
            O-Ring Face Seal end (straight Unified thread
            {threadSample ? (
              <>
                , such as <code>{threadSample}</code>
              </>
            ) : null}
            ), where a flat sealing face mates against the face O-ring of the
            opposing ORFS connector.
          </p>
          <p>
            <strong>Hose Tail Dash</strong> gives nominal hose inside diameter
            in sixteenths of an inch and must equal the hose Dash size; jump
            sizes change only the port end.
          </p>
          {dropNote}
        </>
      );
    case "NPTF":
      return (
        <>
          <p>
            <strong>Connection Dash</strong> sizes the <code>SAE J476</code>{" "}
            Dryseal tapered pipe end
            {threadSample ? (
              <>
                {" "}
                (such as <code>{threadSample}</code>)
              </>
            ) : null}
            , which seals by tapered thread flank and crest-to-root interference
            without a flare cone or O-ring.
          </p>
          <p>
            <strong>Hose Tail Dash</strong> states nominal hose inside diameter
            in sixteenths of an inch and must match the hose Dash size directly.
          </p>
          {dropNote}
        </>
      );
    case "NPSM":
      return (
        <>
          <p>
            <strong>Connection Dash</strong> sizes the straight{" "}
            <code>NPSM</code> female pipe swivel nut
            {threadSample ? (
              <>
                {" "}
                (such as <code>{threadSample}</code>)
              </>
            ) : null}
            , which seals on an internal 60° cone seat against a chamfered male
            NPT/NPTF pipe adapter rather than by thread taper.
          </p>
          <p>
            <strong>Hose Tail Dash</strong> states nominal hose inside diameter
            in sixteenths of an inch and must match the hose Dash size directly.
          </p>
          {dropNote}
        </>
      );
    case "ORB":
      return (
        <>
          <p>
            <strong>Connection Dash</strong> sizes the <code>SAE J1926-1</code>{" "}
            straight-thread O-ring boss male end
            {threadSample ? (
              <>
                {" "}
                (such as <code>{threadSample}</code>)
              </>
            ) : null}
            , which seals via an O-ring compressed into a female SAE boss port
            chamfer.
          </p>
          <p>
            <strong>Hose Tail Dash</strong> states nominal hose inside diameter
            in sixteenths of an inch and must match the hose Dash size 1-for-1.
          </p>
          {dropNote}
        </>
      );
    case "BSPP":
    case "BSPP Flat Face":
    case "BSPT":
      return (
        <>
          <p>
            <strong>Connection Dash</strong> sizes the British Standard Pipe
            connection ({connectionStandard ?? interfaceName}
            {sealingForm ? `, ${sealingForm.toLowerCase()}` : ""}
            {threadSample ? (
              <>
                , such as <code>{threadSample}</code>
              </>
            ) : null}
            ). Do not interchange 55° BSP threads with 60° NPTF or UNF ports.
          </p>
          <p>
            <strong>Hose Tail Dash</strong> states nominal hose inside diameter
            in sixteenths of an inch and must match the hose Dash size directly.
          </p>
          {dropNote}
        </>
      );
    case "SAE Code 61":
    case "SAE Code 62":
    case "Caterpillar Flange":
      return (
        <>
          <p>
            <strong>Connection Dash</strong> gives the nominal 4-bolt flange
            head size ({connectionStandard ?? interfaceName}), sealing via a
            captive O-ring on the flat flange face under split-flange clamp
            halves rather than by threads. Verify flange head diameter and
            thickness before mixing Code 61, Code 62 and Caterpillar flanges.
          </p>
          <p>
            <strong>Hose Tail Dash</strong> states nominal hose inside diameter
            in sixteenths of an inch and must match the hose Dash size 1-for-1.
          </p>
          {dropNote}
        </>
      );
    default:
      return (
        <>
          <p>
            <strong>Connection Dash</strong> sizes the{" "}
            {connectionStandard ?? interfaceName} end
            {sealingForm &&
            (!connectionStandard ||
              sealingForm.toLowerCase() !== connectionStandard.toLowerCase())
              ? ` (${sealingForm.toLowerCase()})`
              : ""}
            {threadSample ? (
              <>
                , such as <code>{threadSample}</code>
              </>
            ) : null}
            .
          </p>
          <p>
            <strong>Hose Tail Dash</strong> gives nominal hose inside diameter
            in sixteenths of an inch (<code>-4 = 1/4&quot;</code>,{" "}
            <code>-8 = 1/2&quot;</code>, <code>-16 = 1&quot;</code>) and must
            match the hose Dash size 1-for-1.
          </p>
          {dropNote}
        </>
      );
  }
}

function crimpLineGuide(
  profile: CrimpProfile | null,
  familyHoses: readonly CompatibleHose[],
) {
  const hoseNames = familyHoses.length
    ? formatList(familyHoses.map((hose) => hose.shortName))
    : "compatible hydraulic";
  if (!profile) {
    return (
      <p>
        Select the hose tail Dash that matches your hose bore, and confirm exact
        crimp compatibility during quote review.
      </p>
    );
  }
  if (profile.requiresExternalSkive) {
    return (
      <>
        <p>
          Every SKU in this series is a <strong>one-piece skive</strong> fitting
          with a factory-attached ferrule — no separate loose ferrule is
          ordered.
        </p>
        <p>
          Designed for heavy spiral wire reinforcement ({hoseNames} hose), the
          outer rubber cover must be skived to the specified length before
          crimping so the ferrule teeth lock directly onto the steel wire plies.
        </p>
      </>
    );
  }
  if (profile.shortStyle.includes("Bite-the-Wire")) {
    return (
      <>
        <p>
          Every SKU in this series is a{" "}
          <strong>
            {profile.isStainless ? "stainless " : ""}one-piece bite-the-wire
          </strong>{" "}
          fitting with a pre-attached ferrule — no separate ferrule SKU is
          needed.
        </p>
        <p>
          It installs <strong>no-skive</strong> over {hoseNames} hose sizes
          listed in the table: internal ferrule serrations bite through the
          outer cover to grip the wire reinforcement during crimping.
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        Every SKU in this series is a{" "}
        <strong>
          {profile.isStainless ? "stainless " : ""}one-piece braided
        </strong>{" "}
        crimp fitting with a factory-attached ferrule — no separate loose
        ferrule is needed.
      </p>
      <p>
        It installs <strong>no-skive</strong> directly over the hose cover on{" "}
        {hoseNames} hose sizes listed in the compatibility column above.
      </p>
    </>
  );
}

function isAngledEnd(angle: string | null) {
  if (!angle) return false;
  const match = /^(\d+)°/.exec(angle.trim());
  return match ? Number(match[1]) > 0 : false;
}

function interfaceFilterHref(interfaceGroup: string | null) {
  const match = hoseEndInterfaceFilters.find(
    (option) => option.interfaceGroup === interfaceGroup,
  );
  return match
    ? `/catalog/hose-ends?interface=${match.id}`
    : resolveHoseEndInterfaceFilter(interfaceGroup)?.id
      ? `/catalog/hose-ends?interface=${resolveHoseEndInterfaceFilter(interfaceGroup)!.id}`
      : "/catalog/hose-ends";
}

export function HoseEndSeriesReference({
  family,
  hoseEndSiblings = [],
  selected,
  selectionComplete,
  selectSku,
}: {
  family: PublicCatalogFamily;
  hoseEndSiblings?: readonly HoseEndSiblingSummary[];
  selected: PublicCatalogItem;
  selectionComplete: boolean;
  selectSku: (sku: string) => void;
}) {
  const repSelection = family.representative.variantSelection;
  if (repSelection?.kind !== "hose_end") return null;

  const rows = buildHoseEndSpecTableRows(family);
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return null;

  const rep = family.representative;
  const baseFamilyName = rep.familyName;
  const fittingLine = resolveHoseEndFittingLine(rep);
  const crimpProfile = fittingLine ? CRIMP_PROFILES[fittingLine] : null;

  const interfaceName =
    findSpecValue(rep, "Interface family") ??
    family.interfaceGroup ??
    "Hose End";
  const connectionStandard = findSpecValue(rep, "Connection standard");
  const sealingForm = findSpecValue(rep, "Sealing form");
  const gender = findSpecValue(rep, "Gender");
  const swivelForm = findSpecValue(rep, "Form");
  const angle = findSpecValue(rep, "Angle");
  const lengthProfile = findSpecValue(rep, "Length profile");
  const storedMaterial = findSpecValue(rep, "Material");

  const connDashes = uniqueOrderedDashes(rows.map((row) => row.connectionDash));
  const tailDashes = uniqueOrderedDashes(rows.map((row) => row.hoseTailDash));
  const [connFilter, setConnFilter] = useState<DashSize | null>(null);

  useEffect(() => {
    setConnFilter(null);
  }, [family.familyKey]);

  const visibleRows = connFilter
    ? rows.filter((row) => row.connectionDash === connFilter)
    : rows;

  const sameDashRows = rows.filter((row) => row.isSameDash);
  const jumpRows = rows.filter((row) => !row.isSameDash);
  const hasThreads = rows.some((row) => row.thread !== null);
  const showPressure = rows.some((row) => row.maxWorkingPressure !== null);
  const showDimensionA = rows.some((row) => row.dimensionA !== null);
  const showCutoffB = rows.some((row) => row.cutoffB !== null);
  const showHex1 = rows.some((row) => row.hex1 !== null);

  const familyHoses = sortedCompatibleHoses(
    rows.flatMap((row) => row.compatibleHoses),
  );
  const familyHoseShortNames = familyHoses.map((hose) => hose.shortName);

  // Group tail sizes by exact compatible-hose set so Q1 explains size-specific hose pairing when it varies.
  const hoseSetByTail = new Map<DashSize, string>();
  for (const row of rows) {
    if (row.hoseTailDash && row.compatibleHoses.length > 0) {
      hoseSetByTail.set(row.hoseTailDash, row.compatibleShortList);
    }
  }
  const distinctTailSets = new Map<string, DashSize[]>();
  for (const [tail, hoseSet] of hoseSetByTail) {
    const bucket = distinctTailSets.get(hoseSet) ?? [];
    bucket.push(tail);
    distinctTailSets.set(hoseSet, bucket);
  }

  const sameShapeSiblings = hoseEndSiblings.filter((item) => item.sameShape);
  const primarySibling = hoseEndSiblings[0] ?? null;
  const angled = isAngledEnd(angle);

  const fourthQuestion: Question =
    sameShapeSiblings.length > 0
      ? {
          question: `How does this series differ from our other ${interfaceName} ${angle ?? ""} crimp options?`,
          answer: (
            <>
              This page lists the{" "}
              <strong>{crimpProfile?.shortStyle ?? "Standard"}</strong> (
              {crimpProfile?.skiveLabel.toLowerCase() ?? "crimp"}) version
              {familyHoseShortNames.length > 0
                ? ` for ${formatList(familyHoseShortNames)} hose`
                : ""}
              . For the same fitting shape in another crimp construction or
              material, see{" "}
              {sameShapeSiblings.map((sibling, index) => (
                <span key={sibling.familyKey}>
                  {index === 0
                    ? ""
                    : index === sameShapeSiblings.length - 1
                      ? " or "
                      : ", "}
                  <Link to={`/catalog/hose-ends/${sibling.familyKey}`}>
                    {sibling.familyName}
                  </Link>
                </span>
              ))}
              .
            </>
          ),
        }
      : angled
        ? {
            question: `How are overall length and orientation measured on ${angle} hose assemblies?`,
            answer: (
              <>
                Finished Overall Assembly Length (OAL) is measured between each
                fitting&apos;s sealing or centerline reference point rather than
                raw cut hose length. When both ends of an assembly use angled
                fittings, relative orientation (Clocking) is specified from{" "}
                <code>000°</code> to <code>359°</code> clockwise; see our{" "}
                <Link to="/assembly-measurement-guide">
                  Assembly Measurement Guide
                </Link>
                .
              </>
            ),
          }
        : {
            question: `How does the ${interfaceName} connection seal against its mating port?`,
            answer: (
              <>
                This {baseFamilyName} conforms to{" "}
                <strong>{connectionStandard ?? interfaceName}</strong>
                {sealingForm
                  ? ` and uses a ${sealingForm.toLowerCase()} seal`
                  : ""}
                .{" "}
                {hasThreads
                  ? "Verify both thread pitch and seat geometry before mating with existing port hardware."
                  : "Verify mating flange or weld dimensions against the connection Dash size before installation."}
              </>
            ),
          };

  const questions: Question[] = [
    {
      question: `Which hydraulic hoses fit this ${baseFamilyName}?`,
      answer: (
        <>
          {familyHoses.length > 0 ? (
            <>
              Across this series, compatible hydraulic hoses include{" "}
              {renderHoseLinks(familyHoses)}
              {crimpProfile
                ? ` (${crimpProfile.skiveLabel.toLowerCase()} ${crimpProfile.crimpSummary.toLowerCase()})`
                : ""}
              .
              {distinctTailSets.size > 1
                ? ` Pairing varies by hose tail size: ${[
                    ...distinctTailSets.entries(),
                  ]
                    .map(
                      ([hoseList, tails]) =>
                        `tail ${formatList(tails.toSorted(compareDashSizes))} fits ${hoseList}`,
                    )
                    .join("; ")}.`
                : " Every listed tail size in this series pairs with that full hose set."}
            </>
          ) : (
            "Hose compatibility is confirmed per size during quote review."
          )}
        </>
      ),
    },
    {
      question:
        "Does this one-piece hose end include a ferrule, or can I order it pre-crimped on a hose?",
      answer: (
        <>
          Every SKU on this page is a loose one-piece crimp fitting with its
          ferrule pre-attached at the factory — no separate ferrule SKU is
          required. Assembly requires calibrated hydraulic crimping dies and
          proof testing; if you want a finished, projectile-cleaned and
          proof-tested hose assembly, configure it in{" "}
          <Link to="/build-a-hose">Build a Hose</Link>.
        </>
      ),
    },
    {
      question:
        "Which equal-dash and jump-size port-to-hose combinations are offered?",
      answer:
        rows.length === 1
          ? `This series offers ${first.pairingCode} (${interfaceName} ${first.connectionSizeLabel} to ${first.hoseTailSizeLabel} hose tail).`
          : `This series includes ${rows.length} size combinations: ${sameDashRows.length} equal-dash ${sameDashRows.length === 1 ? "size" : "sizes"}${sameDashRows.length > 0 ? ` (${formatList(sameDashRows.map((row) => row.connectionDashLabel))})` : ""} and ${jumpRows.length} jump-size port-to-hose ${jumpRows.length === 1 ? "combination" : "combinations"}. Always match the Hose Tail Dash to the hose bore and the Connection Dash to the mating port.`,
    },
    fourthQuestion,
  ];

  const connRangeLabel =
    connDashes.length > 1
      ? `${connDashes[0]} to ${connDashes.at(-1)}`
      : (connDashes[0] ?? "—");
  const tailRangeLabel =
    tailDashes.length > 1
      ? `${tailDashes[0]} to ${tailDashes.at(-1)}`
      : (tailDashes[0] ?? "—");
  const geometryLabel = [
    gender && gender !== "N/A" ? gender : null,
    swivelForm,
    angle,
    lengthProfile ? `(${lengthProfile})` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const sealBarValue = [
    interfaceName,
    sealingForm && sealingForm.toLowerCase() !== interfaceName.toLowerCase()
      ? sealingForm
      : connectionStandard,
  ]
    .filter(Boolean)
    .join(" · ");

  const firstCard = primarySibling
    ? {
        description: primarySibling.sameShape
          ? `Same ${interfaceName} ${angle ?? ""} geometry in ${primarySibling.crimpStyle} construction (${primarySibling.variantCount} ${primarySibling.variantCount === 1 ? "size" : "sizes"}).`
          : `Browse another ${family.interfaceGroup ?? interfaceName} hose end configuration (${primarySibling.variantCount} ${primarySibling.variantCount === 1 ? "size" : "sizes"}).`,
        eyebrow: primarySibling.sameShape
          ? `Same Shape · ${primarySibling.crimpStyle}`
          : `More ${family.interfaceGroup ?? interfaceName} Hose Ends`,
        title: primarySibling.familyName,
        to: `/catalog/hose-ends/${primarySibling.familyKey}`,
      }
    : {
        description: `Browse every published ${family.interfaceGroup ?? interfaceName} crimp hose end family.`,
        eyebrow: `${family.interfaceGroup ?? "All"} Hose Ends`,
        title: `View All ${family.interfaceGroup ?? ""} Crimp Hose Ends`.trim(),
        to: interfaceFilterHref(family.interfaceGroup),
      };

  const primaryHose = familyHoses[0];
  const primaryHosePath = primaryHose
    ? CORE_HOSE_PATHS[primaryHose.shortName]
    : undefined;
  const thirdCard = angled
    ? {
        description:
          "Check seat-to-centerline overall length (OAL) endpoints and double-elbow clocking angles before ordering.",
        eyebrow: "Replacement Measurement Guide",
        title: "How to Measure Elbow Hose Assemblies",
        to: "/assembly-measurement-guide",
      }
    : primaryHose && primaryHosePath
      ? {
          description: `View full bore, working pressure and bend-radius charts for compatible ${formatList(familyHoseShortNames)} hydraulic hose.`,
          eyebrow: "Compatible Hydraulic Hose",
          title: `Compare ${primaryHose.standard ?? primaryHose.shortName} (${primaryHose.shortName}) Hose Specs`,
          to: primaryHosePath,
        }
      : {
          description:
            "Compare working pressures, bend radii and cut-length options across all hydraulic hose series.",
          eyebrow: "Compatible Hydraulic Hose",
          title: "Browse All Hydraulic Hose Series",
          to: "/catalog/hydraulic-hose",
        };

  const sampleThread = rows.find((row) => row.thread)?.thread ?? null;

  return (
    <div
      className="hose-series-reference hose-end-series-reference"
      data-hose-end-reference={family.familyKey}
    >
      {/* Block 1: Full Port, Hose Tail & Hose Compatibility Table */}
      <section
        aria-labelledby="hose-end-size-chart-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">
              {[
                crimpProfile?.crimpSummary ?? "One-Piece Crimp Hose End",
                connectionStandard,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <h2 id="hose-end-size-chart-heading">
              {baseFamilyName} Size &amp; Hose Compatibility Chart
            </h2>
          </div>
          <span className="hose-section-badge">
            {rows.length} {rows.length === 1 ? "size" : "sizes"} · Tail{" "}
            {tailRangeLabel}
          </span>
        </header>

        <p className="hose-reference-lead">
          {rows.length === 1 ? "Published size" : `All ${rows.length} sizes`} of{" "}
          <strong>{baseFamilyName}</strong>, pairing {interfaceName}{" "}
          {connRangeLabel} with {tailRangeLabel} hose tails
          {familyHoseShortNames.length > 0
            ? ` for ${formatList(familyHoseShortNames)} hydraulic hose`
            : ""}
          . Select a row to choose both end sizes in the order panel above.
        </p>

        <dl className="hose-series-construction-bar">
          <div>
            <dt>Interface &amp; Seal</dt>
            <dd>{sealBarValue}</dd>
          </div>
          <div>
            <dt>End Geometry</dt>
            <dd>{geometryLabel || "Standard"}</dd>
          </div>
          <div>
            <dt>Crimp &amp; Skive Rule</dt>
            <dd>
              {crimpProfile
                ? `${crimpProfile.crimpSummary} · ${crimpProfile.skiveLabel}`
                : "One-piece crimp · Confirm in quote"}
            </dd>
          </div>
          <div>
            <dt>
              {storedMaterial || crimpProfile?.isStainless
                ? "Material & Hoses"
                : "Compatible Hoses"}
            </dt>
            <dd>
              {[
                storedMaterial ??
                  (crimpProfile?.isStainless ? "Stainless steel" : null),
                familyHoseShortNames.length > 0
                  ? `${familyHoseShortNames.join(", ")} Hose`
                  : "Confirmed in quote",
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        </dl>

        {connDashes.length > 1 ? (
          <div
            aria-label={`Filter sizes by ${interfaceName} Connection Dash`}
            className="adapter-filter-bar"
            role="group"
          >
            <span className="adapter-filter-label">Connection Dash:</span>
            <button
              aria-pressed={connFilter === null}
              className="adapter-filter-pill"
              onClick={() => setConnFilter(null)}
              type="button"
            >
              All ({rows.length})
            </button>
            {connDashes.map((dash) => (
              <button
                aria-pressed={connFilter === dash}
                className="adapter-filter-pill"
                data-filter-conn-dash={dash}
                key={dash}
                onClick={() =>
                  setConnFilter((current) => (current === dash ? null : dash))
                }
                type="button"
              >
                {dash}
              </button>
            ))}
          </div>
        ) : null}

        <div className="hose-spec-table-scroll">
          <table className="hose-spec-table adapter-spec-table">
            <caption>
              {baseFamilyName} port sizes, hose tail sizes and compatible
              hydraulic hoses
              {connFilter
                ? ` filtered to Connection Dash ${connFilter} (${visibleRows.length} of ${rows.length} sizes).`
                : ` for all ${rows.length} sizes.`}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  Dash Pair
                  <span>Port × Tail</span>
                </th>
                <th scope="col">
                  Port Connection
                  <span>Dash (Nominal)</span>
                </th>
                <th scope="col">
                  {hasThreads ? "Port Thread" : "Port Sealing Form"}
                  <span>{connectionStandard ?? interfaceName}</span>
                </th>
                <th scope="col">
                  Hose Tail
                  <span>Dash (Hose ID)</span>
                </th>
                <th scope="col">
                  Size Pairing
                  <span>Relation</span>
                </th>
                <th scope="col">
                  Compatible Hoses
                  <span>{crimpProfile?.skiveLabel ?? "By Tail Size"}</span>
                </th>
                {showPressure ? (
                  <th scope="col">
                    Max Working Pressure
                    <span>psi / bar</span>
                  </th>
                ) : null}
                {showCutoffB ? (
                  <th scope="col">
                    Cutoff B<span>mm</span>
                  </th>
                ) : null}
                {showDimensionA ? (
                  <th scope="col">
                    Dimension A<span>mm</span>
                  </th>
                ) : null}
                {showHex1 ? (
                  <th scope="col">
                    Hex
                    <span>mm</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const isSelected =
                  selectionComplete && row.sku === selected.sku;
                return (
                  <tr
                    className={isSelected ? "is-selected" : undefined}
                    data-spec-row-sku={row.sku}
                    key={row.sku}
                    onClick={() => selectSku(row.sku)}
                  >
                    <th scope="row">
                      <button
                        aria-label={`Select Connection Dash ${row.connectionDashLabel} with Hose Tail Dash ${row.hoseTailDashLabel}`}
                        className="hose-spec-row-select"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectSku(row.sku);
                        }}
                        type="button"
                      >
                        {row.pairingCode}
                      </button>
                    </th>
                    <td className="hose-spec-nominal">
                      {row.connectionSizeLabel}
                    </td>
                    <td className="hose-spec-pressure">
                      <strong>{row.portSpec}</strong>
                    </td>
                    <td className="hose-spec-nominal">
                      {row.hoseTailSizeLabel}
                    </td>
                    <td>
                      <span
                        className="adapter-pairing-badge"
                        data-pairing={row.isSameDash ? "same" : "jump"}
                      >
                        {row.pairingType}
                      </span>
                    </td>
                    <td className="hose-spec-pressure">
                      <strong>{row.compatibleShortList}</strong>
                    </td>
                    {showPressure ? (
                      <td className="hose-spec-pressure">
                        {row.maxWorkingPressure ?? "—"}
                      </td>
                    ) : null}
                    {showCutoffB ? (
                      <td className="hose-spec-num">{row.cutoffB ?? "—"}</td>
                    ) : null}
                    {showDimensionA ? (
                      <td className="hose-spec-num">{row.dimensionA ?? "—"}</td>
                    ) : null}
                    {showHex1 ? (
                      <td className="hose-spec-num">{row.hex1 ?? "—"}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hose-spec-table-footnote">
          Compatible hoses are determined per tail size by our one-piece crimp
          pairing rules. Loose crimp hose ends require calibrated crimping
          equipment and proof testing.
        </p>
      </section>

      {/* Block 2: Port-vs-Tail Sizing & One-Piece Crimp Guide */}
      <section
        aria-labelledby="hose-end-sizing-guide-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">Sizing &amp; Crimp Guide</span>
            <h2 id="hose-end-sizing-guide-heading">
              How to Match {interfaceName} Port Size, Hose Tail and Crimp Style
            </h2>
          </div>
          <span className="hose-section-badge">
            Port &times; Tail · {crimpProfile?.skiveLabel ?? "One-Piece Crimp"}
          </span>
        </header>

        <div className="hose-guide-stack">
          <div className="adapter-guide-grid">
            <article className="hose-guide-card">
              <div className="hose-guide-card-header">
                <span className="eyebrow">
                  Two-End Sizing · {connectionStandard ?? interfaceName}
                </span>
                <h3>Port Connection Dash vs Hose Tail Dash</h3>
              </div>
              <div className="hose-conversion-copy">
                {interfacePortGuide(
                  interfaceName,
                  connectionStandard,
                  sealingForm,
                  sampleThread,
                  lengthProfile,
                  angle,
                )}
              </div>
            </article>

            <article className="hose-guide-card">
              <div className="hose-guide-card-header">
                <span className="eyebrow">
                  One-Piece Crimp ·{" "}
                  {crimpProfile?.skiveLabel ?? "Pre-Attached Ferrule"}
                </span>
                <h3>
                  {crimpProfile?.crimpSummary ?? "One-Piece Crimp Construction"}
                </h3>
              </div>
              <div className="hose-conversion-copy">
                {crimpLineGuide(crimpProfile, familyHoses)}
              </div>
            </article>
          </div>

          <p className="hose-conversion-callout">
            <strong>Loose crimp component notice:</strong> One-piece crimp hose
            ends are permanently swaged onto compatible hydraulic hose in a
            calibrated crimping press and cannot be installed by hand like
            reusable field fittings.{" "}
            {sameShapeSiblings[0] ? (
              <>
                Need this exact {interfaceName} {angle ?? ""} shape in{" "}
                <strong>{sameShapeSiblings[0].crimpStyle}</strong> construction?
                Switch to{" "}
                <Link
                  to={`/catalog/hose-ends/${sameShapeSiblings[0].familyKey}`}
                >
                  {sameShapeSiblings[0].familyName}
                </Link>
                , or configure a finished assembly in{" "}
                <Link to="/build-a-hose">Build a Hose</Link>.
              </>
            ) : (
              <>
                If you do not operate a hose crimper, configure a factory-built,
                proof-tested assembly in{" "}
                <Link to="/build-a-hose">Build a Hose</Link>.
              </>
            )}
          </p>
        </div>
      </section>

      {/* Block 3: Technical Q&A + 3 Next-Step Internal Links */}
      <section
        aria-labelledby="hose-end-series-qa-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">{interfaceName} Technical Q&amp;A</span>
            <h2 id="hose-end-series-qa-heading">
              {baseFamilyName} Compatibility &amp; Crimp Questions
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
          aria-label="Related hose end options and assembly tools"
          className="hose-next-steps-links"
        >
          <Link className="hose-next-step-card" to={firstCard.to}>
            <span className="eyebrow">{firstCard.eyebrow}</span>
            <strong>{firstCard.title}</strong>
            <span>{firstCard.description}</span>
          </Link>
          <Link className="hose-next-step-card" to="/build-a-hose">
            <span className="eyebrow">Custom Assembly Configurator</span>
            <strong>Build a Hose Assembly by Length</strong>
            <span>
              {familyHoseShortNames.length > 0
                ? `Configure factory-crimped, proof-tested ${formatList(familyHoseShortNames)} hose assemblies online.`
                : "Configure a factory-crimped, proof-tested hydraulic hose assembly online."}
            </span>
          </Link>
          <Link className="hose-next-step-card" to={thirdCard.to}>
            <span className="eyebrow">{thirdCard.eyebrow}</span>
            <strong>{thirdCard.title}</strong>
            <span>{thirdCard.description}</span>
          </Link>
        </nav>
      </section>
    </div>
  );
}
