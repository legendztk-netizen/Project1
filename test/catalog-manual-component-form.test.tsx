// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CatalogManualComponentForm } from "../app/modules/admin/ui/catalog-manual-component-form";

afterEach(cleanup);

function renderForm(
  productType: "adapter" | "ferrule" | "hose_end" | "quick_coupler",
) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <CatalogManualComponentForm
            findings={[]}
            formError={null}
            productType={productType}
            record={null}
            requestedSku=""
            saved={null}
          />
        ),
        path: "/admin/catalog/import",
      },
    ],
    { initialEntries: ["/admin/catalog/import?mode=manual"] },
  );
  render(<RouterProvider router={router} />);
}

describe("CatalogManualComponentForm", () => {
  it("renders the worksheet 02 and 07 contract for a Hose End", () => {
    renderForm("hose_end");

    expect(
      screen.getByRole("heading", { name: "One exact Hose End SKU" }),
    ).toBeTruthy();
    expect(
      document.querySelector('[name="master.interfaceFamily"]'),
    ).toBeTruthy();
    expect(document.querySelector('[name="master.hoseTailDash"]')).toBeTruthy();
    expect(document.querySelector('[name="lifecycleStatus"]')).toBeTruthy();
    expect(
      document.querySelector('[name="master.catalogPublicationStatus"]'),
    ).toBeNull();
    expect(
      document.querySelector('[name="sales.referencePriceUsd"]'),
    ).toHaveProperty("required", true);
    expect(
      screen.getByRole("option", {
        name: "JIC 37°-Female-Swivel-0° Straight",
      }),
    ).toBeTruthy();
  });

  it("renders the worksheet 03 and 07 contract for a Ferrule", () => {
    renderForm("ferrule");

    expect(
      screen.getByRole("heading", { name: "One exact Ferrule SKU" }),
    ).toBeTruthy();
    expect(
      document.querySelector('[name="master.ferruleSeries"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[name="master.skiveRequirement"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[name="sales.referencePriceUsd"]'),
    ).toHaveProperty("required", true);
    expect(
      screen.getByRole("option", {
        name: /SANF 2022 catalogue ferrule representative/u,
      }),
    ).toBeTruthy();
  });

  it("renders the worksheet 05 and 07 contract for an Adapter", () => {
    renderForm("adapter");

    expect(
      screen.getByRole("heading", { name: "One exact Adapter SKU" }),
    ).toBeTruthy();
    expect(document.querySelector('[name="master.adapterSku"]')).toBeTruthy();
    expect(document.querySelector('[name="master.interface1"]')).toBeTruthy();
    expect(document.querySelector('[name="master.size2"]')).toBeTruthy();
    expect(
      document.querySelector('[name="sales.referencePriceUsd"]'),
    ).toHaveProperty("required", true);
    expect(
      screen.getByRole("option", { name: /DHH 2404 straight JIC male/u }),
    ).toBeTruthy();
  });

  it("renders the worksheet 06 and 07 contract for a Quick Coupler", () => {
    renderForm("quick_coupler");

    expect(
      screen.getByRole("heading", { name: "One exact Quick Coupler SKU" }),
    ).toBeTruthy();
    expect(
      document.querySelector('[name="master.interchangeStandard"]'),
    ).toBeTruthy();
    expect(document.querySelector('[name="master.matingSeries"]')).toBeTruthy();
    expect(document.querySelector('[name="master.portThread"]')).toBeTruthy();
    expect(
      document.querySelector('[name="sales.referencePriceUsd"]'),
    ).toHaveProperty("required", true);
    expect(
      screen.getByRole("option", {
        name: /SANF 2022 catalogue quick coupler representative/u,
      }),
    ).toBeTruthy();
  });
});
