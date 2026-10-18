import { afterAll, beforeAll, expect, it } from "vitest";

import {
  createCustomerIdentityService,
  CustomerIdentityError,
} from "../app/modules/customer-identity/application/customer-identity-service";
import { startAfterSalesDatabase } from "./fixtures/after-sales-order";

let db: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const started = await startAfterSalesDatabase("password-reset");
  db = started.db;
  dispose = started.dispose;
}, 90_000);

afterAll(async () => {
  await dispose?.();
});

it("lets a customer who forgot their password set a new one from an email code and sign in with it", async () => {
  const service = createCustomerIdentityService(
    {
      APP_ENV: "production",
      DB: db,
      PRODUCTION_SESSION_SIGNING_KEY: "test-only-session-signing-key",
    } as never,
    {
      deliver: async () => undefined,
      now: () => new Date("2026-10-18T05:00:00.000Z"),
      otp: () => "246810",
    },
  );
  const request = (cookie?: string) =>
    new Request("https://customhoseco.com/forgot-password", {
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        ...(cookie ? { cookie } : {}),
      },
    });
  const email = "buyer@example.test";
  const password = "Hydraulic2026";
  await expect(
    service.signInWithPassword({ email, password, request: request() }),
  ).rejects.toBeInstanceOf(CustomerIdentityError);

  const challenge = await service.requestPasswordAuthorizationOtp({
    email,
    request: request(),
    scope: "password_reset",
  });
  await expect(
    service.verifyPasswordAuthorizationOtp({
      challengeId: challenge.challengeId,
      code: "000000",
      request: request(),
      scope: "password_reset",
    }),
  ).rejects.toBeInstanceOf(CustomerIdentityError);
  const verified = await service.verifyPasswordAuthorizationOtp({
    challengeId: challenge.challengeId,
    code: "246810",
    request: request(),
    scope: "password_reset",
  });
  const authorization = verified.setCookie.split(";")[0];

  const replaced = await service.replacePasswordWithAuthorization({
    newPassword: password,
    request: request(authorization),
  });
  expect(replaced.setCookie).toMatch(/^hs_customer_session=/);
  // The emailed authorization is single-use.
  await expect(
    service.replacePasswordWithAuthorization({
      newPassword: "Another2026",
      request: request(authorization),
    }),
  ).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION" });

  await expect(
    service.signInWithPassword({ email, password, request: request() }),
  ).resolves.toMatchObject({
    setCookie: expect.stringMatching(/^hs_customer_session=/),
  });
  await expect(
    service.signInWithPassword({
      email,
      password: "Another2026",
      request: request(),
    }),
  ).rejects.toBeInstanceOf(CustomerIdentityError);
}, 60_000);
