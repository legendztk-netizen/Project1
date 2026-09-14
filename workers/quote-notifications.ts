import type { ApplicationBindings } from "./environment";
import {
  createAesGcmNotificationProtector,
  createQuoteNotifications,
} from "../app/modules/quote-notifications";

export async function notificationProtector(env: ApplicationBindings) {
  const secret =
    env.APP_ENV === "local"
      ? "local-development-only-customer-identity-signing-key"
      : env.APP_ENV === "preview"
        ? env.PREVIEW_NOTIFICATION_ENCRYPTION_KEY
        : env.PRODUCTION_NOTIFICATION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32)
    throw new Error("Persistent notification encryption key is missing");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("quote-notification-payload-v1"),
      info: new TextEncoder().encode(env.APP_ENV),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return createAesGcmNotificationProtector(key);
}

export async function quoteNotifications(env: ApplicationBindings) {
  return createQuoteNotifications({
    database: env.DB,
    env,
    protector: await notificationProtector(env),
  });
}

export async function dispatchQuoteNotifications(env: ApplicationBindings) {
  const service = await quoteNotifications(env);
  let enqueued = 0;
  let failed = 0;
  for (let batch = 0; batch < 5; batch++) {
    const result = await service.dispatch(env.ASYNC_JOBS, 100);
    enqueued += result.enqueued;
    failed += result.failed;
    if (result.enqueued + result.failed < 100) break;
  }
  return { enqueued, failed };
}

export async function consumeQuoteNotifications(
  batch: MessageBatch<unknown>,
  env: ApplicationBindings,
  fallback?: (message: Message<unknown>) => Promise<boolean>,
) {
  const service = await quoteNotifications(env);
  for (const message of batch.messages) {
    if (!(await service.consume(message)) && !(await fallback?.(message))) {
      // Unknown jobs are not silently accepted by an unrelated consumer.
      message.retry({ delaySeconds: 300 });
    }
  }
}
