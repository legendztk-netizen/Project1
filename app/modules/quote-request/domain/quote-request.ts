import type {
  DeliveryAddress,
  PurchasingContext,
} from "../../customer-identity/domain/customer-account";
import type { CustomerContactProfile } from "../../customer-identity/domain/customer-profile";
import type { AnonymousQuoteLine } from "../../quote-list/domain/anonymous-quote-list";

export const quoteRequestSnapshotVersion = 1;
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
  currency: "USD";
  merchandiseSubtotal: number;
  serviceFeeTotal: number;
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
  importResponsibility: {
    fulfillmentTerm: "DDP";
    version: typeof individualDdpExpectationVersion;
  };
  lines: AnonymousQuoteLine[];
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
    | {
        fulfillmentTerm: "DDP";
        version: typeof organizationDdpExpectationVersion;
      }
    | {
        fulfillmentTerm: "DAP";
        version: typeof organizationDapExpectationVersion;
      };
  lines: AnonymousQuoteLine[];
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
  id: string;
  referenceNumber: string;
  snapshot: QuoteRequestSnapshot;
  submittedAt: string;
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
