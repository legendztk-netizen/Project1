import type { DraftSelectionProvenance } from "./assembly-draft-validation";
import type { HoseConfigurationDraft } from "./hose-configuration-draft";

export type PendingConfigurationStage =
  "hose" | "end-a" | "end-b" | "length" | "clocking" | "protection" | "review";

export interface PendingConfigurationSnapshot {
  configuration: HoseConfigurationDraft;
  pageState: {
    quantityInput: string;
    selectionProvenance: DraftSelectionProvenance;
    stage: PendingConfigurationStage;
  };
}

export interface PendingConfigurationVersionSnapshot {
  assemblyEstimateSchedule: {
    code: string;
    recordVersion: number;
  } | null;
  catalogRelease: {
    id: string;
    number: string;
  };
  clockingConvention: {
    code: string;
    recordVersion: number;
    rendererVersion: string;
  } | null;
  installedProtection: {
    code: string;
    recordVersion: number;
  } | null;
  lengthTolerance: {
    code: string;
    version: string;
  } | null;
  measurementMethod: {
    code: string;
    diagramAssetVersion: string;
    overlayVersion: string;
    recordVersion: number;
  } | null;
}

export class PendingConfigurationSaveRejected extends Error {
  constructor(
    message: string,
    readonly code:
      "INVALID_DRAFT" | "INVALID_EMAIL" | "EMAIL_UNAVAILABLE" | "RATE_LIMITED",
  ) {
    super(message);
    this.name = "PendingConfigurationSaveRejected";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function serializableClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new PendingConfigurationSaveRejected(
      "This configuration could not be read. Keep this page open and try again.",
      "INVALID_DRAFT",
    );
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizePendingConfigurationEmail(value: unknown) {
  if (typeof value !== "string") {
    throw new PendingConfigurationSaveRejected(
      "Enter a valid email address.",
      "INVALID_EMAIL",
    );
  }
  const email = value.trim().toLowerCase();
  const parts = email.split("@");
  if (
    email.length > 254 ||
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1]?.includes(".") ||
    /\s/u.test(email) ||
    !/^[^@\s]+@[^@\s]+$/u.test(email)
  ) {
    throw new PendingConfigurationSaveRejected(
      "Enter a valid email address.",
      "INVALID_EMAIL",
    );
  }
  return email;
}

export function preparePendingConfigurationSnapshot(input: {
  configuration: unknown;
  pageState: unknown;
}) {
  const configuration = input.configuration as Partial<HoseConfigurationDraft>;
  const pageState = input.pageState as Partial<
    PendingConfigurationSnapshot["pageState"]
  >;
  if (
    !configuration ||
    typeof configuration !== "object" ||
    !nonEmptyString(configuration.catalogRelease?.id) ||
    !nonEmptyString(configuration.catalogRelease?.number) ||
    !nonEmptyString(configuration.hose?.sku) ||
    !pageState ||
    typeof pageState !== "object" ||
    !nonEmptyString(pageState.stage) ||
    ![
      "hose",
      "end-a",
      "end-b",
      "length",
      "clocking",
      "protection",
      "review",
    ].includes(pageState.stage) ||
    typeof pageState.quantityInput !== "string" ||
    !pageState.selectionProvenance ||
    typeof pageState.selectionProvenance !== "object"
  ) {
    throw new PendingConfigurationSaveRejected(
      "This configuration is incomplete or unreadable. Keep this page open and review your selections.",
      "INVALID_DRAFT",
    );
  }

  const snapshot = serializableClone({
    configuration: configuration as HoseConfigurationDraft,
    pageState: pageState as PendingConfigurationSnapshot["pageState"],
  });
  if (JSON.stringify(snapshot).length > 131_072) {
    throw new PendingConfigurationSaveRejected(
      "This configuration is too large to save. Keep this page open and review your selections.",
      "INVALID_DRAFT",
    );
  }
  const measurement = snapshot.configuration.measurementSelection;
  const clocking = snapshot.configuration.clocking;
  const protection = snapshot.configuration.installedProtection;
  const pricing = snapshot.configuration.lengthReferencePricing;
  const tolerance = snapshot.configuration.finishedLength?.tolerance;
  const versions: PendingConfigurationVersionSnapshot = {
    assemblyEstimateSchedule:
      pricing?.scheduleRecordVersion !== null &&
      pricing?.scheduleRecordVersion !== undefined
        ? {
            code: "DEFAULT",
            recordVersion: pricing.scheduleRecordVersion,
          }
        : null,
    catalogRelease: { ...snapshot.configuration.catalogRelease },
    clockingConvention: clocking
      ? {
          code: clocking.convention.code,
          recordVersion: clocking.convention.recordVersion,
          rendererVersion: clocking.convention.rendererVersion,
        }
      : null,
    installedProtection: protection
      ? { code: protection.code, recordVersion: protection.recordVersion }
      : null,
    lengthTolerance: tolerance
      ? { code: tolerance.scheduleCode, version: tolerance.scheduleVersion }
      : null,
    measurementMethod:
      measurement?.state === "selected"
        ? {
            code: measurement.method.code,
            diagramAssetVersion: measurement.diagram.assetVersion,
            overlayVersion: measurement.diagram.overlayVersion,
            recordVersion: measurement.method.recordVersion,
          }
        : null,
  };
  return { snapshot, versions };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function pendingConfigurationSaveIdentity(
  email: string,
  snapshot: PendingConfigurationSnapshot,
) {
  return sha256(`${email}\n${JSON.stringify(stableValue(snapshot))}`);
}

export async function pendingConfigurationVerificationTokenHash(token: string) {
  return sha256(token);
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function pendingConfigurationVerificationToken(
  saveIdentity: string,
  secret: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`pending-configuration:${saveIdentity}`),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export async function pendingConfigurationRateLimitKey(value: string) {
  return sha256(`pending-configuration-rate:${value}`);
}
