import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import type {
  AnonymousQuoteLine,
  QuoteLineEstimateSnapshot,
  QuoteLineRefreshReason,
} from "./anonymous-quote-list";
import type {
  ConfiguredAssemblyEstimateBasis,
  ConfiguredAssemblySnapshot,
} from "./configured-assembly-quote";
import {
  calculateLengthBasedHoseEstimate,
  parseLengthBasedHoseOrder,
} from "./length-based-hose";
import {
  noQuoteReferenceDiscount,
  type QuoteReferenceDiscount,
} from "./quote-reference-discount";

export function quoteMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function estimate(input: {
  discount: QuoteReferenceDiscount;
  merchandiseAmount: number | null;
  serviceFeeAmount: number | null;
  serviceFeeRate: number | null;
  serviceFeeRecordVersion: number | null;
  serviceFeeScope: string | null;
  totalReferenceAmount: number | null;
  unitReferencePrice: number | null;
}): QuoteLineEstimateSnapshot {
  const discountAmount =
    input.merchandiseAmount === null
      ? 0
      : quoteMoney(
          input.merchandiseAmount * (input.discount.discountPercent / 100),
        );
  return {
    discountAmount,
    discountPercent: input.discount.discountPercent,
    discountRecordVersion:
      input.discount.recordVersion === 0 ? null : input.discount.recordVersion,
    discountedMerchandiseAmount:
      input.merchandiseAmount === null
        ? null
        : quoteMoney(input.merchandiseAmount - discountAmount),
    merchandiseAmount: input.merchandiseAmount,
    serviceFeeAmount: input.serviceFeeAmount,
    serviceFeeRate: input.serviceFeeRate,
    serviceFeeRecordVersion: input.serviceFeeRecordVersion,
    serviceFeeScope: input.serviceFeeScope,
    totalReferenceAmount: input.totalReferenceAmount,
    unitReferencePrice: input.unitReferencePrice,
  };
}

function buildQuoteLineRefresh(input: {
  blockingReasons: QuoteLineRefreshReason[];
  current: QuoteLineEstimateSnapshot;
  currentCatalogRelease: { id: string; number: string } | null;
  former: QuoteLineEstimateSnapshot;
  refreshedAt: string;
}) {
  return {
    ...input,
    changed: changed(input.former, input.current),
    status: input.blockingReasons.length
      ? ("blocked" as const)
      : ("ready" as const),
  };
}

function currentProductReasons(product: PublicCatalogItem | null) {
  const reasons: QuoteLineRefreshReason[] = [];
  if (!product) {
    reasons.push({
      code: "PRODUCT_NOT_IN_CURRENT_CATALOG",
      message:
        "This SKU is not in the current catalog. Keep it in the list and contact us for an alternative.",
    });
    return reasons;
  }
  if (product.rfqEligibility !== "Eligible") {
    reasons.push({
      code: "RFQ_NOT_ELIGIBLE",
      message:
        "This SKU currently requires review before it can be included in a quote request.",
    });
  }
  if (product.supplyAvailability === "temporarily_unavailable") {
    reasons.push({
      code: "SUPPLY_TEMPORARILY_UNAVAILABLE",
      message:
        "This SKU is temporarily unavailable. It remains in your list for review.",
    });
  }
  if (product.supplyAvailability === "discontinued") {
    reasons.push({
      code: "SUPPLY_DISCONTINUED",
      message:
        "This SKU is discontinued. It remains in your list so you can review the original request.",
    });
  }
  return reasons;
}

function currentTermsReason(input: {
  expectedMadeToOrder: boolean;
  line: AnonymousQuoteLine;
  product: PublicCatalogItem | null;
}) {
  const offer = input.product?.offer;
  if (!offer) return null;
  const matchesOrderingMode =
    offer.madeToOrder === input.expectedMadeToOrder &&
    (!input.expectedMadeToOrder ||
      (input.product?.productType === "hose" && offer.lengthOrdering !== null));
  if (
    matchesOrderingMode &&
    offer.currency === input.line.currency &&
    offer.salesUnit === input.line.salesUnit
  ) {
    return null;
  }
  return {
    code: "PRODUCT_TERMS_CHANGED" as const,
    message:
      "This SKU's ordering mode, currency, or sales unit changed. The original request remains in your list for review.",
  };
}

