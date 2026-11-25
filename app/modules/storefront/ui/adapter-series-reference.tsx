import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { connectorThread } from "../../catalog/domain/connector-thread";
import {
  compareDashSizes,
  type DashSize,
} from "../../catalog/domain/dash-size";
import {
  adapterEndName,
  type PublicAdapterEnd,
  type PublicCatalogFamily,
  type PublicCatalogItem,
} from "../../catalog/domain/public-catalog";
import { displayDash, hoseSizeLabel } from "../domain/variant-label";

function findSpecValue(item: PublicCatalogItem, label: string): string | null {
  const match = item.specs.find((spec) => spec.label === label);
  return match?.value?.trim() || null;
}

/** `1/4"`, `1-1/4"` or `2"`: nominal fraction from Dash ÷ 16. */
function formatNominalInch(dash: DashSize | null) {
  const label = hoseSizeLabel(null, dash);
  return label ? `${label.replace(/\s+in$/, "").replace(/\s+/g, "-")}"` : null;
}

/** `-4 (1/4")` when a Dash size exists. */
function formatDashWithInch(dash: DashSize | null, dashLabel: string) {
  const nominal = formatNominalInch(dash);
  return nominal ? `${dashLabel} (${nominal})` : dashLabel;
}

/** `a`, `a and b`, `a, b and c`. */
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

export interface AdapterSpecTableRow {
  catalogModel: string | null;
  end1Dash: DashSize | null;
  end1DashLabel: string;
  end1SizeLabel: string;
  end1Thread: string;
  end2Dash: DashSize | null;
  end2DashLabel: string;
  end2SizeLabel: string;
  end2Thread: string;
  isSameDash: boolean;
  pairingCode: string;
  pairingType: "Same dash" | "Jump size";
  sku: string;
}

export function buildAdapterSpecTableRows(
  family: PublicCatalogFamily,
): AdapterSpecTableRow[] {
  return family.variants
    .flatMap((variant) =>
      variant.variantSelection?.kind === "adapter"
        ? [{ ends: variant.variantSelection.ends, variant }]
        : [],
    )
    .toSorted(
      (left, right) =>
        compareDashSizes(left.ends[0].dash, right.ends[0].dash) ||
        compareDashSizes(left.ends[1].dash, right.ends[1].dash) ||
        left.variant.sku.localeCompare(right.variant.sku),
    )
    .map(({ ends, variant }) => {
      const [end1, end2] = ends;
      const end1DashLabel = displayDash(end1.dash);
      const end2DashLabel = displayDash(end2.dash);
      const isSameDash = Boolean(
        end1.dash && end2.dash && end1.dash === end2.dash,
      );
      return {
        catalogModel: findSpecValue(variant, "Catalog model"),
        end1Dash: end1.dash,
        end1DashLabel,
        end1SizeLabel: formatDashWithInch(end1.dash, end1DashLabel),
        end1Thread: end1.thread ?? "—",
        end2Dash: end2.dash,
        end2DashLabel,
        end2SizeLabel: formatDashWithInch(end2.dash, end2DashLabel),
        end2Thread: end2.thread ?? "—",
        isSameDash,
        pairingCode: `${end1DashLabel} × ${end2DashLabel}`,
        pairingType: isSameDash ? "Same dash" : "Jump size",
        sku: variant.sku,
      };
    });
}

interface Question {
  answer: ReactNode;
  question: string;
}

interface InterfaceGuideCard {
  body: (threads: ReadonlyMap<DashSize, string>) => ReactNode;
  eyebrow: string;
  sealSummary: string;
  standard: string;
  title: string;
}

