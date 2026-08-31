import type { ApplicationBindings } from "./environment";

const localQuoteSessionSigningKey =
  "local-development-only-anonymous-quote-session-signing-key";

export function quoteSessionSigningKey(env: ApplicationBindings) {
  if (env.APP_ENV === "local") return localQuoteSessionSigningKey;
  const secret =
    env.APP_ENV === "preview"
      ? env.PREVIEW_SESSION_SIGNING_KEY
      : env.PRODUCTION_SESSION_SIGNING_KEY;
  if (!secret) {
    throw new Error(
      `Anonymous Quote Session signing key is missing for ${env.APP_ENV}`,
    );
  }
  return secret;
}

export function customerIdentitySigningKey(env: ApplicationBindings) {
  if (env.APP_ENV === "local") {
    return "local-development-only-customer-identity-signing-key";
  }
  const secret =
    env.APP_ENV === "preview"
      ? env.PREVIEW_SESSION_SIGNING_KEY
      : env.PRODUCTION_SESSION_SIGNING_KEY;
  if (!secret) {
    throw new Error(
      `Customer identity signing key is missing for ${env.APP_ENV}`,
    );
  }
  return secret;
}
