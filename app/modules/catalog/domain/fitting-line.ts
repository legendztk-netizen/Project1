// One-piece crimp Hose Ends pair with hoses by Fitting Line (ADR 0056).
export const fittingLines = ["B", "W", "JJ", "SS", "SSW"] as const;
export type FittingLine = (typeof fittingLines)[number];
export const acceptedFittingLineValues = ["B", "W", "JJ"] as const;
export type AcceptedFittingLine = (typeof acceptedFittingLineValues)[number];

const pairingLines: Record<FittingLine, AcceptedFittingLine> = {
  B: "B",
  W: "W",
  JJ: "JJ",
  SS: "B",
  SSW: "W",
};

export function isFittingLine(value: unknown): value is FittingLine {
  return fittingLines.includes(value as FittingLine);
}

/** Stainless lines pair like their carbon-steel counterparts. */
export function pairingLine(line: FittingLine): AcceptedFittingLine {
  return pairingLines[line];
}

/** Parse "B,W" (commas, slashes, semicolons, spaces, full-width too); null when blank, undefined when invalid. */
export function parseAcceptedFittingLines(
  value: string | null | undefined,
): AcceptedFittingLine[] | null | undefined {
  const parts = String(value ?? "")
    .toUpperCase()
    .split(/[\s,;/、，；]+/u)
    .filter(Boolean);
  if (!parts.length) return null;
  if (
    parts.some(
      (part) =>
        !acceptedFittingLineValues.includes(part as AcceptedFittingLine),
    )
  )
    return undefined;
  return acceptedFittingLineValues.filter((line) => parts.includes(line));
}

export function formatAcceptedFittingLines(lines: AcceptedFittingLine[]) {
  return lines.join(",");
}

export const crimpDiameterKeys = {
  B: "crimpDiameterBMm",
  W: "crimpDiameterWMm",
  JJ: "crimpDiameterJjMm",
} as const satisfies Record<AcceptedFittingLine, string>;

export interface OnePieceHose {
  acceptedFittingLines?: string | null;
  crimpDiameterBMm?: number | string | null;
  crimpDiameterWMm?: number | string | null;
  crimpDiameterJjMm?: number | string | null;
}

/** The accepted line a one-piece Hose End pairs through, or null when this hose does not accept it. */
export function acceptedLineFor(
  hose: OnePieceHose,
  fittingLine: string | null | undefined,
): AcceptedFittingLine | null {
  if (!isFittingLine(fittingLine)) return null;
  const line = pairingLine(fittingLine);
  return parseAcceptedFittingLines(hose.acceptedFittingLines)?.includes(line)
    ? line
    : null;
}

export function referenceCrimpDiameterMm(
  hose: OnePieceHose,
  line: AcceptedFittingLine,
) {
  const value = hose[crimpDiameterKeys[line]];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
