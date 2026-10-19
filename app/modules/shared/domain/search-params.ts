/** One of the allowed values, or the fallback (by default the first option). */
export function choiceParam<T extends string>(
  value: string | null,
  options: readonly T[],
  fallback: T = options[0],
): T {
  return options.find((option) => option === value) ?? fallback;
}

/** A `YYYY-MM-DD` calendar date, or "" for anything else. */
export function isoDateParam(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
