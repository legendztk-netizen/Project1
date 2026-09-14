import type { NotificationProtector } from "../../quote-notifications";

export const MAX_INBOUND_RAW_BYTES = 15 * 1024 * 1024;
export const MAX_INBOUND_HEADERS_BYTES = 64 * 1024;
export const INBOUND_LEASE_MS = 120_000;
export const MAX_INBOUND_ATTEMPTS = 10;
// Storage safety ceilings mirrored by migration 0072, including quarantine history.
export const INBOUND_INGRESS_MAX_RECEIPTS = 10_000;
export const INBOUND_UNVERIFIED_MAX_RECEIPTS = 10_000;
export const INBOUND_INGRESS_MAX_BYTES = 1024 * 1024 * 1024;
export const INBOUND_QUOTE_MAX_RECEIPTS = 200;
export const INBOUND_QUOTE_MAX_BYTES = 100 * 1024 * 1024;

export type InboundReason =
  | "raw_too_large"
  | "invalid_envelope"
  | "authentication_unverified"
  | "reply_not_authorized"
  | "invalid_reply_address"
  | "provider_event_conflict"
  | "malformed_mime"
  | "sender_mismatch"
  | "automated_message"
  | "body_out_of_bounds"
  | "attachment_rejected"
  | "too_many_attachments"
  | "message_id_conflict"
  | "storage_integrity"
  | "reservation_expired"
  | "conversation_limit"
  | "processing_unavailable"
  | "attempts_exhausted"
  | "queue_unavailable";

export type InboundState =
  | "staging"
  | "pending"
  | "processing"
  | "retry"
  | "appended"
  | "duplicate"
  | "quarantined"
  | "dead_letter";

export interface InboundEnvironment {
  APP_ENV: "local" | "preview" | "production";
  EMAIL_REPLY_DOMAIN: string;
}

export interface InboundEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly rawSize: number;
  readonly raw: ReadableStream<Uint8Array>;
  readonly headers: Headers;
}

export interface VerifiedPlatformEmail {
  provider: "cloudflare-email" | "local-fixture";
  authenticatedSender: string;
  rawSha256: string;
  mechanism: "dmarc-aligned";
  eventId?: string;
}

// Trusted runtime dependency, not a request field. Never implement with user MIME headers alone.
export type PlatformEmailVerifier = (input: {
  message: InboundEmailMessage;
  raw: Uint8Array;
  rawSha256: string;
}) => Promise<VerifiedPlatformEmail | null>;

export interface ReplyScope {
  requestId: string;
  profileId: string;
  recipientEmail: string;
  expiresAt: number;
}

export type ReplyTokenResolver = (
  token: string,
  senderEmail: string,
) => Promise<ReplyScope | null>;
export type InboundProtector = NotificationProtector;

export interface InboundQueueJob {
  type: "quote-inbound-email";
  receiptId: string;
}

export interface InboundQueue {
  send(job: InboundQueueJob): Promise<unknown>;
}

export interface InboundQueueMessage {
  body: unknown;
  ack(): void;
  retry(options: { delaySeconds: number }): void;
}

export interface InboundAdminRow {
  id: string;
  state: InboundState;
  reason: InboundReason | null;
  created_at: number;
  completed_at: number | null;
  raw_size: number;
  attempts: number;
  dispatch_attempts: number;
  cleanup_pending: number;
  cleanup_attempts: number;
  cleanup_next_at: number;
  request_id: string | null;
  message_id: string | null;
}

export interface InboundAdminQuery {
  limit?: number;
  cursor?: string;
  state?: InboundState;
}

export interface InboundAdminPage {
  rows: InboundAdminRow[];
  nextCursor: string | null;
}

export class InboundRejection extends Error {
  constructor(readonly reason: InboundReason) {
    super(reason);
  }
}

export function normalizedEmail(value: string) {
  const address = value.trim().toLowerCase();
  return address.length <= 254 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(
      address,
    )
    ? address
    : null;
}

export function replyToken(address: string, domain: string) {
  const normalized = normalizedEmail(address);
  if (!normalized || normalized.split("@")[1] !== domain.toLowerCase())
    return null;
  const token = normalized.split("@")[0];
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export async function sha256(value: Uint8Array | string) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function boundedRaw(message: InboundEmailMessage) {
  if (
    !Number.isFinite(message.rawSize) ||
    message.rawSize < 0 ||
    message.rawSize > MAX_INBOUND_RAW_BYTES
  ) {
    await message.raw.cancel().catch(() => {});
    throw new InboundRejection("raw_too_large");
  }
  const reader = message.raw.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_INBOUND_RAW_BYTES) {
        await reader.cancel();
        throw new InboundRejection("raw_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function inboundJob(value: unknown): InboundQueueJob | null {
  if (!value || typeof value !== "object") return null;
  const job = value as Partial<InboundQueueJob>;
  return job.type === "quote-inbound-email" &&
    typeof job.receiptId === "string" &&
    /^[0-9a-f-]{36}$/.test(job.receiptId)
    ? { type: job.type, receiptId: job.receiptId }
    : null;
}

export function inboundBackoff(attempt: number) {
  return Math.min(3600, 30 * 2 ** Math.min(7, Math.max(0, attempt - 1)));
}
