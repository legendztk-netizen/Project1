import { createCustomerAccountService } from "../../customer-identity/application/customer-account-service";
import {
  validatedDeliveryAddress,
  validatedOrganization,
  type PurchasingContextKind,
} from "../../customer-identity/domain/customer-account";
import { createAnonymousQuoteListService } from "../../quote-list/application/anonymous-quote-list-service";
import {
  discountedMerchandiseSubtotal,
  quoteMoney,
} from "../../quote-list/domain/quote-list-refresh";
import { evaluateRfqPreparation } from "../../quote-list/domain/rfq-preparation";
import {
  individualDdpExpectationVersion,
  QuoteRequestRejected,
  organizationDapExpectationVersion,
  organizationDdpExpectationVersion,
  organizationQuoteRequestAcknowledgementVersion,
  quoteListSourceState,
  quoteRequestAcknowledgementVersion,
  quoteRequestSnapshotVersion,
  type IndividualQuoteRequestSnapshot,
  type OrganizationQuoteRequestSnapshot,
  type QuoteRequestSnapshot,
} from "../domain/quote-request";
import { createD1QuoteRequestRepository } from "../infrastructure/d1-quote-request-repository";
import type { ApplicationBindings } from "#workers/environment";

function validIdempotencyKey(value: string) {
  return /^[A-Za-z0-9_-]{16,120}$/u.test(value);
}

interface SubmitQuoteRequestInput {
  accuracyConfirmed: boolean;
  commercialReviewConfirmed: boolean;
  idempotencyKey: string;
  request: Request;
  selectedLineIds: string[];
}

