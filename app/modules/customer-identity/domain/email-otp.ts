import { encodeBase64Url } from "./base64-url";

export type EmailOtpPurpose = "register" | "sign_in";
export type EmailOtpAuthorizationScope =
  "password_change" | "password_reset" | "session";

export const emailOtpLifetimeSeconds = 10 * 60;
export const emailOtpResendCooldownSeconds = 60;
export const emailOtpMaximumFailedAttempts = 5;
export const emailOtpMaximumRequestsPerEmailHour = 5;
export const emailOtpMaximumRequestsPerIpHour = 20;

const encoder = new TextEncoder();

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

export function normalizeCustomerEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function generateSixDigitOtp() {
  const range = 1_000_000;
  const maximum = Math.floor(2 ** 32 / range) * range;
  const random = new Uint32Array(1);
  do crypto.getRandomValues(random);
  while ((random[0] ?? maximum) >= maximum);
  return String((random[0] ?? 0) % range).padStart(6, "0");
}

export function isSixDigitOtp(value: string) {
  return /^\d{6}$/.test(value);
}

export async function digestEmailOtp(input: {
  authorizationScope?: EmailOtpAuthorizationScope;
  challengeId: string;
  code: string;
  email: string;
  purpose: EmailOtpPurpose;
  secret: string;
}) {
  const key = await importHmacKey(input.secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      `${input.challengeId}\n${input.email}\n${input.purpose}${
        input.authorizationScope && input.authorizationScope !== "session"
          ? `\n${input.authorizationScope}`
          : ""
      }\n${input.code}`,
    ),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export async function verifyEmailOtpDigest(
  input: Parameters<typeof digestEmailOtp>[0] & { digest: string },
) {
  const expected = await digestEmailOtp(input);
  const expectedBytes = encoder.encode(expected);
  const actualBytes = encoder.encode(input.digest);
  if (expectedBytes.byteLength !== actualBytes.byteLength) return false;
  const key = await importHmacKey(input.secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      `${input.challengeId}\n${input.email}\n${input.purpose}${
        input.authorizationScope && input.authorizationScope !== "session"
          ? `\n${input.authorizationScope}`
          : ""
      }\n${input.code}`,
    ),
  );
  const actualSignature = encodeBase64Url(new Uint8Array(signature));
  let difference = 0;
  for (let index = 0; index < actualSignature.length; index += 1) {
    difference |=
      actualSignature.charCodeAt(index) ^ input.digest.charCodeAt(index);
  }
  return difference === 0;
}

export function validatedCustomerReturnPath(
  value: string | null,
  storefrontOrigin: string,
) {
  if (!value || !value.startsWith("/")) return "/account";
  try {
    const target = new URL(value, storefrontOrigin);
    if (
      target.origin !== storefrontOrigin ||
      target.pathname.startsWith("/admin")
    ) {
      return "/account";
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/account";
  }
}
