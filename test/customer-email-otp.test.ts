import { describe, expect, it, vi } from "vitest";

import { createCustomerIdentityService } from "../app/modules/customer-identity/application/customer-identity-service";
import {
  digestEmailOtp,
  emailOtpLifetimeSeconds,
  emailOtpMaximumFailedAttempts,
  emailOtpResendCooldownSeconds,
  generateSixDigitOtp,
  isSixDigitOtp,
  normalizeCustomerEmail,
  validatedCustomerReturnPath,
  verifyEmailOtpDigest,
} from "../app/modules/customer-identity/domain/email-otp";
import {
  clearCustomerSessionCookie,
  createCustomerSessionCookie,
  customerSessionCookieName,
  digestCustomerSessionToken,
  generateCustomerSessionToken,
  readCustomerSessionToken,
} from "../app/modules/customer-identity/domain/customer-session";
import type { createD1CustomerIdentityRepository } from "../app/modules/customer-identity/infrastructure/d1-customer-identity-repository";
import {
  customerPasswordAlgorithm,
  customerPasswordMaximumLength,
  customerPasswordMinimumLength,
  customerPasswordWorkFactor,
  hashCustomerPassword,
  PasswordPolicyError,
  validatedCustomerPassword,
  verifyCustomerPassword,
} from "../app/modules/customer-identity/domain/customer-password";

describe("customer email OTP", () => {
  it("uses the ticket-defined lifetime, cooldown and attempt limit", () => {
    expect(emailOtpLifetimeSeconds).toBe(600);
    expect(emailOtpResendCooldownSeconds).toBe(60);
    expect(emailOtpMaximumFailedAttempts).toBe(5);
  });

  it("generates a cryptographically sourced six-digit value", () => {
    const values = new Set(Array.from({ length: 64 }, generateSixDigitOtp));
    expect(values.size).toBeGreaterThan(1);
    for (const value of values) expect(value).toMatch(/^\d{6}$/);
  });

  it("stores and verifies a one-way challenge-bound digest", async () => {
    const input = {
      challengeId: "challenge-1",
      code: "012345",
      email: "customer@example.com",
      purpose: "register" as const,
      secret: "test-only-customer-secret",
    };
    const digest = await digestEmailOtp(input);
    expect(digest).not.toContain(input.code);
    await expect(verifyEmailOtpDigest({ ...input, digest })).resolves.toBe(
      true,
    );
    await expect(
      verifyEmailOtpDigest({ ...input, code: "012346", digest }),
    ).resolves.toBe(false);
    await expect(
      verifyEmailOtpDigest({ ...input, challengeId: "challenge-2", digest }),
    ).resolves.toBe(false);
  });

  it("normalizes email, rejects malformed codes and blocks open redirects", () => {
    expect(normalizeCustomerEmail(" Customer@Example.COM ")).toBe(
      "customer@example.com",
    );
    expect(normalizeCustomerEmail("not-an-email")).toBeNull();
    expect(isSixDigitOtp("123456")).toBe(true);
    expect(isSixDigitOtp("12345")).toBe(false);
    const origin = "https://storefront.example.test";
    expect(validatedCustomerReturnPath("/quote-list", origin)).toBe(
      "/quote-list",
    );
    expect(validatedCustomerReturnPath("//evil.example/steal", origin)).toBe(
      "/account",
    );
    expect(validatedCustomerReturnPath("/\t/evil.example/x", origin)).toBe(
      "/account",
    );
    expect(validatedCustomerReturnPath("/admin", origin)).toBe("/account");
    expect(validatedCustomerReturnPath("https://evil.example", origin)).toBe(
      "/account",
    );
  });

  it("discards a pending challenge when email delivery fails", async () => {
    const calls: string[] = [];
    const repository = {
      activateDeliveredChallenge: async () => calls.push("activate"),
      countRecentRequests: async () => ({ email: 0, ip: 0 }),
      createChallenge: async () => calls.push("create"),
      discardUndeliveredChallenge: async () => calls.push("discard"),
      latestRequest: async () => null,
    } as unknown as ReturnType<typeof createD1CustomerIdentityRepository>;
    const service = createCustomerIdentityService(
      { APP_ENV: "local" } as never,
      {
        deliver: async () => {
          calls.push("deliver");
          throw new Error("mail provider unavailable");
        },
        otp: () => "123456",
        repository,
      },
    );

    await expect(
      service.requestOtp({
        email: "customer@example.com",
        purpose: "register",
        request: new Request("http://storefront.localhost/register"),
      }),
    ).rejects.toThrow("mail provider unavailable");
    expect(calls).toEqual(["create", "deliver", "discard"]);
  });

  it("returns the local preview without logging the OTP secret", async () => {
    const repository = {
      activateDeliveredChallenge: async () => undefined,
      countRecentRequests: async () => ({ email: 0, ip: 0 }),
      createChallenge: async () => undefined,
      discardUndeliveredChallenge: async () => undefined,
      latestRequest: async () => null,
    } as unknown as ReturnType<typeof createD1CustomerIdentityRepository>;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const service = createCustomerIdentityService(
        { APP_ENV: "local", EMAIL_DELIVERY_MODE: "stub" } as never,
        { otp: () => "654321", repository },
      );
      await expect(
        service.requestOtp({
          email: "customer@example.com",
          purpose: "register",
          request: new Request("http://storefront.localhost/register"),
        }),
      ).resolves.toMatchObject({ localPreviewCode: "654321" });
      expect(consoleInfo).not.toHaveBeenCalled();
    } finally {
      consoleInfo.mockRestore();
    }
  });
});

