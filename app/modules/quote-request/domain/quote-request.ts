import type { QuoteCurrencyTotal } from "../../quote-list/domain/quote-currency-totals";
import type {
  DeliveryAddress,
  PurchasingContext,
} from "../../customer-identity/domain/customer-account";
import type { CustomerContactProfile } from "../../customer-identity/domain/customer-profile";
import type {
  PublicCatalogItem,
  PublicCatalogSpec,
  PublicProductType,
  PublicVariantSelection,
} from "../../catalog/domain/public-catalog";
import type { AnonymousQuoteLine } from "../../quote-list/domain/anonymous-quote-list";

export const quoteRequestSnapshotVersion = 2;
export const quoteRequestAcknowledgementVersion = "individual-request-v1";
export const individualDdpExpectationVersion = "individual-ddp-v1";
export const organizationQuoteRequestAcknowledgementVersion =
  "organization-request-v1";
export const organizationDdpExpectationVersion = "organization-ddp-v1";
export const organizationDapExpectationVersion = "organization-dap-v1";

type QuoteRequestActor = Pick<
  CustomerContactProfile,
  "email" | "fullName" | "id" | "phoneNumber" | "verifiedAt"
>;

interface QuoteRequestAmounts {
  currency: string | null;
  merchandiseSubtotal: number | null;
  groups?: QuoteCurrencyTotal[];
  manualCommercialReview?: boolean;
  serviceFeeTotal: number;
}

export interface QuoteRequestProductSnapshot {
  catalogBasis?: PublicCatalogItem["catalogBasis"];
  mainImageUrl?: string | null;
  offer?: PublicCatalogItem["offer"];
  category: PublicCatalogItem["category"];
  familyName: string;
  mediaKey: string | null;
  productType: PublicProductType;
  releaseId: string;
  releaseNumber: string;
  specs: PublicCatalogSpec[];
  variantSelection: PublicVariantSelection | null;
}

export type QuoteRequestLine = AnonymousQuoteLine & {
  productSnapshot: QuoteRequestProductSnapshot;
};

export function captureQuoteRequestProductSnapshot(
  product: PublicCatalogItem,
): QuoteRequestProductSnapshot {
  return {
    ...(product.catalogBasis
      ? {
          catalogBasis: structuredClone(product.catalogBasis),
          mainImageUrl: product.mainImageUrl ?? null,
          offer: structuredClone(product.offer),
        }
      : {}),
    category: product.category,
    familyName: product.familyName,
    mediaKey: product.mediaKey,
    productType: product.productType,
    releaseId: product.releaseId,
    releaseNumber: product.releaseNumber,
    specs: product.specs.map((spec) => ({ ...spec })),
    variantSelection: product.variantSelection
      ? structuredClone(product.variantSelection)
      : null,
  };
}

export interface ManualCommercialReview {
  fulfillmentTerm: "MANUAL";
  version: "manual-commercial-review-v1";
}

export interface IndividualQuoteRequestSnapshot {
  acknowledgements: {
    accuracyConfirmed: true;
    commercialReviewConfirmed: true;
    version: typeof quoteRequestAcknowledgementVersion;
  };
  actor: QuoteRequestActor;
  amounts: QuoteRequestAmounts;
  destination: DeliveryAddress;
  importResponsibility:
    | ManualCommercialReview
    | {
        fulfillmentTerm: "DDP";
        version: typeof individualDdpExpectationVersion;
      };
  lines: QuoteRequestLine[];
  purchasingContext: PurchasingContext & { kind: "individual" };
  submittedAt: string;
  version: typeof quoteRequestSnapshotVersion;
}

export interface OrganizationQuoteRequestSnapshot {
  acknowledgements: {
    accuracyConfirmed: true;
    commercialReviewConfirmed: true;
    version: typeof organizationQuoteRequestAcknowledgementVersion;
  };
  actor: QuoteRequestActor;
  amounts: QuoteRequestAmounts;
  destination: DeliveryAddress;
  importResponsibility:
    | ManualCommercialReview
    | {
        fulfillmentTerm: "DDP";
        version: typeof organizationDdpExpectationVersion;
      }
    | {
        fulfillmentTerm: "DAP";
        version: typeof organizationDapExpectationVersion;
      };
  lines: QuoteRequestLine[];
  purchasingContext: PurchasingContext & {
    countryCode: string;
    kind: "organization";
    legalName: string;
  };
  submittedAt: string;
  version: typeof quoteRequestSnapshotVersion;
}

