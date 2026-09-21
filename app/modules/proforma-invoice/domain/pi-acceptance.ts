import type { AdminIdentity } from "#workers/admin-access";
import { piUtcInstant, type ProformaInvoiceSnapshot } from "./proforma-invoice";

export interface PiAcceptanceTarget {
  piId: string;
  documentVersion: number;
  snapshotHash: string;
}

export interface PiAcceptanceCustomer {
  profileId: string;
  purchasingContextId: string;
}

export type PiAcceptanceSnapshot = Pick<
  ProformaInvoiceSnapshot,
  "schemaVersion" | "documentVersion" | "issuedAt" | "validUntil" | "conditions"
> & {
  quoteRevision: Pick<
    ProformaInvoiceSnapshot["quoteRevision"],
    "id" | "requestId"
  >;
  lines: ReadonlyArray<
    Pick<ProformaInvoiceSnapshot["lines"][number], "id" | "madeToOrder">
  >;
};

export interface PiAcceptanceAcknowledgements {
  general: { version: string; confirmed: boolean };
  madeToOrder: Array<{
    lineIds: string[];
    version: string;
    cancellationVersion: string;
    specificationsConfirmed: boolean;
    cancellationConfirmed: boolean;
  }>;
}

export interface PiAcceptanceInput extends PiAcceptanceTarget {
  legalName: string;
  acknowledgements: PiAcceptanceAcknowledgements;
}

interface ScopedEvidence extends PiAcceptanceTarget, PiAcceptanceCustomer {
  id: string;
  occurredAt: string;
}

export type PiAcceptanceSource =
  | {
      source: "website";
      customer: PiAcceptanceCustomer & { verified: boolean };
      viewing: ScopedEvidence & {
        kind: "view" | "download";
        successful: boolean;
      };
    }
  | {
      source: "email";
      admin: AdminIdentity;
      explicitlyConfirmed: boolean;
      evidence: ScopedEvidence & {
        sourceMessageId: string;
        acknowledgementEvidenceId: string;
      };
    };

// Supplied by authenticated application/database reads, never by submitted form
// fields. Recheck ownership/current state in the eventual atomic INSERT. Handle
// exact command replay before this new-acceptance validator (even after expiry).
export interface PiAcceptanceContext {
  pi: PiAcceptanceTarget & { snapshot: PiAcceptanceSnapshot };
  currentPiId: string;
  currentQuoteRevisionId: string;
  superseded: boolean;
  alreadyAccepted: boolean;
  customer: PiAcceptanceCustomer;
  customerAuthorized: boolean;
  now: string;
  source: PiAcceptanceSource;
  requestEvidence: {
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  };
}

function required(value: string, label: string, limit = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(`${label} required`);
  return value.trim();
}

function target(value: PiAcceptanceTarget) {
  if (
    !value ||
    !Number.isSafeInteger(value.documentVersion) ||
    value.documentVersion < 1 ||
    typeof value.snapshotHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.snapshotHash)
  )
    throw new Error("Exact PI version and snapshot hash required");
  return {
    piId: required(value.piId, "PI id"),
    documentVersion: value.documentVersion,
    snapshotHash: value.snapshotHash,
  };
}

function sameTarget(left: PiAcceptanceTarget, right: PiAcceptanceTarget) {
  const checked = target(left);
  if (
    checked.piId !== right.piId ||
    checked.documentVersion !== right.documentVersion ||
    checked.snapshotHash !== right.snapshotHash
  )
    throw new Error("Stale or mismatched PI evidence");
}

function scopedEvidence(
  evidence: ScopedEvidence,
  pi: PiAcceptanceTarget,
  customer: PiAcceptanceCustomer,
  issuedAt: string,
  now: string,
) {
  sameTarget(evidence, pi);
  if (
    evidence.profileId !== customer.profileId ||
    evidence.purchasingContextId !== customer.purchasingContextId
  )
    throw new Error("Wrong customer evidence");
  const occurredAt = piUtcInstant(evidence.occurredAt);
  if (occurredAt < issuedAt || occurredAt > now)
    throw new Error(
      "Evidence must follow PI issuance and not be in the future",
    );
  return { id: required(evidence.id, "Evidence id"), occurredAt };
}

function policy(value: { readonly version: string; readonly text: string }) {
  required(value?.version, "Policy source version");
  required(value?.text, "Policy source text", 20000);
  return { version: value.version, text: value.text };
}

