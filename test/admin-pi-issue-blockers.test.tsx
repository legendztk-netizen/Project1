// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import AdminPi from "../app/modules/admin/routes/proforma-invoice";
import { SELLER_LEGAL_NAME } from "../app/modules/seller-settings/domain/seller-commercial-settings";

vi.mock("../app/modules/admin/ui/admin-navigation", () => ({
  AdminNavigation: () => null,
}));
afterEach(cleanup);

const seller = {
  id: "seller",
  version: 2,
  legalName: SELLER_LEGAL_NAME,
  registeredAddressEn: "Hangzhou, Zhejiang 310000\nChina",
  registeredCountryCode: "CN" as const,
  status: "current" as const,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: "owner",
  supersededAt: null,
};
const bank = {
  id: "bank",
  version: 1,
  channel: "bank_transfer" as const,
  instructions: "Currency: USD",
};

function show(readiness: Record<string, unknown>) {
  render(
    <RouterProvider
      router={createMemoryRouter([
        {
          path: "/",
          element: (
            <AdminPi
              loaderData={
                {
                  requestId: "request",
                  commandId: "command",
                  paymentHistory: [],
                  readiness: {
                    pdfJobs: [],
                    quoteRevision: { id: "revision", hash: "hash" },
                    seller,
                    payments: [bank],
                    conditionsConfigured: true,
                    current: null,
                    ...readiness,
                  },
                } as never
              }
            />
          ),
        },
      ])}
    />,
  );
  return screen.getByRole("button", { name: "签发固定 USD 形式发票" });
}
const reasons = () =>
  screen
    .queryByText("暂时无法签发：")
    ?.closest("[role=status]")
    ?.querySelectorAll("li") ?? [];

it("explains next to the button that a formal quote must be published first", () => {
  const button = show({ quoteRevision: null });
  fireEvent.change(screen.getByRole("combobox"), {
    target: {
      value: JSON.stringify({
        id: "bank",
        version: 1,
        channel: "bank_transfer",
      }),
    },
  });
  expect(button).toHaveProperty("disabled", true);
  expect(button.getAttribute("aria-describedby")).toBe("pi-issue-blockers");
  expect([...reasons()].map((item) => item.textContent)).toEqual([
    "尚未发布正式报价。PI 必须基于已发布的正式报价。 发布正式报价",
  ]);
  expect(
    screen.getByRole("link", { name: "发布正式报价" }).getAttribute("href"),
  ).toBe("/admin/quotes/request/issue");
});

it("lists every missing precondition, asking for a payment choice last", () => {
  show({
    quoteRevision: null,
    seller: null,
    conditionsConfigured: false,
    pdfJobs: [{ commandId: "saved", state: "queued", attempts: 0 }],
  });
  expect([...reasons()].map((item) => item.textContent)).toEqual([
    "PDF 正在生成或等待重试，完成后才能签发。",
    "尚未发布正式报价。PI 必须基于已发布的正式报价。 发布正式报价",
    "卖方信息缺少有效的中国注册英文地址。 配置卖方信息",
    "取消、退款与确认条款尚未配置。",
    "请选择付款渠道及说明版本。",
  ]);
});

it("points to commercial settings when no payment instructions exist", () => {
  show({ payments: [] });
  expect([...reasons()].map((item) => item.textContent)).toEqual([
    "无有效付款说明。 配置付款说明",
  ]);
  expect(
    screen.getByRole("link", { name: "配置付款说明" }).getAttribute("href"),
  ).toBe("/admin/settings/commercial");
});

it("enables issuing with no reasons once a payment is chosen and dates stay empty", () => {
  const button = show({});
  expect([...reasons()].map((item) => item.textContent)).toEqual([
    "请选择付款渠道及说明版本。",
  ]);
  fireEvent.change(screen.getByRole("combobox"), {
    target: {
      value: JSON.stringify({
        id: "bank",
        version: 1,
        channel: "bank_transfer",
      }),
    },
  });
  expect(button).toHaveProperty("disabled", false);
  expect(button.getAttribute("aria-describedby")).toBeNull();
  expect(screen.queryByText("暂时无法签发：")).toBeNull();
});
