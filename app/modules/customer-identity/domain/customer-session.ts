import { encodeBase64Url } from "./base64-url";

export const customerSessionCookieName = "hs_customer_session";
export const customerSessionLifetimeSeconds = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function generateCustomerSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export async function digestCustomerSessionToken(
  token: string,
  secret: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
  return encodeBase64Url(new Uint8Array(digest));
}

export function readCustomerSessionToken(request: Request) {
  return readCookie(request, customerSessionCookieName);
}

export function createCustomerSessionCookie(input: {
  now: Date;
  secure: boolean;
  token: string;
}) {
  const expires = new Date(
    input.now.getTime() + customerSessionLifetimeSeconds * 1000,
  );
  return [
    `${customerSessionCookieName}=${encodeURIComponent(input.token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${customerSessionLifetimeSeconds}`,
    `Expires=${expires.toUTCString()}`,
    input.secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearCustomerSessionCookie(secure: boolean) {
  return [
    `${customerSessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}
