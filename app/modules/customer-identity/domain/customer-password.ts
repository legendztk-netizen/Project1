import { decodeBase64Url, encodeBase64Url } from "./base64-url";

export const customerPasswordAlgorithm = "PBKDF2-HMAC-SHA-256";
export const customerPasswordWorkFactor = 600_000;
export const customerPasswordMinimumLength = 15;
export const customerPasswordMaximumLength = 128;
export const customerPasswordMaximumBytes = 1024;
export const customerPasswordMaximumAttemptsPerEmail = 10;
export const customerPasswordMaximumAttemptsPerIp = 30;
export const customerPasswordAttemptWindowSeconds = 15 * 60;

const encoder = new TextEncoder();
const builtInBlockedPasswords = new Set(
  [
    "123456789012345",
    "correcthorsebatterystaple",
    "hydraulicsupply",
    "letmeinletmeinletmein",
    "passwordpassword",
    "qwertyuiopqwerty",
  ].map((password) => password.normalize("NFC").toLocaleLowerCase("en-US")),
);

export interface PasswordCredentialHash {
  algorithm: typeof customerPasswordAlgorithm;
  derivedKey: string;
  hashBytes: 32;
  normalization: "NFC";
  salt: string;
  workFactor: number;
}

export interface PasswordScreeningProvider {
  isBlocked(password: string): Promise<boolean> | boolean;
}

export const builtInPasswordScreening: PasswordScreeningProvider = {
  isBlocked(password) {
    return builtInBlockedPasswords.has(password.toLocaleLowerCase("en-US"));
  },
};

export type PasswordPolicyErrorCode =
  "COMMON_PASSWORD" | "TOO_LONG" | "TOO_SHORT";

export class PasswordPolicyError extends Error {
  constructor(
    message: string,
    readonly code: PasswordPolicyErrorCode,
  ) {
    super(message);
  }
}

export async function validatedCustomerPassword(
  password: string,
  screening: PasswordScreeningProvider = builtInPasswordScreening,
) {
  const normalized = password.normalize("NFC");
  const characterLength = Array.from(normalized).length;
  if (characterLength < customerPasswordMinimumLength) {
    throw new PasswordPolicyError(
      `Use at least ${customerPasswordMinimumLength} characters. A passphrase works well.`,
      "TOO_SHORT",
    );
  }
  if (
    characterLength > customerPasswordMaximumLength ||
    encoder.encode(normalized).byteLength > customerPasswordMaximumBytes
  ) {
    throw new PasswordPolicyError(
      `Use no more than ${customerPasswordMaximumLength} characters.`,
      "TOO_LONG",
    );
  }
  if (await screening.isBlocked(normalized)) {
    throw new PasswordPolicyError(
      "Choose a less common password or passphrase.",
      "COMMON_PASSWORD",
    );
  }
  return normalized;
}

async function derivePassword(input: {
  password: string;
  salt: Uint8Array;
  workFactor: number;
}) {
  const salt = Uint8Array.from(input.salt);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      iterations: input.workFactor,
      name: "PBKDF2",
      salt,
    },
    key,
    256,
  );
  return new Uint8Array(derived);
}

export async function hashCustomerPassword(
  password: string,
): Promise<PasswordCredentialHash> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derivedKey = await derivePassword({
    password,
    salt,
    workFactor: customerPasswordWorkFactor,
  });
  return {
    algorithm: customerPasswordAlgorithm,
    derivedKey: encodeBase64Url(derivedKey),
    hashBytes: 32,
    normalization: "NFC",
    salt: encodeBase64Url(salt),
    workFactor: customerPasswordWorkFactor,
  };
}

export async function verifyCustomerPassword(
  password: string,
  credential: PasswordCredentialHash,
) {
  if (
    credential.algorithm !== customerPasswordAlgorithm ||
    credential.hashBytes !== 32 ||
    credential.normalization !== "NFC" ||
    !Number.isSafeInteger(credential.workFactor) ||
    credential.workFactor < 1
  ) {
    return false;
  }
  const normalized = password.normalize("NFC");
  if (encoder.encode(normalized).byteLength > customerPasswordMaximumBytes) {
    return false;
  }
  let expected: Uint8Array;
  let salt: Uint8Array;
  try {
    expected = decodeBase64Url(credential.derivedKey);
    salt = decodeBase64Url(credential.salt);
  } catch {
    return false;
  }
  const actual = await derivePassword({
    password: normalized,
    salt,
    workFactor: credential.workFactor,
  });
  if (expected.byteLength !== actual.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}
