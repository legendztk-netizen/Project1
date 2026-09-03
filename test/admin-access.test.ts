import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  authorizeAdminRequest,
  isAdminPath,
  verifyCloudflareAccessJwt,
  type AdminAccessBindings,
} from "../workers/admin-access";

const deployedBindings: AdminAccessBindings = {
  ADMIN_AUTH_MODE: "cloudflare-access",
  ADMIN_ORIGIN: "https://admin.example.com",
  APP_ENV: "preview",
  CLOUDFLARE_ACCESS_AUD: "test-audience",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://test-team.cloudflareaccess.com",
  DB: {} as D1Database,
};

const ownerIdentity = {
  accountType: "owner" as const,
  canManageSubaccounts: true,
  email: "owner@example.com",
  id: "admin-owner",
};

const subaccountIdentity = {
  accountType: "subaccount" as const,
  canManageSubaccounts: false,
  email: "operator@example.com",
  id: "admin-operator",
};

async function signedAccessToken(email: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const keyId = "ticket04-test-key";
  const keySet = createLocalJWKSet({ keys: [{ ...publicJwk, kid: keyId }] });
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .setAudience(deployedBindings.CLOUDFLARE_ACCESS_AUD)
    .setExpirationTime("5m")
    .setIssuedAt()
    .setIssuer(deployedBindings.CLOUDFLARE_ACCESS_TEAM_DOMAIN)
    .setSubject(`access-user:${email}`)
    .sign(privateKey);
  return { keySet, token };
}

describe("Admin route boundary", () => {
  it.each([
    ["/admin", true],
    ["/admin/", true],
    ["/admin/catalog", true],
    ["/admin/catalog/review", true],
    ["/admin/catalog/releases", true],
    ["/admin/quotes", true],
    ["/admin/quotes/request-1", true],
    ["/administrator", false],
    ["/", false],
  ])("classifies %s", (pathname, expected) => {
    expect(isAdminPath(pathname)).toBe(expected);
  });

  it("uses an explicit Owner identity only in local development", async () => {
    const identity = await authorizeAdminRequest(
      new Request("http://admin.localhost:5173/admin"),
      {
        ...deployedBindings,
        ADMIN_AUTH_MODE: "local-stub",
        ADMIN_ORIGIN: "http://admin.localhost:5173",
        APP_ENV: "local",
        CLOUDFLARE_ACCESS_AUD: "local-stub",
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://local.invalid",
      },
    );

    expect(identity).toMatchObject({
      accountType: "owner",
      canManageSubaccounts: true,
      email: "owner@local.invalid",
      source: "local-development",
    });
  });

  it("rejects a missing deployed Access assertion", async () => {
    await expect(
      authorizeAdminRequest(
        new Request("https://admin.example.com/admin/catalog/review", {
          headers: { cookie: "hs_customer_session=customer-token" },
        }),
        deployedBindings,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects Admin paths requested through the Storefront origin", async () => {
    await expect(
      authorizeAdminRequest(
        new Request("https://storefront.example.com/admin", {
          headers: { "Cf-Access-Jwt-Assertion": "unused" },
        }),
        deployedBindings,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("cryptographically validates an Access JWT and maps the Owner", async () => {
    const { keySet, token } = await signedAccessToken("owner@example.com");
    const request = new Request("https://admin.example.com/admin", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const identity = await authorizeAdminRequest(request, deployedBindings, {
      findIdentityByEmail: async () => ownerIdentity,
      verifyJwt: (assertion, settings) =>
        verifyCloudflareAccessJwt(assertion, settings, keySet),
    });

    expect(identity).toMatchObject({
      accountType: "owner",
      canManageSubaccounts: true,
      email: "owner@example.com",
      source: "cloudflare-access",
    });
  });

  it("maps the allowed Subaccount without subaccount-management permission", async () => {
    const { keySet, token } = await signedAccessToken("operator@example.com");
    const identity = await authorizeAdminRequest(
      new Request("https://admin.example.com/admin", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      deployedBindings,
      {
        findIdentityByEmail: async () => subaccountIdentity,
        verifyJwt: (assertion, settings) =>
          verifyCloudflareAccessJwt(assertion, settings, keySet),
      },
    );

    expect(identity).toMatchObject({
      accountType: "subaccount",
      canManageSubaccounts: false,
      email: "operator@example.com",
    });
  });

  it("rejects invalid assertions and identities without an active D1 account", async () => {
    const invalidRequest = new Request("https://admin.example.com/admin", {
      headers: { "Cf-Access-Jwt-Assertion": "not-a-jwt" },
    });
    await expect(
      authorizeAdminRequest(invalidRequest, deployedBindings),
    ).rejects.toMatchObject({ status: 403 });

    const { keySet, token } = await signedAccessToken("unknown@example.com");
    await expect(
      authorizeAdminRequest(
        new Request("https://admin.example.com/admin", {
          headers: { "Cf-Access-Jwt-Assertion": token },
        }),
        deployedBindings,
        {
          findIdentityByEmail: async () => null,
          verifyJwt: (assertion, settings) =>
            verifyCloudflareAccessJwt(assertion, settings, keySet),
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
