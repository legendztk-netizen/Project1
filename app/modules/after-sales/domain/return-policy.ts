import { Temporal } from "@js-temporal/polyfill";

import {
  dueDateInstant,
  isUsBankBusinessDay,
  US_BANK_CALENDAR_VERSION,
} from "../../proforma-invoice/domain/pi-payment-terms";

// The launch return policy (Spec 7 / ADR-0024). Version 2 adds customer
// terms for problem reports that inspection shows the buyer caused.
export const LAUNCH_RETURN_POLICY = Object.freeze({
  version: "return-policy-2026-09-27-v2",
  requestWindowCalendarDays: 14,
  restockingFeeBasisPoints: 1000,
  raArrivalCalendarDays: 30,
  inspectionBusinessDays: 5,
  refundInitiationBusinessDays: 10,
  businessCalendarVersion: US_BANK_CALENDAR_VERSION,
});

export const RETURN_POLICY_PATH = "/policies/returns";

// PI refund terms that disclose customer terms for an "Other problem" the
// buyer caused. Earlier accepted terms only disclose them for convenience
// returns, so those Orders keep seller terms for every problem report.
const CUSTOMER_CAUSED_PROBLEM_TERMS = new Set(["pi-refund-2026-09-27-v2"]);

/**
 * Whether Admin may resolve a Case under customer terms (restocking fee, no
 * refund of performed DDP charges, documented third-party deductions).
 */
export function customerTermsAllowed(
  reason: string,
  refundTermsVersion: string | null,
) {
  if (reason === "convenience_return") return true;
  return (
    reason === "other" &&
    refundTermsVersion !== null &&
    CUSTOMER_CAUSED_PROBLEM_TERMS.has(refundTermsVersion)
  );
}

const zone = "America/New_York";

export type ReturnProductClass = "standard" | "cut_hose" | "made_to_order";

export interface FrozenOrderLineFacts {
  lineKind: string;
  madeToOrder?: boolean;
  quantity?: number;
  lengthOrder?: { pieceCount?: number } | null;
}

/**
 * Classifies a purchased line from its frozen Order snapshot and the PI's
 * made-to-order acknowledgements. Current catalog data is never consulted.
 */
export function returnProductClass(
  line: FrozenOrderLineFacts,
  acknowledgedMadeToOrder = false,
): ReturnProductClass {
  if (line.lineKind === "length_based_hose") return "cut_hose";
  if (line.lineKind !== "standard") return "made_to_order";
  if (line.madeToOrder === true || acknowledgedMadeToOrder)
    return "made_to_order";
  return "standard";
}

export function allowsConvenienceReturn(productClass: ReturnProductClass) {
  return productClass === "standard";
}

/** Physical units: cut-hose piece count, otherwise the purchased quantity. */
export function physicalQuantity(line: FrozenOrderLineFacts) {
  const value =
    line.lineKind === "length_based_hose"
      ? line.lengthOrder?.pieceCount
      : line.quantity;
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error("Frozen physical quantity unavailable");
  return value as number;
}

export function etDate(instant: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}

/** Calendar-day deadline: the trigger's ET date is day 0, closing 23:59 ET. */
export function calendarDayDeadline(triggerInstant: string, days: number) {
  const date = Temporal.PlainDate.from(etDate(triggerInstant)).add({ days });
  return { dateEt: date.toString(), at: dueDateInstant(date.toString()) };
}

/** US-business-day deadline under the frozen US Business Calendar version. */
export function businessDayDeadline(
  triggerInstant: string,
  days: number,
  calendarVersion: string = US_BANK_CALENDAR_VERSION,
) {
  if (calendarVersion !== US_BANK_CALENDAR_VERSION)
    throw new Error("Unsupported US Business Calendar version");
  let date = Temporal.PlainDate.from(etDate(triggerInstant));
  let counted = 0;
  while (counted < days) {
    date = date.add({ days: 1 });
    if (isUsBankBusinessDay(date.toString())) counted++;
  }
  return {
    dateEt: date.toString(),
    at: dueDateInstant(date.toString()),
    calendarVersion,
  };
}

/** Same rule when the recorded fact is the ET delivery date itself. */
export function convenienceReturnCutoffForDate(deliveredDateEt: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveredDateEt))
    throw new Error("Invalid ET delivery date");
  const date = Temporal.PlainDate.from(deliveredDateEt).add({
    days: LAUNCH_RETURN_POLICY.requestWindowCalendarDays,
  });
  return { dateEt: date.toString(), at: dueDateInstant(date.toString()) };
}

export function convenienceReturnCutoff(deliveredAt: string) {
  return calendarDayDeadline(
    deliveredAt,
    LAUNCH_RETURN_POLICY.requestWindowCalendarDays,
  );
}

export function raArrivalDeadline(issuedAt: string) {
  return calendarDayDeadline(
    issuedAt,
    LAUNCH_RETURN_POLICY.raArrivalCalendarDays,
  );
}

export function inspectionDeadline(receivedAt: string) {
  return businessDayDeadline(
    receivedAt,
    LAUNCH_RETURN_POLICY.inspectionBusinessDays,
  );
}

export function refundInitiationDeadline(approvedAt: string) {
  return businessDayDeadline(
    approvedAt,
    LAUNCH_RETURN_POLICY.refundInitiationBusinessDays,
  );
}

/** Inclusive deadline check at the same precision as PI payment deadlines. */
export function isOnOrBefore(instant: string, deadlineAt: string) {
  return (
    Temporal.Instant.compare(
      Temporal.Instant.from(instant),
      Temporal.Instant.from(deadlineAt),
    ) <= 0
  );
}

export function convenienceReturnOpen(deliveredAt: string, at: string) {
  return isOnOrBefore(at, convenienceReturnCutoff(deliveredAt).at);
}

export const PRODUCT_RETURN_DISCLOSURE = Object.freeze({
  standard:
    "Unused standard products may request return review within 14 calendar days of delivery. Approved convenience returns carry a 10% restocking fee; customer-paid return shipping applies.",
  madeToOrder:
    "Convenience returns are unavailable after cutting or production approval. Remedies remain available for seller error or a nonconforming product.",
});

export function etDisplayDate(dateEt: string) {
  return new Date(`${dateEt}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
  });
}
