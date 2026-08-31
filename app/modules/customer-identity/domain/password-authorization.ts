import { encodeBase64Url } from "./base64-url";

export type PasswordAuthorizationScope = "password_change" | "password_reset";

export const passwordAuthorizationCookieName = "hs_password_authorization";
export const passwordAuthorizationLifetimeSeconds = 10 * 60;

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

export function generatePasswordAuthorizationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function readPasswordAuthorizationToken(request: Request) {
  return readCookie(request, passwordAuthorizationCookieName);
}

export function createPasswordAuthorizationCookie(input: {
  now: Date;
  secure: boolean;
  token: string;
}) {
  const expires = new Date(
    input.now.getTime() + passwordAuthorizationLifetimeSeconds * 1000,
  );
  return [
    `${passwordAuthorizationCookieName}=${encodeURIComponent(input.token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${passwordAuthorizationLifetimeSeconds}`,
    `Expires=${expires.toUTCString()}`,
    input.secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearPasswordAuthorizationCookie(secure: boolean) {
  return [
    `${passwordAuthorizationCookieName}=`,
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
