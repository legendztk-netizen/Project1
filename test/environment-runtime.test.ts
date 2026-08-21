import { describe, expect, it } from "vitest";

import { validateRuntimeEnvironment } from "../workers/environment";

const resources = {
  ASYNC_JOBS: {},
  DB: {},
  PRIVATE_FILES: {},
};

function bindingsFor(environment: "local" | "preview" | "production") {
  const deployed = environment !== "local";
  const hostname =
    environment === "production" ? "shop.example.com" : "preview.example.com";

  return {
    ...resources,
    ADMIN_AUTH_MODE: deployed ? "cloudflare-access" : "local-stub",
    ADMIN_ORIGIN: deployed
      ? `https://admin.${hostname}`
      : "http://admin.localhost:5173",
    APP_ENV: environment,
    CLOUDFLARE_ACCESS_AUD: deployed
      ? `${environment}-access-audience`
      : "local-stub",
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: deployed
      ? "https://team.cloudflareaccess.com"
      : "https://local.invalid",
    EMAIL_DELIVERY_MODE: deployed ? "resend" : "stub",
    EMAIL_FROM: deployed ? `quotes@${hostname}` : "quotes@local.invalid",
    EMAIL_REPLY_DOMAIN: deployed ? `reply.${hostname}` : "reply.local.invalid",
    PUBLIC_APP_NAME: "Hydraulic Supply",
    PUBLIC_STOREFRONT_ORIGIN: deployed
      ? `https://${hostname}`
      : "http://storefront.localhost:5173",
    ...(environment === "preview"
      ? {
          PREVIEW_RESEND_API_KEY: "unit-test-resend-key",
          PREVIEW_SESSION_SIGNING_KEY: "unit-test-session-key",
        }
      : {}),
    ...(environment === "production"
      ? {
          PRODUCTION_RESEND_API_KEY: "unit-test-resend-key",
          PRODUCTION_SESSION_SIGNING_KEY: "unit-test-session-key",
        }
      : {}),
  };
}

describe("runtime environment validation", () => {
  it.each(["local", "preview", "production"] as const)(
    "accepts a complete %s environment",
    (environment) => {
      const validated = validateRuntimeEnvironment(bindingsFor(environment));

      expect(validated.environment).toBe(environment);
    },
  );

  it("fails with an actionable missing-binding message", () => {
    const bindings = bindingsFor("local");
    Reflect.deleteProperty(bindings, "DB");

    expect(() => validateRuntimeEnvironment(bindings)).toThrow(
      "Missing binding DB (D1 database)",
    );
  });

  it("rejects unresolved deployed placeholders and missing secrets", () => {
    const bindings = {
      ...bindingsFor("preview"),
      PUBLIC_STOREFRONT_ORIGIN: "https://storefront.preview.example.invalid",
      PREVIEW_RESEND_API_KEY: undefined,
    };

    expect(() => validateRuntimeEnvironment(bindings)).toThrowError(
      /PUBLIC_STOREFRONT_ORIGIN.*placeholder.*PREVIEW_RESEND_API_KEY/s,
    );
  });

  it("never permits the local Admin identity mode outside local development", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...bindingsFor("preview"),
        ADMIN_AUTH_MODE: "local-stub",
      }),
    ).toThrow("ADMIN_AUTH_MODE must be cloudflare-access for preview");
  });

  it("requires the local Admin identity mode in local development", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...bindingsFor("local"),
        ADMIN_AUTH_MODE: "cloudflare-access",
      }),
    ).toThrow("ADMIN_AUTH_MODE must be local-stub in local development");
  });
});