describe("customer session", () => {
  it("uses an opaque token, a one-way digest and an HttpOnly cookie", async () => {
    const token = generateCustomerSessionToken();
    expect(token.length).toBeGreaterThan(32);
    const digest = await digestCustomerSessionToken(token, "test-only-secret");
    expect(digest).not.toContain(token);
    const cookie = createCustomerSessionCookie({
      now: new Date("2026-08-31T00:00:00.000Z"),
      secure: true,
      token,
    });
    expect(cookie).toContain(`${customerSessionCookieName}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(
      readCustomerSessionToken(
        new Request("https://example.test/account", {
          headers: { cookie: cookie.split(";", 1)[0] ?? "" },
        }),
      ),
    ).toBe(token);
  });

  it("clears the customer cookie explicitly", () => {
    const cookie = clearCustomerSessionCookie(false);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
});

describe("customer password", () => {
  it("creates unique-salted Worker-compatible adaptive hashes", async () => {
    const password = "A long customer passphrase 2026";
    const [first, second] = await Promise.all([
      hashCustomerPassword(password),
      hashCustomerPassword(password),
    ]);

    expect(first).toMatchObject({
      algorithm: customerPasswordAlgorithm,
      hashBytes: 32,
      normalization: "NFC",
      workFactor: customerPasswordWorkFactor,
    });
    expect(first.salt).not.toBe(second.salt);
    expect(first.derivedKey).not.toBe(second.derivedKey);
    expect(JSON.stringify(first)).not.toContain(password);
    await expect(verifyCustomerPassword(password, first)).resolves.toBe(true);
    await expect(
      verifyCustomerPassword("A different customer passphrase", first),
    ).resolves.toBe(false);
  });

  it("accepts Unicode passphrases without composition rules", async () => {
    await expect(
      validatedCustomerPassword("液压系统 专用 长密码 2026"),
    ).resolves.toBe("液压系统 专用 长密码 2026");
  });

  it("rejects short, overlong and common values without truncation", async () => {
    await expect(validatedCustomerPassword("too short")).rejects.toMatchObject({
      code: "TOO_SHORT",
    });
    await expect(
      validatedCustomerPassword("x".repeat(customerPasswordMaximumLength + 1)),
    ).rejects.toMatchObject({ code: "TOO_LONG" });
    await expect(
      validatedCustomerPassword("correcthorsebatterystaple"),
    ).rejects.toMatchObject({ code: "COMMON_PASSWORD" });
    expect(customerPasswordMinimumLength).toBe(15);
    expect(new PasswordPolicyError("short", "TOO_SHORT").code).toBe(
      "TOO_SHORT",
    );
  });

  it("allows the compromised-value screening provider to be replaced", async () => {
    const screened: string[] = [];
    await expect(
      validatedCustomerPassword("A unique launch passphrase", {
        isBlocked(password) {
          screened.push(password);
          return false;
        },
      }),
    ).resolves.toBe("A unique launch passphrase");
    expect(screened).toEqual(["A unique launch passphrase"]);
  });
});
