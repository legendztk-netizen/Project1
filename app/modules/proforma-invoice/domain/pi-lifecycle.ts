import type { QuoteRevisionSnapshot } from "../../quote-review/domain/quote-revision";
import { validateQuoteIssuance } from "../../quote-review/domain/quote-revision";
import { publicPiLine } from "./public-product-snapshot";
import { piUtcInstant } from "./proforma-invoice";

export const piReplacementReasons = {
  customer_requested_change: "Customer-requested change",
  customer_data_correction: "Correction to customer-supplied information",
  seller_requested_change: "Seller-requested change",
  seller_packing_estimate_error: "Seller packing estimate correction",
  seller_freight_estimate_error: "Seller freight estimate correction",
  seller_ddp_duty_estimate_error: "Seller DDP duty estimate correction",
  seller_import_tax_estimate_error: "Seller import-tax estimate correction",
  lower_actual_seller_cost: "Lower actual seller cost",
} as const;
export type PiReplacementReasonCode = keyof typeof piReplacementReasons;

// The application authenticates the actor and resolves evidence ownership. These
// are reviewed command facts, not a free-text reason inferred from price deltas.
export interface PiReplacementReason {
  code: PiReplacementReasonCode;
  customerRequested: boolean;
  customerDataAccurate: boolean;
  explanation: string;
  evidenceIds: string[];
}

export interface PiLifecycleTarget {
  piId: string;
  documentVersion: number;
  snapshotHash: string;
}
export interface PiLifecycleRecord extends PiLifecycleTarget {
  requestId: string;
  quoteRevisionId: string;
  totalCents: number;
  issuedAt: string;
  validUntil: string;
  acceptance: (PiLifecycleTarget & { id: string; acceptedAt: string }) | null;
  supersededAt: string | null;
  supersededByPiId: string | null;
}
export interface PiLifecycleViewContext {
  currentPiId: string;
  currentQuoteRevisionId: string;
  now: string;
}
export type PiPublicState = "current" | "accepted" | "expired" | "superseded";

export class PiLifecycleError extends Error {
  constructor(
    readonly code:
      "invalid_evidence" | "stale" | "invalid_source" | "invalid_reason",
    message: string,
  ) {
    super(message);
    this.name = "PiLifecycleError";
  }
}

