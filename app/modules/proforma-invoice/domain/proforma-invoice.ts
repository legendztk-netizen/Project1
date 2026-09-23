import { Temporal } from "@js-temporal/polyfill";
import type { QuoteRevisionSnapshot } from "../../quote-review/domain/quote-revision";
import { validateQuoteIssuance } from "../../quote-review/domain/quote-revision";
import {
  paymentChannel,
  paymentInstructionsReadyForPi,
  SELLER_LEGAL_NAME,
  validatedPaymentInstructions,
  type PaymentChannel,
  type PaymentInstructionVersion,
  type SellerIdentityVersion,
} from "../../seller-settings/domain/seller-commercial-settings";
import { publicPiLine } from "./public-product-snapshot";
import { paymentTerms, type PiPaymentTerms } from "./pi-payment-terms";

export interface PiVersionedText {
  version: string;
  text: string;
}
export interface PiConditions {
  cancellation: PiVersionedText;
  refund: PiVersionedText;
  generalAcknowledgement: PiVersionedText;
  madeToOrderAcknowledgements: Array<PiVersionedText & { lineId: string }>;
}
export interface CreateProformaInvoiceInput {
  documentNumber: string;
  documentVersion: number;
  issuedAt: string;
  validUntil?: string;
  fixedPaymentDueDateEt?: string;
  quoteRevisionId: string;
  currentQuoteRevisionId: string;
  revision: QuoteRevisionSnapshot | null;
  seller: SellerIdentityVersion | null;
  selectedPaymentChannel: PaymentChannel;
  paymentInstructions: PaymentInstructionVersion | null;
  conditions: PiConditions;
}

export function piUtcInstant(value: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    throw new Error("An explicit UTC instant is required");
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value.replace(/(?<!\.\d{3})Z$/, ".000Z")
  )
    throw new Error("Invalid UTC instant");
  return date.toISOString();
}

export function piValidityDeadline(issuedAt: string, explicit?: string) {
  const issued = new Date(piUtcInstant(issuedAt));
  const value =
    explicit === undefined
      ? Temporal.Instant.from(issued.toISOString())
          .toZonedDateTimeISO("America/New_York")
          .toPlainDateTime()
          .add({ days: 14 })
          .toZonedDateTime("America/New_York", { disambiguation: "compatible" })
          .toInstant()
          .toString({ fractionalSecondDigits: 3 })
      : piUtcInstant(explicit);
  if (new Date(value).getTime() <= issued.getTime())
    throw new Error("PI validity deadline must be in the future");
  return value;
}

