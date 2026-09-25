import { expect, it } from "vitest";
import { chinaCalendarError } from "../app/modules/shipment/ui/admin-china-calendar-form";
import { validatedChinaCalendarDraft } from "../app/modules/shipment/domain/ready-schedule";

it("explains which calendar field blocked publishing", () => {
  expect(
    chinaCalendarError(400, "China calendar coverage end precedes its start"),
  ).toBe("覆盖结束日期不能早于覆盖起始日期。");
  expect(
    chinaCalendarError(
      400,
      "Confirm all China calendar exceptions were reviewed",
    ),
  ).toBe("请勾选确认已核对全部例外日期。");
  expect(
    chinaCalendarError(400, "Invalid or duplicate China calendar exception"),
  ).toBe("例外日期必须在覆盖区间内、不能重复，并填写原因。");
  expect(
    chinaCalendarError(409, "Calendar changed; reload before publishing"),
  ).toBe("日历版本已变化，请刷新后重新核对。");
  expect(chinaCalendarError(400, "unexpected")).toBe(
    "日历发布失败，请检查覆盖日期、工作日、例外日期和审核依据。",
  );
});

it("accepts short calendar review text but still requires it", () => {
  const draft = {
    coverageFrom: "2026-10-01",
    coverageThrough: "2026-12-31",
    workingWeekdays: [1, 2, 3, 4, 5],
    exceptions: [{ date: "2026-10-01", isWorking: false, reason: "假" }],
    revisionReason: "ok",
    confirmedComplete: true,
  };
  expect(validatedChinaCalendarDraft(draft).revisionReason).toBe("ok");
  expect(() =>
    validatedChinaCalendarDraft({ ...draft, revisionReason: "  " }),
  ).toThrow("Calendar review reason is required");
  expect(() =>
    validatedChinaCalendarDraft({
      ...draft,
      exceptions: [{ date: "2026-10-01", isWorking: false, reason: " " }],
    }),
  ).toThrow("Invalid or duplicate China calendar exception");
});
