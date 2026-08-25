import type { PublicLengthOrdering } from "../../catalog/domain/public-catalog";
import { maximumStandardProductQuantity } from "./anonymous-quote-session";

export interface LengthBasedHoseFieldErrors {
  lengthPerPiece?: string;
  lengthUnit?: string;
  pieceCount?: string;
}

export interface LengthBasedHoseOrder {
  normalizedLengthFt: number;
  originalLengthUnit: "ft";
  originalLengthValue: number;
  pieceCount: number;
  totalFootage: number;
}

export type LengthBasedHoseParseResult =
  | { fieldErrors: LengthBasedHoseFieldErrors; ok: false }
  | { ok: true; value: LengthBasedHoseOrder };

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveWholeNumber(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function parseLengthBasedHoseOrder(
  input: {
    lengthPerPiece: FormDataEntryValue | null;
    lengthUnit: FormDataEntryValue | null;
    pieceCount: FormDataEntryValue | null;
  },
  ordering: PublicLengthOrdering,
): LengthBasedHoseParseResult {
  const fieldErrors: LengthBasedHoseFieldErrors = {};
  const originalLength = text(input.lengthPerPiece);
  const unit = text(input.lengthUnit).toLocaleLowerCase();
  const pieces = text(input.pieceCount);
  const originalLengthValue = positiveWholeNumber(originalLength);
  const pieceCount = positiveWholeNumber(pieces);

  if (!originalLength) {
    fieldErrors.lengthPerPiece = "Enter the length of each piece.";
  } else if (originalLengthValue === null) {
    fieldErrors.lengthPerPiece = "Length must be a positive whole number.";
  } else if (originalLengthValue < ordering.minimumLengthFt) {
    fieldErrors.lengthPerPiece = `Minimum length is ${ordering.minimumLengthFt} ft.`;
  } else if (
    (originalLengthValue - ordering.minimumLengthFt) % ordering.incrementFt !==
    0
  ) {
    fieldErrors.lengthPerPiece = `Length must use ${ordering.incrementFt} ft increments.`;
  }

  if (!unit) {
    fieldErrors.lengthUnit = "Select a length unit.";
  } else if (unit !== ordering.unit) {
    fieldErrors.lengthUnit = "Only feet (ft) are supported for cut hose.";
  }

  if (!pieces) {
    fieldErrors.pieceCount = "Enter the number of pieces.";
  } else if (
    pieceCount === null ||
    pieceCount > maximumStandardProductQuantity
  ) {
    fieldErrors.pieceCount = "Pieces must be a whole number from 1 to 9,999.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, ok: false };
  }

  const normalizedLengthFt = originalLengthValue!;
  const totalFootage = normalizedLengthFt * pieceCount!;
  if (!Number.isSafeInteger(totalFootage)) {
    return {
      fieldErrors: {
        lengthPerPiece: "The requested total length is too large to calculate.",
      },
      ok: false,
    };
  }

  return {
    ok: true,
    value: {
      normalizedLengthFt,
      originalLengthUnit: "ft",
      originalLengthValue: originalLengthValue!,
      pieceCount: pieceCount!,
      totalFootage,
    },
  };
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateLengthBasedHoseEstimate(input: {
  feeRatePerPiece: number;
  order: LengthBasedHoseOrder;
  referencePricePerFoot: number | null;
}) {
  const cuttingLabelingFeeAmount = money(
    input.feeRatePerPiece * input.order.pieceCount,
  );
  const estimatedMerchandiseAmount =
    input.referencePricePerFoot === null
      ? null
      : money(input.referencePricePerFoot * input.order.totalFootage);
  return {
    currentEstimateAmount:
      estimatedMerchandiseAmount === null
        ? null
        : money(estimatedMerchandiseAmount + cuttingLabelingFeeAmount),
    cuttingLabelingFeeAmount,
    estimatedMerchandiseAmount,
  };
}

export function lengthBasedHoseLineIdentity(
  sku: string,
  normalizedLengthFt: number,
) {
  return `length-hose:${sku}:${normalizedLengthFt}ft`;
}