function text(value: string, field: string, limit = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new PiLifecycleError("invalid_evidence", `${field} required`);
  return value.trim();
}
function positive(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new PiLifecycleError(
      "invalid_evidence",
      `${field} must be a positive integer`,
    );
  return value;
}
function target(value: PiLifecycleTarget) {
  if (!value || typeof value !== "object")
    throw new PiLifecycleError("invalid_evidence", "Exact PI target required");
  text(value.piId, "PI identity");
  positive(value.documentVersion, "PI version");
  if (
    typeof value.snapshotHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.snapshotHash)
  )
    throw new PiLifecycleError(
      "invalid_evidence",
      "Exact PI snapshot hash required",
    );
}
function sameTarget(left: PiLifecycleTarget, right: PiLifecycleTarget) {
  target(left);
  target(right);
  return (
    left.piId === right.piId &&
    left.documentVersion === right.documentVersion &&
    left.snapshotHash === right.snapshotHash
  );
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function publicPiLifecycle(
  record: PiLifecycleRecord,
  context: PiLifecycleViewContext,
) {
  target(record);
  text(record.requestId, "RFQ identity");
  text(record.quoteRevisionId, "Quote Revision identity");
  text(context.currentPiId, "Current PI identity");
  text(context.currentQuoteRevisionId, "Current Quote Revision identity");
  if (!Number.isSafeInteger(record.totalCents) || record.totalCents < 0)
    throw new PiLifecycleError("invalid_source", "Invalid accepted PI total");
  const now = piUtcInstant(context.now);
  const issuedAt = piUtcInstant(record.issuedAt);
  const validUntil = piUtcInstant(record.validUntil);
  if (now < issuedAt || validUntil <= issuedAt)
    throw new PiLifecycleError(
      "invalid_source",
      "PI must be issued with a valid future deadline",
    );
  let acceptedAt: string | null = null;
  if (record.acceptance) {
    if (!sameTarget(record.acceptance, record))
      throw new PiLifecycleError(
        "invalid_evidence",
        "Acceptance belongs to a different PI version",
      );
    text(record.acceptance.id, "Acceptance identity");
    acceptedAt = piUtcInstant(record.acceptance.acceptedAt);
    if (acceptedAt < issuedAt || acceptedAt >= validUntil || acceptedAt > now)
      throw new PiLifecycleError(
        "invalid_evidence",
        "Acceptance timestamp is outside the actionable PI interval",
      );
  }
  if ((record.supersededAt === null) !== (record.supersededByPiId === null))
    throw new PiLifecycleError(
      "invalid_source",
      "Complete supersession evidence required",
    );
  let supersededAt: string | null = null;
  if (record.supersededAt !== null) {
    supersededAt = piUtcInstant(record.supersededAt);
    text(record.supersededByPiId!, "Replacement PI identity");
    if (
      record.supersededByPiId === record.piId ||
      supersededAt < issuedAt ||
      supersededAt > now ||
      (acceptedAt !== null && acceptedAt > supersededAt)
    )
      throw new PiLifecycleError(
        "invalid_source",
        "Invalid PI supersession evidence",
      );
  }
  const isCurrent =
    record.piId === context.currentPiId && supersededAt === null;
  const state: PiPublicState = !isCurrent
    ? "superseded"
    : acceptedAt
      ? "accepted"
      : now >= validUntil
        ? "expired"
        : "current";
  const awaitingReplacement =
    isCurrent && record.quoteRevisionId !== context.currentQuoteRevisionId;
  return freeze({
    piId: record.piId,
    documentVersion: record.documentVersion,
    state,
    label: {
      current: "Current",
      accepted: "Accepted",
      expired: "Expired",
      superseded: "Superseded",
    }[state],
    issuedAt,
    validUntil,
    acceptedAt,
    supersededAt,
    isCurrent,
    canView: true as const,
    canDownload: true as const,
    canAccept: state === "current" && !awaitingReplacement,
    awaitingReplacement,
    automaticRefundCents: 0 as const,
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value ?? null;
}
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
function orderedSpecs<T extends { label: string; value: string }>(
  specs: readonly T[],
) {
  return specs
    .map(({ label, value }) => ({ label, value }))
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
    );
}

function quoteBasis(quote: QuoteRevisionSnapshot) {
  const validated = validateQuoteIssuance(quote, quote.factoryReviewConfirmed, {
    allowHistoricalUnstructuredSplit: true,
  });
  if (!equal(validated.totals, quote.totals))
    throw new PiLifecycleError(
      "invalid_source",
      "Quote totals do not match captured commercial values",
    );
  const lines = quote.source.lines
    .map((line, index) => publicPiLine(line, quote.prices[index]))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(lines.map((line) => line.id)).size !== lines.length)
    throw new PiLifecycleError("invalid_source", "Duplicate line identity");
  const t = validated.terms;
  const { label: _addressLabel, ...destination } = t.destination;
  const buyer = quote.source.purchasingContext;
  if (!buyer)
    throw new PiLifecycleError(
      "invalid_source",
      "Captured customer context required",
    );
  return {
    products: lines.map((line) => ({
      id: line.id,
      sku: line.sku,
      kind: line.lineKind,
      salesUnit: line.salesUnit,
    })),
    quantities: lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      lengthOrder: line.lengthOrder,
    })),
    specifications: lines.map((line) => {
      const assembly = line.assembly;
      return {
        id: line.id,
        product: {
          category: line.product.category,
          type: line.product.productType,
          variant: line.product.variantSelection,
          specifications: orderedSpecs(line.product.specifications),
          madeToOrder: line.madeToOrder,
        },
        amendments: orderedSpecs(line.quotedSpecificationOverrides),
        assembly: assembly
          ? {
              hose: assembly.hose,
              endA: assembly.endA,
              endB: assembly.endB,
              length: assembly.finishedLength,
              measurement: assembly.measurement,
              clocking: assembly.clocking,
              protection: assembly.protection
                ? {
                    code: assembly.protection.code,
                    publicName: assembly.protection.publicName,
                    specification: assembly.protection.specification,
                    isNoAdditionalProtection:
                      assembly.protection.isNoAdditionalProtection,
                  }
                : null,
              application: assembly.application,
            }
          : null,
      };
    }),
    destination,
    shipment_plan: {
      mode: t.shipmentMode,
      plan: t.splitPlan,
      groups:
        t.shipmentGroups?.map((group) => ({
          ...group,
          allocations: [...group.allocations].sort((a, b) =>
            a.lineId.localeCompare(b.lineId),
          ),
        })) ?? null,
    },
    transport: t.transportMethod,
    customer_data: {
      kind: buyer.kind,
      legalName: buyer.legalName,
      countryCode: buyer.countryCode,
      registrationOrTaxId: buyer.registrationOrTaxId,
      contactName: buyer.primaryContactName,
      contactEmail: buyer.primaryContactEmail,
    },
    prices_discounts: lines.map((line) => ({ id: line.id, price: line.price })),
    freight: t.charges.freight,
    import_charges: t.charges.dutiesImport,
    import_terms: { incoterm: t.incoterm, namedPlace: t.namedPlace },
    sales_tax: { treatment: t.taxTreatment, amountCents: t.charges.salesTax },
    other_fees: {
      insurance: t.charges.insurance,
      cuttingLabeling: t.charges.cuttingLabeling,
      assemblyService: t.charges.assemblyService,
      protectionService: t.charges.protectionService,
    },
    lead_time: t.leadTime,
    packing_estimate: t.packingEstimate,
  };
}

