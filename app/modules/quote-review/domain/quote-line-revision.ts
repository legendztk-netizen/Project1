import type {
  PublicCatalogItem,
  PublicCatalogSpec,
} from "../../catalog/domain/public-catalog";
import {
  captureQuoteRequestProductSnapshot,
  type QuoteRequestLine,
} from "../../quote-request/domain/quote-request";
import { evaluateFinishedAssemblyLength } from "../../configurator/domain/finished-assembly-length";

export type ReviewedQuoteLine = QuoteRequestLine & {
  quotedSpecificationOverrides?: PublicCatalogSpec[];
};
export interface QuoteLineEdit {
  id: string;
  sku: string;
  quantity: number;
  lengthValue: string;
  lengthUnit: "ft" | "in" | "mm";
  specifications: PublicCatalogSpec[];
  assembly?: {
    confirmCurrentComponentRefresh?: boolean;
    endASku: string;
    endAFerruleSku: string;
    endBSku: string;
    endBFerruleSku: string;
    measurement: string;
    clocking: string;
    protectionCode: string;
  };
}
export const quotedSpecificationLabels = [
  "Surface finish",
  "Marking",
  "Packaging",
] as const;

export function reviseQuoteLine(
  existing: ReviewedQuoteLine | null,
  edit: QuoteLineEdit,
  replacement: PublicCatalogItem | null,
): ReviewedQuoteLine {
  if (
    !Number.isSafeInteger(edit.quantity) ||
    edit.quantity < 1 ||
    edit.quantity > 1000000
  )
    throw new Error("Quantity must be a positive whole number up to 1000000");
  if (!/^[A-Za-z0-9:_-]{1,120}$/.test(edit.id))
    throw new Error("Invalid quoted line identity");
  const changedProduct = !existing || existing.sku !== edit.sku;
  let line: ReviewedQuoteLine;
  if (changedProduct) {
    if (
      !replacement?.canAddToQuote ||
      !replacement.offer ||
      replacement.sku !== edit.sku
    )
      throw new Error(
        "Replacement product must have an available published offer",
      );
    if (existing?.lineKind === "configured_assembly") {
      if (replacement.productType !== "hose")
        throw new Error("Replace an assembly hose with a published hose SKU");
      line = {
        ...structuredClone(existing),
        sku: replacement.sku,
        catalogReleaseId: replacement.releaseId,
        productSnapshot: captureQuoteRequestProductSnapshot(replacement),
        displayName: `${replacement.familyName} Assembly`,
      };
    } else {
      const base = {
        id: edit.id,
        sku: replacement.sku,
        category: replacement.category,
        catalogReleaseId: replacement.releaseId,
        displayName: replacement.displayName,
        currency: replacement.offer.currency,
        referenceUnitPrice: replacement.offer.referencePrice,
        salesUnit: replacement.offer.salesUnit,
        quantity: edit.quantity,
        updatedAt: "",
        refresh: null,
        productSnapshot: captureQuoteRequestProductSnapshot(replacement),
      };
      line = replacement.offer.lengthOrdering
        ? {
            ...base,
            lineKind: "length_based_hose",
            currentEstimateAmount: null,
            estimatedMerchandiseAmount: null,
            cuttingLabelingFeeAmount: 0,
            cuttingLabelingFeeRate:
              replacement.offer.lengthOrdering.cuttingLabelingFee.ratePerPiece,
            lengthOrder: {
              normalizedLengthFt: 0,
              originalLengthValue: 0,
              originalLengthUnit: "ft",
              pieceCount: edit.quantity,
              totalFootage: 0,
            },
          }
        : {
            ...base,
            lineKind: "standard",
            currentEstimateAmount: null,
            cuttingLabelingFeeAmount: null,
            cuttingLabelingFeeRate: null,
            estimatedMerchandiseAmount: null,
            lengthOrder: null,
          };
    }
  } else line = structuredClone(existing);
  line.quantity = edit.quantity;
  if (line.lineKind === "length_based_hose") {
    const length = Number(edit.lengthValue);
    if (
      edit.lengthUnit !== "ft" ||
      !Number.isFinite(length) ||
      length <= 0 ||
      length > 1000000 ||
      !Number.isFinite(length * edit.quantity)
    )
      throw new Error("Enter a valid per-piece length in feet");
    line.lengthOrder = {
      normalizedLengthFt: length,
      originalLengthValue: length,
      originalLengthUnit: "ft",
      pieceCount: edit.quantity,
      totalFootage: length * edit.quantity,
    };
  }
  if (line.lineKind === "configured_assembly") {
    const configuration = line.configuredAssembly.snapshot.configuration;
    if (edit.lengthUnit !== "in" && edit.lengthUnit !== "mm")
      throw new Error("Assembly length unit must be in or mm");
    const result = evaluateFinishedAssemblyLength({
      hasBothEnds: !!configuration.endA && !!configuration.endB,
      requestedTighterTolerance:
        configuration.finishedLength?.requestedTighterTolerance ?? false,
      unit: edit.lengthUnit,
      value: edit.lengthValue,
    });
    if (!result.valid) throw new Error(result.error);
    if (
      JSON.stringify(configuration.finishedLength) !==
      JSON.stringify(result.length)
    ) {
      configuration.finishedLength = result.length;
      line.configuredAssembly.snapshot.review.outcome = "technical_review";
    }
  }
  if (!Array.isArray(edit.specifications) || edit.specifications.length > 50)
    throw new Error("Maximum 50 specification overrides");
  const specifications = edit.specifications
    .map((spec) => {
      if (
        typeof spec.label !== "string" ||
        typeof spec.value !== "string" ||
        !spec.label.trim() ||
        !spec.value.trim() ||
        spec.label.length > 120 ||
        spec.value.length > 2000
      )
        throw new Error("Invalid specification override");
      const label = quotedSpecificationLabels.find(
        (label) => label.toLowerCase() === spec.label.trim().toLowerCase(),
      );
      if (!label)
        throw new Error(
          "Use structured product, quantity and length controls; only Surface finish, Marking and Packaging amendments are supported",
        );
      return { label, value: spec.value.trim() };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  if (
    new Set(specifications.map((spec) => spec.label.toLowerCase())).size !==
    specifications.length
  )
    throw new Error("Duplicate specification label");
  if (specifications.length) line.quotedSpecificationOverrides = specifications;
  else delete line.quotedSpecificationOverrides;
  return line;
}
