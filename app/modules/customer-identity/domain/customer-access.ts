export type CustomerSignInMethod = "email_code" | "password" | "password_reset";

/** Cloudflare's approximate location of an IP address. */
export interface IpLocation {
  country: string | null;
  region: string | null;
  city: string | null;
}

/** The location fields as Cloudflare's `request.cf` provides them. */
export type CustomerRequestLocation = {
  [Field in keyof IpLocation]?: string | null;
};

/** Where a new customer session was opened from (ADR 0059). */
export interface CustomerSignInAccess extends IpLocation {
  ip: string | null;
  method: CustomerSignInMethod;
}

function bounded(value: string | null | undefined, maximum: number) {
  const text = value?.trim();
  return text ? text.slice(0, maximum) : null;
}

export function customerSignInAccess(input: {
  ip: string | null;
  location?: CustomerRequestLocation;
  method: CustomerSignInMethod;
}): CustomerSignInAccess {
  const country = input.location?.country?.trim().toUpperCase();
  return {
    city: bounded(input.location?.city, 100),
    // Cloudflare reports ISO 3166-1 alpha-2, plus T1 for Tor and XX for unknown.
    country: country && /^[A-Z0-9]{2}$/.test(country) ? country : null,
    ip: bounded(input.ip, 64),
    method: input.method,
    region: bounded(input.location?.region, 100),
  };
}
