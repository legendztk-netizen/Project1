export type DimensionUnit = "cm" | "in";
export type WeightUnit = "kg" | "lb";

export interface CartonGroup {
  count: number;
  dimensionUnit: DimensionUnit;
  length: number | null;
  width: number | null;
  height: number | null;
  weightUnit: WeightUnit;
  grossWeight: number | null;
}

export interface DimensionalDivisor {
  value: number;
  dimensionUnit: DimensionUnit;
  weightUnit: WeightUnit;
}

export interface ShipmentPackingDraft {
  cartons: CartonGroup[];
  dimensionalDivisor: DimensionalDivisor | null;
  notes: string;
}

function converted(value: number | null, factor: number) {
  return value === null ? null : Number((value * factor).toPrecision(8));
}

export function changeCartonDimensionUnit(
  carton: CartonGroup,
  unit: DimensionUnit,
): CartonGroup {
  if (carton.dimensionUnit === unit) return carton;
  const factor = unit === "in" ? 1 / 2.54 : 2.54;
  return {
    ...carton,
    dimensionUnit: unit,
    length: converted(carton.length, factor),
    width: converted(carton.width, factor),
    height: converted(carton.height, factor),
  };
}

export function changeCartonWeightUnit(
  carton: CartonGroup,
  unit: WeightUnit,
): CartonGroup {
  if (carton.weightUnit === unit) return carton;
  const factor = unit === "lb" ? 1 / 0.45359237 : 0.45359237;
  return {
    ...carton,
    weightUnit: unit,
    grossWeight: converted(carton.grossWeight, factor),
  };
}

export function changeDivisorDimensionUnit(
  divisor: DimensionalDivisor,
  unit: DimensionUnit,
): DimensionalDivisor {
  if (divisor.dimensionUnit === unit) return divisor;
  const factor = unit === "in" ? 1 / 2.54 : 2.54;
  return {
    ...divisor,
    dimensionUnit: unit,
    value: converted(divisor.value, factor ** 3)!,
  };
}

export function changeDivisorWeightUnit(
  divisor: DimensionalDivisor,
  unit: WeightUnit,
): DimensionalDivisor {
  if (divisor.weightUnit === unit) return divisor;
  const factor = unit === "lb" ? 1 / 0.45359237 : 0.45359237;
  return {
    ...divisor,
    weightUnit: unit,
    value: converted(divisor.value, 1 / factor)!,
  };
}

function positive(value: number | null, label: string) {
  if (
    value !== null &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 100000)
  )
    throw new Error(`${label} must be a positive measured value`);
}

export function validatedPackingDraft(
  input: ShipmentPackingDraft,
): ShipmentPackingDraft {
  if (!Array.isArray(input.cartons) || input.cartons.length > 100)
    throw new Error("No more than 100 carton groups are allowed");
  if (typeof input.notes !== "string" || input.notes.length > 2000)
    throw new Error("Packing notes must be at most 2000 characters");
  if (input.dimensionalDivisor !== null) {
    const divisor = input.dimensionalDivisor;
    if (
      !divisor ||
      !["cm", "in"].includes(divisor.dimensionUnit) ||
      !["kg", "lb"].includes(divisor.weightUnit)
    )
      throw new Error("Explicit dimensional divisor units are required");
    positive(divisor.value, "Dimensional divisor");
  }
  return {
    notes: input.notes.trim(),
    dimensionalDivisor: input.dimensionalDivisor,
    cartons: input.cartons.map((carton) => {
      if (
        !Number.isSafeInteger(carton.count) ||
        carton.count < 1 ||
        carton.count > 10000
      )
        throw new Error("Carton count must be a positive whole number");
      if (
        !["cm", "in"].includes(carton.dimensionUnit) ||
        !["kg", "lb"].includes(carton.weightUnit)
      )
        throw new Error("Explicit carton units are required");
      positive(carton.length, "Carton length");
      positive(carton.width, "Carton width");
      positive(carton.height, "Carton height");
      positive(carton.grossWeight, "Carton gross weight");
      const measurements = [carton.length, carton.width, carton.height];
      if (
        measurements.some((value) => value !== null) &&
        measurements.some((value) => value === null)
      )
        throw new Error(
          "Enter all three carton dimensions or leave them blank",
        );
      return {
        count: carton.count,
        dimensionUnit: carton.dimensionUnit,
        length: carton.length,
        width: carton.width,
        height: carton.height,
        weightUnit: carton.weightUnit,
        grossWeight: carton.grossWeight,
      };
    }),
  };
}

export function packingTotals(input: ShipmentPackingDraft) {
  const packing = validatedPackingDraft(input);
  const cartonCount = packing.cartons.reduce(
    (sum, carton) => sum + carton.count,
    0,
  );
  const grossKg =
    packing.cartons.length &&
    packing.cartons.every((carton) => carton.grossWeight !== null)
      ? packing.cartons.reduce(
          (sum, carton) =>
            sum +
            carton.count *
              carton.grossWeight! *
              (carton.weightUnit === "lb" ? 0.45359237 : 1),
          0,
        )
      : null;
  const dimensionalKg =
    packing.cartons.length &&
    packing.dimensionalDivisor &&
    packing.cartons.every((carton) => carton.length !== null)
      ? packing.cartons.reduce((sum, carton) => {
          const dimensionFactor =
            carton.dimensionUnit === packing.dimensionalDivisor!.dimensionUnit
              ? 1
              : carton.dimensionUnit === "cm"
                ? 1 / 2.54
                : 2.54;
          const weightFactor =
            packing.dimensionalDivisor!.weightUnit === "lb" ? 0.45359237 : 1;
          return (
            sum +
            (carton.count *
              carton.length! *
              carton.width! *
              carton.height! *
              dimensionFactor ** 3 *
              weightFactor) /
              packing.dimensionalDivisor!.value
          );
        }, 0)
      : null;
  if (
    (grossKg !== null && !Number.isFinite(grossKg)) ||
    (dimensionalKg !== null && !Number.isFinite(dimensionalKg))
  )
    throw new Error("Packing totals exceed supported measurement limits");
  return { cartonCount, grossKg, dimensionalKg };
}
