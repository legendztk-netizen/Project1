// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { AdminNavigation } from "../app/modules/admin/ui/admin-navigation";

const fetchUnread = vi.fn(async () => Response.json({ unread: 0 }));

beforeEach(() => {
  sessionStorage.clear();
  fetchUnread.mockClear();
  vi.stubGlobal("fetch", fetchUnread);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminNavigation", () => {
  it.each([
    ["assemblies", "总成管理"],
    ["manual", "管理所有产品"],
    ["commercial", "销售、包装和价格"],
  ] as const)(
    "shows product maintenance paths as sidebar submenu items in %s mode",
    (maintenanceMode, activeLabel) => {
      render(
        <MemoryRouter>
          <AdminNavigation active="imports" maintenanceMode={maintenanceMode} />
        </MemoryRouter>,
      );

      const submenu = screen.getByRole("group", {
        name: "产品数据维护",
      });
      expect(
        within(submenu)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["管理所有产品", "销售、包装和价格", "总成管理"]);
      expect(
        within(submenu)
          .getByRole("link", { name: activeLabel })
          .getAttribute("aria-current"),
      ).toBe("page");
    },
  );

  it("expands and collapses a first-level item that owns a submenu", () => {
    render(
      <MemoryRouter>
        <AdminNavigation active="overview" />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "产品数据维护" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "产品数据维护" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("link", { name: "管理所有产品" }).getAttribute("href"),
    ).toBe("/admin/catalog/products");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "产品数据维护" })).toBeNull();
  });

  it("keeps first-level items without children as direct navigation links", () => {
    render(
      <MemoryRouter>
        <AdminNavigation active="overview" />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "总览" }).getAttribute("href"),
    ).toBe("/admin");
    expect(
      screen.getByRole("link", { name: "产品审核与发布" }).getAttribute("href"),
    ).toBe("/admin/catalog/requests");
  });

  it("preserves the menu across outside clicks and page remounts until toggled again", () => {
    const show = (active: "imports" | "orders") =>
      render(
        <MemoryRouter>
          <AdminNavigation active={active} />
          <button>页面内容</button>
        </MemoryRouter>,
      );
    let page = show("imports");
    fireEvent.click(screen.getByRole("button", { name: "页面内容" }));
    expect(
      screen
        .getByRole("button", { name: "产品数据维护" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("link", { name: "订单" }));
    page.unmount();
    page = show("orders");
    const toggle = screen.getByRole("button", { name: "产品数据维护" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("group", { name: "产品数据维护" })).toBeNull();
    page.unmount();
    show("imports");
    expect(
      screen
        .getByRole("button", { name: "产品数据维护" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});

describe("AdminNavigation notifications", () => {
  it("links the first-level notifications item and shows its unread badge", () => {
    render(
      <MemoryRouter>
        <AdminNavigation active="notifications" unreadNotifications={3} />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /通知/ });
    expect(link.getAttribute("href")).toBe("/admin/notifications");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(within(link).getByLabelText("3 条未读").textContent).toBe("3");
  });

  it("hides the badge when there are no unread notifications", () => {
    render(
      <MemoryRouter>
        <AdminNavigation active="overview" unreadNotifications={0} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "通知" })).toBeTruthy();
    expect(screen.queryByText(/条未读/)).toBeNull();
  });

  it("loads the unread count for pages that do not supply it", async () => {
    fetchUnread.mockImplementation(async () => Response.json({ unread: 120 }));
    render(
      <MemoryRouter>
        <AdminNavigation active="orders" />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("120 条未读").textContent).toBe("99+"),
    );
    expect(fetchUnread).toHaveBeenCalledWith(
      "/admin/notifications/unread-count",
      expect.anything(),
    );
  });
});

import { AdminIdentityContext } from "../app/modules/admin/ui/admin-identity-context";
it("shows assembly parameter configuration independently of product management", () => {
  render(
    <MemoryRouter>
      <AdminIdentityContext.Provider
        value={{
          id: "staff",
          email: "staff@tests.invalid",
          accountType: "subaccount",
          canManageSubaccounts: false,
          source: "cloudflare-access",
          moduleAccess: { configurator: "read" },
        }}
      >
        <AdminNavigation active="configurator" />
      </AdminIdentityContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "总成参数配置" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "产品数据维护" })).toBeNull();
  expect(screen.queryByRole("link", { name: "产品审核与发布" })).toBeNull();
});
