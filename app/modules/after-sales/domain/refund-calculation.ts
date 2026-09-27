import { LAUNCH_RETURN_POLICY } from "./return-policy";

function cents(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Response(`${label} must be whole USD cents`, { status: 400 });
  return value;
}

/**
 * Allocates a line's discounted USD total across physical units by cumulative
 * quantity, so repeated partial credits always sum exactly to the line total
 * and can never exceed it. `priorQuantity` units were credited already.
 */
export function cumulativeLineAmount(
  lineTotalCents: number,
  lineQuantity: number,
  priorQuantity: number,
  quantity: number,
) {
  cents(lineTotalCents, "Line total");
  if (
    !Number.isSafeInteger(lineQuantity) ||
    lineQuantity < 1 ||
    !Number.isSafeInteger(priorQuantity) ||
    priorQuantity < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0 ||
    priorQuantity + quantity > lineQuantity
  )
    throw new Response("Refunded quantity exceeds purchased quantity", {
      status: 409,
    });
  const upTo = (units: number) =>
    Math.floor((lineTotalCents * units) / lineQuantity);
  return upTo(priorQuantity + quantity) - upTo(priorQuantity);
}

/** Cumulative 10% restocking fee so partial decisions cannot over-deduct. */
export function cumulativeRestockingFee(
  priorMerchandiseCents: number,
  merchandiseCents: number,
) {
  cents(priorMerchandiseCents, "Prior merchandise");
  cents(merchandiseCents, "Merchandise");
  const fee = (amount: number) =>
    Math.round(
      (amount * LAUNCH_RETURN_POLICY.restockingFeeBasisPoints) / 10000,
    );
  return (
    fee(priorMerchandiseCents + merchandiseCents) - fee(priorMerchandiseCents)
  );
}

export interface RefundComponents {
  merchandiseCents: number;
  logisticsCents: number;
  sellerLogisticsCents: number;
  taxCents: number;
  serviceFeeCents: number;
  restockingFeeCents: number;
  thirdPartyCostCents: number;
}

export function refundComponents(input: Partial<RefundComponents>) {
  const value: RefundComponents = {
    merchandiseCents: cents(input.merchandiseCents ?? 0, "Merchandise"),
    logisticsCents: cents(input.logisticsCents ?? 0, "Logistics"),
    sellerLogisticsCents: cents(
      input.sellerLogisticsCents ?? 0,
      "Seller-funded logistics",
    ),
    taxCents: cents(input.taxCents ?? 0, "Sales Tax"),
    serviceFeeCents: cents(input.serviceFeeCents ?? 0, "Service fee"),
    restockingFeeCents: cents(input.restockingFeeCents ?? 0, "Restocking fee"),
    thirdPartyCostCents: cents(
      input.thirdPartyCostCents ?? 0,
      "Third-party cost",
    ),
  };
  const grossCents =
    value.merchandiseCents +
    value.logisticsCents +
    value.sellerLogisticsCents +
    value.taxCents +
    value.serviceFeeCents;
  const refundCents =
    grossCents - value.restockingFeeCents - value.thirdPartyCostCents;
  if (refundCents < 0)
    throw new Response("Deductions cannot exceed the gross refund", {
      status: 400,
    });
  return { ...value, grossCents, refundCents };
}

export type CalculatedRefund = ReturnType<typeof refundComponents>;

export const usd = (value: number) =>
  `${value < 0 ? "-" : ""}USD ${(Math.abs(value) / 100).toFixed(2)}`;

/** Parses a USD amount typed by Admin (e.g. "12.30") into integer cents. */
export function parseUsdCents(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return 0;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text))
    throw new Response(`${label} must be a USD amount`, { status: 400 });
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
