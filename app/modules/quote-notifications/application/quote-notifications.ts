import type { AdminIdentity } from "#workers/admin-access";
import {
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  REPLY_TOKEN_LIFETIME_MS,
  SAFE_PROVIDER_RETRY_MS,
  normalizeReplySender,
  notificationConfiguration,
  notificationJob,
  retryDelaySeconds,
  type NotificationEmail,
  type NotificationEnvironment,
  type NotificationProtector,
  type NotificationQueue,
  type NotificationQueueMessage,
  type QuoteNotificationAdapter,
  type DeliveryResult,
  type NotificationAdminListOptions,
} from "../domain/quote-notification";
import {
  createD1QuoteNotifications,
  type NotificationRow,
} from "../infrastructure/d1-quote-notifications";
import {
  newReplyToken,
  replyTokenHash,
} from "../infrastructure/protected-payload";
import { createResendNotificationAdapter } from "../infrastructure/resend-notification-adapter";

function requireAdmin(actor: AdminIdentity | null | undefined) {
  if (!actor?.id || !["owner", "subaccount"].includes(actor.accountType))
    throw new Response("Forbidden", { status: 403 });
}

function limitSize(value: number) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 100)) : 50;
}

export function createQuoteNotifications(input: {
  database: D1Database;
  env: NotificationEnvironment;
  protector: NotificationProtector;
  adapter?: QuoteNotificationAdapter;
  now?: () => number;
}) {
  const repository = createD1QuoteNotifications(input.database);
  const now = input.now ?? Date.now;
  const { env, protector } = input;

  async function prepare(row: NotificationRow) {
    if (row.protected_payload) return row;
    const recipient = await repository.recipient(row.request_id);
    if (!recipient || !normalizeReplySender(recipient.email)) {
      await repository.finish(row, "review", "recipient_unavailable", now());
      return null;
    }
    const source = await repository.source(row);
    if (!source) {
      await repository.finish(row, "dead_letter", "source_unavailable", now());
      return null;
    }
    const token = newReplyToken();
    const payload: NotificationEmail = {
      from: env.EMAIL_FROM,
      to: [recipient.email],
      subject: "New message about your quote",
      text: `${source.body.trim() || "You have a new quote message with an attachment."}\n\nView the authoritative conversation in My Quotes. Any attachments are available there.`,
      reply_to: `${token}@${env.EMAIL_REPLY_DOMAIN}`,
    };
    let encrypted: string;
    try {
      encrypted = await protector.seal(JSON.stringify(payload), row.id);
    } catch {
      await repository.finish(
        row,
        "review",
        "protected_payload_unavailable",
        now(),
      );
      return null;
    }
    const timestamp = now();
    return repository.prepare(row, {
      profileId: recipient.id,
      email: recipient.email,
      payload: encrypted,
      mode: env.EMAIL_DELIVERY_MODE,
      tokenHash: await replyTokenHash(token),
      now: timestamp,
      expiresAt: timestamp + REPLY_TOKEN_LIFETIME_MS,
    });
  }

  async function deliver(id: string): Promise<number | null> {
    const lease = crypto.randomUUID();
    let row = await repository.claim(id, now(), lease);
    if (!row) {
      const current = await repository.read(id);
      return current && ["pending", "retry", "sending"].includes(current.state)
        ? Math.max(
            1,
            Math.ceil(
              (Math.max(current.next_attempt_at, current.lease_until ?? 0) -
                now()) /
                1000,
            ),
          )
        : null;
    }
    if (
      row.first_attempt_at !== null &&
      now() >= row.first_attempt_at + SAFE_PROVIDER_RETRY_MS
    ) {
      await repository.finish(
        row,
        "review",
        "idempotency_window_elapsed",
        now(),
      );
      return null;
    }
    if (row.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await repository.finish(
        row,
        "review",
        "delivery_attempts_exhausted",
        now(),
      );
      return null;
    }
    let adapter = input.adapter;
    try {
      notificationConfiguration(env);
      if (env.EMAIL_DELIVERY_MODE === "resend" && !adapter)
        adapter = createResendNotificationAdapter(
          (env.APP_ENV === "preview"
            ? env.PREVIEW_RESEND_API_KEY
            : env.PRODUCTION_RESEND_API_KEY) ?? "",
        );
    } catch {
      await repository.finish(
        row,
        "review",
        "configuration_unavailable",
        now(),
      );
      return null;
    }
    if (row.delivery_mode && row.delivery_mode !== env.EMAIL_DELIVERY_MODE) {
      await repository.finish(row, "review", "delivery_mode_changed", now());
      return null;
    }
    row = await prepare(row);
    if (!row) return null;
    if (row.lease_id !== lease || row.state !== "sending")
      return DELIVERY_LEASE_MS / 1000;
    if (!(await repository.validReplyToken(row.id, now()))) {
      await repository.finish(
        row,
        "review",
        "reply_token_expired_or_revoked",
        now(),
      );
      return null;
    }
    let email: NotificationEmail;
    try {
      email = JSON.parse(
        await protector.open(row.protected_payload!, row.id),
      ) as NotificationEmail;
    } catch {
      await repository.finish(
        row,
        "review",
        "protected_payload_unavailable",
        now(),
      );
      return null;
    }
    // Never retarget a frozen provider request, even when another contact becomes authorized.
    if (
      !row.recipient_profile_id ||
      !row.recipient_email ||
      !(await repository.recipient(
        row.request_id,
        row.recipient_profile_id,
        row.recipient_email,
      ))
    ) {
      await repository.finish(
        row,
        "review",
        "recipient_no_longer_authorized",
        now(),
      );
      return null;
    }
    if (
      row.first_attempt_at !== null &&
      now() >= row.first_attempt_at + SAFE_PROVIDER_RETRY_MS
    ) {
      await repository.finish(
        row,
        "review",
        "idempotency_window_elapsed",
        now(),
      );
      return null;
    }
    const attempt = await repository.markAttempt(row, now());
    if (!attempt) return DELIVERY_LEASE_MS / 1000;
    row = attempt;
    if (env.EMAIL_DELIVERY_MODE === "stub") {
      await repository.capture(row, now());
      return null;
    }
    let result: DeliveryResult;
    try {
      result = await adapter!.send(email, row.idempotency_key);
    } catch {
      result = { kind: "retry", code: "transport_uncertain" };
    }
    if (result.kind === "sent") {
      await repository.finish(row, "sent", null, now(), result.providerId);
      return null;
    }
    if (result.kind === "permanent" || result.kind === "review") {
      await repository.finish(
        row,
        result.kind === "permanent" ? "dead_letter" : "review",
        result.code,
        now(),
      );
      return null;
    }
    const delay = Math.max(
      retryDelaySeconds(row.attempts),
      Math.min(3600, Math.max(0, result.retryAfterSeconds ?? 0)),
    );
    if (
      row.attempts >= MAX_DELIVERY_ATTEMPTS ||
      now() + delay * 1000 >= row.first_attempt_at! + SAFE_PROVIDER_RETRY_MS
    ) {
      await repository.finish(
        row,
        "review",
        "delivery_retry_budget_exhausted",
        now(),
      );
      return null;
    }
    await repository.retry(row, result.code, now() + delay * 1000);
    return delay;
  }

  return {
    async dispatch(queue: NotificationQueue, limit = 50) {
      let enqueued = 0;
      let failed = 0;
      for (const candidate of await repository.due(now(), limitSize(limit))) {
        const row = await repository.claimDispatch(candidate, now());
        if (!row) continue;
        try {
          await queue.send({
            type: "quote-conversation-notification",
            notificationId: row.id,
          });
          await repository.dispatched(row);
          enqueued++;
        } catch {
          await repository.dispatchFailed(
            row,
            now() + retryDelaySeconds(row.dispatch_attempts) * 1000,
            row.dispatch_attempts >= MAX_DELIVERY_ATTEMPTS,
            now(),
          );
          failed++;
        }
      }
      return { enqueued, failed };
    },
    async consume(message: NotificationQueueMessage): Promise<boolean> {
      const job = notificationJob(message.body);
      if (!job) return false;
      try {
        const delay = await deliver(job.notificationId);
        if (delay === null) {
          // A stale lease holder may have lost its conditional completion write.
          const persisted = await repository.read(job.notificationId);
          if (
            persisted &&
            ["pending", "sending", "retry"].includes(persisted.state)
          )
            message.retry({ delaySeconds: 60 });
          else message.ack();
        } else message.retry({ delaySeconds: Math.min(43_200, delay) });
      } catch {
        // D1 or protection outages must not acknowledge unrecorded completion.
        message.retry({ delaySeconds: 60 });
      }
      return true;
    },
    async listAdmin(
      actor: AdminIdentity | null | undefined,
      options: number | NotificationAdminListOptions = {},
    ) {
      requireAdmin(actor);
      return repository.adminList(
        typeof options === "number" ? { limit: options } : options,
      );
    },
    async readLocalCapture(
      actor: AdminIdentity | null | undefined,
      notificationId: string,
    ): Promise<NotificationEmail> {
      requireAdmin(actor);
      if (env.APP_ENV !== "local" || env.EMAIL_DELIVERY_MODE !== "stub")
        throw new Response("Not found", { status: 404 });
      const capture = await repository.capturePayload(notificationId);
      if (!capture) throw new Response("Not found", { status: 404 });
      return JSON.parse(
        await protector.open(capture.protected_payload, notificationId),
      ) as NotificationEmail;
    },
    async resolveReplyToken(token: string, senderEmail: string) {
      const email = normalizeReplySender(senderEmail);
      if (!/^[0-9a-f]{64}$/.test(token) || !email) return null;
      const scope = await repository.replyScope(
        await replyTokenHash(token),
        email,
        now(),
      );
      if (
        !scope ||
        !(await repository.recipient(scope.request_id, scope.profile_id, email))
      )
        return null;
      return {
        requestId: scope.request_id,
        profileId: scope.profile_id,
        recipientEmail: scope.recipient_email,
        expiresAt: scope.expires_at,
      };
    },
  };
}