/** Standards and sealing forms match `catalog_runtime_hose_end_series` and ADR 0057. */
const INTERFACE_GUIDES: Readonly<Record<string, InterfaceGuideCard>> = {
  "JIC 37°": {
    eyebrow: "SAE J514 / ISO 8434-2",
    sealSummary: "SAE J514 · 37° cone seat",
    standard: "SAE J514",
    title: "Male JIC 37° (37° Flare Cone)",
    body: (threads) => (
      <>
        <p>
          Uses straight Unified threads (<code>UNF</code> / <code>UN</code>)
          with a machined 37° flare cone nose. Fluid seals metal-to-metal where
          the male 37° nose seats against a mating female JIC 37° swivel cone or
          flared tube; the straight threads carry mechanical clamping load
          rather than sealing fluid.
        </p>
        <p>
          Dash numbers state nominal tube outside diameter in sixteenths of an
          inch, while the external thread major diameter is larger:{" "}
          {threadExamples(threads, ["-4", "-6", "-8", "-12"])}.
        </p>
      </>
    ),
  },
  NPTF: {
    eyebrow: "SAE J476 / ASME B1.20.3",
    sealSummary: "SAE J476 · Tapered pipe thread",
    standard: "SAE J476",
    title: "Male NPTF (Dryseal Tapered Pipe)",
    body: (threads) => (
      <>
        <p>
          Uses Dryseal tapered pipe threads that seal by flank, crest and root
          interference inside a female pipe port, with no flare cone or O-ring
          boss seat.
        </p>
        <p>
          Pipe Dash numbers state nominal pipe size in sixteenths of an inch (
          <code>-2 = 1/8&quot;</code>, <code>-4 = 1/4&quot;</code>,{" "}
          <code>-6 = 3/8&quot;</code>, <code>-8 = 1/2&quot;</code>), not the
          caliper width across the male threads:{" "}
          {threadExamples(threads, ["-2", "-4", "-6", "-8"])}.
        </p>
      </>
    ),
  },
  ORB: {
    eyebrow: "SAE J1926-1 / ISO 11926-1",
    sealSummary: "SAE J1926-1 · O-ring boss",
    standard: "SAE J1926-1",
    title: "Male SAE ORB (Straight-Thread O-Ring Boss)",
    body: (threads) => (
      <>
        <p>
          Uses straight Unified threads (<code>UNF</code> / <code>UN</code>)
          with an elastomeric O-ring seated against the hex shoulder. The O-ring
          compresses into the machined chamfer of a female SAE straight- thread
          boss port on a valve bank, pump, cylinder or manifold.
        </p>
        <p>
          Dash numbers follow the SAE straight-thread boss chart:{" "}
          {threadExamples(threads, ["-4", "-6", "-8", "-12"])}.
        </p>
      </>
    ),
  },
  ORFS: {
    eyebrow: "SAE J1453 / ISO 8434-3",
    sealSummary: "SAE J1453 · O-ring face seal",
    standard: "SAE J1453",
    title: "Male ORFS (O-Ring Face Seal)",
    body: (threads) => (
      <>
        <p>
          Uses straight Unified threads (<code>UNF</code> / <code>UNS</code> /{" "}
          <code>UN</code>) with a flat machined end face and a captive O-ring
          groove. Fluid seals where the face O-ring compresses against the flat
          sealing surface of a mating female ORFS swivel nut.
        </p>
        <p>
          ORFS threads are larger than JIC threads of the same Dash size:{" "}
          {threadExamples(threads, ["-4", "-6", "-8", "-12"])}.
        </p>
      </>
    ),
  },
};

function threadExamples(
  threads: ReadonlyMap<DashSize, string>,
  preferred: readonly DashSize[],
) {
  const available = preferred.filter((dash) => threads.has(dash));
  const dashes =
    available.length >= 2 ? available : [...threads.keys()].slice(0, 4);
  return formatList(dashes.map((dash) => `${dash} is ${threads.get(dash)}`));
}

function threadsByDash(
  rows: readonly AdapterSpecTableRow[],
  end: 1 | 2,
): Map<DashSize, string> {
  const map = new Map<DashSize, string>();
  for (const row of rows) {
    const dash = end === 1 ? row.end1Dash : row.end2Dash;
    const thread = end === 1 ? row.end1Thread : row.end2Thread;
    if (dash && thread !== "—") {
      map.set(dash, thread);
    }
  }
  return map;
}

function catalogModelPrefix(rows: readonly AdapterSpecTableRow[]) {
  const firstModel = rows.find((row) => row.catalogModel)?.catalogModel;
  if (!firstModel) return null;
  const prefix = firstModel.split("-", 1)[0]?.trim();
  return prefix || null;
}

