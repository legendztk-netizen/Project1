import type { CatalogFamilyId } from "../../catalog/domain/catalog-family";
import type {
  ConfiguredAssemblyEstimateBasis,
  ConfiguredAssemblySnapshot,
} from "./configured-assembly-quote";

export interface AnonymousQuoteLineBase {
  catalogReleaseId: string;
  category: CatalogFamilyId;
  currency: string;
  displayName: string;
  id: string;
  quantity: number;
  referenceUnitPrice: number | null;
  refresh: QuoteLineRefresh | null;
  salesUnit: string;
  sku: string;
  updatedAt: string;
}

export type QuoteLineRefreshReasonCode =
  | "CONFIGURATION_INVALID"
  | "CURRENT_PRICE_MISSING"
  | "LENGTH_ORDERING_CHANGED"
  | "PRODUCT_TERMS_CHANGED"
  | "PRODUCT_NOT_IN_CURRENT_CATALOG"
  | "RFQ_NOT_ELIGIBLE"
  | "SUPPLY_DISCONTINUED"
  | "SUPPLY_TEMPORARILY_UNAVAILABLE";

export interface QuoteLineRefreshReason {
  code: QuoteLineRefreshReasonCode;
  message: string;
}

export interface QuoteLineEstimateSnapshot {
  discountAmount: number;
  discountPercent: number;
  discountRecordVersion: number | null;
  discountedMerchandiseAmount: number | null;
  merchandiseAmount: number | null;
  serviceFeeAmount: number | null;
  totalReferenceAmount: number | null;
  unitReferencePrice: number | null;
}

export interface QuoteLineRefresh {
  blockingReasons: QuoteLineRefreshReason[];
  changed: boolean;
  current: QuoteLineEstimateSnapshot;
  currentCatalogRelease: {
    id: string;
    number: string;
  } | null;
  former: QuoteLineEstimateSnapshot;
  refreshedAt: string;
  status: "blocked" | "ready";
}

export type AnonymousQuoteLine = AnonymousQuoteLineBase &
  (
    | {
        currentEstimateAmount: null;
        cuttingLabelingFeeAmount: null;
        cuttingLabelingFeeRate: null;
        estimatedMerchandiseAmount: null;
        lengthOrder: null;
        lineKind: "standard";
      }
    | {
        currentEstimateAmount: number | null;
        cuttingLabelingFeeAmount: number;
        cuttingLabelingFeeRate: number;
        estimatedMerchandiseAmount: number | null;
        lengthOrder: {
          normalizedLengthFt: number;
          originalLengthUnit: "ft";
          originalLengthValue: number;
          pieceCount: number;
          totalFootage: number;
        };
        lineKind: "length_based_hose";
      }
    | {
        configuredAssembly: {
          currentIssue: string | null;
          estimateBasis: ConfiguredAssemblyEstimateBasis;
          snapshot: ConfiguredAssemblySnapshot;
          unitEstimateAmount: number | null;
        };
        currentEstimateAmount: number | null;
        cuttingLabelingFeeAmount: null;
        cuttingLabelingFeeRate: null;
        estimatedMerchandiseAmount: null;
        lengthOrder: null;
        lineKind: "configured_assembly";
      }
  );

export interface AnonymousQuoteSession {
  expiresAt: string;
  id: string;
}

export class QuoteListCommandRejected extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_QUANTITY"
      | "LENGTH_BASED_HOSE_REQUIRED"
      | "LINE_NOT_FOUND"
      | "PRODUCT_NOT_AVAILABLE"
      | "STANDARD_PRODUCT_REQUIRED"
      | "CONFIGURATION_INVALID",
  ) {
    super(message);
    this.name = "QuoteListCommandRejected";
  }
}
