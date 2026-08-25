import {
  nominalInchesFromDash,
  type DashSize,
} from "../../catalog/domain/dash-size";

export function displayDash(value: DashSize | null) {
  return value ?? "Not specified";
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
}

function formatInches(value: number) {
  const sixteenths = Math.round(value * 16);
  const wholeInches = Math.floor(sixteenths / 16);
  const remainder = sixteenths % 16;
  if (remainder === 0) return `${wholeInches}`;
  const divisor = greatestCommonDivisor(remainder, 16);
  const fraction = `${remainder / divisor}/${16 / divisor}`;
  return `${wholeInches ? `${wholeInches} ` : ""}${fraction}`;
}

export function hoseIdLabel(
  nominalIdIn: number | null,
  fallbackDash: DashSize | null,
) {
  const size = hoseSizeLabel(nominalIdIn, fallbackDash);
  return size === null ? "Hose ID not specified" : `${size} hose ID`;
}

export function hoseSizeLabel(
  nominalIdIn: number | null,
  fallbackDash: DashSize | null,
) {
  const value = nominalIdIn ?? nominalInchesFromDash(fallbackDash);
  return value === null ? null : `${formatInches(value)} in`;
}
