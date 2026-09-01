// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import type { RootLoaderData } from "../app/root";
import { StorefrontHeader } from "../app/modules/storefront/ui/storefront-header";

function renderHeader(customer: RootLoaderData["customer"]) {
  const router = createMemoryRouter(
    [
      {
        children: [
          {
            element: <StorefrontHeader />,
            path: "build-a-hose",
          },
        ],
        element: <Outlet />,
        id: "root",
        loader: () => ({ customer }) satisfies RootLoaderData,
        path: "/",
      },
    ],
    { initialEntries: ["/build-a-hose"] },
  );

  render(<RouterProvider router={router} />);
}

afterEach(cleanup);

describe("StorefrontHeader", () => {
  it("shows registration and sign-in links to a guest", async () => {
    renderHeader(null);

    expect(
      (await screen.findByRole("link", { name: "Register" })).getAttribute(
        "href",
      ),
    ).toBe("/register");
    expect(
      screen.getByRole("link", { name: "Sign In" }).getAttribute("href"),
    ).toBe("/sign-in");
    expect(screen.queryByRole("link", { name: "Account & Lists" })).toBeNull();
  });

  it("replaces guest actions with Account & Lists for a signed-in customer", async () => {
    renderHeader({ email: "buyer@example.com", id: "customer-1" });

    const accountLink = await screen.findByRole("link", {
      name: "Account & Lists",
    });
    expect(accountLink.getAttribute("href")).toBe("/quote-list");
    expect(screen.queryByRole("link", { name: "Register" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign In" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Quote List$/u })).toBeNull();
  });
});
