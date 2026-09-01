import { describe, expect, it } from "vitest";

import {
  anonymousQuoteCookieName,
  anonymousQuoteSessionLifetimeSeconds,
  clearAnonymousQuoteCookie,
  createAnonymousQuoteCookie,
  parseStandardProductQuantity,
  readAnonymousQuoteSessionId,
  signAnonymousQuoteSession,
} from "../app/modules/quote-list/domain/anonymous-quote-session";

const secret = "test-only-session-signing-secret";

describe("anonymous Quote Session", () => {
  it("accepts an authentic signed session and rejects tampering", async () => {
    const signed = await signAnonymousQuoteSession("session-123", secret);
    const authentic = new Request("https://example.test/quote-list", {
      headers: { cookie: `${anonymousQuoteCookieName}=${signed}` },
    });
    await expect(readAnonymousQuoteSessionId(authentic, secret)).resolves.toBe(
      "session-123",
    );

    const tampered = new Request("https://example.test/quote-list", {
      headers: {
        cookie: `${anonymousQuoteCookieName}=another-session.${signed.split(".")[1]}`,
      },
    });
    await expect(
      readAnonymousQuoteSessionId(tampered, secret),
    ).resolves.toBeNull();
  });

  it("issues a 30-day HttpOnly cookie without product or personal data", async () => {
    const cookie = await createAnonymousQuoteCookie({
      now: new Date("2026-08-25T00:00:00.000Z"),
      secret,
      secure: true,
      sessionId: "session-456",
    });
    expect(cookie).toContain(`${anonymousQuoteCookieName}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain(`Max-Age=${anonymousQuoteSessionLifetimeSeconds}`);
    expect(cookie).not.toContain("SKU");
    expect(cookie).not.toContain("email");
  });

  it("retires the browser ownership token after an account merge", () => {
    const cookie = clearAnonymousQuoteCookie(true);
    expect(cookie).toContain(`${anonymousQuoteCookieName}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });

  it("accepts only whole quantities from 1 through 9,999", () => {
    expect(parseStandardProductQuantity("1")).toBe(1);
    expect(parseStandardProductQuantity("9999")).toBe(9999);
    expect(parseStandardProductQuantity("0")).toBeNull();
    expect(parseStandardProductQuantity("10000")).toBeNull();
    expect(parseStandardProductQuantity("1.5")).toBeNull();
    expect(parseStandardProductQuantity("two")).toBeNull();
  });
});
