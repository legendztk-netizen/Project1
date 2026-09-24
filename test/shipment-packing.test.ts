import { describe, expect, it } from "vitest";
import {
  changeCartonDimensionUnit,
  changeCartonWeightUnit,
  changeDivisorDimensionUnit,
  changeDivisorWeightUnit,
  packingTotals,
  validatedPackingDraft,
  type ShipmentPackingDraft,
} from "../app/modules/shipment/domain/shipment-packing";

const draft: ShipmentPackingDraft = {
  cartons: [
    {
      count: 2,
      dimensionUnit: "cm",
      length: 50,
      width: 40,
      height: 30,
      weightUnit: "kg",
      grossWeight: 12,
    },
  ],
  dimensionalDivisor: {
    value: 5000,
    dimensionUnit: "cm",
    weightUnit: "kg",
  },
  notes: "Two matching cartons",
};

describe("shipment packing", () => {
  it("counts identical cartons without treating them as product quantity", () => {
    expect(packingTotals(draft)).toEqual({
      cartonCount: 2,
      grossKg: 24,
      dimensionalKg: 24,
    });
  });

  it("does not invent dimensional or gross weight from missing measurements", () => {
    expect(
      packingTotals({
        ...draft,
        cartons: [{ ...draft.cartons[0], grossWeight: null }],
        dimensionalDivisor: null,
        notes: "Packing list uploaded separately",
      }),
    ).toEqual({ cartonCount: 2, grossKg: null, dimensionalKg: null });
    expect(
      packingTotals({
        cartons: [],
        dimensionalDivisor: null,
        notes: "Packing list only",
      }),
    ).toEqual({ cartonCount: 0, grossKg: null, dimensionalKg: null });
  });

  it("requires complete dimensions and explicit divisor units", () => {
    expect(() =>
      validatedPackingDraft({
        ...draft,
        cartons: [{ ...draft.cartons[0], width: null }],
      }),
    ).toThrow(/all three/);
    expect(() =>
      validatedPackingDraft({
        ...draft,
        dimensionalDivisor: undefined,
      } as unknown as ShipmentPackingDraft),
    ).toThrow(/Explicit dimensional divisor units/);
  });

  it("converts explicitly entered imperial weights only for the summary", () => {
    expect(
      packingTotals({
        cartons: [
          {
            ...draft.cartons[0],
            count: 1,
            dimensionUnit: "in",
            length: 10,
            width: 10,
            height: 10,
            weightUnit: "lb",
            grossWeight: 10,
          },
        ],
        dimensionalDivisor: {
          value: 166,
          dimensionUnit: "in",
          weightUnit: "lb",
        },
        notes: "",
      }).grossKg,
    ).toBeCloseTo(4.5359237);
  });

  it("rejects missing numeric fields and non-finite dimensional totals", () => {
    expect(() =>
      validatedPackingDraft({
        ...draft,
        cartons: [{ ...draft.cartons[0], length: undefined }],
      } as unknown as ShipmentPackingDraft),
    ).toThrow(/positive measured value/);
    expect(() =>
      packingTotals({
        ...draft,
        dimensionalDivisor: {
          value: 1e-310,
          dimensionUnit: "cm",
          weightUnit: "kg",
        },
      }),
    ).toThrow(/supported measurement limits/);
  });

  it("converts entered units without changing actual mass or volume", () => {
    const carton = changeCartonWeightUnit(
      changeCartonDimensionUnit(draft.cartons[0], "in"),
      "lb",
    );
    const divisor = changeDivisorWeightUnit(
      changeDivisorDimensionUnit(draft.dimensionalDivisor!, "in"),
      "lb",
    );
    const converted = packingTotals({
      cartons: [carton],
      dimensionalDivisor: divisor,
      notes: "",
    });
    expect(converted.grossKg).toBeCloseTo(24, 4);
    expect(converted.dimensionalKg).toBeCloseTo(24, 4);
    expect(carton.weightUnit).toBe("lb");
    expect(carton.dimensionUnit).toBe("in");
  });
});
