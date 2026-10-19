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

it("does not record a sign-in when a signed-in customer resets their password from Account Security", async () => {
  let clock = new Date("2026-10-18T06:00:00.000Z");
  const service = createCustomerIdentityService(
    {
      APP_ENV: "production",
      DB: db,
      PRODUCTION_SESSION_SIGNING_KEY: "test-only-session-signing-key",
    } as never,
    {
      deliver: async () => undefined,
      now: () => clock,
      otp: () => "135790",
    },
  );
  const request = (ip: string, cookie?: string) =>
    new Request("https://customhoseco.com/account/security", {
      headers: { "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}) },
    });
  const email = "buyer@example.test";
  const signedIn = await service.signInWithPassword({
    email,
    password: "Hydraulic2026",
    request: request("198.51.100.1"),
  });
  const session = signedIn.setCookie.split(";")[0];
  const lastSignIn = () =>
    db
      .prepare(
        `SELECT last_sign_in_at,last_sign_in_method,last_sign_in_ip
         FROM customer_access_records WHERE profile_id='buyer'`,
      )
      .first();
  const before = await lastSignIn();
  expect(before).toEqual({
    last_sign_in_at: "2026-10-18T06:00:00.000Z",
    last_sign_in_method: "password",
    last_sign_in_ip: "198.51.100.1",
  });

  clock = new Date("2026-10-18T07:00:00.000Z");
  const challenge = await service.requestPasswordAuthorizationOtp({
    request: request("198.51.100.2", session),
    scope: "password_change",
  });
  const verified = await service.verifyPasswordAuthorizationOtp({
    challengeId: challenge.challengeId,
    code: "135790",
    request: request("198.51.100.2", session),
    scope: "password_change",
  });
  await service.replacePasswordWithAuthorization({
    newPassword: "Hydraulic2027",
    request: request(
      "198.51.100.2",
      `${session}; ${verified.setCookie.split(";")[0]}`,
    ),
  });
  expect(await lastSignIn()).toEqual(before);
}, 60_000);