interface AdapterReferenceContext {
  end1: PublicAdapterEnd;
  end1Dashes: readonly DashSize[];
  end1Name: string;
  end1Threads: ReadonlyMap<DashSize, string>;
  end2: PublicAdapterEnd;
  end2Dashes: readonly DashSize[];
  end2Name: string;
  end2Threads: ReadonlyMap<DashSize, string>;
  jumpRows: readonly AdapterSpecTableRow[];
  modelPrefix: string | null;
  publishedAdapterKeys: ReadonlySet<string> | null;
  rows: readonly AdapterSpecTableRow[];
  sameDashRows: readonly AdapterSpecTableRow[];
  shape: string;
}

interface AdapterFamilyContent {
  callout: (context: AdapterReferenceContext) => ReactNode;
  hoseEndLink: {
    description: string;
    eyebrow: string;
    title: string;
    to: string;
  };
  noun: string;
  questions: (context: AdapterReferenceContext) => Question[];
  seriesLabel: string;
  siblingAdapter: {
    description: string;
    eyebrow: string;
    familyKey: string;
    title: string;
  };
  sizeChartHeading: string;
}

function combinationsQuestion({
  end1Dashes,
  end1Name,
  end2Name,
  jumpRows,
  modelPrefix,
  rows,
  sameDashRows,
}: AdapterReferenceContext): Question {
  const label = modelPrefix ? `${modelPrefix} ` : "";
  const sameDashes = sameDashRows.map((row) => row.end1DashLabel);
  const jumpExamples = jumpRows
    .slice(0, 3)
    .map((row) => `${row.end1DashLabel} to ${row.end2DashLabel}`);
  // End 1 tube sizes that have no equal-dash End 2 row in this series (such as -3, -5, -10, -14 on NPTF).
  const sameSet = new Set(
    sameDashRows
      .map((row) => row.end1Dash)
      .filter((dash): dash is DashSize => dash !== null),
  );
  const stepOnlyEnd1 = end1Dashes.filter((dash) => !sameSet.has(dash));
  return {
    question: `Which equal-dash and jump-size combinations are in the ${label}adapter series?`,
    answer: (
      <>
        This series lists {rows.length} published {end1Name} to {end2Name} size
        combinations: {sameDashRows.length} equal-dash sizes (
        {formatList(sameDashes)}) and {jumpRows.length} jump-size reducer or
        expander combinations
        {jumpExamples.length > 0 ? ` such as ${formatList(jumpExamples)}` : ""}.
        {stepOnlyEnd1.length > 0
          ? ` ${end1Name} ${formatList(stepOnlyEnd1)} are offered exclusively as jump sizes because ${end2Name} has no matching ${formatList(stepOnlyEnd1, "or")} size in this series.`
          : null}
      </>
    ),
  };
}

function partNumberQuestion({
  end1Name,
  end2Name,
  jumpRows,
  modelPrefix,
  rows,
}: AdapterReferenceContext): Question[] {
  if (!modelPrefix) return [];
  const example =
    jumpRows.find(
      (row) =>
        row.end1Dash === "-6" && row.end2Dash === "-8" && row.catalogModel,
    ) ??
    jumpRows.find((row) => row.catalogModel) ??
    rows.find((row) => row.catalogModel);
  if (!example?.catalogModel) return [];
  return [
    {
      question: `How do ${modelPrefix} catalog model numbers map to the two end sizes?`,
      answer: (
        <>
          In <code>{example.catalogModel}</code>, the first Dash code after{" "}
          <code>{modelPrefix}-</code> gives the {end1Name} end (
          <code>{example.end1DashLabel}</code>, {example.end1Thread}) and the
          second Dash code gives the {end2Name} end (
          <code>{example.end2DashLabel}</code>, {example.end2Thread}). Check end
          order carefully when selecting a jump-size adapter so the flare or
          face-seal nose and port thread are not reversed.
        </>
      ),
    },
  ];
}

function assemblyAlternativeQuestion({
  end1Name,
  end2Name,
}: AdapterReferenceContext): Question {
  return {
    question:
      "When should I use a port adapter versus configuring the port end directly on a hose assembly?",
    answer: (
      <>
        Straight {end1Name} to {end2Name} adapters convert a fixed equipment
        port so a standard female swivel hose end can connect and disconnect
        without rotating the hose. When you are building a new replacement line
        and want fewer threaded joints, you can also configure compatible crimp
        hose ends directly in <Link to="/build-a-hose">Build a Hose</Link>.
      </>
    ),
  };
}

