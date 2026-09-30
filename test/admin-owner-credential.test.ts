import { describe, expect, it } from "vitest";

import {
  ownerCredentialSql,
  ownerPasswordHash,
  validatedOwnerPassword,
} from "../scripts/admin-owner-credential.mjs";
import {
  customerPasswordWorkFactor,
  verifyCustomerPassword,
  type PasswordCredentialHash,
} from "../app/modules/customer-identity/domain/customer-password";

describe("admin Owner credential script", () => {
  it("creates a hash the Worker's login check accepts", async () => {
    const hash = JSON.parse(
      await ownerPasswordHash("Correct-Horse-7"),
    ) as PasswordCredentialHash;

    expect(await verifyCustomerPassword("Correct-Horse-7", hash)).toBe(true);
    expect(await verifyCustomerPassword("Correct-Horse-8", hash)).toBe(false);
  }, 30_000);

  it("enforces the admin password policy", () => {
    expect(() => validatedOwnerPassword("short1A")).toThrow("at least 8");
    expect(() => validatedOwnerPassword("alllowercase1")).toThrow("uppercase");
    expect(() => validatedOwnerPassword("NoDigitsHere")).toThrow("number");
    expect(validatedOwnerPassword("Passw0rd-ok")).toBe("Passw0rd-ok");
  });

  it("escapes quotes and updates or creates the Owner", () => {
    const update = ownerCredentialSql(
      '{"a":"it\'s"}',
      "2026-09-30T00:00:00.000Z",
      true,
    );
    const insert = ownerCredentialSql("{}", "2026-09-30T00:00:00.000Z", false);

    expect(update).toContain("it''s");
    expect(update).toMatch(/^UPDATE admin_identities SET username = 'admin'/u);
    expect(update).toContain("credential_version = credential_version + 1");
    expect(insert).toMatch(/^INSERT INTO admin_identities/u);
    expect(insert).toContain("'owner'");
  });

  it("stays within the Cloudflare Workers PBKDF2 iteration limit", async () => {
    // Deployed Workers reject more than 100,000 iterations; local workerd does not.
    expect(customerPasswordWorkFactor).toBeLessThanOrEqual(100_000);
    const hash = JSON.parse(
      await ownerPasswordHash("Correct-Horse-7"),
    ) as PasswordCredentialHash;
    expect(hash.workFactor).toBe(customerPasswordWorkFactor);
  }, 30_000);

  it("treats a credential it cannot evaluate as a non-match", async () => {
    const hash = JSON.parse(
      await ownerPasswordHash("Correct-Horse-7"),
    ) as PasswordCredentialHash;

    expect(
      await verifyCustomerPassword("Correct-Horse-7", {
        ...hash,
        derivedKey: "!!!not-base64!!!",
      }),
    ).toBe(false);
  }, 30_000);
});