function changed(
  former: QuoteLineEstimateSnapshot,
  current: QuoteLineEstimateSnapshot,
) {
  return JSON.stringify(former) !== JSON.stringify(current);
}

export function configuredAssemblyServiceFee(input: {
  basis: ConfiguredAssemblyEstimateBasis;
  quantity: number;
  snapshot: ConfiguredAssemblySnapshot;
}) {
  const pricing = input.snapshot.configuration.lengthReferencePricing;
  const protection = input.snapshot.configuration.installedProtection;
  if (!pricing || !protection) return null;
  const installation = protection.isNoAdditionalProtection
    ? 0
    : protection.referenceInstallationPricePerStartedFootUsd;
  if (input.basis.assemblyServiceUsd === null || installation === null) {
    return null;
  }
  return quoteMoney(
    (input.basis.assemblyServiceUsd + installation * pricing.startedFeet) *
      input.quantity,
  );
}

export function configuredAssemblyMerchandiseAmount(input: {
  basis: ConfiguredAssemblyEstimateBasis;
  quantity: number;
  snapshot: ConfiguredAssemblySnapshot;
}) {
  const protection = input.snapshot.configuration.installedProtection;
  const prices = [
    input.basis.hoseCutLengthFeet,
    input.basis.hosePricePerFootUsd,
    input.basis.hoseEndAPriceUsd,
    input.basis.hoseEndBPriceUsd,
    input.basis.ferruleAPriceUsd,
    input.basis.ferruleBPriceUsd,
  ];
  if (!protection || prices.some((value) => value === null)) return null;
  const protectionMaterial = protection.isNoAdditionalProtection
    ? 0
    : protection.referenceBasePriceUsd === null ||
        protection.referenceMaterialPricePerFootUsd === null
      ? null
      : protection.referenceBasePriceUsd +
        protection.referenceMaterialPricePerFootUsd *
          input.basis.finishedOverallLengthFeet;
  if (protectionMaterial === null) return null;
  return quoteMoney(
    ((input.basis.hoseCutLengthFeet ?? 0) *
      (input.basis.hosePricePerFootUsd ?? 0) +
      (input.basis.hoseEndAPriceUsd ?? 0) +
      (input.basis.hoseEndBPriceUsd ?? 0) +
      (input.basis.ferruleAPriceUsd ?? 0) +
      (input.basis.ferruleBPriceUsd ?? 0) +
      protectionMaterial) *
      input.quantity,
  );
}

export function formerQuoteLineEstimate(
  line: AnonymousQuoteLine,
  discount: QuoteReferenceDiscount = noQuoteReferenceDiscount,
): QuoteLineEstimateSnapshot {
  if (line.lineKind === "standard") {
    const merchandise =
      line.referenceUnitPrice === null
        ? null
        : quoteMoney(line.referenceUnitPrice * line.quantity);
    return estimate({
      discount,
      merchandiseAmount: merchandise,
      serviceFeeAmount: 0,
      serviceFeeRate: null,
      serviceFeeRecordVersion: null,
      serviceFeeScope: null,
      totalReferenceAmount: merchandise,
      unitReferencePrice: line.referenceUnitPrice,
    });
  }
  if (line.lineKind === "length_based_hose") {
    return estimate({
      discount,
      merchandiseAmount: line.estimatedMerchandiseAmount,
      serviceFeeAmount: line.cuttingLabelingFeeAmount,
      serviceFeeRate: line.cuttingLabelingFeeRate,
      serviceFeeRecordVersion: null,
      serviceFeeScope: null,
      totalReferenceAmount: line.currentEstimateAmount,
      unitReferencePrice: line.referenceUnitPrice,
    });
  }
  const merchandise = configuredAssemblyMerchandiseAmount({
    basis: line.configuredAssembly.estimateBasis,
    quantity: line.quantity,
    snapshot: line.configuredAssembly.snapshot,
  });
  return estimate({
    discount,
    merchandiseAmount: merchandise,
    serviceFeeAmount: configuredAssemblyServiceFee({
      basis: line.configuredAssembly.estimateBasis,
      quantity: line.quantity,
      snapshot: line.configuredAssembly.snapshot,
    }),
    serviceFeeRate: line.configuredAssembly.estimateBasis.assemblyServiceUsd,
    serviceFeeRecordVersion:
      line.configuredAssembly.estimateBasis.scheduleRecordVersion,
    serviceFeeScope: "assembly_estimate_schedule:DEFAULT",
    totalReferenceAmount: line.currentEstimateAmount,
    unitReferencePrice: line.configuredAssembly.unitEstimateAmount,
  });
}