const ADAPTER_FAMILY_CONTENT: Readonly<Record<string, AdapterFamilyContent>> = {
  "adp-fam-jic-npt-st": {
    seriesLabel: "2404",
    noun: "straight Male JIC 37° to Male NPTF hydraulic adapter",
    sizeChartHeading:
      "2404 Straight Male JIC 37° to Male NPTF Adapter Size & Thread Chart",
    callout: ({ end1Threads, end2Threads }) => {
      const jic4 = end1Threads.get("-4") ?? connectorThread("JIC", "-4");
      const jic8 = end1Threads.get("-8") ?? connectorThread("JIC", "-8");
      const npt4 = end2Threads.get("-4") ?? connectorThread("NPT", "-4");
      const npt8 = end2Threads.get("-8") ?? connectorThread("NPT", "-8");
      return (
        <>
          <strong>Do not mix straight and tapered port threads:</strong> Male
          JIC 37° uses straight Unified threads (
          {jic4 ? <code>{jic4}</code> : null} on <code>-4</code>,{" "}
          {jic8 ? <code>{jic8}</code> : null} on <code>-8</code>) and seals only
          on its 37° cone — do not thread it into a straight-thread SAE ORB
          port, which shares the same thread sizes per Dash but requires an
          O-ring boss end. The opposite end is tapered <code>NPTF</code> pipe
          thread ({npt4 ? <code>{npt4}</code> : null} on <code>-4</code>,{" "}
          {npt8 ? <code>{npt8}</code> : null} on <code>-8</code>) for female
          pipe ports only.
        </>
      );
    },
    questions: (context) => [
      combinationsQuestion(context),
      {
        question:
          "How do the Male JIC 37° and Male NPTF ends seal in an assembly?",
        answer: (
          <>
            The Male JIC 37° end (SAE J514) seals metal-to-metal where its 37°
            cone seats into a female JIC 37° swivel hose end or flared tube nut;
            its straight threads do not seal fluid. The Male NPTF end (SAE J476)
            threads into a female pipe port and seals along the tapered pipe
            threads.
          </>
        ),
      },
      ...partNumberQuestion(context),
      assemblyAlternativeQuestion(context),
    ],
    siblingAdapter: {
      eyebrow: "SAE O-Ring Boss Port Alternative",
      familyKey: "adp-fam-jic-orb-st",
      title: "Compare 6400 Male JIC 37° to Male ORB Adapters",
      description:
        "Adapting into a straight-thread SAE O-ring boss port instead of tapered NPTF pipe? View all JIC-to-ORB sizes.",
    },
    hoseEndLink: {
      eyebrow: "Mating Crimp Fittings",
      title: "Browse JIC 37° Crimp Hose Ends",
      description:
        "Pair the male 37° flare nose with straight, 45° or 90° JIC 37° female swivel one-piece crimp hose ends.",
      to: "/catalog/hose-ends?interface=jic",
    },
  },
  "adp-fam-jic-orb-st": {
    seriesLabel: "6400",
    noun: "straight Male JIC 37° to Male SAE ORB hydraulic adapter",
    sizeChartHeading:
      "6400 Straight Male JIC 37° to Male SAE ORB Adapter Size & Thread Chart",
    callout: ({ rows, sameDashRows }) => {
      const first = sameDashRows[0] ?? rows[0];
      const last = sameDashRows.at(-1) ?? rows.at(-1);
      const mid =
        sameDashRows.find((row) => row.end1Dash === "-8") ?? sameDashRows[0];
      return (
        <>
          <strong>Same straight thread, different sealing surface:</strong>{" "}
          {first && last
            ? `From ${first.end1DashLabel} (${first.end1Thread}) through ${last.end1DashLabel} (${last.end1Thread}), `
            : ""}
          Male JIC 37° and Male ORB use the exact same Unified thread size at
          every Dash number
          {mid?.catalogModel
            ? `, so ${mid.catalogModel} has ${mid.end1Thread} on both ends`
            : ""}
          . Keep the two ends oriented properly: the 37° flare nose mates with a
          female JIC cone seat, while the O-ring boss end seals in a female SAE
          ORB port chamfer. Never thread a JIC flare cone into an ORB port or an
          ORB end into a JIC swivel nut.
        </>
      );
    },
    questions: (context) => [
      combinationsQuestion(context),
      {
        question:
          "Why is a 6400 adapter needed when JIC 37° and SAE ORB share the same thread size?",
        answer: (
          <>
            Although both interfaces share one Unified thread per Dash size in
            the SAE thread chart (for example{" "}
            <code>{connectorThread("JIC", "-6")}</code> at <code>-6</code> and{" "}
            <code>{connectorThread("JIC", "-8")}</code> at <code>-8</code>),
            their sealing geometries are incompatible: a female SAE ORB port has
            an O-ring counterbore with no 37° seat, whereas a female JIC swivel
            nut has a 37° cone with no O-ring boss. The 6400 adapter converts
            that ORB equipment port to a standard male 37° flare connection, and
            jump sizes step between different JIC and ORB Dash numbers in one
            fitting.
          </>
        ),
      },
      ...partNumberQuestion(context),
      assemblyAlternativeQuestion(context),
    ],
    siblingAdapter: {
      eyebrow: "Tapered Pipe Port Alternative",
      familyKey: "adp-fam-jic-npt-st",
      title: "Compare 2404 Male JIC 37° to Male NPTF Adapters",
      description:
        "Adapting into a tapered NPTF dryseal pipe port instead of a straight-thread ORB port? View all JIC-to-NPTF sizes.",
    },
    hoseEndLink: {
      eyebrow: "Mating Crimp Fittings",
      title: "Browse JIC 37° Crimp Hose Ends",
      description:
        "Pair the male 37° flare nose with straight, 45° or 90° JIC 37° female swivel one-piece crimp hose ends.",
      to: "/catalog/hose-ends?interface=jic",
    },
  },
  "adp-fam-orfs-npt-st": {
    seriesLabel: "FS2404",
    noun: "straight Male ORFS to Male NPTF hydraulic adapter",
    sizeChartHeading:
      "FS2404 Straight Male ORFS to Male NPTF Adapter Size & Thread Chart",
    callout: () => {
      const orfs4 = connectorThread("ORFS", "-4");
      const jic6 = connectorThread("JIC", "-6");
      const orfs12 = connectorThread("ORFS", "-12");
      const jic14 = connectorThread("JIC", "-14");
      return (
        <>
          <strong>Verify the flat face, not just the thread gauge:</strong>{" "}
          Several ORFS thread sizes overlap JIC 37° / ORB threads at different
          Dash numbers — ORFS <code>-4</code> uses <code>{orfs4}</code> (the
          same thread size as JIC/ORB <code>-6</code>, <code>{jic6}</code>) and
          ORFS <code>-12</code> uses <code>{orfs12}</code> (the same thread size
          as JIC/ORB <code>-14</code>, <code>{jic14}</code>). ORFS has a flat
          face with an O-ring groove and never seals against a 37° flare seat.
        </>
      );
    },
    questions: (context) => {
      const has2404 =
        !context.publishedAdapterKeys ||
        context.publishedAdapterKeys.has("adp-fam-jic-npt-st");
      return [
        combinationsQuestion(context),
        {
          question:
            "How does FS2404 (Male ORFS to Male NPTF) differ from 2404 (Male JIC 37° to Male NPTF)?",
          answer: (
            <>
              Both adapt a female <code>NPTF</code> pipe port, but{" "}
              <code>FS2404</code> provides a flat-face <code>Male ORFS</code>{" "}
              end (SAE J1453) with a face O-ring groove for flat-face female
              swivel hose ends, whereas <code>2404</code> provides a 37° cone{" "}
              <code>Male JIC 37°</code> end (SAE J514). If your hose uses 37°
              flare female swivel nuts,{" "}
              {has2404 ? (
                <>
                  see the{" "}
                  <Link to="/catalog/adapters/adp-fam-jic-npt-st">
                    2404 Male JIC 37° to Male NPTF size chart
                  </Link>
                  .
                </>
              ) : (
                <>
                  browse <Link to="/catalog/adapters">hydraulic adapters</Link>.
                </>
              )}
            </>
          ),
        },
        ...partNumberQuestion(context),
        assemblyAlternativeQuestion(context),
      ];
    },
    siblingAdapter: {
      eyebrow: "37° Flare Alternative",
      familyKey: "adp-fam-jic-npt-st",
      title: "Compare 2404 Male JIC 37° to Male NPTF Adapters",
      description:
        "Connecting a 37° flare female swivel hose end instead of flat-face ORFS? View all JIC-to-NPTF sizes.",
    },
    hoseEndLink: {
      eyebrow: "Mating Crimp Fittings",
      title: "Browse ORFS Crimp Hose Ends",
      description:
        "Pair the male ORFS face-seal end with straight, 45° or 90° ORFS female swivel one-piece crimp hose ends.",
      to: "/catalog/hose-ends?interface=orfs",
    },
  },
};

