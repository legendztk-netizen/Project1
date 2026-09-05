// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CatalogCommercialMaintenance } from "../app/modules/admin/ui/catalog-commercial-maintenance";

afterEach(cleanup);

describe("Sales, Packaging and Price maintenance", () => {
  it("renders a bilingual series rule and a separate exact-SKU price form", () => {
    const router = createMemoryRouter(
      [
        {
          element: (
            <CatalogCommercialMaintenance
              exact={null}
              formError={null}
              productType="hose"
              rule={null}
              selectedSeries="601R1"
              series={[
                {
                  productType: "hose",
                  seriesCode: "601R1",
                  seriesName: "601R1",
                },
              ]}
              sku="601R1_001"
              skuRecord={{
                lifecycleStatus: "online",
                productType: "hose",
                seriesCode: "601R1",
                sku: "601R1_001",
              }}
            />
          ),
          path: "/admin/catalog/commercial",
        },
      ],
      { initialEntries: ["/admin/catalog/commercial"] },
    );
    const { container } = render(<RouterProvider router={router} />);

    expect(
      screen.getByRole("heading", {
        name: "Series Commercial Rule / 系列销售、包装和价格规则",
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Sales Unit / 销售单位")).toBeTruthy();
    expect(screen.getByLabelText("MOQ / 最小起订量")).toBeTruthy();
    expect(
      screen.getByLabelText("Preset Length 3 ft / 快捷长度3（英尺）"),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Exact SKU Price and Packaging / 子体价格和包装",
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Sales SKU / 销售 SKU")).toHaveProperty(
      "readOnly",
      true,
    );
    expect(screen.getByDisplayValue("USD")).toHaveProperty("readOnly", true);
    expect(
      container.querySelectorAll('form[method="post"][novalidate]'),
    ).toHaveLength(2);
    expect(screen.queryByText(/Factory Unit Price|工厂价/u)).toBeNull();
    expect(screen.queryByText(/Incoterm|贸易术语/u)).toBeNull();
  });
});
