import type { QuoteNotificationAdapter } from "../domain/quote-notification";

// https://resend.com/docs/dashboard/emails/idempotency-keys
// https://resend.com/docs/api-reference/emails/send-email
export function createResendNotificationAdapter(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): QuoteNotificationAdapter {
  if (!apiKey.trim() || /replace-with-|placeholder/i.test(apiKey))
    throw new Error("Resend API key is not configured");
  return {
    async send(email, idempotencyKey) {
      try {
        const response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(email),
          signal: AbortSignal.timeout(20_000),
          redirect: "error",
        });
        if (response.ok) {
          const data = (await response.json()) as { id?: unknown };
          if (
            typeof data.id === "string" &&
            data.id.length > 0 &&
            data.id.length <= 256
          )
            return { kind: "sent", providerId: data.id };
          return { kind: "retry", code: "transport_uncertain" };
        }
        if (response.status === 409) {
          const error = (await response.json()) as { name?: string };
          return error.name === "concurrent_idempotent_requests"
            ? { kind: "retry", code: "provider_busy" }
            : { kind: "review", code: "idempotency_conflict" };
        }
        if (
          response.status === 429 ||
          response.status >= 500 ||
          response.status === 408
        ) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          return {
            kind: "retry",
            code: "provider_unavailable",
            retryAfterSeconds: Number.isFinite(retryAfter)
              ? Math.min(3600, Math.max(0, retryAfter))
              : undefined,
          };
        }
        return {
          kind: "permanent",
          code: [401, 403].includes(response.status)
            ? "provider_auth"
            : "provider_rejected",
        };
      } catch {
        // Never persist provider response bodies, request payloads, or exception text.
        return { kind: "retry", code: "transport_uncertain" };
      }
    },
  };
}