export function refreshStandardQuoteLine(input: {
  currentDiscount?: QuoteReferenceDiscount;
  formerDiscount?: QuoteReferenceDiscount;
  line: Extract<AnonymousQuoteLine, { lineKind: "standard" }>;
  product: PublicCatalogItem | null;
  refreshedAt: string;
}) {
  const former = formerQuoteLineEstimate(
    input.line,
    input.formerDiscount ?? noQuoteReferenceDiscount,
  );
  const termsReason = currentTermsReason({
    expectedMadeToOrder: false,
    line: input.line,
    product: input.product,
  });
  const price = termsReason
    ? null
    : (input.product?.offer?.referencePrice ?? null);
  const merchandise =
    price === null ? null : quoteMoney(price * input.line.quantity);
  const current = estimate({
    discount: input.currentDiscount ?? noQuoteReferenceDiscount,
    merchandiseAmount: merchandise,
    serviceFeeAmount: 0,
    serviceFeeRate: null,
    serviceFeeRecordVersion: null,
    serviceFeeScope: null,
    totalReferenceAmount: merchandise,
    unitReferencePrice: price,
  });
  const blockingReasons = currentProductReasons(input.product);
  if (termsReason) blockingReasons.push(termsReason);
  else if (price === null) {
    blockingReasons.push({
      code: "CURRENT_PRICE_MISSING",
      message:
        "A current reference price is unavailable. We need to confirm pricing before submission.",
    });
  }
  return buildQuoteLineRefresh({
    blockingReasons,
    current,
    currentCatalogRelease: input.product
      ? { id: input.product.releaseId, number: input.product.releaseNumber }
      : null,
    former,
    refreshedAt: input.refreshedAt,
  });
}

export function refreshLengthBasedHoseQuoteLine(input: {
  currentDiscount?: QuoteReferenceDiscount;
  formerDiscount?: QuoteReferenceDiscount;
  line: Extract<AnonymousQuoteLine, { lineKind: "length_based_hose" }>;
  product: PublicCatalogItem | null;
  refreshedAt: string;
}) {
  const former = formerQuoteLineEstimate(
    input.line,
    input.formerDiscount ?? noQuoteReferenceDiscount,
  );
  const termsReason = currentTermsReason({
    expectedMadeToOrder: true,
    line: input.line,
    product: input.product,
  });
  const ordering = termsReason ? null : input.product?.offer?.lengthOrdering;
  const price = termsReason
    ? null
    : (input.product?.offer?.referencePrice ?? null);
  const currentCalculation = ordering
    ? calculateLengthBasedHoseEstimate({
        feeRatePerPiece: ordering.cuttingLabelingFee.ratePerPiece,
        order: input.line.lengthOrder,
        referencePricePerFoot: price,
      })
    : null;
  const current = estimate({
    discount: input.currentDiscount ?? noQuoteReferenceDiscount,
    merchandiseAmount: currentCalculation?.estimatedMerchandiseAmount ?? null,
    serviceFeeAmount: currentCalculation?.cuttingLabelingFeeAmount ?? null,
    serviceFeeRate: ordering?.cuttingLabelingFee.ratePerPiece ?? null,
    serviceFeeRecordVersion: ordering?.cuttingLabelingFee.version ?? null,
    serviceFeeScope: ordering?.cuttingLabelingFee.scope ?? null,
    totalReferenceAmount: currentCalculation?.currentEstimateAmount ?? null,
    unitReferencePrice: price,
  });
  const blockingReasons = currentProductReasons(input.product);
  if (termsReason) blockingReasons.push(termsReason);
  else if (!ordering || price === null) {
    blockingReasons.push({
      code: "CURRENT_PRICE_MISSING",
      message:
        "Current hose pricing or Cutting & Labeling inputs are incomplete. We need to confirm them before submission.",
    });
  }
  if (ordering) {
    const currentOrder = parseLengthBasedHoseOrder(
      {
        lengthPerPiece: String(input.line.lengthOrder.originalLengthValue),
        lengthUnit: input.line.lengthOrder.originalLengthUnit,
        pieceCount: String(input.line.lengthOrder.pieceCount),
      },
      ordering,
    );
    if (!currentOrder.ok) {
      blockingReasons.push({
        code: "LENGTH_ORDERING_CHANGED",
        message:
          "This length no longer matches the current minimum or increment. Keep it in the list and review the current ordering requirements.",
      });
    }
  }
  return buildQuoteLineRefresh({
    blockingReasons,
    current,
    currentCatalogRelease: input.product
      ? { id: input.product.releaseId, number: input.product.releaseNumber }
      : null,
    former,
    refreshedAt: input.refreshedAt,
  });
}

