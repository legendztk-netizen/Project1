import type { QuoteRequestSnapshot } from "../../quote-request/domain/quote-request";
import type { QuoteCommercialTerms } from "./quote-commercial-terms";
import type { QuotedLinePrice } from "./quote-pricing";
import type { ReviewedQuoteLine } from "./quote-line-revision";
import type { HoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";

interface QuoteMaterial {
  source: QuoteRequestSnapshot;
  terms: QuoteCommercialTerms;
  prices: QuotedLinePrice[];
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value ?? null;
}
function printable(value: unknown): string {
  if (value === null || value === undefined) return "Not specified";
  if (Array.isArray(value))
    return value
      .map((entry, index) => `${index + 1}. ${printable(entry)}`)
      .join("\n");
  if (typeof value === "object")
    return Object.entries(value)
      .map(
        ([key, entry]) =>
          `${key.replace(/([A-Z])/g, " $1")}: ${printable(entry)}`,
      )
      .join("\n");
  return String(value);
}
function assemblySpecifications(configuration: HoseConfigurationDraft) {
  const end = (value: HoseConfigurationDraft["endA"]) =>
    value
      ? {
          sku: value.hoseEnd.sku,
          name: value.hoseEnd.displayName,
          ferruleSku: value.ferrule.sku,
        }
      : null;
  return {
    hose: {
      sku: configuration.hose.sku,
      name: configuration.hose.familyName,
      insideDiameterIn: configuration.hose.nominalIdIn,
    },
    endA: end(configuration.endA),
    endB: end(configuration.endB),
    finishedLength: configuration.finishedLength
      ? {
          value: configuration.finishedLength.originalValue,
          unit: configuration.finishedLength.originalUnit,
        }
      : null,
    measurement:
      configuration.measurementSelection?.state === "selected"
        ? configuration.measurementSelection.method.displayName
        : "Not sure",
    clocking:
      configuration.clocking?.status === "specified"
        ? `${configuration.clocking.targetDisplay} degrees clockwise`
        : (configuration.clocking?.status ?? "Not applicable"),
    installedProtection: configuration.installedProtection?.publicName ?? null,
  };
}
function material(quote: QuoteMaterial) {
  const t = quote.terms;
  const entries = quote.source.lines
    .map((line, index) => ({ line, price: quote.prices[index] }))
    .sort((a, b) => a.line.id.localeCompare(b.line.id));
  const lines = entries.map((entry) => entry.line);
  return {
    Products: lines.map((line) => ({
      sku: line.sku,
      name: line.displayName,
      salesUnit: line.salesUnit,
    })),
    Quantities: lines.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
      lengthOrder:
        line.lineKind === "length_based_hose"
          ? {
              perPiece: line.lengthOrder.originalLengthValue,
              unit: line.lengthOrder.originalLengthUnit,
              totalFeet: line.lengthOrder.totalFootage,
            }
          : null,
    })),
    Specifications: lines.map((line) => ({
      sku: line.sku,
      product: line.productSnapshot
        ? {
            familyName: line.productSnapshot.familyName,
            specs: line.productSnapshot.specs?.map((spec) => ({
              label: spec.label,
              value: spec.value,
            })),
          }
        : null,
      overrides: (
        (line as ReviewedQuoteLine).quotedSpecificationOverrides ?? []
      ).map((spec) => ({ label: spec.label, value: spec.value })),
      assembly:
        line.lineKind === "configured_assembly"
          ? assemblySpecifications(
              line.configuredAssembly.snapshot.configuration,
            )
          : null,
    })),
    "Delivery address": {
      recipient: t.destination.recipientName,
      email: t.destination.recipientEmail,
      phone: t.destination.recipientPhone,
      addressLine1: t.destination.addressLine1,
      addressLine2: t.destination.addressLine2,
      city: t.destination.city,
      stateProvince: t.destination.stateProvince,
      postalCode: t.destination.postalCode,
      countryCode: t.destination.countryCode,
    },
    "Shipment plan": { mode: t.shipmentMode, plan: t.splitPlan },
    Transport: t.transportMethod,
    "Sales tax": { treatment: t.taxTreatment, amountCents: t.charges.salesTax },
    "USD prices and discounts": entries.map(({ line, price }) => ({
      sku: line.sku,
      unitPriceUsd:
        price.unitPriceCents === null ? null : price.unitPriceCents / 100,
      discountPercent: price.discountBasisPoints / 100,
    })),
    Freight: t.charges.freight,
    "Import terms and charges": {
      incoterm: t.incoterm,
      namedPlace: t.namedPlace,
      dutiesImportCents: t.charges.dutiesImport,
    },
    "Other charges": {
      insurance: t.charges.insurance,
      cuttingLabeling: t.charges.cuttingLabeling,
      assemblyService: t.charges.assemblyService,
      protectionService: t.charges.protectionService,
    },
    "Lead time": t.leadTime,
    "Packing estimate": t.packingEstimate,
  };
}
export function quoteRevisionDifferences(
  before: QuoteMaterial,
  after: QuoteMaterial,
) {
  const previous = material(before),
    current = material(after);
  return (Object.keys(current) as Array<keyof typeof current>).flatMap(
    (field) => {
      const unchanged =
        JSON.stringify(canonical(previous[field])) ===
        JSON.stringify(canonical(current[field]));
      return unchanged
        ? []
        : [
            {
              field,
              former: printable(previous[field]),
              current: printable(current[field]),
            },
          ];
    },
  );
}
export type QuoteRevisionDifference = ReturnType<
  typeof quoteRevisionDifferences
>[number];
