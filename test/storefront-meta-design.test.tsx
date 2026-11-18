// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import type { RootLoaderData } from "../app/root";
import { CatalogBrowser } from "../app/modules/storefront/ui/catalog-browser";
import { StorefrontHeader } from "../app/modules/storefront/ui/storefront-header";
import { publicHoseFixture } from "./fixtures/public-hose";

afterEach(cleanup);

function renderWithRoot(element: React.ReactElement, initialEntry = "/") {
  const router = createMemoryRouter(
    [
      {
        children: [
          {
            element,
            path: "*",
          },
        ],
        element: <Outlet />,
        id: "root",
        loader: () => ({ customer: null }) satisfies RootLoaderData,
        path: "/",
      },
    ],
    { initialEntries: [initialEntry] },
  );
  return render(<RouterProvider router={router} />);
}

describe("Meta Design System storefront migration", () => {
  it("keeps first-level menus in StorefrontHeader instead of category links", async () => {
    renderWithRoot(<StorefrontHeader />, "/catalog/hydraulic-hose");

    const nav = await screen.findByRole("navigation", {
      name: "Customer navigation",
    });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Products", "Build a Hose", "Quote List"]);

    for (const category of [
      "Hydraulic Hose",
      "Hose Ends",
      "Adapters",
      "Quick Couplers",
    ]) {
      expect(within(nav).queryByRole("link", { name: category })).toBeNull();
    }

    const menuButton = screen.getByRole("button", {
      name: "Open navigation menu",
    });
    fireEvent.click(menuButton);
    expect(
      screen.getByRole("button", { name: "Close navigation menu" }),
    ).toBeTruthy();
  });

  it("renders category pills inside CatalogBrowser main workspace and omits them from header", async () => {
    const hose = publicHoseFixture({
      familyKey: "601r2",
      familyName: "SAE 100R2AT Hydraulic Hose (R2)",
      sku: "601R2_005",
    });

    renderWithRoot(
      <CatalogBrowser
        data={{
          activeCategory: "hydraulic-hose",
          appName: "Hydraulic Supply",
          families: [
            {
              category: "hydraulic-hose",
              familyKey: "601r2",
              familyName: "SAE 100R2AT Hydraulic Hose (R2)",
              interfaceGroup: "SAE 100R2AT · EN 853 2SN",
              minimumReferencePrice: 2.14,
              representative: hose,
              variantCount: 15,
            },
          ],
          pagination: {
            page: 1,
            pageCount: 1,
            perPage: 10,
            total: 1,
          },
          query: "",
        }}
      />,
      "/catalog/hydraulic-hose",
    );

    const categoryNav = await screen.findByRole("navigation", {
      name: "Catalog categories",
    });
    expect(
      within(categoryNav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "All Products",
      "Hydraulic Hose",
      "Hose Ends",
      "Adapters",
      "Quick Couplers",
    ]);
    expect(
      within(categoryNav)
        .getByRole("link", { name: "Hydraulic Hose" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("heading", { level: 1, name: "Hydraulic Hose" }),
    ).toBeTruthy();
  });
});
