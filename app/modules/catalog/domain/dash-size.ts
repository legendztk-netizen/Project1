export type DashSize = `-${number}`;

export function normalizeDashSize(value: string | null): DashSize | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized.replace(/^-/, ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? `-${parsed}` : null;
}

export function compareDashSizes(
  left: DashSize | null,
  right: DashSize | null,
) {
  const value = (dash: DashSize | null) =>
    dash ? Number.parseInt(dash.slice(1), 10) : Number.POSITIVE_INFINITY;
  return value(left) - value(right);
}

export function nominalInchesFromDash(value: DashSize | null) {
  return value ? Number.parseInt(value.slice(1), 10) / 16 : null;
}
