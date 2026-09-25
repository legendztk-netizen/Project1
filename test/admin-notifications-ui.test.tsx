// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminNotifications from "../app/modules/admin/routes/notifications";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ unread: 2 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type LoaderData = Parameters<typeof AdminNotifications>[0]["loaderData"];

const loaderData: LoaderData = {
  filter: "all",
  page: 1,
  pageCount: 1,
  all: 3,
  unread: 2,
  notifications: [
    {
      id: "shipping-change:change-1",
      kind: "shipping_change_requested",
      changeKind: "delivery_address",
      createdAt: "2026-09-25T02:00:00.000Z",
      customerEmail: "buyer@example.test",
      read: false,
      reference: "ORDER-1",
      target: "/admin/orders/order-1?tab=changes",
    },
    {
      id: "rfq:request-2",
      kind: "rfq_submitted",
      changeKind: null,
      createdAt: "2026-09-25T01:00:00.000Z",
      customerEmail: "buyer@example.test",
      read: false,
      reference: "QR-2",
      target: "/admin/quotes/request-2",
    },
    {
      id: "rfq:request-1",
      kind: "rfq_submitted",
      changeKind: null,
      createdAt: "2026-09-24T01:00:00.000Z",
      customerEmail: null,
      read: true,
      reference: "QR-1",
      target: "/admin/quotes/request-1",
    },
  ],
};

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/notifications",
        element: <AdminNotifications loaderData={loaderData} />,
      },
    ],
    { initialEntries: ["/admin/notifications"] },
  );
  render(<RouterProvider router={router} />);
}

describe("AdminNotifications", () => {
  it("lists change requests and RFQs with unread state", () => {
    renderPage();

    expect(
      screen.getByRole("button", { name: /客户提交了收货地址变更申请/ })
        .textContent,
    ).toContain("订单 ORDER-1");
    expect(screen.getAllByText("新 RFQ 待审核")).toHaveLength(2);
    expect(
      screen.getAllByText("未读", { selector: ".admin-notification-dot" }),
    ).toHaveLength(2);
    expect(
      (
        screen.getByLabelText("选择：新 RFQ 待审核", {
          selector: "input[value='rfq:request-1']",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("enables batch mark-read only after unread messages are selected", () => {
    renderPage();

    const submit = screen.getByRole("button", { name: /标为已读/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("全选本页未读"));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(submit.textContent).toContain("（2）");

    const checked = screen
      .getAllByRole("checkbox")
      .filter(
        (box) =>
          (box as HTMLInputElement).name === "notificationId" &&
          (box as HTMLInputElement).checked,
      )
      .map((box) => (box as HTMLInputElement).value);
    expect(checked).toEqual(["shipping-change:change-1", "rfq:request-2"]);
  });
});