function operationalShipmentPlan(
  plan: ReturnType<typeof quoteBasis>["shipment_plan"],
) {
  return {
    mode: plan.mode,
    plan: plan.plan,
    groups: plan.groups?.map((group) => ({
      id: group.id,
      label: group.label,
      allocations: [...group.allocations].sort((a, b) =>
        a.lineId.localeCompare(b.lineId),
      ),
      transportMethod: group.transportMethod,
      incoterm: group.incoterm,
      namedPlace: group.namedPlace,
    })),
  };
}

export type PiMaterialChange = keyof ReturnType<typeof quoteBasis>;
export function comparePiQuoteMaterial(
  previous: QuoteRevisionSnapshot,
  next: QuoteRevisionSnapshot,
) {
  if (
    previous.requestId !== next.requestId ||
    previous.sourceHash !== next.sourceHash
  )
    throw new PiLifecycleError(
      "invalid_source",
      "Quotes must retain the same original RFQ identity",
    );
  const before = quoteBasis(previous),
    after = quoteBasis(next);
  const changes = (Object.keys(before) as PiMaterialChange[]).filter(
    (key) => !equal(before[key], after[key]),
  );
  return freeze({
    changes,
    previousTotalCents: previous.totals.totalCents,
    nextTotalCents: next.totals.totalCents,
    totalChanged: previous.totals.totalCents !== next.totals.totalCents,
    quantitiesUnchanged: !changes.includes("quantities"),
    destinationUnchanged: !changes.includes("destination"),
    shipmentPlanUnchanged: equal(
      operationalShipmentPlan(before.shipment_plan),
      operationalShipmentPlan(after.shipment_plan),
    ),
    transportUnchanged: !changes.includes("transport"),
    customerDataUnchanged: !changes.includes("customer_data"),
  });
}

function reviewedReason(input: PiReplacementReason) {
  if (
    !input ||
    !Object.hasOwn(piReplacementReasons, input.code) ||
    typeof input.customerRequested !== "boolean" ||
    typeof input.customerDataAccurate !== "boolean"
  )
    throw new PiLifecycleError(
      "invalid_reason",
      "Explicit reviewed reason, customer request and data accuracy required",
    );
  if (
    !Array.isArray(input.evidenceIds) ||
    input.evidenceIds.length < 1 ||
    input.evidenceIds.length > 50
  )
    throw new PiLifecycleError(
      "invalid_reason",
      "Associated reviewed change evidence required",
    );
  const evidenceIds = input.evidenceIds.map((id) =>
    text(id, "Change evidence", 200),
  );
  if (new Set(evidenceIds).size !== evidenceIds.length)
    throw new PiLifecycleError("invalid_reason", "Duplicate change evidence");
  const sellerCause =
    input.code.startsWith("seller_") ||
    input.code === "lower_actual_seller_cost";
  if (
    (sellerCause && input.customerRequested) ||
    (input.code === "customer_requested_change" && !input.customerRequested) ||
    (!input.customerDataAccurate &&
      input.code !== "customer_data_correction") ||
    (input.code === "customer_data_correction" && input.customerDataAccurate)
  )
    throw new PiLifecycleError(
      "invalid_reason",
      "Reason contradicts reviewed customer request or data accuracy",
    );
  return {
    code: input.code,
    label: piReplacementReasons[input.code],
    customerRequested: input.customerRequested,
    customerDataAccurate: input.customerDataAccurate,
    explanation: text(input.explanation, "Reviewed explanation"),
    evidenceIds,
  };
}

export interface PiReplacementContext {
  pi: PiLifecycleRecord;
  head: { piId: string; version: number };
  previousQuote: { id: string; snapshot: QuoteRevisionSnapshot };
  nextQuote: { id: string; snapshot: QuoteRevisionSnapshot };
  currentQuoteRevisionId: string;
  now: string;
}
export interface PiReplacementCommand {
  expectedPi: PiLifecycleTarget;
  expectedHeadVersion: number;
  expectedAcceptanceId: string | null;
  nextQuoteRevisionId: string;
  reason: PiReplacementReason;
}

