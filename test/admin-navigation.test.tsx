// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import { AdminNavigation } from "../app/modules/admin/ui/admin-navigation";

afterEach(cleanup);

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
});
