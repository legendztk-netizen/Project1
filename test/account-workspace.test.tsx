// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import type { RootLoaderData } from "../app/root";
import { AccountWorkspace } from "../app/modules/customer-identity/ui/account-workspace";

function renderWorkspace(activeSection: "quote-list" | "security") {
  const router = createMemoryRouter(
    [
      {
        children: [
          {
            element: (
              <AccountWorkspace activeSection={activeSection}>
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
  it("shows the requested first-level menu beside the selected detail", async () => {
    renderWorkspace("quote-list");

    const navigation = await screen.findByRole("navigation", {
      name: "Account & Lists",
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
    expect(within(navigation).getAllByRole("link")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Selected account detail" }),
    ).toBeTruthy();
  });
});
