import { createCustomerAccountService } from "../../customer-identity/application/customer-account-service";
import { validatedDeliveryAddress } from "../../customer-identity/domain/customer-account";
import { createAnonymousQuoteListService } from "../../quote-list/application/anonymous-quote-list-service";
import {
  discountedMerchandiseSubtotal,
  quoteMoney,
} from "../../quote-list/domain/quote-list-refresh";
import { evaluateRfqPreparation } from "../../quote-list/domain/rfq-preparation";
import {
  individualDdpExpectationVersion,
  IndividualQuoteRequestRejected,
  quoteListSourceState,
  quoteRequestAcknowledgementVersion,
  quoteRequestSnapshotVersion,
  type IndividualQuoteRequestSnapshot,
} from "../domain/individual-quote-request";
import { createD1IndividualQuoteRequestRepository } from "../infrastructure/d1-individual-quote-request-repository";
import type { ApplicationBindings } from "#workers/environment";

function validIdempotencyKey(value: string) {
  return /^[A-Za-z0-9_-]{16,120}$/u.test(value);
}

export function createIndividualQuoteRequestService(
  env: ApplicationBindings,
  dependencies: {
    generateId?: () => string;
    generateReferenceNumber?: (now: Date) => string;
    now?: () => Date;
  } = {},
) {
  const quoteLists = createAnonymousQuoteListService(env, dependencies);
  const accounts = createCustomerAccountService(env, dependencies);
  const repository = createD1IndividualQuoteRequestRepository(env.DB);
  const generateId = dependencies.generateId ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date());
  const generateReferenceNumber =
    dependencies.generateReferenceNumber ??
    ((date: Date) => {
      const day = date.toISOString().slice(0, 10).replaceAll("-", "");
      return `QR-${day}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    });

  return {
    async readOwned(request: Request, requestId: string) {
      const account = await accounts.read(request);
      if (!account) return { authenticated: false as const, record: null };
      return {
        authenticated: true as const,
        record: await repository.findOwned(account.profile.id, requestId),
      };
    },

    async submitIndividual(input: {
      accuracyConfirmed: boolean;
      commercialReviewConfirmed: boolean;
      idempotencyKey: string;
      request: Request;
    }) {
      if (!validIdempotencyKey(input.idempotencyKey)) {
        throw new IndividualQuoteRequestRejected(
          "Refresh the page and try submitting again.",
          "INVALID_IDEMPOTENCY_KEY",
        );
      }

      const prepared = await quoteLists.readForSubmission(input.request);
      if (!prepared) {
        throw new IndividualQuoteRequestRejected(
          "Sign in before requesting a quote.",
          "AUTHENTICATION_REQUIRED",
        );
      }
      const existing = await repository.findByIdempotency(
        prepared.profile.id,
        input.idempotencyKey,
      );
      if (existing) return existing;

      if (!input.accuracyConfirmed || !input.commercialReviewConfirmed) {
        throw new IndividualQuoteRequestRejected(
          "Confirm the request details and quote-review terms before submitting.",
          "ACKNOWLEDGEMENTS_REQUIRED",
        );
      }

      const account = await accounts.read(input.request);
      if (!account) {
        throw new IndividualQuoteRequestRejected(
          "Sign in before requesting a quote.",
          "AUTHENTICATION_REQUIRED",
        );
      }
      const purchasingContext = account.purchasingContexts.find(
        (context) => context.isSelected,
      );
      if (!purchasingContext || purchasingContext.kind !== "individual") {
        throw new IndividualQuoteRequestRejected(
          "Select Individual purchase before submitting this request.",
          "INDIVIDUAL_CONTEXT_REQUIRED",
        );
      }
      const destination = account.addresses.find(
        (address) => address.isSelected,
      );
      if (!destination) {
        throw new IndividualQuoteRequestRejected(
          "Select a complete delivery address before submitting.",
          "ADDRESS_REQUIRED",
        );
      }
      try {
        validatedDeliveryAddress(destination);
      } catch {
        throw new IndividualQuoteRequestRejected(
          "Review the selected delivery address and complete every required field.",
          "ADDRESS_REQUIRED",
        );
      }

      if (!prepared.session || prepared.lines.length === 0) {
        throw new IndividualQuoteRequestRejected(
          "Your Quote List is empty.",
          "LIST_EMPTY",
        );
      }
      const ready = prepared.lines.every(
        (line) =>
          line.refresh?.status === "ready" &&
          line.refresh.current.discountedMerchandiseAmount !== null,
      );
      if (!ready) {
        throw new IndividualQuoteRequestRejected(
          "Review the highlighted products before submitting. Your Quote List has been preserved.",
          "LIST_NOT_READY",
        );
      }
      const currentReleaseIds = new Set(
        prepared.lines.map((line) => line.refresh?.currentCatalogRelease?.id),
      );
      if (currentReleaseIds.size !== 1 || currentReleaseIds.has(undefined)) {
        throw new IndividualQuoteRequestRejected(
          "Review the highlighted products before submitting. Your Quote List has been preserved.",
          "LIST_NOT_READY",
        );
      }
      const expectedCatalogReleaseId = [...currentReleaseIds][0]!;
      const expectedLengthBasedHoseFees = prepared.lines
        .filter((line) => line.lineKind === "length_based_hose")
        .map((line) => ({
          lineId: line.id,
          ratePerPiece: line.refresh!.current.serviceFeeRate,
          scope: line.refresh!.current.serviceFeeScope,
          version: line.refresh!.current.serviceFeeRecordVersion,
        }));

      const merchandiseSubtotal = discountedMerchandiseSubtotal(prepared.lines);
      const serviceFeeTotal = quoteMoney(
        prepared.lines.reduce(
          (total, line) =>
            total + (line.refresh?.current.serviceFeeAmount ?? 0),
          0,
        ),
      );
      const evaluation = evaluateRfqPreparation({
        amounts: {
          duties: null,
          freight: null,
          importCharges: null,
          insurance: null,
          merchandise: merchandiseSubtotal,
          serviceFees: serviceFeeTotal,
          tax: null,
        },
        pricingComplete: ready,
        purchasingContextKind: purchasingContext.kind,
      });
      if (
        !evaluation.outcome.allowed ||
        evaluation.outcome.code !== "INDIVIDUAL_DDP"
      ) {
        throw new IndividualQuoteRequestRejected(
          evaluation.outcome.code === "ORGANIZATION_REQUIRED"
            ? "Individual quote requests are limited to USD 4,500.00 in merchandise. Choose an Organization Purchasing Context."
            : "The merchandise subtotal must be at least USD 100.00.",
          "THRESHOLD_NOT_MET",
        );
      }

      const submittedAt = now();
      const snapshot: IndividualQuoteRequestSnapshot = {
        acknowledgements: {
          accuracyConfirmed: true,
          commercialReviewConfirmed: true,
          version: quoteRequestAcknowledgementVersion,
        },
        actor: {
          email: account.profile.email,
          fullName: account.profile.fullName,
          id: account.profile.id,
          phoneNumber: account.profile.phoneNumber,
          verifiedAt: account.profile.verifiedAt,
        },
        amounts: {
          currency: "USD",
          merchandiseSubtotal: evaluation.merchandiseSubtotal,
          serviceFeeTotal,
        },
        destination,
        importResponsibility: {
          fulfillmentTerm: "DDP",
          version: individualDdpExpectationVersion,
        },
        lines: prepared.lines,
        purchasingContext: { ...purchasingContext, kind: "individual" },
        submittedAt: submittedAt.toISOString(),
        version: quoteRequestSnapshotVersion,
      };
      const result = await repository.createAndClearQuoteList({
        expectedCatalogReleaseId,
        expectedLengthBasedHoseFees,
        expectedLineCount: prepared.lines.length,
        expectedLineState: quoteListSourceState(prepared.lines),
        id: generateId(),
        idempotencyKey: input.idempotencyKey,
        profileId: prepared.profile.id,
        purchasingContextId: purchasingContext.id,
        referenceNumber: generateReferenceNumber(submittedAt),
        sessionId: prepared.session.id,
        sessionVersion: prepared.session.lastActivityAt,
        snapshot,
        sourceAddressId: destination.id,
      });
      if (!result.record) {
        throw new IndividualQuoteRequestRejected(
          "Your Quote List changed while it was being submitted. Review it and try again.",
          "LIST_CHANGED",
        );
      }
      return result.record;
    },
  };
}
