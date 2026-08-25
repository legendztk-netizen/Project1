import { describe, expect, it } from "vitest";

import type { PublicLengthOrdering } from "../app/modules/catalog/domain/public-catalog";
import {
  calculateLengthBasedHoseEstimate,
  lengthBasedHoseLineIdentity,
  parseLengthBasedHoseOrder,
} from "../app/modules/quote-list/domain/length-based-hose";

const ordering: PublicLengthOrdering = {
  cuttingLabelingFee: {
    currency: "USD",
    ratePerPiece: 1.25,
    scope: "series:601R1",
    version: 3,
  },
  incrementFt: 1,
  minimumLengthFt: 1,
  presetsFt: [25, 50, 100],
  unit: "ft",
};

describe("length-based hose ordering", () => {
  it("requires both length and number of pieces", () => {
    expect(
      parseLengthBasedHoseOrder(
        { lengthPerPiece: "", lengthUnit: "ft", pieceCount: "" },
        ordering,
      ),
    ).toEqual({
      fieldErrors: {
        lengthPerPiece: "Enter the length of each piece.",
        pieceCount: "Enter the number of pieces.",
      },
      ok: false,
    });
  });

  it.each([25, 50, 100])(
    "normalizes the %i ft shortcut without changing its entered unit",
    (length) => {
      expect(
        parseLengthBasedHoseOrder(
          {
            lengthPerPiece: String(length),
            lengthUnit: "ft",
            pieceCount: "2",
          },
          ordering,
        ),
      ).toEqual({
        ok: true,
        value: {
          normalizedLengthFt: length,
          originalLengthUnit: "ft",
          originalLengthValue: length,
          pieceCount: 2,
          totalFootage: length * 2,
        },
      });
    },
  );

  it("rejects unsupported units, fractional values and invalid increments", () => {
    expect(
      parseLengthBasedHoseOrder(
        { lengthPerPiece: "5", lengthUnit: "m", pieceCount: "1.5" },
        { ...ordering, incrementFt: 2, minimumLengthFt: 2 },
      ),
    ).toEqual({
      fieldErrors: {
        lengthPerPiece: "Length must use 2 ft increments.",
        lengthUnit: "Only feet (ft) are supported for cut hose.",
        pieceCount: "Pieces must be a whole number from 1 to 9,999.",
      },
      ok: false,
    });
  });

  it("calculates merchandise and per-piece fees independently", () => {
    const parsed = parseLengthBasedHoseOrder(
      { lengthPerPiece: "50", lengthUnit: "ft", pieceCount: "2" },
      ordering,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Expected a valid hose order.");

    expect(
      calculateLengthBasedHoseEstimate({
        feeRatePerPiece: 1.25,
        order: parsed.value,
        referencePricePerFoot: 2.16,
      }),
    ).toEqual({
      currentEstimateAmount: 218.5,
      cuttingLabelingFeeAmount: 2.5,
      estimatedMerchandiseAmount: 216,
    });
  });

  it("merges only an exact SKU and normalized cut length", () => {
    expect(lengthBasedHoseLineIdentity("601R1_001", 50)).toBe(
      lengthBasedHoseLineIdentity("601R1_001", 50),
    );
    expect(lengthBasedHoseLineIdentity("601R1_001", 50)).not.toBe(
      lengthBasedHoseLineIdentity("601R1_001", 25),
    );
    expect(lengthBasedHoseLineIdentity("601R1_001", 50)).not.toBe(
      lengthBasedHoseLineIdentity("601R1_002", 50),
    );
  });
});
