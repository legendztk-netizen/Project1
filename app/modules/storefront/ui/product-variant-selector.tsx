import { formatReferenceUnitPrice } from "../../quote-list/domain/quote-currency-totals";
import { Check, CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import {
  compareDashSizes,
  normalizeDashSize,
} from "../../catalog/domain/dash-size";
import { formatCompatibleHoses } from "../../catalog/domain/hose-name";
import {
  adapterEndName,
  quickCouplerRoleName,
  type PublicCatalogFamily,
  type PublicCatalogItem,
} from "../../catalog/domain/public-catalog";
import {
  chooseStageValue,
  resolvedStageVariant,
  resolveVariantStages,
  stageValuesOf,
  variantStageAxes,
  type ResolvedVariantStage,
  type VariantStageOption,
} from "../domain/staged-variant-selection";
import {
  connectionSizeLabel,
  displayDash,
  hoseIdLabel,
  hoseSizeLabel,
} from "../domain/variant-label";
import { ProductCommercialPanel } from "./product-commercial-panel";

// Other parameters, such as the `back` list link, survive a size change.
function navigateToSku(
  navigate: ReturnType<typeof useNavigate>,
  sku: string,
  current: URLSearchParams,
) {
  const next = new URLSearchParams(current);
  next.set("sku", sku);
  void navigate(`?${next}`);
}

function VariantChoice({
  active,
  ariaLabel,
  dataAttribute,
  note,
  onSelect,
  primary,
  secondary,
  value,
}: {
  active: boolean;
  ariaLabel?: string;
  dataAttribute: `data-${string}`;
  note?: string | null;
  onSelect: () => void;
  primary: string;
  secondary: string;
  value: string | null;
}) {
  return (
    <button
      {...{ [dataAttribute]: value ?? undefined }}
      aria-label={ariaLabel}
      aria-pressed={active}
      className="variant-choice"
      onClick={onSelect}
      type="button"
    >
      <span>
        <strong>{primary}</strong>
        <small>{secondary}</small>
        {note ? <small>{note}</small> : null}
      </span>
      {active ? <Check aria-hidden="true" size={17} /> : null}
    </button>
  );
}

function HoseSizePicker({
  family,
  selectedSku,
  selectionComplete,
  selectSku,
}: {
  family: PublicCatalogFamily;
  selectedSku: string;
  selectionComplete: boolean;
  selectSku: (sku: string) => void;
}) {
  const options = family.variants
    .flatMap((variant) =>
      variant.variantSelection?.kind === "hose"
        ? [{ selection: variant.variantSelection, variant }]
        : [],
    )
    .toSorted((left, right) =>
      compareDashSizes(left.selection.dash, right.selection.dash),
    );

  return (
    <fieldset className="variant-choice-group">
      <legend>Hose Inside Diameter</legend>
      <details className="dash-size-help">
        <summary aria-label="What is a Dash size?" title="What is a Dash size?">
          <CircleHelp aria-hidden="true" size={18} />
        </summary>
        <div className="dash-size-help-panel">
          <strong>Dash size</strong>
          <p>
            An industry code for nominal hose ID in sixteenths of an inch. For
            example, Dash -8 means 8/16 in, or 1/2 in.
          </p>
        </div>
      </details>
      <p>Choose the nominal inside diameter.</p>
      <div className="variant-choice-grid">
        {options.map(({ selection, variant }) => {
          const sizeLabel =
            hoseSizeLabel(selection.nominalIdIn, selection.dash) ??
            "Size not specified";
          const dashLabel = displayDash(selection.dash);
          return (
            <VariantChoice
              active={selectionComplete && variant.sku === selectedSku}
              ariaLabel={`Select ${sizeLabel} hose inside diameter, Dash ${dashLabel}`}
              dataAttribute="data-hose-dash"
              key={variant.sku}
              onSelect={() => selectSku(variant.sku)}
              primary={sizeLabel}
              secondary={`Hose ID · Dash ${dashLabel}`}
              value={selection.dash}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

interface StageOptionView {
  ariaLabel: string;
  note?: string | null;
  primary: string;
  secondary: string;
}

interface StagePresentation {
  /** Names the stage in `data-stage` and each choice's `data-<attribute>` value. */
  attribute: string;
  hint: string;
  legend: string;
  option: (option: VariantStageOption) => StageOptionView;
  /** Shown under the product title while this stage waits for a choice. */
  prompt: string;
}

function hoseEndOf(option: VariantStageOption) {
  const selection = option.variants[0]?.variantSelection;
  return selection?.kind === "hose_end" ? selection : null;
}

function adapterEndOf(option: VariantStageOption, end: 0 | 1) {
  const selection = option.variants[0]?.variantSelection;
  return selection?.kind === "adapter" ? selection.ends[end] : null;
}

function quickCouplerOf(option: VariantStageOption) {
  const selection = option.variants[0]?.variantSelection;
  return selection?.kind === "quick_coupler" ? selection : null;
}

const hoseEndStages: StagePresentation[] = [
  {
    attribute: "connection-dash",
    hint: "Select the nominal port or thread size.",
    legend: "1. Connection Dash",
    option: (option) => {
      const dash = normalizeDashSize(option.value);
      const size =
        connectionSizeLabel(hoseEndOf(option)?.thread, dash) ??
        "Size confirmed in quote";
      return {
        ariaLabel: `Select ${size}, Connection Dash ${displayDash(dash)}`,
        primary: size,
        secondary: `Connection Dash ${displayDash(dash)}`,
      };
    },
    prompt: "Choose a size to continue.",
  },
  {
    attribute: "hose-tail-dash",
    hint: "Only compatible hose-tail sizes are shown.",
    legend: "2. Hose Tail Dash",
    option: (option) => {
      const dash = normalizeDashSize(option.value);
      const idLabel = hoseIdLabel(null, dash);
      const hoses = hoseEndOf(option)?.compatibleHoses ?? [];
      return {
        ariaLabel: `Select ${idLabel}, Hose Tail Dash ${displayDash(dash)}`,
        note: hoses.length
          ? `Fits ${hoses.map((hose) => hose.shortName).join(", ")}`
          : null,
        primary: idLabel,
        secondary: `Hose Tail Dash ${displayDash(dash)}`,
      };
    },
    prompt: "Choose a Hose Tail Dash to continue.",
  },
];

function adapterStages(family: PublicCatalogFamily): StagePresentation[] {
  const selection = family.representative.variantSelection;
  const names = ([0, 1] as const).map(
    (end) =>
      (selection?.kind === "adapter" && adapterEndName(selection.ends[end])) ||
      `End ${end + 1}`,
  );
  const stage = (end: 0 | 1): StagePresentation => ({
    attribute: `end-${end + 1}-dash`,
    hint:
      end === 0
        ? `Select the ${names[0]} thread size.`
        : "Only sizes available with the selected first end are shown.",
    legend: `${end + 1}. ${names[end]} End`,
    option: (option) => {
      const dash = normalizeDashSize(option.value);
      const size =
        adapterEndOf(option, end)?.thread ??
        hoseSizeLabel(null, dash) ??
        "Size confirmed in quote";
      return {
        ariaLabel: `Select ${size}, ${names[end]} Dash ${displayDash(dash)}`,
        primary: size,
        secondary: `Dash ${displayDash(dash)}`,
      };
    },
    prompt:
      end === 0
        ? "Choose a size to continue."
        : `Choose the ${names[1]} end size to continue.`,
  });
  return [stage(0), stage(1)];
}

const quickCouplerPartNotes: Record<string, string> = {
  "Complete Pair": "One coupler and one nipple",
  "Coupler/Socket": "Female half",
  "Plug/Nipple": "Male half",
};

const quickCouplerStages: StagePresentation[] = [
  {
    attribute: "body-dash",
    hint: "Select the coupler body size.",
    legend: "1. Body Size",
    option: (option) => {
      const dash = normalizeDashSize(option.value);
      const size =
        quickCouplerOf(option)?.bodySize ??
        hoseSizeLabel(null, dash) ??
        "Size confirmed in quote";
      return {
        ariaLabel: `Select ${size} body, Body Dash ${displayDash(dash)}`,
        primary: size,
        secondary: `Body Dash ${displayDash(dash)}`,
      };
    },
    prompt: "Choose a size to continue.",
  },
  {
    attribute: "port",
    hint: "Only ports available for the selected body size are shown.",
    legend: "2. Port",
    option: (option) => {
      const coupler = quickCouplerOf(option);
      const port = [coupler?.portGender, coupler?.portInterface, "port"]
        .filter(Boolean)
        .join(" ");
      const thread = coupler?.portThread ?? "Thread confirmed in quote";
      return {
        ariaLabel: `Select ${thread}, ${port}`,
        primary: thread,
        secondary: `${port} · Dash ${displayDash(coupler?.portDash ?? null)}`,
      };
    },
    prompt: "Choose a port to continue.",
  },
  {
    attribute: "part",
    hint: "Order the coupler, the nipple, or both as a set.",
    legend: "3. Part",
    option: (option) => {
      const name = quickCouplerRoleName(option.value) ?? option.value;
      const offer = option.variants[0]?.offer;
      return {
        ariaLabel: `Select ${name}`,
        note:
          offer?.referencePrice == null
            ? "Price confirmed in quote"
            : `${offer.currency} ${formatReferenceUnitPrice(offer.referencePrice)} / ${offer.salesUnit.toLocaleLowerCase()}`,
        primary: name,
        secondary: quickCouplerPartNotes[option.value] ?? "Quick coupler part",
      };
    },
    prompt: "Choose a part to continue.",
  },
];

function stagePresentations(family: PublicCatalogFamily, productType: string) {
  return productType === "hose_end"
    ? hoseEndStages
    : productType === "adapter"
      ? adapterStages(family)
      : productType === "quick_coupler"
        ? quickCouplerStages
        : [];
}

function StagedVariantPicker({
  family,
  productType,
  selectStage,
  stages,
}: {
  family: PublicCatalogFamily;
  productType: string;
  selectStage: (index: number, value: string) => void;
  stages: ResolvedVariantStage[];
}) {
  const presentations = stagePresentations(family, productType);
  return (
    <div className="staged-variant-picker">
      {stages.map((stage, index) => {
        const presentation = presentations[index];
        if (!presentation) return null;
        return (
          <fieldset
            className="variant-choice-group"
            data-stage={presentation.attribute}
            key={presentation.attribute}
          >
            <legend>{presentation.legend}</legend>
            <p>{presentation.hint}</p>
            <div className="variant-choice-grid">
              {stage.options.map((option) => {
                const view = presentation.option(option);
                return (
                  <VariantChoice
                    active={stage.selected === option.value}
                    ariaLabel={view.ariaLabel}
                    dataAttribute={`data-${presentation.attribute}`}
                    key={option.value}
                    note={view.note}
                    onSelect={() => selectStage(index, option.value)}
                    primary={view.primary}
                    secondary={view.secondary}
                    value={option.value}
                  />
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export function ProductVariantSelector({
  family,
  selected,
  selection,
}: {
  family: PublicCatalogFamily;
  selected: PublicCatalogItem;
  selection: ProductVariantSelectionModel;
}) {
  const presentations = stagePresentations(family, selected.productType);
  const waitingStage = presentations[selection.stages.length - 1];
  return (
    <>
      <h1>{selection.guided ? family.familyName : selected.displayName}</h1>
      {selection.selectionComplete ? (
        <>
          <p className="product-sku">
            SKU <strong>{selected.sku}</strong>
          </p>
          {selected.variantSelection?.kind === "hose_end" &&
          selected.variantSelection.compatibleHoses?.length ? (
            <p className="product-fits">
              Fits Dash {displayDash(selected.variantSelection.hoseTailDash)}{" "}
              hose:{" "}
              <strong>
                {formatCompatibleHoses(
                  selected.variantSelection.compatibleHoses,
                )}
              </strong>
            </p>
          ) : null}
        </>
      ) : (
        <p className="product-sku">
          {waitingStage?.prompt ?? "Choose a size to continue."}
        </p>
      )}

      {selected.productType === "hose" ? (
        <HoseSizePicker
          family={family}
          selectedSku={selected.sku}
          selectionComplete={selection.selectionComplete}
          selectSku={selection.selectSku}
        />
      ) : presentations.length ? (
        <StagedVariantPicker
          family={family}
          productType={selected.productType}
          selectStage={selection.selectStage}
          stages={selection.stages}
        />
      ) : (
        <div className="variant-picker">
          <label htmlFor="variant">Size / connection variant</label>
          <select
            id="variant"
            value={selected.sku}
            onChange={(event) => selection.selectSku(event.currentTarget.value)}
          >
            {family.variants.map((variant) => (
              <option key={variant.sku} value={variant.sku}>
                {variant.sku}
              </option>
            ))}
          </select>
        </div>
      )}

      <ProductCommercialPanel
        selected={selected}
        selectionComplete={selection.selectionComplete}
      />
    </>
  );
}

export interface ProductVariantSelectionModel {
  guided: boolean;
  selectionComplete: boolean;
  selectSku: (sku: string) => void;
  selectStage: (index: number, value: string) => void;
  /** Stages up to the first one still waiting for a choice; empty for single-list products. */
  stages: ResolvedVariantStage[];
}

export function useProductVariantSelection({
  family,
  selected,
  selectionRequested,
}: {
  family: PublicCatalogFamily;
  selected: PublicCatalogItem;
  selectionRequested: boolean;
}): ProductVariantSelectionModel {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const axes = variantStageAxes(selected.productType);
  const requestedChoices = () =>
    selectionRequested && axes ? stageValuesOf(selected, axes) : [];
  const [chosen, setChosen] = useState<(string | null)[]>(requestedChoices);
  const [navigationPending, setNavigationPending] = useState(false);
  const guided = selected.productType === "hose" || axes !== null;
  const stages = axes
    ? resolveVariantStages(family.variants, axes, chosen)
    : [];
  const resolved = axes ? resolvedStageVariant(stages, axes.length) : null;
  const selectionComplete =
    !guided ||
    (!navigationPending &&
      (axes ? resolved?.sku === selected.sku : selectionRequested));

  useEffect(() => {
    setChosen(requestedChoices());
    setNavigationPending(false);
  }, [selected.sku, selectionRequested]);

  const beginSkuNavigation = (sku: string) => {
    setNavigationPending(true);
    navigateToSku(navigate, sku, searchParams);
  };

  return {
    guided,
    selectionComplete,
    selectSku: beginSkuNavigation,
    selectStage: (index, value) => {
      if (!axes) return;
      const next = chooseStageValue(stages, index, value);
      setChosen(next);
      const variant = resolvedStageVariant(
        resolveVariantStages(family.variants, axes, next),
        axes.length,
      );
      if (variant && (variant.sku !== selected.sku || !selectionRequested)) {
        beginSkuNavigation(variant.sku);
      }
    },
    stages,
  };
}
