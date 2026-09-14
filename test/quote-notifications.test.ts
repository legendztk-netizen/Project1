import { expect, it, vi } from "vitest";
import {
  createAesGcmNotificationProtector,
  createResendNotificationAdapter,
} from "../app/modules/quote-notifications";
import { notificationConfiguration } from "../app/modules/quote-notifications/domain/quote-notification";

const email = {
  from: "quotes@seller.test",
  to: ["buyer@buyer.test"],
  subject: "Quote",
  text: "Hello",
  reply_to: `${"a".repeat(64)}@reply.seller.test`,
};

it("sends the identical external idempotency header and payload through the replaceable HTTP adapter", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{"id":"provider-id"}'));
  const adapter = createResendNotificationAdapter("test-key", fetcher);
  expect(await adapter.send(email, "quote-conversation/message")).toEqual({
    kind: "sent",
    providerId: "provider-id",
  });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(init).toMatchObject({
    method: "POST",
    redirect: "error",
    body: JSON.stringify(email),
    headers: {
      "Idempotency-Key": "quote-conversation/message",
      Authorization: "Bearer test-key",
    },
  });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

it("classifies transient, permanent, conflicting and uncertain provider responses without echoing secrets", async () => {
  for (const [status, body, kind, code] of [
    [429, "SECRET", "retry", "provider_unavailable"],
    [503, "SECRET", "retry", "provider_unavailable"],
    [401, "SECRET", "permanent", "provider_auth"],
    [422, "SECRET", "permanent", "provider_rejected"],
    [
      409,
      '{"name":"concurrent_idempotent_requests"}',
      "retry",
      "provider_busy",
    ],
    [
      409,
      '{"name":"invalid_idempotent_request"}',
      "review",
      "idempotency_conflict",
    ],
    [200, "{}", "retry", "transport_uncertain"],
  ] as const) {
    const adapter = createResendNotificationAdapter(
      "test",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status })),
    );
    expect(await adapter.send(email, "stable")).toMatchObject({ kind, code });
  }
  const adapter = createResendNotificationAdapter(
    "test",
    vi.fn<typeof fetch>().mockRejectedValue(new Error("SECRET TOKEN")),
  );
  expect(await adapter.send(email, "stable")).toEqual({
    kind: "retry",
    code: "transport_uncertain",
  });
});

it("rejects deployed placeholders and stub delivery outside local, with no real credentials needed for local", () => {
  const local = {
    APP_ENV: "local",
    EMAIL_DELIVERY_MODE: "stub",
    EMAIL_FROM: "quotes@local.invalid",
    EMAIL_REPLY_DOMAIN: "reply.local.invalid",
  } as const;
  expect(() => notificationConfiguration(local)).not.toThrow();
  expect(() =>
    notificationConfiguration({ ...local, APP_ENV: "production" }),
  ).toThrow();
  expect(() =>
    notificationConfiguration({
      ...local,
      APP_ENV: "production",
      EMAIL_DELIVERY_MODE: "resend",
    }),
  ).toThrow();
  expect(() =>
    notificationConfiguration({
      ...local,
      EMAIL_REPLY_DOMAIN: "reply.test\r\nBcc:bad",
    }),
  ).toThrow();
  expect(() =>
    notificationConfiguration({
      ...local,
      APP_ENV: "preview",
      EMAIL_DELIVERY_MODE: "resend",
      EMAIL_FROM: "Sales <quotes@seller.test>",
      EMAIL_REPLY_DOMAIN: "reply.seller.test",
    }),
  ).not.toThrow();
  expect(() => createResendNotificationAdapter("")).toThrow();
});

it("encrypts retry payloads with context binding and rejects swapped or tampered ciphertext", async () => {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const protector = createAesGcmNotificationProtector(key);
  const payload = JSON.stringify(email);
  const encrypted = await protector.seal(payload, "notification-a");
  expect(encrypted).not.toContain(email.reply_to);
  expect(await protector.open(encrypted, "notification-a")).toBe(payload);
  await expect(protector.open(encrypted, "notification-b")).rejects.toThrow();
  const changed = `${encrypted.slice(0, -1)}${encrypted.endsWith("0") ? "1" : "0"}`;
  await expect(protector.open(changed, "notification-a")).rejects.toThrow();
  expect(await protector.seal(payload, "notification-a")).not.toBe(encrypted);
});
