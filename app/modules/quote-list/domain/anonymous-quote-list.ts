import type { CatalogFamilyId } from "../../catalog/domain/catalog-family";
import type {
  ConfiguredAssemblyEstimateBasis,
  ConfiguredAssemblySnapshot,
} from "./configured-assembly-quote";

interface AnonymousQuoteLineBase {
  category: CatalogFamilyId;
  currency: string;
  displayName: string;
  id: string;
  quantity: number;
  referenceUnitPrice: number | null;
  salesUnit: string;
  sku: string;
  updatedAt: string;
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