export function createQuoteRequestService(
  env: ApplicationBindings,
  dependencies: {
    generateId?: () => string;
    generateReferenceNumber?: (now: Date) => string;
    now?: () => Date;
  } = {},
) {
  const quoteLists = createAnonymousQuoteListService(env, dependencies);
  const accounts = createCustomerAccountService(env, dependencies);
  const repository = createD1QuoteRequestRepository(env.DB);
  const generateId = dependencies.generateId ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date());
  const generateReferenceNumber =
    dependencies.generateReferenceNumber ??
    ((date: Date) => {
      const day = date.toISOString().slice(0, 10).replaceAll("-", "");
      return `QR-${day}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    });

  async function submit(
    input: SubmitQuoteRequestInput,
    expectedContextKind: PurchasingContextKind,
  ) {
    if (!validIdempotencyKey(input.idempotencyKey)) {
      throw new QuoteRequestRejected(
        "Refresh the page and try submitting again.",
        "INVALID_IDEMPOTENCY_KEY",
      );
    }

    const prepared = await quoteLists.readForSubmission(input.request);
    if (!prepared) {
      throw new QuoteRequestRejected(
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
      throw new QuoteRequestRejected(
        "Confirm the request details and quote-review terms before submitting.",
        "ACKNOWLEDGEMENTS_REQUIRED",
      );
    }

    const account = await accounts.read(input.request);
    if (!account) {
      throw new QuoteRequestRejected(
        "Sign in before requesting a quote.",
        "AUTHENTICATION_REQUIRED",
      );
    }
    const purchasingContext = account.purchasingContexts.find(
      (context) => context.isSelected,
    );
    if (!purchasingContext || purchasingContext.kind !== expectedContextKind) {
      throw new QuoteRequestRejected(
        expectedContextKind === "individual"
          ? "Select Individual purchase before submitting this request."
          : "Select an Organization Purchasing Context that you manage as its Primary Company Contact.",
        expectedContextKind === "individual"
          ? "INDIVIDUAL_CONTEXT_REQUIRED"
          : "ORGANIZATION_CONTEXT_REQUIRED",
      );
    }
    let validatedOrganizationContext: ReturnType<
      typeof validatedOrganization
    > | null = null;
    if (purchasingContext.kind === "organization") {
      try {
        validatedOrganizationContext = validatedOrganization({
          countryCode: purchasingContext.countryCode ?? "",
          legalName: purchasingContext.legalName ?? "",
          registrationOrTaxId: purchasingContext.registrationOrTaxId ?? "",
          tradeName: purchasingContext.tradeName ?? "",
        });
      } catch {
        throw new QuoteRequestRejected(
          "Complete the selected organization's legal company details before submitting.",
          "ORGANIZATION_CONTEXT_REQUIRED",
        );
      }
      if (
        purchasingContext.primaryContactEmail.toLowerCase() !==
        account.profile.email.toLowerCase()
      ) {
        throw new QuoteRequestRejected(
          "Only the active Primary Company Contact can submit for this organization.",
          "ORGANIZATION_CONTEXT_REQUIRED",
        );
      }
    }
    const destination = account.addresses.find((address) => address.isSelected);
    if (!destination) {
      throw new QuoteRequestRejected(
        "Select a complete delivery address before submitting.",
        "ADDRESS_REQUIRED",
      );
    }
    try {
      validatedDeliveryAddress(destination);
    } catch {
      throw new QuoteRequestRejected(
        "Review the selected delivery address and complete every required field.",
        "ADDRESS_REQUIRED",
      );
    }

    if (!prepared.session || prepared.lines.length === 0) {
      throw new QuoteRequestRejected("Your Quote List is empty.", "LIST_EMPTY");
    }
    const selectedLineIds = [...new Set(input.selectedLineIds)];
    if (selectedLineIds.length === 0) {
      throw new QuoteRequestRejected(
        "Select at least one product before requesting a quote.",
        "NO_LINES_SELECTED",
      );
    }
    const selectedLineIdSet = new Set(selectedLineIds);
    const selectedLines = prepared.lines.filter((line) =>
      selectedLineIdSet.has(line.id),
    );
    if (selectedLines.length !== selectedLineIds.length) {
      throw new QuoteRequestRejected(
        "Your selected products changed. Review the Quote List and try again.",
        "LIST_CHANGED",
      );
    }
    const ready = selectedLines.every(
      (line) =>
        line.refresh?.status === "ready" &&
        line.refresh.current.discountedMerchandiseAmount !== null,
    );
    if (!ready) {
      throw new QuoteRequestRejected(
        "Review the highlighted products before submitting. Your Quote List has been preserved.",
        "LIST_NOT_READY",
      );
    }
    const currentReleaseIds = new Set(
      selectedLines.map((line) => line.refresh?.currentCatalogRelease?.id),
    );
    if (currentReleaseIds.size !== 1 || currentReleaseIds.has(undefined)) {
      throw new QuoteRequestRejected(
        "Review the highlighted products before submitting. Your Quote List has been preserved.",
        "LIST_NOT_READY",
      );
    }
    const expectedCatalogReleaseId = [...currentReleaseIds][0]!;
    const expectedLengthBasedHoseFees = selectedLines
      .filter((line) => line.lineKind === "length_based_hose")
      .map((line) => ({
        lineId: line.id,
        ratePerPiece: line.refresh!.current.serviceFeeRate,
        scope: line.refresh!.current.serviceFeeScope,
        version: line.refresh!.current.serviceFeeRecordVersion,
      }));

    const merchandiseSubtotal = discountedMerchandiseSubtotal(selectedLines);
    const serviceFeeTotal = quoteMoney(
      selectedLines.reduce(
        (total, line) => total + (line.refresh?.current.serviceFeeAmount ?? 0),
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
    const expectedOutcome =
      expectedContextKind === "individual"
        ? evaluation.outcome.code === "INDIVIDUAL_DDP"
        : evaluation.outcome.code === "ORGANIZATION_DDP" ||
          evaluation.outcome.code === "ORGANIZATION_DAP";
    if (!evaluation.outcome.allowed || !expectedOutcome) {
      throw new QuoteRequestRejected(
        evaluation.outcome.code === "ORGANIZATION_REQUIRED"
          ? "Individual quote requests are limited to USD 4,500.00 in merchandise. Choose an Organization Purchasing Context."
          : "The merchandise subtotal must be at least USD 100.00.",
        "THRESHOLD_NOT_MET",
      );
    }

    const submittedAt = now();
    const actor = {
      email: account.profile.email,
      fullName: account.profile.fullName,
      id: account.profile.id,
      phoneNumber: account.profile.phoneNumber,
      verifiedAt: account.profile.verifiedAt,
    };
    const amounts = {
      currency: "USD" as const,
      merchandiseSubtotal: evaluation.merchandiseSubtotal,
      serviceFeeTotal,
    };
    let snapshot: QuoteRequestSnapshot;
    if (purchasingContext.kind === "individual") {
      snapshot = {
        acknowledgements: {
          accuracyConfirmed: true,
          commercialReviewConfirmed: true,
          version: quoteRequestAcknowledgementVersion,
        },
        actor,
        amounts,
        destination,
        importResponsibility: {
          fulfillmentTerm: "DDP",
          version: individualDdpExpectationVersion,
        },
        lines: selectedLines,
        purchasingContext: { ...purchasingContext, kind: "individual" },
        submittedAt: submittedAt.toISOString(),
        version: quoteRequestSnapshotVersion,
      } satisfies IndividualQuoteRequestSnapshot;
    } else {
      const organization = validatedOrganizationContext!;
      const importResponsibility: OrganizationQuoteRequestSnapshot["importResponsibility"] =
        evaluation.outcome.fulfillmentTerm === "DAP"
          ? {
              fulfillmentTerm: "DAP",
              version: organizationDapExpectationVersion,
            }
          : {
              fulfillmentTerm: "DDP",
              version: organizationDdpExpectationVersion,
            };
      snapshot = {
        acknowledgements: {
          accuracyConfirmed: true,
          commercialReviewConfirmed: true,
          version: organizationQuoteRequestAcknowledgementVersion,
        },
        actor,
        amounts,
        destination,
        importResponsibility,
        lines: selectedLines,
        purchasingContext: {
          ...purchasingContext,
          countryCode: organization.countryCode,
          kind: "organization",
          legalName: organization.legalName,
          registrationOrTaxId: organization.registrationOrTaxId || null,
          tradeName: organization.tradeName || null,
        },
        submittedAt: submittedAt.toISOString(),
        version: quoteRequestSnapshotVersion,
      } satisfies OrganizationQuoteRequestSnapshot;
    }
    const result = await repository.createAndClearSelectedQuoteLines({
      expectedCatalogReleaseId,
      expectedLengthBasedHoseFees,
      expectedLineCount: selectedLines.length,
      expectedLineState: quoteListSourceState(selectedLines),
      id: generateId(),
      idempotencyKey: input.idempotencyKey,
      profileId: prepared.profile.id,
      purchasingContextId: purchasingContext.id,
      referenceNumber: generateReferenceNumber(submittedAt),
      sessionId: prepared.session.id,
      sessionVersion: prepared.session.lastActivityAt,
      snapshot,
      sourceAddressId: destination.id,
      selectedLineIds,
    });
    if (!result.record) {
      throw new QuoteRequestRejected(
        "Your Quote List changed while it was being submitted. Review it and try again.",
        "LIST_CHANGED",
      );
    }
    return result.record;
  }

  return {
    async readOwned(request: Request, requestId: string) {
      const account = await accounts.read(request);
      if (!account) return { authenticated: false as const, record: null };
      return {
        authenticated: true as const,
        record: await repository.findOwned(account.profile.id, requestId),
      };
    },

    submitIndividual(input: SubmitQuoteRequestInput) {
      return submit(input, "individual");
    },

    submitOrganization(input: SubmitQuoteRequestInput) {
      return submit(input, "organization");
    },
  };
}
