// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import type { RootLoaderData } from "../app/root";
import { AccountWorkspace } from "../app/modules/customer-identity/ui/account-workspace";

function renderWorkspace() {
  const router = createMemoryRouter(
    [
      {
        children: [
          {
            element: (
              <AccountWorkspace activeView="quote-list">
                <h1>Selected account detail</h1>
              </AccountWorkspace>
            ),
            path: "quote-list",
          },
        ],
        element: <Outlet />,
        id: "root",
        loader: () =>
          ({
            customer: { email: "buyer@example.com", id: "customer-1" },
          }) satisfies RootLoaderData,
        path: "/",
      },
    ],
    { initialEntries: ["/quote-list"] },
  );

  render(<RouterProvider router={router} />);
}

afterEach(cleanup);

describe("AccountWorkspace", () => {
  it("shows the complete first-level menu in the left rail", async () => {
    renderWorkspace();

    const navigation = await screen.findByRole("navigation", {
      name: "Account details",
    });
    const quoteList = within(navigation).getByRole("link", {
      name: "Quote List",
    });
    const security = within(navigation).getByRole("link", {
      name: "Account Security",
    });

    expect(quoteList.getAttribute("aria-current")).toBe("page");
    expect(quoteList.getAttribute("href")).toBe("/quote-list");
    expect(security.getAttribute("href")).toBe("/account/security");
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
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Selected account detail" }),
    ).toBeTruthy();
  });
});
