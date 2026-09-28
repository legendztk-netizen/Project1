import type { ApplicationBindings } from "./environment";
import { createAesGcmNotificationProtector } from "../app/modules/quote-notifications/infrastructure/protected-payload";

/** Separate derived key and AAD namespace for bank details; root secret stays outside D1. */
export async function refundAccountProtector(env: ApplicationBindings) {
  const secret =
    env.APP_ENV === "local"
      ? "local-development-only-customer-identity-signing-key"
      : env.APP_ENV === "preview"
        ? env.PREVIEW_NOTIFICATION_ENCRYPTION_KEY
        : env.PRODUCTION_NOTIFICATION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32)
    throw new Error("Refund account encryption is unavailable");
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
      salt: new TextEncoder().encode("refund-bank-account-v1"),
      info: new TextEncoder().encode(env.APP_ENV),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return createAesGcmNotificationProtector(key);
}
