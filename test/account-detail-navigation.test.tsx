// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import { AccountDetailNavigation } from "../app/modules/customer-identity/ui/account-detail-navigation";

afterEach(cleanup);

describe("AccountDetailNavigation", () => {
  it("keeps all account views in the requested menu order", () => {
    render(
      <MemoryRouter>
        <AccountDetailNavigation activeView="orders" />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Account details",
    });
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Overview",
      "Quote List",
      "Saved Configurations",
      "My Quotes",
      "Orders",
      "Addresses",
      "Account Security",
      "Profile / Company",
    ]);
    expect(
      within(navigation)
        .getByRole("link", { name: "Orders" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(navigation)
        .getByRole("link", { name: "Profile / Company" })
        .getAttribute("href"),
    ).toBe("/account?view=profile");
  });

  it("uses native links that remain available to keyboard users", () => {
    render(
      <MemoryRouter>
        <AccountDetailNavigation activeView="overview" />
      </MemoryRouter>,
    );

    const links = within(
      screen.getByRole("navigation", { name: "Account details" }),
    ).getAllByRole("link");
    expect(links).toHaveLength(8);
    for (const link of links) {
      expect(link.tabIndex).toBe(0);
      link.focus();
      expect(document.activeElement).toBe(link);
    }
  });
});
