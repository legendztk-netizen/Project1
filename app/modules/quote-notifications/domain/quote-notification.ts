import {
  decodeBase64Url,
  encodeBase64Url,
} from "../../customer-identity/domain/base64-url";

export const REPLY_TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
// Leave an hour of headroom inside Resend's 24-hour idempotency retention.
export const SAFE_PROVIDER_RETRY_MS = 23 * 60 * 60 * 1000;
export const DELIVERY_LEASE_MS = 120_000;
export const MAX_DELIVERY_ATTEMPTS = 10;

export interface NotificationEnvironment {
  APP_ENV: "local" | "preview" | "production";
  EMAIL_DELIVERY_MODE: "stub" | "resend";
  EMAIL_FROM: string;
  EMAIL_REPLY_DOMAIN: string;
  PREVIEW_RESEND_API_KEY?: string;
  PRODUCTION_RESEND_API_KEY?: string;
}

export interface NotificationEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  reply_to: string;
}

export interface NotificationAdminRow {
  id: string;
  message_id: string;
  request_id: string;
  state: "pending" | "sending" | "retry" | "sent" | "dead_letter" | "review";
  created_at: number;
  attempts: number;
  dispatch_attempts: number;
  failure_code: string | null;
  next_attempt_at: number;
  completed_at: number | null;
  has_local_capture: number;
}

export type AdminNotificationProjection = NotificationAdminRow;

export interface NotificationAdminListOptions {
  limit?: number;
  before?: string;
  filter?: "all" | "unresolved";
}

export interface NotificationAdminPage {
  rows: NotificationAdminRow[];
  nextCursor: string | null;
}

interface NotificationCursor {
  version: 1;
  filter: "all" | "unresolved";
  createdAt: number;
  id: string;
}

export function notificationAdminCursor(cursor: NotificationCursor) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

export function notificationAdminPageOptions(
  options: NotificationAdminListOptions,
) {
  const filter = options.filter ?? "all";
  if (filter !== "all" && filter !== "unresolved")
    throw new Response("Invalid notification filter", { status: 400 });
  const limit = Number.isInteger(options.limit)
    ? Math.min(100, Math.max(1, options.limit!))
    : 50;
  let cursor: NotificationCursor | null = null;
  if (options.before !== undefined) {
    try {
      if (
        typeof options.before !== "string" ||
        options.before.length > 2048 ||
        !/^[A-Za-z0-9_-]+$/.test(options.before)
      )
        throw new Error();
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          decodeBase64Url(options.before),
        ),
      );
      if (!parsed || typeof parsed !== "object") throw new Error();
      const value = parsed as Partial<NotificationCursor>;
      if (
        value.version !== 1 ||
        value.filter !== filter ||
        !Number.isSafeInteger(value.createdAt) ||
        value.createdAt! < 0 ||
        typeof value.id !== "string" ||
        !value.id.length ||
        value.id.length > 200
      )
        throw new Error();
      cursor = {
        version: 1,
        filter,
        createdAt: value.createdAt!,
        id: value.id,
      };
      if (notificationAdminCursor(cursor) !== options.before) throw new Error();
    } catch {
      throw new Response("Invalid notification cursor", { status: 400 });
    }
  }
  return { filter, limit, cursor };
}

export type DeliveryResult =
  | { kind: "sent"; providerId: string }
  | {
      kind: "retry";
      code: "transport_uncertain" | "provider_busy" | "provider_unavailable";
      retryAfterSeconds?: number;
    }
  | { kind: "permanent"; code: "provider_rejected" | "provider_auth" }
  | { kind: "review"; code: "idempotency_conflict" };

export interface QuoteNotificationAdapter {
  send(
    email: NotificationEmail,
    idempotencyKey: string,
  ): Promise<DeliveryResult>;
}

export interface NotificationProtector {
  seal(plaintext: string, context: string): Promise<string>;
  open(ciphertext: string, context: string): Promise<string>;
}

export interface QuoteNotificationJob {
  type: "quote-conversation-notification";
  notificationId: string;
}

export interface NotificationQueue {
  send(body: QuoteNotificationJob): Promise<unknown>;
}

export interface NotificationQueueMessage {
  body: unknown;
  ack(): void;
  retry(options: { delaySeconds: number }): void;
}

export function notificationJob(value: unknown): QuoteNotificationJob | null {
  if (typeof value !== "object" || value === null) return null;
  const job = value as Partial<QuoteNotificationJob>;
  return job.type === "quote-conversation-notification" &&
    typeof job.notificationId === "string" &&
    job.notificationId.length > 0 &&
    job.notificationId.length <= 256
    ? { type: job.type, notificationId: job.notificationId }
    : null;
}

export function retryDelaySeconds(attempt: number) {
  return Math.min(3600, 30 * 2 ** Math.min(Math.max(0, attempt - 1), 7));
}

export function normalizeReplySender(email: string) {
  const normalized = email.trim().toLowerCase();
  return /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(normalized)
    ? normalized
    : null;
}

export function notificationConfiguration(env: NotificationEnvironment) {
  const fromEmail = env.EMAIL_FROM.match(/<([^<>]+)>$/)?.[1] ?? env.EMAIL_FROM;
  if (
    !normalizeReplySender(fromEmail) ||
    /[\r\n]/.test(env.EMAIL_FROM) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
      env.EMAIL_REPLY_DOMAIN,
    )
  )
    throw new Error("Invalid notification configuration");
  if (env.APP_ENV === "local") {
    if (env.EMAIL_DELIVERY_MODE !== "stub")
      throw new Error("Local notifications require stub delivery");
    return;
  }
  const values = [fromEmail, env.EMAIL_REPLY_DOMAIN];
  if (
    !["preview", "production"].includes(env.APP_ENV) ||
    env.EMAIL_DELIVERY_MODE !== "resend" ||
    values.some((value) =>
      /replace-with-|\.invalid$|@example\.(com|org|net)$|^example\.(com|org|net)$/i.test(
        value,
      ),
    )
  )
    throw new Error("Notification production configuration is not ready");
}