function metadata(value: string | null, label: string, limit: number) {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(`Invalid ${label}`);
  return value;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function validatePiAcceptance(
  context: PiAcceptanceContext,
  input: PiAcceptanceInput,
) {
  const pi = target(context.pi);
  sameTarget(input, pi);
  const snapshot = context.pi.snapshot;
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.documentVersion !== pi.documentVersion ||
    context.currentPiId !== pi.piId ||
    context.currentQuoteRevisionId !== snapshot.quoteRevision.id ||
    context.superseded !== false
  )
    throw new Error("Current non-superseded PI required");
  if (context.alreadyAccepted !== false)
    throw new Error("PI already accepted; resolve exact replay or conflict");
  if (context.customerAuthorized !== true)
    throw new Error("Customer is not authorized for this purchasing context");
  const customer = {
    profileId: required(context.customer.profileId, "Customer profile"),
    purchasingContextId: required(
      context.customer.purchasingContextId,
      "Purchasing context",
    ),
  };
  const now = piUtcInstant(context.now);
  const issuedAt = piUtcInstant(snapshot.issuedAt);
  if (now < issuedAt || now >= piUtcInstant(snapshot.validUntil))
    throw new Error("PI is not yet issued or has expired");
  const legalName = required(input.legalName, "Customer legal name", 300);
  if (
    [...legalName].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("Invalid customer legal name");
  const conditions = snapshot.conditions;
  const general = policy(conditions.generalAcknowledgement);
  const cancellation = policy(conditions.cancellation);
  const refund = policy(conditions.refund);
  if (
    input.acknowledgements?.general?.confirmed !== true ||
    input.acknowledgements.general.version !== general.version
  )
    throw new Error("Explicit current general acknowledgement required");
  const customIds = snapshot.lines
    .filter((line) => line.madeToOrder)
    .map((line) => line.id);
  const expected = conditions.madeToOrderAcknowledgements;
  if (
    new Set(snapshot.lines.map((line) => line.id)).size !==
      snapshot.lines.length ||
    new Set(expected.map((ack) => ack.lineId)).size !== expected.length ||
    expected.length !== customIds.length ||
    expected.some((ack) => !customIds.includes(ack.lineId))
  )
    throw new Error("PI made-to-order policy coverage is incomplete");
  const groups = input.acknowledgements.madeToOrder;
  if (!Array.isArray(groups) || groups.length > expected.length)
    throw new Error("Invalid made-to-order acknowledgements");
  const seen = new Set<string>();
  for (const group of groups) {
    if (
      !Array.isArray(group.lineIds) ||
      !group.lineIds.length ||
      group.lineIds.length > expected.length ||
      group.specificationsConfirmed !== true ||
      group.cancellationConfirmed !== true ||
      group.cancellationVersion !== cancellation.version
    )
      throw new Error(
        "Explicit specification and cancellation acknowledgements required",
      );
    for (const id of group.lineIds) {
      const ack = expected.find((value) => value.lineId === id);
      if (!ack || seen.has(id) || group.version !== ack.version)
        throw new Error("Missing, duplicate or stale line acknowledgement");
      seen.add(id);
    }
  }
  if (seen.size !== expected.length)
    throw new Error("Every made-to-order line must be acknowledged");
  const madeToOrder = expected
    .map((ack) => ({
      id: "made-to-order" as const,
      lineId: ack.lineId,
      ...policy(ack),
      specificationsConfirmed: true as const,
      cancellationConfirmed: true as const,
      cancellationVersion: cancellation.version,
    }))
    .sort((a, b) => a.lineId.localeCompare(b.lineId));

  const source = context.source;
  let evidence;
  if (source?.source === "website") {
    if (
      source.customer?.verified !== true ||
      source.customer.profileId !== customer.profileId ||
      source.customer.purchasingContextId !== customer.purchasingContextId ||
      source.viewing?.successful !== true ||
      !["view", "download"].includes(source.viewing.kind)
    )
      throw new Error(
        "Verified customer and successful exact PI view/download required",
      );
    evidence = {
      source: "website" as const,
      ...scopedEvidence(source.viewing, pi, customer, issuedAt, now),
      kind: source.viewing.kind,
    };
  } else if (source?.source === "email") {
    if (
      !source.admin?.id ||
      !["owner", "subaccount"].includes(source.admin.accountType) ||
      source.explicitlyConfirmed !== true
    )
      throw new Error(
        "Authorized Admin and explicit email confirmation required",
      );
    evidence = {
      source: "email" as const,
      ...scopedEvidence(source.evidence, pi, customer, issuedAt, now),
      actingAdminId: required(source.admin.id, "Acting Admin"),
      sourceMessageId: required(
        source.evidence.sourceMessageId,
        "Source message",
      ),
      acknowledgementEvidenceId: required(
        source.evidence.acknowledgementEvidenceId,
        "Acknowledgement evidence",
      ),
      explicitlyConfirmed: true as const,
    };
  } else throw new Error("Acceptance source required");

  return freeze({
    schemaVersion: 1 as const,
    ...pi,
    quoteRevisionId: snapshot.quoteRevision.id,
    requestId: snapshot.quoteRevision.requestId,
    customer,
    legalName,
    acceptedAt: now,
    evidence,
    policySource: { ...pi, schemaVersion: snapshot.schemaVersion },
    acknowledgements: {
      general: { id: "general" as const, ...general, confirmed: true as const },
      madeToOrder,
    },
    conditions: { cancellation, refund },
    requestEvidence: {
      requestId: required(
        context.requestEvidence.requestId,
        "Request evidence",
      ),
      ipAddress: metadata(
        context.requestEvidence.ipAddress,
        "IP evidence",
        128,
      ),
      userAgent: metadata(
        context.requestEvidence.userAgent,
        "user agent",
        4096,
      ),
    },
  });
}

export type PiAcceptance = ReturnType<typeof validatePiAcceptance>;
