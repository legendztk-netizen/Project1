export const anonymousQuoteCookieName = "hs_quote_session";
export const anonymousQuoteSessionLifetimeSeconds = 30 * 24 * 60 * 60;
export const maximumStandardProductQuantity = 9999;

const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeBase64Url(value: string) {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(
      normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function importSigningKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export async function signAnonymousQuoteSession(
  sessionId: string,
  secret: string,
) {
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(sessionId),
  );
  return `${sessionId}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function readAnonymousQuoteSessionId(
  request: Request,
  secret: string,
) {
  const value = readCookie(request, anonymousQuoteCookieName);
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const sessionId = value.slice(0, separator);
  const signature = decodeBase64Url(value.slice(separator + 1));
  if (!signature) return null;
  const key = await importSigningKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(sessionId),
  );
  return valid ? sessionId : null;
}

export async function createAnonymousQuoteCookie(input: {
  now: Date;
  secret: string;
  secure: boolean;
  sessionId: string;
}) {
  const value = await signAnonymousQuoteSession(input.sessionId, input.secret);
  const expires = new Date(
    input.now.getTime() + anonymousQuoteSessionLifetimeSeconds * 1000,
  );
  return [
    `${anonymousQuoteCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${anonymousQuoteSessionLifetimeSeconds}`,
    `Expires=${expires.toUTCString()}`,
    input.secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export function quoteSessionExpiry(now: Date) {
  return new Date(
    now.getTime() + anonymousQuoteSessionLifetimeSeconds * 1000,
  ).toISOString();
}

export function parseStandardProductQuantity(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= maximumStandardProductQuantity
    ? quantity
    : null;
}
