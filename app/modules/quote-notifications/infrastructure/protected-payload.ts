import type { NotificationProtector } from "../domain/quote-notification";

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function unhex(value: string) {
  if (!/^(?:[0-9a-f]{2})+$/.test(value))
    throw new Error("Invalid protected payload");
  return Uint8Array.from(value.match(/../g)!, (byte) =>
    Number.parseInt(byte, 16),
  );
}

export async function replyTokenHash(token: string) {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  );
}

export function newReplyToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

// The caller retains the persistent key outside D1. AAD prevents swapping job payloads.
export function createAesGcmNotificationProtector(
  key: CryptoKey,
): NotificationProtector {
  if (
    key.algorithm.name !== "AES-GCM" ||
    !key.usages.includes("encrypt") ||
    !key.usages.includes("decrypt")
  )
    throw new Error("Notification protection requires an AES-GCM key");
  return {
    async seal(plaintext, context) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(context),
        },
        key,
        new TextEncoder().encode(plaintext),
      );
      return `v1.${hex(iv)}.${hex(new Uint8Array(bytes))}`;
    },
    async open(ciphertext, context) {
      const [version, iv, bytes, extra] = ciphertext.split(".");
      if (
        version !== "v1" ||
        !iv ||
        iv.length !== 24 ||
        !bytes ||
        extra !== undefined
      )
        throw new Error("Invalid protected payload");
      try {
        return new TextDecoder().decode(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: unhex(iv),
              additionalData: new TextEncoder().encode(context),
            },
            key,
            unhex(bytes),
          ),
        );
      } catch {
        throw new Error("Protected notification payload unavailable");
      }
    },
  };
}
