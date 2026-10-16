import {
  compareDashSizes,
  normalizeDashSize,
} from "../../catalog/domain/dash-size";
import {
  compareQuickCouplerRoles,
  type PublicCatalogItem,
  type PublicVariantSelection,
} from "../../catalog/domain/public-catalog";

/** One choice in a staged picker, such as an adapter's first-end Dash size. */
export interface VariantStageAxis {
  /** Resolves a sole remaining option without a click; the Hose End picker keeps its explicit steps. */
  autoSelectSingle: boolean;
  compare: (left: string, right: string) => number;
  value: (variant: PublicCatalogItem) => string | null;
}

export interface VariantStageOption {
  value: string;
  /** Variants that remain when this option is chosen. */
  variants: PublicCatalogItem[];
}

export interface ResolvedVariantStage {
  options: VariantStageOption[];
  selected: string | null;
}

/**
 * Each stage offers only the values that remain under the choices before it, and stops at the first stage
 * still waiting for a choice. A chosen value that no longer exists counts as unchosen.
 */
export function resolveVariantStages(
  variants: readonly PublicCatalogItem[],
  axes: readonly VariantStageAxis[],
  chosen: readonly (string | null)[],
): ResolvedVariantStage[] {
  const stages: ResolvedVariantStage[] = [];
  let remaining = [...variants];
  for (const [index, axis] of axes.entries()) {
    const groups = new Map<string, PublicCatalogItem[]>();
    for (const variant of remaining) {
      const value = axis.value(variant);
      if (value === null) continue;
      const group = groups.get(value);
      if (group) group.push(variant);
      else groups.set(value, [variant]);
    }
    const options = [...groups]
      .map(([value, group]) => ({ value, variants: group }))
      .toSorted((left, right) => axis.compare(left.value, right.value));
    const explicit = chosen[index] ?? null;
    const selected =
      explicit !== null && groups.has(explicit)
        ? explicit
        : axis.autoSelectSingle && options.length === 1
          ? options[0]!.value
          : null;
    stages.push({ options, selected });
    if (selected === null) break;
    remaining = groups.get(selected)!;
  }
  return stages;
}

/** The variant every stage resolves to, or null while a stage still waits for a choice. */
export function resolvedStageVariant(
  stages: readonly ResolvedVariantStage[],
  axisCount: number,
) {
  const last = stages.at(-1);
  if (stages.length !== axisCount || !last?.selected) return null;
  return (
    last.options.find((option) => option.value === last.selected)
      ?.variants[0] ?? null
  );
}

/**
 * The choices after picking `value` at stage `index`. Earlier stages keep what they show, including values
 * selected automatically, and later stages clear so they offer only what fits the new choice.
 */
export function chooseStageValue(
  stages: readonly ResolvedVariantStage[],
  index: number,
  value: string,
) {
  return [...stages.slice(0, index).map((stage) => stage.selected), value];
}

/** The stage values of one variant, used to restore a requested SKU's choices. */
export function stageValuesOf(
  variant: PublicCatalogItem,
  axes: readonly VariantStageAxis[],
) {
  return axes.map((axis) => axis.value(variant));
}

type SelectionOf<Kind extends PublicVariantSelection["kind"]> = Extract<
  PublicVariantSelection,
  { kind: Kind }
>;

function selectionOf<Kind extends PublicVariantSelection["kind"]>(
  variant: PublicCatalogItem,
  kind: Kind,
) {
  const selection = variant.variantSelection;
  return selection?.kind === kind ? (selection as SelectionOf<Kind>) : null;
}

function compareDashValues(left: string, right: string) {
  return compareDashSizes(normalizeDashSize(left), normalizeDashSize(right));
}

function dashAxis(
  value: (variant: PublicCatalogItem) => string | null,
  autoSelectSingle: boolean,
): VariantStageAxis {
  return { autoSelectSingle, compare: compareDashValues, value };
}

const quickCouplerPortSeparator = "|";

/** A port is its Dash, interface and gender: ISO 5675 offers both a -8 NPTF and a -8 ORB port. */
export function quickCouplerPortKey(
  selection: Pick<
    SelectionOf<"quick_coupler">,
    "portDash" | "portGender" | "portInterface"
  >,
) {
  return selection.portDash
    ? [
        selection.portDash,
        selection.portInterface ?? "",
        selection.portGender ?? "",
      ].join(quickCouplerPortSeparator)
    : null;
}

function compareQuickCouplerPorts(left: string, right: string) {
  const [leftDash = "", ...leftRest] = left.split(quickCouplerPortSeparator);
  const [rightDash = "", ...rightRest] = right.split(quickCouplerPortSeparator);
  return (
    compareDashValues(leftDash, rightDash) ||
    leftRest.join().localeCompare(rightRest.join())
  );
}

/** The ordered choices of a staged picker, or null for products chosen from one list. */
export function variantStageAxes(
  productType: PublicCatalogItem["productType"],
): VariantStageAxis[] | null {
  if (productType === "hose_end") {
    return [
      dashAxis(
        (variant) => selectionOf(variant, "hose_end")?.connectionDash ?? null,
        false,
      ),
      dashAxis(
        (variant) => selectionOf(variant, "hose_end")?.hoseTailDash ?? null,
        false,
      ),
    ];
  }
  if (productType === "adapter") {
    return [0, 1].map((end) =>
      dashAxis(
        (variant) => selectionOf(variant, "adapter")?.ends[end]?.dash ?? null,
        true,
      ),
    );
  }
  if (productType === "quick_coupler") {
    return [
      dashAxis(
        (variant) => selectionOf(variant, "quick_coupler")?.bodyDash ?? null,
        true,
      ),
      {
        autoSelectSingle: true,
        compare: compareQuickCouplerPorts,
        value: (variant) => {
          const selection = selectionOf(variant, "quick_coupler");
          return selection ? quickCouplerPortKey(selection) : null;
        },
      },
      {
        autoSelectSingle: true,
        compare: compareQuickCouplerRoles,
        value: (variant) => selectionOf(variant, "quick_coupler")?.role ?? null,
      },
    ];
  }
  return null;
}
