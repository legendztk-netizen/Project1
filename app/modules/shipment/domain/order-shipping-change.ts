export const splitShipmentIdForChange = (requestId: string) =>
  `shipment:change:${requestId}`;

export interface ShippingCreditAllocation {
  logisticsCents: number;
  taxCents: number;
}

/** Allocate a negative Order Change adjustment to the original paid components. */
export function shippingCreditAllocation(
  adjustmentCents: number,
  taxCreditCents = 0,
): ShippingCreditAllocation {
  const creditCents = Math.max(0, -adjustmentCents);
  if (
    !Number.isSafeInteger(taxCreditCents) ||
    taxCreditCents < 0 ||
    taxCreditCents > creditCents
  )
    throw new Response(
      "Sales Tax credit must be between zero and the total credit",
      { status: 400 },
    );
  return {
    logisticsCents: creditCents - taxCreditCents,
    taxCents: taxCreditCents,
  };
}
