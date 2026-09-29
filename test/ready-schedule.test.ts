import { describe, expect, it } from "vitest";
import {
  committedReadyDate,
  validatedChinaCalendarDraft,
  validatedReadySchedule,
  type ChinaFulfillmentCalendar,
} from "../app/modules/shipment/domain/ready-schedule";

const calendar: ChinaFulfillmentCalendar = {
  version: 7,
  coverageFrom: "2026-09-01",
  coverageThrough: "2026-09-30",
  confirmedComplete: true,
  workingWeekdays: [1, 2, 3, 4, 5],
  exceptions: {
    "2026-09-25": false,
    "2026-09-27": true,
  },
};

describe("shipment ready-date agreement", () => {
  it("preserves a fixed calendar date without a calendar lookup", () => {
    expect(
      committedReadyDate(
        "2026-09-24T15:30:00.000Z",
        { kind: "fixed_date", readyDate: "2026-10-02" },
        null,
      ),
    ).toEqual({ date: "2026-10-02", calendarVersion: null });
  });

  it("starts on the next China business day and respects holidays and exception workdays", () => {
    expect(
      committedReadyDate(
        "2026-09-24T15:30:00.000Z",
        { kind: "china_business_days", days: 2 },
        calendar,
      ),
    ).toEqual({ date: "2026-09-28", calendarVersion: 7 });
  });

  it("requires confirmed calendar coverage instead of guessing weekdays", () => {
    expect(() =>
      committedReadyDate(
        "2026-09-24T15:30:00.000Z",
        { kind: "china_business_days", days: 8 },
        calendar,
      ),
    ).toThrow(/coverage/i);
    expect(() =>
      committedReadyDate(
        "2026-09-24T15:30:00.000Z",
        { kind: "china_business_days", days: 1 },
        { ...calendar, confirmedComplete: false },
      ),
    ).toThrow(/confirmed/i);
  });

  it("rejects unsupported schedule values", () => {
    expect(() =>
      validatedReadySchedule({ kind: "china_business_days", days: 0 }),
    ).toThrow();
    expect(() =>
      validatedReadySchedule({ kind: "fixed_date", readyDate: "2026-02-30" }),
    ).toThrow();
  });

  it("validates complete calendar coverage and explicit exceptions", () => {
    const draft = {
      coverageFrom: "2026-09-01",
      coverageThrough: "2026-09-30",
      workingWeekdays: [5, 1, 2, 3, 4],
      exceptions: [
        { date: "2026-09-27", isWorking: true, reason: "Shifted workday" },
      ],
      revisionReason: "Reviewed the complete September calendar",
      confirmedComplete: true,
    };
    expect(validatedChinaCalendarDraft(draft).workingWeekdays).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(() =>
      validatedChinaCalendarDraft({
        ...draft,
        exceptions: [...draft.exceptions, { ...draft.exceptions[0] }],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      validatedChinaCalendarDraft({ ...draft, confirmedComplete: false }),
    ).toThrow(/Confirm/);
  });
});