function required(value: string, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 20000)
    throw new Error(`${label} required`);
  return value;
}
function positiveVersion(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} version required`);
  return value;
}
function versionedText(value: PiVersionedText, label: string) {
  if (!value) throw new Error(`${label} required`);
  return {
    version: required(value.version, `${label} version`),
    text: required(value.text, label),
  };
}

type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function publicPiPaymentInstructions(
  value: PaymentInstructionVersion | null,
  channel: PaymentChannel,
) {
  if (
    !value ||
    !paymentInstructionsReadyForPi(value) ||
    value.channel !== paymentChannel(channel)
  )
    throw new Error("Current selected Payment Instructions required");
  validatedPaymentInstructions(value.instructions);
  return freeze({
    id: required(value.id, "Payment Instructions id"),
    version: positiveVersion(value.version, "Payment Instructions"),
    channel: value.channel,
    instructions: value.instructions,
  });
}

// The caller supplies the authoritative current revision; authorization and the
// atomic issuance transition belong to the application command, not this factory.
export class PiValidationError extends Error {
  override name = "PiValidationError";
}

export function createProformaInvoiceSnapshot(
  input: CreateProformaInvoiceInput,
) {
  try {
    return validatedProformaInvoiceSnapshot(input);
  } catch (error) {
    throw new PiValidationError(
      error instanceof Error ? error.message : "Invalid PI inputs",
      { cause: error },
    );
  }
}

function validatedProformaInvoiceSnapshot(input: CreateProformaInvoiceInput) {
  const revision = input.revision;
  if (
    !revision ||
    !input.quoteRevisionId ||
    input.quoteRevisionId !== input.currentQuoteRevisionId
  )
    throw new Error("Current Quote Revision required");
  if (revision.version !== 1)
    throw new Error("Unsupported Quote Revision schema version");
  const seller = input.seller;
  const addressText = seller?.registeredAddressEn?.trim() ?? "";
  if (
    !seller ||
    seller.status !== "current" ||
    seller.legalName !== SELLER_LEGAL_NAME ||
    seller.registeredCountryCode !== "CN" ||
    addressText.length < 10 ||
    !/[A-Za-z]/u.test(addressText) ||
    /\bUnited States\b|\bPlano\b|542\s+Haggard|PLACEHOLDER|REPLACE[-_ ]?WITH|EXAMPLE\.INVALID/iu.test(
      addressText,
    )
  )
    throw new Error("Current seller China registered address required");
  if (
    seller.registeredAddressEn!.length > 1000 ||
    [...seller.registeredAddressEn!].some((character) => {
      const code = character.codePointAt(0)!;
      return code === 127 || (code < 32 && !"\r\n\t".includes(character));
    })
  )
    throw new Error("Invalid seller registered address");
  const instructions = publicPiPaymentInstructions(
    input.paymentInstructions,
    input.selectedPaymentChannel,
  );
  const issuedAt = piUtcInstant(input.issuedAt);
  if (new Date(piUtcInstant(revision.issuedAt)) > new Date(issuedAt))
    throw new Error("PI cannot precede its Quote Revision");
  const validated = validateQuoteIssuance(
    revision,
    revision.factoryReviewConfirmed === true,
  );
  for (const key of [
    "currency",
    "merchandiseCents",
    "discountCents",
    "totalCents",
  ] as const) {
    if (revision.totals[key] !== validated.totals[key])
      throw new Error(
        "Captured Quote Revision totals do not match its commercial values",
      );
  }
  const lines = revision.source.lines.map((line, index) =>
    publicPiLine(line, revision.prices[index]),
  );
  if (new Set(lines.map((line) => line.id)).size !== lines.length)
    throw new Error("Duplicate PI line identity");
  const conditions = input.conditions;
  if (!conditions || !Array.isArray(conditions.madeToOrderAcknowledgements))
    throw new Error("Versioned PI conditions required");
  const madeToOrder = lines
    .filter((line) => line.madeToOrder)
    .map((line) => line.id);
  const acknowledgements = conditions.madeToOrderAcknowledgements.map(
    (value) => ({
      lineId: required(value.lineId, "Acknowledgement line"),
      ...versionedText(value, "Made-to-order acknowledgement"),
    }),
  );
  if (
    new Set(acknowledgements.map((value) => value.lineId)).size !==
      acknowledgements.length ||
    acknowledgements.length !== madeToOrder.length ||
    madeToOrder.some(
      (id) => !acknowledgements.some((value) => value.lineId === id),
    )
  )
    throw new Error(
      "Each made-to-order line requires its versioned acknowledgement",
    );
  const terms = revision.terms;
  const address = terms.destination;
  const buyer = revision.source.purchasingContext;
  if (!buyer || !["individual", "organization"].includes(buyer.kind))
    throw new Error("Captured purchasing context required");
  const snapshot = {
    schemaVersion: 1 as const,
    documentNumber: required(input.documentNumber, "PI document number"),
    documentVersion: positiveVersion(input.documentVersion, "PI document"),
    issuedAt,
    validUntil: piValidityDeadline(issuedAt, input.validUntil),
    paymentTerms: paymentTerms(
      input.fixedPaymentDueDateEt,
      piValidityDeadline(issuedAt, input.validUntil),
    ) as PiPaymentTerms,
    currency: "USD" as const,
    quoteRevision: {
      id: input.quoteRevisionId,
      number: positiveVersion(revision.revisionNumber, "Quote Revision"),
      schemaVersion: revision.version,
      issuedAt: revision.issuedAt,
      requestId: required(revision.requestId, "RFQ identity"),
      sourceHash: required(revision.sourceHash, "RFQ source hash"),
      preparationVersion: positiveVersion(
        revision.preparationVersion,
        "Quote Preparation",
      ),
      rfqSnapshotVersion: positiveVersion(
        revision.source.version,
        "RFQ snapshot",
      ),
      rfqSubmittedAt: piUtcInstant(revision.source.submittedAt),
      rfqAcknowledgementVersion: required(
        revision.source.acknowledgements?.version,
        "RFQ acknowledgement version",
      ),
      importResponsibilityVersion: required(
        revision.source.importResponsibility.version,
        "Import responsibility version",
      ),
      previousRevisionId: revision.previousRevisionId ?? null,
    },
    seller: {
      id: required(seller.id, "Seller identity"),
      version: positiveVersion(seller.version, "Seller identity"),
      legalName: seller.legalName,
      registeredAddressEn: seller.registeredAddressEn!,
      registeredCountryCode: seller.registeredCountryCode,
    },
    buyer: {
      kind: buyer.kind,
      legalName: buyer.legalName,
      tradeName: buyer.tradeName,
      countryCode: buyer.countryCode,
      registrationOrTaxId: buyer.registrationOrTaxId,
      contactName: buyer.primaryContactName,
      contactEmail: buyer.primaryContactEmail,
    },
    destination: {
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      countryCode: address.countryCode,
      postalCode: address.postalCode,
      recipientEmail: address.recipientEmail,
      recipientName: address.recipientName,
      recipientPhone: address.recipientPhone,
      stateProvince: address.stateProvince,
    },
    lines,
    terms: {
      shipmentMode: terms.shipmentMode,
      splitPlan: terms.splitPlan,
      ...(validated.terms.shipmentGroups
        ? { shipmentGroups: validated.terms.shipmentGroups }
        : {}),
      transportMethod: terms.transportMethod,
      incoterm: terms.incoterm,
      namedPlace: terms.namedPlace,
      taxTreatment: terms.taxTreatment,
      leadTime: terms.leadTime,
      charges: {
        freight: terms.charges.freight,
        insurance: terms.charges.insurance,
        dutiesImport: terms.charges.dutiesImport,
        salesTax: terms.charges.salesTax,
        cuttingLabeling: terms.charges.cuttingLabeling,
        assemblyService: terms.charges.assemblyService,
        protectionService: terms.charges.protectionService,
      },
    },
    totals: {
      currency: revision.totals.currency,
      merchandiseCents: revision.totals.merchandiseCents,
      discountCents: revision.totals.discountCents,
      totalCents: revision.totals.totalCents,
    },
    conditions: {
      cancellation: versionedText(
        conditions.cancellation,
        "Cancellation conditions",
      ),
      refund: versionedText(conditions.refund, "Refund conditions"),
      generalAcknowledgement: versionedText(
        conditions.generalAcknowledgement,
        "General acknowledgement",
      ),
      madeToOrderAcknowledgements: acknowledgements,
    },
    paymentSelection: {
      channel: instructions.channel,
      instructionId: instructions.id,
      instructionVersion: instructions.version,
    },
  };
  return freeze(snapshot);
}

export type ProformaInvoiceSnapshot = Omit<
  ReturnType<typeof createProformaInvoiceSnapshot>,
  "paymentTerms"
> & { readonly paymentTerms?: PiPaymentTerms };

export function formatPiDate(instant: string, audience: "customer" | "admin") {
  const date = new Date(piUtcInstant(instant));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: audience === "customer" ? "America/New_York" : "Asia/Shanghai",
    year: "numeric",
    month: audience === "customer" ? "short" : "2-digit",
    day: audience === "customer" ? "numeric" : "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  if (audience === "customer") return `${formatter.format(date)} ET`;
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} 北京时间`;
}

export async function piSha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
