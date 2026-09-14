import type { QuoteRequestLine } from "../../quote-request/domain/quote-request";

export interface QuotedLinePrice {
  unitPriceCents: number | null;
  discountBasisPoints: number;
}

export function parseUsdCents(value: string): number {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error(
      "Enter a non-negative USD amount with at most two decimals",
    );
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function parseDiscount(value: string): number {
  const basisPoints = parseUsdCents(value);
  if (basisPoints > 10000)
    throw new Error("Discount must be between 0 and 100 percent");
  return basisPoints;
}

export function quotedQuantity(line: QuoteRequestLine): number {
  const quantity =
    line.lineKind === "length_based_hose"
      ? line.lengthOrder.totalFootage
      : line.quantity;
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("Invalid captured quantity");
  return quantity;
}

export function quoteLineTotals(
  line: QuoteRequestLine,
  price: QuotedLinePrice,
) {
  const quantity = quotedQuantity(line);
  if (
    !price ||
    !Number.isInteger(price.discountBasisPoints) ||
    price.discountBasisPoints < 0 ||
    price.discountBasisPoints > 10000
  )
    throw new Error("Invalid discount");
  if (price.unitPriceCents === null)
    return {
      quantity,
      undiscountedCents: null,
      discountCents: null,
      totalCents: null,
    };
  if (
    !Number.isSafeInteger(price.unitPriceCents) ||
    price.unitPriceCents < 0 ||
    !Number.isInteger(price.discountBasisPoints) ||
    price.discountBasisPoints < 0 ||
    price.discountBasisPoints > 10000
  )
    throw new Error("Invalid quoted price");
  const raw = quantity * price.unitPriceCents;
  const undiscountedCents = Math.round(raw);
  const totalCents = Math.round(
    (raw * (10000 - price.discountBasisPoints)) / 10000,
  );
  if (
    !Number.isSafeInteger(undiscountedCents) ||
    !Number.isSafeInteger(totalCents)
  )
    throw new Error("Quote amount exceeds supported range");
  return {
    quantity,
    undiscountedCents,
    discountCents: undiscountedCents - totalCents,
    totalCents,
  };
}

export function initialQuotePrices(
  lines: QuoteRequestLine[],
): QuotedLinePrice[] {
  if (!Array.isArray(lines) || !lines.length)
    throw new Error("RFQ has no captured lines");
  return lines.map((line) => {
    quotedQuantity(line);
    return { unitPriceCents: null, discountBasisPoints: 0 };
  });
}
