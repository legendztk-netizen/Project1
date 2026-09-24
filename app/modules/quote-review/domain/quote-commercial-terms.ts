import {
  validatedDeliveryAddress,
  type DeliveryAddressDraft,
} from "../../customer-identity/domain/customer-account";
import type { QuoteRequestSnapshot } from "../../quote-request/domain/quote-request";
import { quoteLineTotals, type QuotedLinePrice } from "./quote-pricing";
import {
  validatedShipmentGroups,
  type QuotedShipmentGroup,
} from "../../shipment/domain/shipment-plan";

export const commercialChargeKeys = [
  "freight",
  "insurance",
  "dutiesImport",
  "salesTax",
  "cuttingLabeling",
  "assemblyService",
  "protectionService",
] as const;
export type CommercialCharges = Record<
  (typeof commercialChargeKeys)[number],
  number
>;
export interface QuoteCommercialTerms {
  destination: DeliveryAddressDraft;
  addressConfirmed: boolean;
  addressReplacementReason: string;
  shipmentMode: "together" | "split";
  splitPlan: string;
  shipmentGroups?: QuotedShipmentGroup[];
  transportMethod: string;
  incoterm: "DDP" | "DAP";
  termReplacementReason: string;
  namedPlace: string;
  packingEstimate: string;
  freightReviewConfirmed: boolean;
  actualPacking: string;
  taxTreatment: "Collected" | "Exempt" | "Not Collected";
  taxEvidenceId: string | null;
  leadTime: string;
  charges: CommercialCharges;
  manualCurrencyConfirmed: boolean;
}

function required(value: string, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 4000)
    throw new Error(`${field} is required (maximum 4000 characters)`);
  return value.trim();
}

export function validateCommercialTerms(
  input: QuoteCommercialTerms,
  source: QuoteRequestSnapshot,
  options: { allowHistoricalUnstructuredSplit?: boolean } = {},
): QuoteCommercialTerms {
  const destination = validatedDeliveryAddress(input.destination);
  if (input.freightReviewConfirmed !== true)
    throw new Error(
      "Confirm packing estimate is sufficient for freight review",
    );
  if (
    typeof input.actualPacking !== "string" ||
    input.actualPacking.length > 4000
  )
    throw new Error("Invalid actual packing details");
  if (input.addressConfirmed !== true)
    throw new Error("Confirm final delivery address");
  const original = source.destination;
  const addressChanged = Object.keys(destination).some(
    (key) =>
      destination[key as keyof DeliveryAddressDraft] !==
      original[key as keyof DeliveryAddressDraft],
  );
  if (addressChanged)
    required(input.addressReplacementReason, "Address replacement reason");
  if (!["together", "split"].includes(input.shipmentMode))
    throw new Error("Invalid shipment mode");
  if (input.shipmentMode === "split")
    required(input.splitPlan, "Quoted split shipment plan");
  if (!["DDP", "DAP"].includes(input.incoterm))
    throw new Error("Confirm Incoterm");
  if (source.importResponsibility.fulfillmentTerm !== input.incoterm)
    required(input.termReplacementReason, "Reviewed import-term decision");
  if (!["Collected", "Exempt", "Not Collected"].includes(input.taxTreatment))
    throw new Error("Confirm sales tax treatment");
  if (input.taxTreatment === "Exempt" && !input.taxEvidenceId)
    throw new Error("Private tax evidence required");
  const charges = Object.fromEntries(
    commercialChargeKeys.map((key) => {
      const value = input.charges[key];
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`Invalid ${key} amount`);
      return [key, value];
    }),
  ) as CommercialCharges;
  if (input.taxTreatment !== "Collected" && charges.salesTax !== 0)
    throw new Error("Tax amount must be zero when not collected");
  const transportMethod = required(input.transportMethod, "Transport method");
  const namedPlace = required(input.namedPlace, "Named place");
  const shipmentGroups =
    options.allowHistoricalUnstructuredSplit &&
    input.shipmentMode === "split" &&
    !input.shipmentGroups
      ? undefined
      : validatedShipmentGroups(source.lines, {
          shipmentMode: input.shipmentMode,
          shipmentGroups: input.shipmentGroups,
          transportMethod,
          incoterm: input.incoterm,
          namedPlace,
          charges,
        });
  const requiresCurrencyReview =
    source.amounts.manualCommercialReview ||
    source.lines.some(
      (line) =>
        line.currency !== "USD" ||
        (line.productSnapshot?.offer &&
          line.productSnapshot.offer.currency !== "USD") ||
        (line.lineKind === "configured_assembly" &&
          line.configuredAssembly.snapshot.productBasis?.some(
            (product) => product.offer?.currency !== "USD",
          )),
    );
  if (requiresCurrencyReview && input.manualCurrencyConfirmed !== true)
    throw new Error("Confirm manual USD pricing and import terms");
  return {
    destination,
    addressConfirmed: true,
    addressReplacementReason: addressChanged
      ? input.addressReplacementReason.trim()
      : "",
    shipmentMode: input.shipmentMode,
    splitPlan: input.shipmentMode === "split" ? input.splitPlan.trim() : "",
    shipmentGroups,
    transportMethod,
    incoterm: input.incoterm,
    termReplacementReason:
      source.importResponsibility.fulfillmentTerm !== input.incoterm
        ? input.termReplacementReason.trim()
        : "",
    namedPlace,
    packingEstimate: required(input.packingEstimate, "Packing estimate"),
    freightReviewConfirmed: true,
    actualPacking: input.actualPacking.trim(),
    taxTreatment: input.taxTreatment,
    taxEvidenceId: input.taxTreatment === "Exempt" ? input.taxEvidenceId : null,
    leadTime: required(input.leadTime, "Reviewed lead time"),
    charges,
    manualCurrencyConfirmed: input.manualCurrencyConfirmed === true,
  };
}

export function commercialTotals(
  source: QuoteRequestSnapshot,
  prices: QuotedLinePrice[],
  charges: CommercialCharges,
) {
  if (prices.length !== source.lines.length)
    throw new Error("Pricing does not match captured lines");
  const lines = source.lines.map((line, index) =>
    quoteLineTotals(line, prices[index]),
  );
  if (lines.some((line) => line.totalCents === null))
    throw new Error("Complete all final USD prices");
  const merchandiseCents = lines.reduce(
    (sum, line) => sum + line.totalCents!,
    0,
  );
  const discountCents = lines.reduce(
    (sum, line) => sum + line.discountCents!,
    0,
  );
  const totalCents = commercialChargeKeys.reduce(
    (sum, key) => sum + charges[key],
    merchandiseCents,
  );
  if (!Number.isSafeInteger(totalCents) || totalCents < 0)
    throw new Error("Invalid total");
  return {
    currency: "USD" as const,
    merchandiseCents,
    discountCents,
    totalCents,
  };
}