// Resolve exact replay first. A returned plan is NOT a database authorization or
// a lock: the application must atomically recheck every optimistic token below.
export function planPiReplacement(
  context: PiReplacementContext,
  input: PiReplacementCommand,
) {
  if (!input || typeof input !== "object")
    throw new PiLifecycleError(
      "invalid_evidence",
      "Replacement review required",
    );
  const view = publicPiLifecycle(context.pi, {
    currentPiId: context.head.piId,
    currentQuoteRevisionId: context.currentQuoteRevisionId,
    now: context.now,
  });
  positive(context.head.version, "PI head version");
  if (
    !sameTarget(input.expectedPi, context.pi) ||
    input.expectedHeadVersion !== context.head.version ||
    input.expectedAcceptanceId !== (context.pi.acceptance?.id ?? null) ||
    !view.isCurrent ||
    input.nextQuoteRevisionId !== context.nextQuote.id ||
    context.currentQuoteRevisionId !== context.nextQuote.id
  )
    throw new PiLifecycleError(
      "stale",
      "PI, acceptance, or current Quote Revision changed; reload before replacing",
    );
  const previous = context.previousQuote.snapshot,
    next = context.nextQuote.snapshot;
  if (
    context.previousQuote.id !== context.pi.quoteRevisionId ||
    previous.requestId !== context.pi.requestId ||
    next.requestId !== context.pi.requestId ||
    previous.totals.totalCents !== context.pi.totalCents
  )
    throw new PiLifecycleError(
      "invalid_source",
      "Exact PI source Quote Revision required",
    );
  const reason = reviewedReason(input.reason);
  const material = comparePiQuoteMaterial(previous, next);
  const estimateError = [
    "seller_packing_estimate_error",
    "seller_freight_estimate_error",
    "seller_ddp_duty_estimate_error",
    "seller_import_tax_estimate_error",
  ].includes(reason.code);
  const lowerActualCost = reason.code === "lower_actual_seller_cost";
  if (
    (reason.code === "seller_ddp_duty_estimate_error" ||
      reason.code === "seller_import_tax_estimate_error") &&
    previous.terms.incoterm !== "DDP"
  )
    throw new PiLifecycleError(
      "invalid_reason",
      "DDP estimate-error reason requires an accepted DDP basis; US sales tax is separate",
    );
  const unchangedInputs =
    material.quantitiesUnchanged &&
    material.destinationUnchanged &&
    material.shipmentPlanUnchanged &&
    material.transportUnchanged &&
    material.customerDataUnchanged &&
    reason.customerDataAccurate;
  const onlyEstimateFields =
    material.changes.length > 0 &&
    material.changes
      .filter(
        (field) => field !== "shipment_plan" || !material.shipmentPlanUnchanged,
      )
      .every((field) =>
        ["freight", "import_charges", "packing_estimate"].includes(field),
      );
  const accepted = context.pi.acceptance !== null;
  const common = {
    material,
    automaticRefundCents: 0 as const,
    publicReason: {
      code: reason.code,
      label: reason.label,
      customerRequested: reason.customerRequested,
    },
    auditReason: reason,
  };
  if (
    accepted &&
    unchangedInputs &&
    !reason.customerRequested &&
    (estimateError || lowerActualCost || onlyEstimateFields)
  ) {
    return freeze({
      ...common,
      decision: material.totalChanged
        ? ("accepted_total_locked" as const)
        : ("record_actual_cost_only" as const),
      acceptedTotalCents: context.pi.totalCents,
      replacement: null,
    });
  }
  if (!material.changes.length)
    return freeze({
      ...common,
      decision: "no_material_change" as const,
      acceptedTotalCents: accepted ? context.pi.totalCents : null,
      replacement: null,
    });
  if (
    context.nextQuote.id === context.previousQuote.id ||
    !Number.isSafeInteger(next.revisionNumber) ||
    next.revisionNumber <= previous.revisionNumber ||
    piUtcInstant(next.issuedAt) < piUtcInstant(previous.issuedAt) ||
    piUtcInstant(next.issuedAt) > piUtcInstant(context.now)
  )
    throw new PiLifecycleError(
      "invalid_source",
      "A newer issued current Quote Revision is required for replacement",
    );
  return freeze({
    ...common,
    decision: "replacement_required" as const,
    acceptedTotalCents: accepted ? context.pi.totalCents : null,
    replacement: {
      requestId: context.pi.requestId,
      previousPiId: context.pi.piId,
      nextDocumentVersion: positive(
        context.pi.documentVersion + 1,
        "Replacement PI version",
      ),
      quoteRevisionId: context.nextQuote.id,
      supersededAt: piUtcInstant(context.now),
      requiresRenewedAcceptance: true as const,
      carryAcceptance: false as const,
      preserveHistoricalArtifacts: true as const,
      expectedPi: { ...input.expectedPi },
      expectedHeadVersion: context.head.version,
      expectedAcceptanceId: input.expectedAcceptanceId,
    },
  });
}

export type PiReplacementPlan = ReturnType<typeof planPiReplacement>;
