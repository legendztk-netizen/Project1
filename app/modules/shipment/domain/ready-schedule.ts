import { Temporal } from "@js-temporal/polyfill";

export type ReadyScheduleBasis =
  | { kind: "fixed_date"; readyDate: string }
  | { kind: "china_business_days"; days: number };

export interface ChinaFulfillmentCalendar {
  version: number;
  coverageFrom: string;
  coverageThrough: string;
  confirmedComplete: boolean;
  workingWeekdays: number[];
  exceptions: Record<string, boolean>;
}

export interface ChinaCalendarException {
  date: string;
  isWorking: boolean;
  reason: string;
}

export interface ChinaCalendarDraft {
  coverageFrom: string;
  coverageThrough: string;
  workingWeekdays: number[];
  exceptions: ChinaCalendarException[];
  revisionReason: string;
  confirmedComplete: boolean;
}

function plainDate(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("A valid calendar date is required");
  const date = Temporal.PlainDate.from(value);
  if (date.toString() !== value)
    throw new Error("A valid calendar date is required");
  return date;
}

export function validatedChinaCalendarDraft(
  input: ChinaCalendarDraft,
): ChinaCalendarDraft {
  const from = plainDate(input.coverageFrom);
  const through = plainDate(input.coverageThrough);
  if (Temporal.PlainDate.compare(through, from) < 0)
    throw new Error("China calendar coverage end precedes its start");
  if (input.confirmedComplete !== true)
    throw new Error("Confirm all China calendar exceptions were reviewed");
  if (
    !Array.isArray(input.workingWeekdays) ||
    input.workingWeekdays.length < 1 ||
    new Set(input.workingWeekdays).size !== input.workingWeekdays.length ||
    input.workingWeekdays.some(
      (day) => !Number.isSafeInteger(day) || day < 1 || day > 7,
    )
  )
    throw new Error("Select valid China calendar weekdays");
  if (
    typeof input.revisionReason !== "string" ||
    input.revisionReason.trim().length < 10 ||
    input.revisionReason.length > 2000
  )
    throw new Error("Calendar review reason is required");
  if (!Array.isArray(input.exceptions) || input.exceptions.length > 1000)
    throw new Error("Invalid China calendar exceptions");
  const seen = new Set<string>();
  const exceptions = input.exceptions.map((exception) => {
    const date = plainDate(exception.date);
    if (
      seen.has(exception.date) ||
      Temporal.PlainDate.compare(date, from) < 0 ||
      Temporal.PlainDate.compare(date, through) > 0 ||
      typeof exception.isWorking !== "boolean" ||
      typeof exception.reason !== "string" ||
      exception.reason.trim().length < 3 ||
      exception.reason.length > 500
    )
      throw new Error("Invalid or duplicate China calendar exception");
    seen.add(exception.date);
    return { ...exception, reason: exception.reason.trim() };
  });
  return {
    coverageFrom: from.toString(),
    coverageThrough: through.toString(),
    workingWeekdays: [...input.workingWeekdays].sort((a, b) => a - b),
    exceptions: exceptions.sort((a, b) => a.date.localeCompare(b.date)),
    revisionReason: input.revisionReason.trim(),
    confirmedComplete: true,
  };
}

export function validatedReadySchedule(value: unknown): ReadyScheduleBasis {
  if (!value || typeof value !== "object")
    throw new Error("Reviewed ready-date schedule is required");
  const schedule = value as Record<string, unknown>;
  if (schedule.kind === "fixed_date")
    return {
      kind: "fixed_date",
      readyDate: plainDate(schedule.readyDate as string).toString(),
    };
  if (schedule.kind === "china_business_days") {
    if (
      !Number.isSafeInteger(schedule.days) ||
      (schedule.days as number) < 1 ||
      (schedule.days as number) > 365
    )
      throw new Error("Ready-date business days must be between 1 and 365");
    return { kind: "china_business_days", days: schedule.days as number };
  }
  throw new Error("Unsupported ready-date schedule");
}

export function readyScheduleText(value: ReadyScheduleBasis): string {
  const schedule = validatedReadySchedule(value);
  return schedule.kind === "fixed_date"
    ? `Estimated ready to ship: ${schedule.readyDate}`
    : `Estimated ready to ship: ${schedule.days} China fulfillment business days after Order confirmation`;
}

export function committedReadyDate(
  confirmedAt: string,
  input: ReadyScheduleBasis,
  calendar: ChinaFulfillmentCalendar | null,
): { date: string; calendarVersion: number | null } {
  const schedule = validatedReadySchedule(input);
  if (schedule.kind === "fixed_date")
    return { date: schedule.readyDate, calendarVersion: null };
  if (!calendar?.confirmedComplete)
    throw new Error("A confirmed China fulfillment calendar is required");
  if (
    !Number.isSafeInteger(calendar.version) ||
    calendar.version < 1 ||
    !Array.isArray(calendar.workingWeekdays) ||
    !calendar.workingWeekdays.length ||
    calendar.workingWeekdays.some(
      (day) => !Number.isSafeInteger(day) || day < 1 || day > 7,
    )
  )
    throw new Error("Invalid China fulfillment calendar");
  const from = plainDate(calendar.coverageFrom);
  const through = plainDate(calendar.coverageThrough);
  let day = Temporal.Instant.from(confirmedAt)
    .toZonedDateTimeISO("Asia/Shanghai")
    .toPlainDate()
    .add({ days: 1 });
  let remaining = schedule.days;
  while (remaining > 0) {
    if (
      Temporal.PlainDate.compare(day, from) < 0 ||
      Temporal.PlainDate.compare(day, through) > 0
    )
      throw new Error("China fulfillment calendar coverage is incomplete");
    const exception = calendar.exceptions[day.toString()];
    if (
      exception === true ||
      (exception !== false && calendar.workingWeekdays.includes(day.dayOfWeek))
    )
      remaining -= 1;
    if (remaining > 0) day = day.add({ days: 1 });
  }
  return { date: day.toString(), calendarVersion: calendar.version };
}