export function refreshConfiguredAssemblyQuoteLine(input: {
  currentDiscount?: QuoteReferenceDiscount;
  formerDiscount?: QuoteReferenceDiscount;
  current: {
    basis: ConfiguredAssemblyEstimateBasis;
    snapshot: ConfiguredAssemblySnapshot;
    unitEstimateAmount: number | null;
  } | null;
  issue: string | null;
  line: Extract<AnonymousQuoteLine, { lineKind: "configured_assembly" }>;
  refreshedAt: string;
}) {
  const former = formerQuoteLineEstimate(
    input.line,
    input.formerDiscount ?? noQuoteReferenceDiscount,
  );
  const merchandise = input.current
    ? configuredAssemblyMerchandiseAmount({
        basis: input.current.basis,
        quantity: input.line.quantity,
        snapshot: input.current.snapshot,
      })
    : null;
  const serviceFee = input.current
    ? configuredAssemblyServiceFee({
        basis: input.current.basis,
        quantity: input.line.quantity,
        snapshot: input.current.snapshot,
      })
    : null;
  const total =
    input.current?.unitEstimateAmount === null || !input.current
      ? null
      : quoteMoney(input.current.unitEstimateAmount * input.line.quantity);
  const current = estimate({
    discount: input.currentDiscount ?? noQuoteReferenceDiscount,
    merchandiseAmount: merchandise,
    serviceFeeAmount: serviceFee,
    serviceFeeRate: input.current?.basis.assemblyServiceUsd ?? null,
    serviceFeeRecordVersion: input.current?.basis.scheduleRecordVersion ?? null,
    serviceFeeScope: input.current
      ? "assembly_estimate_schedule:DEFAULT"
      : null,
    totalReferenceAmount: total,
    unitReferencePrice: input.current?.unitEstimateAmount ?? null,
  });
  const blockingReasons: QuoteLineRefreshReason[] = [];
  if (input.issue) {
    blockingReasons.push({
      code: "CONFIGURATION_INVALID",
      message: input.issue,
    });
  } else if (merchandise === null || total === null) {
    blockingReasons.push({
      code: "CURRENT_PRICE_MISSING",
      message:
        "Current assembly reference inputs are incomplete. We need to confirm pricing before submission.",
    });
  }
  return buildQuoteLineRefresh({
    blockingReasons,
    current,
    currentCatalogRelease: input.current
      ? {
          id: input.current.basis.catalogReleaseId,
          number: input.current.snapshot.sourceCatalogRelease.number,
        }
      : null,
    former,
    refreshedAt: input.refreshedAt,
  });
}

export function discountedMerchandiseSubtotal(lines: AnonymousQuoteLine[]) {
  return quoteMoney(
    lines.reduce(
      (total, line) =>
        total + (line.refresh?.current.discountedMerchandiseAmount ?? 0),
      0,
    ),
  );
}
