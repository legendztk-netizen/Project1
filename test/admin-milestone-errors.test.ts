import { expect, it } from "vitest";
import { adminMilestoneError } from "../app/modules/shipment/ui/admin-milestone-errors";

it("explains which tracking field was rejected", () => {
  expect(adminMilestoneError(400, "Package label is required")).toBe(
    "请填写包裹名称。",
  );
  expect(adminMilestoneError(400, "Carrier is required")).toBe(
    "请填写承运商名称。",
  );
  expect(
    adminMilestoneError(
      400,
      "Tracking source or correction reason is required",
    ),
  ).toBe("请填写记录来源或更正原因。");
  expect(
    adminMilestoneError(400, "Tracking URL must be a public HTTPS address"),
  ).toBe("追踪链接必须是以 https:// 开头的公开网址。");
});

it("explains milestone date ordering rejections", () => {
  expect(
    adminMilestoneError(
      400,
      "Carrier handoff cannot precede verified readiness",
    ),
  ).toBe("交接时间不能早于核实备妥的记录时间。");
  expect(
    adminMilestoneError(400, "Late handoff review reason is required"),
  ).toBe("请填写迟录原因。");
});

it("falls back to the generic conflict and validation messages", () => {
  expect(
    adminMilestoneError(409, "Shipment changed or release is held; reload"),
  ).toBe("批次状态或放行条件已变化，请刷新后核查限制与数量。");
  expect(adminMilestoneError(400, "something unexpected")).toBe(
    "批次状态保存失败，请检查日期、数量和必填凭据。",
  );
});