export type QuoteRequestSnapshot =
  IndividualQuoteRequestSnapshot | OrganizationQuoteRequestSnapshot;

export interface QuoteRequestRecord {
  currentPi?: {
    quoteRevisionId: string;
    currentQuoteRevisionId: string;
    validUntil: string;
    totalCents: number | null;
    currency: string | null;
  } | null;
  hasCurrentOffer?: boolean;
  acceptedCurrentPiQuoteRevisionId?: string | null;
  id: string;
  referenceNumber: string;
  snapshot: QuoteRequestSnapshot;
  submittedAt: string;
}

export const customerQuoteProgressStages = [
  { code: "RFQ_SUBMITTED", label: "RFQ Submitted" },
  { code: "PI_ISSUED", label: "PI Issued" },
  { code: "PI_ACCEPTED", label: "PI Accepted" },
  { code: "PI_EXPIRED", label: "PI Expired" },
  { code: "PI_REPLACEMENT_REQUIRED", label: "PI Awaiting Replacement" },
  { code: "PAYMENT_PENDING", label: "Payment Pending" },
  { code: "PAYMENT_CONFIRMED", label: "Payment Confirmed" },
  { code: "PAYMENT_REVIEW_REQUIRED", label: "Payment Review Required" },
  { code: "PAYMENT_REVIEW_HOLD", label: "Payment Review Hold" },
  { code: "ORDER_CREATED", label: "Order Created" },
] as const;

export type CustomerQuoteProgressCode =
  (typeof customerQuoteProgressStages)[number]["code"];

export interface CustomerQuoteProjection extends QuoteRequestRecord {
  orderId?: string | null;
  proposedChanges?: import("../../quote-review/domain/quote-revision-differences").QuoteRevisionDifference[];
  offerHistory?: Array<
    import("../../quote-review/domain/quote-revision").CustomerQuoteRevision & {
      id: string;
    }
  >;
  currentOffer?:
    | import("../../quote-review/domain/quote-revision").CustomerQuoteRevision
    | null;
  progress: {
    code: CustomerQuoteProgressCode;
    label: string;
  };
}

export function customerQuoteProjection(
  record: QuoteRequestRecord,
  progressCode: CustomerQuoteProgressCode = customerQuoteProgress(record),
): CustomerQuoteProjection {
  const current = customerQuoteProgressStages.find(
    ({ code }) => code === progressCode,
  )!;
  return {
    ...record,
    progress: { ...current },
  };
}

export function customerQuoteProgress(
  record: QuoteRequestRecord,
  now = Date.now(),
): CustomerQuoteProgressCode {
  if (
    record.currentPi &&
    record.currentPi.quoteRevisionId !== record.currentPi.currentQuoteRevisionId
  )
    return "PI_REPLACEMENT_REQUIRED";
  return record.acceptedCurrentPiQuoteRevisionId
    ? "PI_ACCEPTED"
    : record.currentPi
      ? Date.parse(record.currentPi.validUntil) <= now
        ? "PI_EXPIRED"
        : "PI_ISSUED"
      : "RFQ_SUBMITTED";
}

export type QuoteRequestErrorCode =
  | "ACKNOWLEDGEMENTS_REQUIRED"
  | "ADDRESS_REQUIRED"
  | "AUTHENTICATION_REQUIRED"
  | "INDIVIDUAL_CONTEXT_REQUIRED"
  | "INVALID_IDEMPOTENCY_KEY"
  | "LIST_CHANGED"
  | "LIST_EMPTY"
  | "LIST_NOT_READY"
  | "NO_LINES_SELECTED"
  | "ORGANIZATION_CONTEXT_REQUIRED"
  | "THRESHOLD_NOT_MET";

export class QuoteRequestRejected extends Error {
  constructor(
    message: string,
    readonly code: QuoteRequestErrorCode,
  ) {
    super(message);
    this.name = "QuoteRequestRejected";
  }
}

export function quoteListSourceState(lines: AnonymousQuoteLine[]) {
  return JSON.stringify(
    lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      updatedAt: line.updatedAt,
    })),
  );
}
