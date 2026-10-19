import { SELLER_LEGAL_NAME } from "../../seller-settings/domain/seller-commercial-settings";
import {
  customerSessionCookieName,
  customerSessionLifetimeSeconds,
} from "../../customer-identity/domain/customer-session";
import {
  passwordAuthorizationCookieName,
  passwordAuthorizationLifetimeSeconds,
} from "../../customer-identity/domain/password-authorization";
import {
  anonymousQuoteCookieName,
  anonymousQuoteSessionLifetimeSeconds,
} from "../../quote-list/domain/anonymous-quote-session";

export const privacyNoticePath = "/policies/privacy";
export const privacyContactEmail = "privacy@customhoseco.com";
export const privacyNoticeUpdated = "Oct 19, 2026";

/**
 * The Seller of Record with its configured registered address on one line.
 * An unset address shows the legal name alone.
 */
export function privacyNoticeOperator(registeredAddressEn: string | null) {
  const address = (registeredAddressEn ?? "")
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  return address ? `${SELLER_LEGAL_NAME}, ${address}` : SELLER_LEGAL_NAME;
}

function lifetime(seconds: number) {
  const days = seconds / 86_400;
  return Number.isInteger(days) ? `${days} days` : `${seconds / 60} minutes`;
}

/** Every cookie the application sets, with the lifetime it is set for. */
export const privacyNoticeCookies = [
  {
    name: customerSessionCookieName,
    purpose: "Keeps you signed in.",
    lifetime: lifetime(customerSessionLifetimeSeconds),
  },
  {
    name: anonymousQuoteCookieName,
    purpose: "Keeps your Quote List before you sign in.",
    lifetime: lifetime(anonymousQuoteSessionLifetimeSeconds),
  },
  {
    name: passwordAuthorizationCookieName,
    purpose: "Lets you set a new password after confirming an email code.",
    lifetime: lifetime(passwordAuthorizationLifetimeSeconds),
  },
] as const;