export function hasAdapterSeriesReference(
  familyKey: string | null | undefined,
): boolean {
  return Boolean(familyKey && ADAPTER_FAMILY_CONTENT[familyKey.toLowerCase()]);
}

export function AdapterSeriesReference({
  family,
  publishedAdapterKeys = null,
  selected,
  selectionComplete,
  selectSku,
}: {
  family: PublicCatalogFamily;
  publishedAdapterKeys?: readonly string[] | null;
  selected: PublicCatalogItem;
  selectionComplete: boolean;
  selectSku: (sku: string) => void;
}) {
  const repSelection = family.representative.variantSelection;
  if (repSelection?.kind !== "adapter") return null;
  const familyKey = family.familyKey.toLowerCase();
  const content = ADAPTER_FAMILY_CONTENT[familyKey];
  if (!content) return null;

  const rows = buildAdapterSpecTableRows(family);
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return null;

  const [end1, end2] = repSelection.ends;
  const end1Name = adapterEndName(end1) ?? "End 1";
  const end2Name = adapterEndName(end2) ?? "End 2";
  const end1Guide = end1.interfaceName
    ? INTERFACE_GUIDES[end1.interfaceName]
    : undefined;
  const end2Guide = end2.interfaceName
    ? INTERFACE_GUIDES[end2.interfaceName]
    : undefined;

  const end1Dashes = uniqueOrderedDashes(rows.map((row) => row.end1Dash));
  const end2Dashes = uniqueOrderedDashes(rows.map((row) => row.end2Dash));
  const [end1Filter, setEnd1Filter] = useState<DashSize | null>(null);

  useEffect(() => {
    setEnd1Filter(null);
  }, [familyKey]);

  const visibleRows = end1Filter
    ? rows.filter((row) => row.end1Dash === end1Filter)
    : rows;

  const sameDashRows = rows.filter((row) => row.isSameDash);
  const jumpRows = rows.filter((row) => !row.isSameDash);
  const end1Threads = threadsByDash(rows, 1);
  const end2Threads = threadsByDash(rows, 2);
  const modelPrefix = catalogModelPrefix(rows);
  const showCatalogModel = rows.some((row) => row.catalogModel !== null);
  const shape = findSpecValue(family.representative, "Shape") ?? "Straight";
  const publishedKeySet = publishedAdapterKeys
    ? new Set(publishedAdapterKeys.map((key) => key.toLowerCase()))
    : null;

  const context: AdapterReferenceContext = {
    end1,
    end1Dashes,
    end1Name,
    end1Threads,
    end2,
    end2Dashes,
    end2Name,
    end2Threads,
    jumpRows,
    modelPrefix,
    publishedAdapterKeys: publishedKeySet,
    rows,
    sameDashRows,
    shape,
  };

  const questions = content.questions(context);
  const siblingAvailable =
    !publishedKeySet ||
    publishedKeySet.has(content.siblingAdapter.familyKey.toLowerCase());
  const siblingLink = siblingAvailable
    ? {
        description: content.siblingAdapter.description,
        eyebrow: content.siblingAdapter.eyebrow,
        title: content.siblingAdapter.title,
        to: `/catalog/adapters/${content.siblingAdapter.familyKey}`,
      }
    : {
        description: "Browse every published hydraulic adapter series.",
        eyebrow: "All Hydraulic Adapters",
        title: "Compare Every Hydraulic Adapter Series",
        to: "/catalog/adapters",
      };

  const end1RangeLabel =
    end1Dashes.length > 1
      ? `${end1Dashes[0]} to ${end1Dashes.at(-1)}`
      : (end1Dashes[0] ?? "—");
  const end2RangeLabel =
    end2Dashes.length > 1
      ? `${end2Dashes[0]} to ${end2Dashes.at(-1)}`
      : (end2Dashes[0] ?? "—");
  const firstModel = rows.find((row) => row.catalogModel)?.catalogModel;
  const lastModel = [...rows]
    .reverse()
    .find((row) => row.catalogModel)?.catalogModel;

  return (
    <div
      className="hose-series-reference adapter-series-reference"
      data-adapter-reference={familyKey}
    >
      {/* Block 1: Full Combination & Thread Specification Table */}
      <section
        aria-labelledby="adapter-size-chart-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">
              {[
                modelPrefix ? `Series ${modelPrefix}` : null,
                end1Guide?.standard,
                end2Guide?.standard,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <h2 id="adapter-size-chart-heading">{content.sizeChartHeading}</h2>
          </div>
          <span className="hose-section-badge">
            {rows.length} combinations · {end1RangeLabel} × {end2RangeLabel}
          </span>
        </header>

        <p className="hose-reference-lead">
          All {rows.length} size combinations of{" "}
          <strong>{modelPrefix ?? family.familyName}</strong> {content.noun},
          covering {end1Name} {end1RangeLabel} to {end2Name} {end2RangeLabel}.
          Select a row to choose both end sizes in the order panel above.
        </p>

        <dl className="hose-series-construction-bar">
          <div>
            <dt>Body Geometry</dt>
            <dd>{shape}</dd>
          </div>
          <div>
            <dt>End 1 Connection</dt>
            <dd>
              {end1Name}
              {end1Guide ? ` · ${end1Guide.sealSummary}` : ""}
            </dd>
          </div>
          <div>
            <dt>End 2 Connection</dt>
            <dd>
              {end2Name}
              {end2Guide ? ` · ${end2Guide.sealSummary}` : ""}
            </dd>
          </div>
          <div>
            <dt>{modelPrefix ? "Catalog Series" : "Size Coverage"}</dt>
            <dd>
              {modelPrefix && firstModel && lastModel
                ? `${modelPrefix} (${firstModel} to ${lastModel})`
                : `${sameDashRows.length} equal-dash · ${jumpRows.length} jump-size`}
            </dd>
          </div>
        </dl>

        {end1Dashes.length > 1 ? (
          <div
            aria-label={`Filter combinations by ${end1Name} Dash size`}
            className="adapter-filter-bar"
            role="group"
          >
            <span className="adapter-filter-label">{end1Name} Dash:</span>
            <button
              aria-pressed={end1Filter === null}
              className="adapter-filter-pill"
              onClick={() => setEnd1Filter(null)}
              type="button"
            >
              All ({rows.length})
            </button>
            {end1Dashes.map((dash) => (
              <button
                aria-pressed={end1Filter === dash}
                className="adapter-filter-pill"
                data-filter-end1-dash={dash}
                key={dash}
                onClick={() =>
                  setEnd1Filter((current) => (current === dash ? null : dash))
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
              {family.familyName} Dash sizes, derived threads and size pairings
              {end1Filter
                ? ` filtered to ${end1Name} ${end1Filter} (${visibleRows.length} of ${rows.length} combinations).`
                : ` for all ${rows.length} combinations.`}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  Dash Pair
                  <span>End 1 × End 2</span>
                </th>
                <th scope="col">
                  {end1Name}
                  <span>Dash (Nominal)</span>
                </th>
                <th scope="col">
                  {end1Name} Thread
                  <span>{end1Guide?.standard ?? "End 1"}</span>
                </th>
                <th scope="col">
                  {end2Name}
                  <span>Dash (Nominal)</span>
                </th>
                <th scope="col">
                  {end2Name} Thread
                  <span>{end2Guide?.standard ?? "End 2"}</span>
                </th>
                <th scope="col">
                  Size Pairing
                  <span>Relation</span>
                </th>
                {showCatalogModel ? (
                  <th scope="col">
                    Catalog Model
                    <span>Series Code</span>
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
                        aria-label={`Select ${end1Name} ${row.end1DashLabel} to ${end2Name} ${row.end2DashLabel}${row.catalogModel ? ` (${row.catalogModel})` : ""}`}
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
                    <td className="hose-spec-nominal">{row.end1SizeLabel}</td>
                    <td className="hose-spec-pressure">
                      <strong>{row.end1Thread}</strong>
                    </td>
                    <td className="hose-spec-nominal">{row.end2SizeLabel}</td>
                    <td className="hose-spec-pressure">
                      <strong>{row.end2Thread}</strong>
                    </td>
                    <td>
                      <span
                        className="adapter-pairing-badge"
                        data-pairing={row.isSameDash ? "same" : "jump"}
                      >
                        {row.pairingType}
                      </span>
                    </td>
                    {showCatalogModel ? (
                      <td className="hose-spec-num">
                        {row.catalogModel ?? "—"}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hose-spec-table-footnote">
          Threads are derived from each end&apos;s interface and Dash size per
          our Fluid Port and Connector Thread Sizes chart. Equal-dash rows match
          the same Dash number on both ends; jump-size rows step between
          different Dash numbers.
        </p>
      </section>

      {/* Block 2: End-to-End Thread & Sealing Identification Guide */}
      {end1Guide && end2Guide ? (
        <section
          aria-labelledby="adapter-sealing-guide-heading"
          className="hose-reference-section"
        >
          <header className="hose-section-header">
            <div>
              <span className="eyebrow">Thread &amp; Sealing Guide</span>
              <h2 id="adapter-sealing-guide-heading">
                How to Identify {end1.interfaceName} and {end2.interfaceName}{" "}
                Adapter Ends
              </h2>
            </div>
            <span className="hose-section-badge">
              Dash &divide; 16 · Thread &amp; Seal Check
            </span>
          </header>

          <div className="hose-guide-stack">
            <div className="adapter-guide-grid">
              <article className="hose-guide-card">
                <div className="hose-guide-card-header">
                  <span className="eyebrow">End 1 · {end1Guide.eyebrow}</span>
                  <h3>{end1Guide.title}</h3>
                </div>
                <div className="hose-conversion-copy">
                  {end1Guide.body(end1Threads)}
                </div>
              </article>

              <article className="hose-guide-card">
                <div className="hose-guide-card-header">
                  <span className="eyebrow">End 2 · {end2Guide.eyebrow}</span>
                  <h3>{end2Guide.title}</h3>
                </div>
                <div className="hose-conversion-copy">
                  {end2Guide.body(end2Threads)}
                </div>
              </article>
            </div>

            <p className="hose-conversion-callout">
              {content.callout(context)}
            </p>
          </div>
        </section>
      ) : null}

      {/* Block 3: Family-Specific Q&A + 3 Next-Step Internal Links */}
      <section
        aria-labelledby="adapter-series-qa-heading"
        className="hose-reference-section"
      >
        <header className="hose-section-header">
          <div>
            <span className="eyebrow">
              {content.seriesLabel} Series Technical Q&amp;A
            </span>
            <h2 id="adapter-series-qa-heading">
              {`${family.familyName} (${content.seriesLabel}) Selection & Ordering Questions`}
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
          aria-label="Related adapter series and hose assembly tools"
          className="hose-next-steps-links"
        >
          <Link className="hose-next-step-card" to={siblingLink.to}>
            <span className="eyebrow">{siblingLink.eyebrow}</span>
            <strong>{siblingLink.title}</strong>
            <span>{siblingLink.description}</span>
          </Link>
          <Link className="hose-next-step-card" to={content.hoseEndLink.to}>
            <span className="eyebrow">{content.hoseEndLink.eyebrow}</span>
            <strong>{content.hoseEndLink.title}</strong>
            <span>{content.hoseEndLink.description}</span>
          </Link>
          <Link className="hose-next-step-card" to="/build-a-hose">
            <span className="eyebrow">Custom Assembly Configurator</span>
            <strong>Build a Hose Assembly by Length</strong>
            <span>
              Configure a factory-crimped, proof-tested hydraulic hose assembly
              with compatible {end1.interfaceName ?? "JIC, ORFS"} or{" "}
              {end2.interfaceName ?? "NPTF"} hose ends.
            </span>
          </Link>
        </nav>
      </section>
    </div>
  );
}
