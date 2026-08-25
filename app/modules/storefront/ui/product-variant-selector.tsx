import { Check, CircleHelp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import {
  compareDashSizes,
  type DashSize,
} from "../../catalog/domain/dash-size";
import type {
  PublicCatalogFamily,
  PublicCatalogItem,
} from "../../catalog/domain/public-catalog";
import {
  displayDash,
  hoseIdLabel,
  hoseSizeLabel,
} from "../domain/variant-label";
import { ProductCommercialPanel } from "./product-commercial-panel";

function navigateToSku(navigate: ReturnType<typeof useNavigate>, sku: string) {
  void navigate(`?sku=${encodeURIComponent(sku)}`);
}

function DashChoice({
  active,
  ariaLabel,
  dash,
  dataAttribute,
  onSelect,
  primary,
  secondary,
}: {
  active: boolean;
  ariaLabel?: string;
  dash: DashSize | null;
  dataAttribute:
    "data-connection-dash" | "data-hose-dash" | "data-hose-tail-dash";
  onSelect: () => void;
  primary?: string;
  secondary: string;
}) {
  return (
    <button
      {...{ [dataAttribute]: dash ?? undefined }}
      aria-label={ariaLabel}
      aria-pressed={active}
      className="variant-choice"
      onClick={onSelect}
      type="button"
    >
      <span>
        <strong>{primary ?? displayDash(dash)}</strong>
        <small>{secondary}</small>
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
            <DashChoice
              active={selectionComplete && variant.sku === selectedSku}
              ariaLabel={`Select ${sizeLabel} hose inside diameter, Dash ${dashLabel}`}
              dash={selection.dash}
              dataAttribute="data-hose-dash"
              key={variant.sku}
              onSelect={() => selectSku(variant.sku)}
              primary={sizeLabel}
              secondary={`Hose ID · Dash ${dashLabel}`}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

function HoseEndSizePicker({
  connectionDash,
  family,
  hoseTailDash,
  selectConnection,
  selectTail,
}: {
  connectionDash: DashSize | null;
  family: PublicCatalogFamily;
  hoseTailDash: DashSize | null;
  selectConnection: (dash: DashSize) => void;
  selectTail: (dash: DashSize | null, sku: string) => void;
}) {
  const hoseEndVariants = useMemo(
    () =>
      family.variants.flatMap((variant) =>
        variant.variantSelection?.kind === "hose_end"
          ? [{ selection: variant.variantSelection, variant }]
          : [],
      ),
    [family.variants],
  );
  const connectionOptions = useMemo(() => {
    const options = new Map<DashSize, string | null>();
    for (const { selection } of hoseEndVariants) {
      if (selection.connectionDash) {
        options.set(selection.connectionDash, selection.thread);
      }
    }
    return [...options.entries()].toSorted(([left], [right]) =>
      compareDashSizes(left, right),
    );
  }, [hoseEndVariants]);
  const hoseTailOptions = useMemo(
    () =>
      connectionDash
        ? hoseEndVariants
            .filter(
              ({ selection }) => selection.connectionDash === connectionDash,
            )
            .toSorted((left, right) =>
              compareDashSizes(
                left.selection.hoseTailDash,
                right.selection.hoseTailDash,
              ),
            )
        : [],
    [connectionDash, hoseEndVariants],
  );

  return (
    <div className="staged-variant-picker">
      <fieldset className="variant-choice-group">
        <legend>1. Connection Dash</legend>
        <p>Select the nominal port or thread size.</p>
        <div className="variant-choice-grid">
          {connectionOptions.map(([dash, thread]) => (
            <DashChoice
              active={connectionDash === dash}
              dash={dash}
              dataAttribute="data-connection-dash"
              key={dash}
              onSelect={() => selectConnection(dash)}
              secondary={thread ?? "Thread confirmed in quote"}
            />
          ))}
        </div>
      </fieldset>

      {connectionDash ? (
        <fieldset className="variant-choice-group" data-stage="hose-tail">
          <legend>2. Hose Tail Dash</legend>
          <p>Only compatible hose-tail sizes are shown.</p>
          <div className="variant-choice-grid">
            {hoseTailOptions.map(({ selection, variant }) => {
              const idLabel = hoseIdLabel(null, selection.hoseTailDash);
              return (
                <DashChoice
                  active={hoseTailDash === selection.hoseTailDash}
                  ariaLabel={`Select ${displayDash(selection.hoseTailDash)}, ${idLabel}`}
                  dash={selection.hoseTailDash}
                  dataAttribute="data-hose-tail-dash"
                  key={variant.sku}
                  onSelect={() =>
                    selectTail(selection.hoseTailDash, variant.sku)
                  }
                  secondary={idLabel}
                />
              );
            })}
          </div>
        </fieldset>
      ) : null}
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
  return (
    <>
      <h1>{selection.guided ? family.familyName : selected.displayName}</h1>
      {selection.selectionComplete ? (
        <p className="product-sku">
          SKU <strong>{selected.sku}</strong>
        </p>
      ) : (
        <p className="product-sku">
          {selected.productType === "hose_end" && selection.connectionDash
            ? "Choose a Hose Tail Dash to continue."
            : "Choose a size to continue."}
        </p>
      )}

      {selected.productType === "hose" ? (
        <HoseSizePicker
          family={family}
          selectedSku={selected.sku}
          selectionComplete={selection.selectionComplete}
          selectSku={selection.selectSku}
        />
      ) : selected.productType === "hose_end" ? (
        <HoseEndSizePicker
          connectionDash={selection.connectionDash}
          family={family}
          hoseTailDash={selection.hoseTailDash}
          selectConnection={selection.selectConnection}
          selectTail={selection.selectTail}
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
  connectionDash: DashSize | null;
  guided: boolean;
  hoseTailDash: DashSize | null;
  selectConnection: (dash: DashSize) => void;
  selectionComplete: boolean;
  selectSku: (sku: string) => void;
  selectTail: (dash: DashSize | null, sku: string) => void;
}

export function useProductVariantSelection({
  selected,
  selectionRequested,
}: {
  selected: PublicCatalogItem;
  selectionRequested: boolean;
}): ProductVariantSelectionModel {
  const navigate = useNavigate();
  const selectedHoseEnd =
    selected.variantSelection?.kind === "hose_end"
      ? selected.variantSelection
      : null;
  const [connectionDash, setConnectionDash] = useState<DashSize | null>(
    selectionRequested ? (selectedHoseEnd?.connectionDash ?? null) : null,
  );
  const [hoseTailDash, setHoseTailDash] = useState<DashSize | null>(
    selectionRequested ? (selectedHoseEnd?.hoseTailDash ?? null) : null,
  );
  const [navigationPending, setNavigationPending] = useState(false);
  const guided =
    selected.productType === "hose" || selected.productType === "hose_end";
  const selectionComplete =
    !guided ||
    (selected.productType === "hose"
      ? selectionRequested && !navigationPending
      : Boolean(
          selectionRequested &&
          !navigationPending &&
          connectionDash &&
          hoseTailDash &&
          connectionDash === selectedHoseEnd?.connectionDash &&
          hoseTailDash === selectedHoseEnd.hoseTailDash,
        ));

  useEffect(() => {
    setConnectionDash(
      selectionRequested ? (selectedHoseEnd?.connectionDash ?? null) : null,
    );
    setHoseTailDash(
      selectionRequested ? (selectedHoseEnd?.hoseTailDash ?? null) : null,
    );
    setNavigationPending(false);
  }, [selected.sku, selectionRequested]);

  const beginSkuNavigation = (sku: string) => {
    setNavigationPending(true);
    navigateToSku(navigate, sku);
  };

  return {
    connectionDash,
    guided,
    hoseTailDash,
    selectConnection: (dash) => {
      setConnectionDash(dash);
      setHoseTailDash(null);
    },
    selectionComplete,
    selectSku: beginSkuNavigation,
    selectTail: (dash, sku) => {
      setHoseTailDash(dash);
      beginSkuNavigation(sku);
    },
  };
}
