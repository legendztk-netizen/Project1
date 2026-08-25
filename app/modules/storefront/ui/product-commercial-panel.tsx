import { FileText } from "lucide-react";
import { useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";

import type { SupplyAvailability } from "../../catalog/domain/catalog-draft-availability";
import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import {
  calculateLengthBasedHoseEstimate,
  parseLengthBasedHoseOrder,
  type LengthBasedHoseFieldErrors,
} from "../../quote-list/domain/length-based-hose";

const availabilityLabels: Record<SupplyAvailability, string> = {
  available_for_quote: "Available for Quote",
  discontinued: "Discontinued",
  temporarily_unavailable: "Temporarily Unavailable",
};

interface LengthOrderActionData {
  fieldErrors?: LengthBasedHoseFieldErrors;
  formError?: string;
  sku?: string;
  values?: {
    lengthPerPiece: string;
    lengthUnit: string;
    pieceCount: string;
  };
}

function LengthBasedHoseOrderForm({
  selected,
}: {
  selected: PublicCatalogItem;
}) {
  const actionData = useActionData<LengthOrderActionData>();
  const navigation = useNavigation();
  const submitted = actionData?.sku === selected.sku ? actionData : null;
  const [lengthPerPiece, setLengthPerPiece] = useState(
    submitted?.values?.lengthPerPiece ?? "",
  );
  const [pieceCount, setPieceCount] = useState(
    submitted?.values?.pieceCount ?? "",
  );
  const ordering = selected.offer?.lengthOrdering;

  if (!selected.offer || !ordering) {
    return (
      <p className="availability-note">
        Length ordering details are not available for this hose.
      </p>
    );
  }

  const parsed = parseLengthBasedHoseOrder(
    {
      lengthPerPiece,
      lengthUnit: ordering.unit,
      pieceCount,
    },
    ordering,
  );
  const estimate = parsed.ok
    ? calculateLengthBasedHoseEstimate({
        feeRatePerPiece: ordering.cuttingLabelingFee.ratePerPiece,
        order: parsed.value,
        referencePricePerFoot: selected.offer.referencePrice,
      })
    : null;
  const canSubmit =
    selected.canAddToQuote && parsed.ok && navigation.state === "idle";
  const errors = submitted?.fieldErrors;
  const lengthError = errors?.lengthPerPiece ?? errors?.lengthUnit;

  return (
    <Form className="length-order-form" method="post">
      <input name="intent" type="hidden" value="add-length-hose" />
      <input name="sku" type="hidden" value={selected.sku} />
      <input name="lengthUnit" type="hidden" value={ordering.unit} />

      <fieldset className="length-shortcuts">
        <legend>Length per piece</legend>
        <div aria-label="Common hose lengths" className="length-shortcut-row">
          {ordering.presetsFt.map((preset) => (
            <button
              aria-pressed={lengthPerPiece === String(preset)}
              className="length-shortcut"
              key={preset}
              onClick={() => setLengthPerPiece(String(preset))}
              type="button"
            >
              {preset} ft
            </button>
          ))}
        </div>
      </fieldset>

      <div className="length-order-fields">
        <label>
          <span>Length per piece</span>
          <span className="length-input-shell">
            <input
              aria-describedby={lengthError ? "length-error" : undefined}
              aria-invalid={Boolean(lengthError)}
              inputMode="numeric"
              min={ordering.minimumLengthFt}
              name="lengthPerPiece"
              onChange={(event) => setLengthPerPiece(event.currentTarget.value)}
              placeholder="Enter length"
              required
              step={ordering.incrementFt}
              type="number"
              value={lengthPerPiece}
            />
            <strong>ft</strong>
          </span>
          {lengthError ? (
            <small className="field-error" id="length-error" role="alert">
              {lengthError}
            </small>
          ) : null}
        </label>
        <label>
          <span>Number of pieces</span>
          <input
            aria-describedby={errors?.pieceCount ? "pieces-error" : undefined}
            aria-invalid={Boolean(errors?.pieceCount)}
            inputMode="numeric"
            max="9999"
            min="1"
            name="pieceCount"
            onChange={(event) => setPieceCount(event.currentTarget.value)}
            placeholder="Enter pieces"
            required
            step="1"
            type="number"
            value={pieceCount}
          />
          {errors?.pieceCount ? (
            <small className="field-error" id="pieces-error" role="alert">
              {errors.pieceCount}
            </small>
          ) : null}
        </label>
      </div>

      {parsed.ok ? (
        <div className="length-order-estimate" aria-live="polite">
          <p>
            <strong>
              {parsed.value.originalLengthValue} ft x {parsed.value.pieceCount}{" "}
              {parsed.value.pieceCount === 1 ? "piece" : "pieces"}
            </strong>
            <span>= {parsed.value.totalFootage} total ft</span>
          </p>
          <p>
            <span>Current non-binding estimate</span>
            <strong>
              {estimate?.currentEstimateAmount == null
                ? "Price on quote"
                : `USD ${estimate.currentEstimateAmount.toFixed(2)}`}
            </strong>
          </p>
          {ordering.cuttingLabelingFee.ratePerPiece > 0 ? (
            <small>
              Includes USD {estimate?.cuttingLabelingFeeAmount.toFixed(2)}{" "}
              Cutting &amp; Labeling Fee.
            </small>
          ) : null}
        </div>
      ) : (
        <p className="length-order-prompt">
          Enter length and pieces to calculate total footage.
        </p>
      )}

      {submitted?.formError ? (
        <p className="field-error" role="alert">
          {submitted.formError}
        </p>
      ) : null}

      <button
        className="button button-primary product-quote-command"
        data-command="add-length-hose-to-quote"
        data-sku={selected.sku}
        disabled={!canSubmit}
        type="submit"
      >
        <FileText size={18} /> Add to Quote
      </button>
    </Form>
  );
}

export function ProductCommercialPanel({
  selectionComplete,
  selected,
}: {
  selectionComplete: boolean;
  selected: PublicCatalogItem;
}) {
  const offer = selectionComplete ? selected.offer : null;
  const standardProductReady = Boolean(
    selectionComplete && selected.canAddToQuote && offer && !offer.madeToOrder,
  );
  return (
    <>
      <div className="product-commercials">
        <div>
          <span>Reference Price</span>
          <strong>
            {!selectionComplete
              ? "Complete size selection"
              : offer?.referencePrice == null
                ? "Price on quote"
                : `USD ${offer.referencePrice.toFixed(2)} / ${offer.salesUnit.toLocaleLowerCase()}`}
          </strong>
          <small>
            Non-binding reference; final pricing is confirmed in your quote.
          </small>
        </div>
        <div>
          <span>Supply Availability</span>
          <strong>
            {selectionComplete
              ? availabilityLabels[selected.supplyAvailability]
              : "Complete size selection"}
          </strong>
          <small>
            {selectionComplete && offer
              ? `${offer.leadTimeDays} business day processing estimate`
              : "Processing time confirmed after size selection"}
          </small>
        </div>
      </div>

      {selectionComplete && offer?.madeToOrder ? (
        <LengthBasedHoseOrderForm key={selected.sku} selected={selected} />
      ) : (
        <Form action="/quote-list" method="post">
          <input name="intent" type="hidden" value="add" />
          <input name="sku" type="hidden" value={selected.sku} />
          <input name="quantity" type="hidden" value="1" />
          <button
            className="button button-primary product-quote-command"
            data-command="add-to-quote"
            data-sku={selectionComplete ? selected.sku : undefined}
            disabled={!standardProductReady}
            type="submit"
          >
            <FileText size={18} /> Add to Quote
          </button>
        </Form>
      )}
      {!selectionComplete ? (
        <p className="availability-note">
          Complete the size selection before adding this product to your quote.
        </p>
      ) : !selected.canAddToQuote ? (
        <p className="availability-note">
          This variant can be viewed but is not currently available to add to a
          quote.
        </p>
      ) : null}
    </>
  );
}
