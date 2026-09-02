import type { PurchasingContextKind } from "../../customer-identity/domain/customer-account";

export interface RfqPreparationAmounts {
  duties: number | null;
  freight: number | null;
  importCharges: number | null;
  insurance: number | null;
  merchandise: number;
  serviceFees: number;
  tax: number | null;
}

export type RfqPreparationOutcome =
  | {
      allowed: false;
      code:
        | "INCOMPLETE_PRICING"
        | "MINIMUM_NOT_MET"
        | "PURCHASING_CONTEXT_REQUIRED"
        | "ORGANIZATION_REQUIRED";
      fulfillmentTerm: null;
    }
  | {
      allowed: true;
      code: "INDIVIDUAL_DDP" | "ORGANIZATION_DDP" | "ORGANIZATION_DAP";
      fulfillmentTerm: "DAP" | "DDP";
    };

export interface RfqPreparationEvaluation {
  merchandiseSubtotal: number;
  outcome: RfqPreparationOutcome;
}

function cents(amount: number, label: string) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be a finite, non-negative amount.`);
  }
  const amountInCents = amount * 100;
  const roundedCents = Math.round(amountInCents);
  if (Math.abs(amountInCents - roundedCents) > 0.000_001) {
    throw new Error(`${label} must not contain fractional cents.`);
  }
  return roundedCents;
}

export function evaluateRfqPreparation(input: {
  amounts: RfqPreparationAmounts;
  pricingComplete: boolean;
  purchasingContextKind: PurchasingContextKind | null;
}): RfqPreparationEvaluation {
  const merchandiseCents = cents(
    input.amounts.merchandise,
    "Merchandise subtotal",
  );

  // These amounts are intentionally not added to the eligibility subtotal.
  cents(input.amounts.serviceFees, "Service fees");
  for (const [label, amount] of [
    ["Freight", input.amounts.freight],
    ["Tax", input.amounts.tax],
    ["Duties", input.amounts.duties],
    ["Import charges", input.amounts.importCharges],
    ["Insurance", input.amounts.insurance],
  ] as const) {
    if (amount !== null) cents(amount, label);
  }

  const result = (
    outcome: RfqPreparationOutcome,
  ): RfqPreparationEvaluation => ({
    merchandiseSubtotal: merchandiseCents / 100,
    outcome,
  });

  if (!input.pricingComplete) {
    return result({
      allowed: false,
      code: "INCOMPLETE_PRICING",
      fulfillmentTerm: null,
    });
  }

  if (merchandiseCents < 10_000) {
    return result({
      allowed: false,
      code: "MINIMUM_NOT_MET",
      fulfillmentTerm: null,
    });
  }

  if (input.purchasingContextKind === null) {
    return result({
      allowed: false,
      code: "PURCHASING_CONTEXT_REQUIRED",
      fulfillmentTerm: null,
    });
  }

  if (input.purchasingContextKind === "individual") {
    return merchandiseCents <= 450_000
      ? result({
          allowed: true,
          code: "INDIVIDUAL_DDP",
          fulfillmentTerm: "DDP",
        })
      : result({
          allowed: false,
          code: "ORGANIZATION_REQUIRED",
          fulfillmentTerm: null,
        });
  }

  return merchandiseCents <= 300_000
    ? result({
        allowed: true,
        code: "ORGANIZATION_DDP",
        fulfillmentTerm: "DDP",
      })
    : result({
        allowed: true,
        code: "ORGANIZATION_DAP",
        fulfillmentTerm: "DAP",
      });
}
