import { Temporal } from "@js-temporal/polyfill";

export const US_BANK_CALENDAR_VERSION = "us-federal-bank-2025-2035-v1";
const zone = "America/New_York";
const firstYear = 2025;
const lastYear = 2035;

export type PiPaymentTerms =
  | {
      kind: "ten_us_business_days";
      calendarVersion: typeof US_BANK_CALENDAR_VERSION;
    }
  | {
      kind: "fixed_et_date";
      dueDateEt: string;
      calendarVersion: typeof US_BANK_CALENDAR_VERSION;
    };

function plainDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid ET date");
  const date = Temporal.PlainDate.from(value);
  if (date.toString() !== value) throw new Error("Invalid ET date");
  if (date.year < firstYear || date.year > lastYear)
    throw new Error("US bank calendar coverage unavailable");
  return date;
}

function observed(date: Temporal.PlainDate) {
  if (date.dayOfWeek === 6) return date.subtract({ days: 1 });
  if (date.dayOfWeek === 7) return date.add({ days: 1 });
  return date;
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  let date = Temporal.PlainDate.from({ year, month, day: 1 });
  date = date.add({ days: (weekday - date.dayOfWeek + 7) % 7 });
  return date.add({ days: (nth - 1) * 7 });
}

function lastWeekday(year: number, month: number, weekday: number) {
  let date = Temporal.PlainDate.from({ year, month, day: 1 });
  date = date.add({ months: 1 }).subtract({ days: 1 });
  return date.subtract({ days: (date.dayOfWeek - weekday + 7) % 7 });
}

function holidays(year: number) {
  const dates = [
    observed(Temporal.PlainDate.from({ year, month: 1, day: 1 })),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    lastWeekday(year, 5, 1),
    observed(Temporal.PlainDate.from({ year, month: 6, day: 19 })),
    observed(Temporal.PlainDate.from({ year, month: 7, day: 4 })),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 10, 1, 2),
    observed(Temporal.PlainDate.from({ year, month: 11, day: 11 })),
    nthWeekday(year, 11, 4, 4),
    observed(Temporal.PlainDate.from({ year, month: 12, day: 25 })),
  ];
  // New Year's Day can be observed in the preceding calendar year.
  dates.push(
    observed(Temporal.PlainDate.from({ year: year + 1, month: 1, day: 1 })),
  );
  return new Set(dates.map((date) => date.toString()));
}

export function isUsBankBusinessDay(value: string) {
  const date = plainDate(value);
  return date.dayOfWeek <= 5 && !holidays(date.year).has(value);
}

function etDate(instant: string) {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDate();
}

export function dueDateInstant(dueDateEt: string) {
  const date = plainDate(dueDateEt);
  return date
    .toPlainDateTime({ hour: 23, minute: 59 })
    .toZonedDateTime(zone)
    .toInstant()
    .toString({ fractionalSecondDigits: 3 });
}

export function defaultPaymentDueDate(acceptedAt: string) {
  let date = etDate(acceptedAt);
  plainDate(date.toString());
  let counted = 0;
  while (counted < 10) {
    date = date.add({ days: 1 });
    if (isUsBankBusinessDay(date.toString())) counted++;
  }
  return date.toString();
}

export function paymentTerms(
  fixedDueDateEt: string | undefined,
  validUntil: string,
): PiPaymentTerms {
  if (fixedDueDateEt === undefined)
    return {
      kind: "ten_us_business_days",
      calendarVersion: US_BANK_CALENDAR_VERSION,
    };
  const deadline = dueDateInstant(fixedDueDateEt);
  if (
    Temporal.Instant.compare(deadline, Temporal.Instant.from(validUntil)) <= 0
  )
    throw new Error("Fixed payment deadline must be after PI validity");
  return {
    kind: "fixed_et_date",
    dueDateEt: fixedDueDateEt,
    calendarVersion: US_BANK_CALENDAR_VERSION,
  };
}

export function acceptedPaymentDeadline(
  terms: PiPaymentTerms,
  acceptedAt: string,
) {
  if (terms.calendarVersion !== US_BANK_CALENDAR_VERSION)
    throw new Error("Unsupported US bank calendar version");
  const dueDateEt =
    terms.kind === "fixed_et_date"
      ? terms.dueDateEt
      : defaultPaymentDueDate(acceptedAt);
  return { dueDateEt, dueAt: dueDateInstant(dueDateEt) };
}
