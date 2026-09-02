import type {
  DeliveryAddress,
  PurchasingContext,
} from "../../customer-identity/domain/customer-account";
import type { CustomerContactProfile } from "../../customer-identity/domain/customer-profile";
import type { AnonymousQuoteLine } from "../../quote-list/domain/anonymous-quote-list";

export const quoteRequestSnapshotVersion = 1;
export const quoteRequestAcknowledgementVersion = "individual-request-v1";
export const individualDdpExpectationVersion = "individual-ddp-v1";

export interface IndividualQuoteRequestSnapshot {
  acknowledgements: {
    accuracyConfirmed: true;
    commercialReviewConfirmed: true;
    version: typeof quoteRequestAcknowledgementVersion;
  };
  actor: Pick<
    CustomerContactProfile,
    "email" | "fullName" | "id" | "phoneNumber" | "verifiedAt"
  >;
  amounts: {
    currency: "USD";
    merchandiseSubtotal: number;
    serviceFeeTotal: number;
  };
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

export interface IndividualQuoteRequestRecord {
  id: string;
  referenceNumber: string;
  snapshot: IndividualQuoteRequestSnapshot;
  submittedAt: string;
}

export type IndividualQuoteRequestErrorCode =
  | "ACKNOWLEDGEMENTS_REQUIRED"
  | "ADDRESS_REQUIRED"
  | "AUTHENTICATION_REQUIRED"
  | "INDIVIDUAL_CONTEXT_REQUIRED"
  | "INVALID_IDEMPOTENCY_KEY"
  | "LIST_CHANGED"
  | "LIST_EMPTY"
  | "LIST_NOT_READY"
  | "THRESHOLD_NOT_MET";

export class IndividualQuoteRequestRejected extends Error {
  constructor(
    message: string,
    readonly code: IndividualQuoteRequestErrorCode,
  ) {
    super(message);
    this.name = "IndividualQuoteRequestRejected";
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
