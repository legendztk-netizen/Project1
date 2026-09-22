import { describe, expect, it, vi } from "vitest";

import {
  deliverCustomerOtp,
  type ResendOtpClientFactory,
} from "../app/modules/customer-identity/infrastructure/resend-otp-delivery";

function environment(overrides: Record<string, unknown> = {}) {
  return {
    APP_ENV: "preview",
    EMAIL_DELIVERY_MODE: "resend",
    EMAIL_FROM: "Hydraulic Supply <verify@example.test>",
    PREVIEW_RESEND_API_KEY: "unit-test-resend-key",
    ...overrides,
  } as never;
}

describe("Resend OTP delivery", () => {
  it("keeps local stub delivery offline", async () => {
    const createClient = vi.fn();
    await deliverCustomerOtp(
      {
        challengeId: "challenge-local",
        code: "123456",
        email: "customer@example.com",
        env: environment({
          APP_ENV: "local",
          EMAIL_DELIVERY_MODE: "stub",
        }),
        purpose: "register",
      },
      createClient as ResendOtpClientFactory,
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("sends the dynamic recipient and OTP through the SDK client", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ data: { id: "email-1" }, error: null });
    const createClient = vi.fn(() => ({ send }));

    await deliverCustomerOtp(
      {
        challengeId: "challenge-123",
        code: "654321",
        email: "customer@example.com",
        env: environment(),
        purpose: "sign_in",
      },
      createClient,
    );

    expect(createClient).toHaveBeenCalledWith("unit-test-resend-key");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Hydraulic Supply <verify@example.test>",
        html: expect.stringContaining("654321"),
        text: expect.stringContaining("654321"),
        to: ["customer@example.com"],
      }),
      { idempotencyKey: "customer-otp/challenge-123" },
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain(
      "unit-test-resend-key",
    );
  });

  it("fails closed when the secret is missing or Resend rejects delivery", async () => {
    await expect(
      deliverCustomerOtp({
        challengeId: "challenge-missing-key",
        code: "123456",
        email: "customer@example.com",
        env: environment({ PREVIEW_RESEND_API_KEY: undefined }),
        purpose: "register",
      }),
    ).rejects.toThrow("Resend API key is not configured");

    const send = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "provider detail must not escape" },
    });
    await expect(
      deliverCustomerOtp(
        {
          challengeId: "challenge-provider-error",
          code: "123456",
          email: "customer@example.com",
          env: environment(),
          purpose: "register",
        },
        () => ({ send }),
      ),
    ).rejects.toThrow("Email delivery failed");
  });
});
