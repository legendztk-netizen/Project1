// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import {
  CatalogHoseEndMaintenance,
  HoseEndMaintenanceActions,
} from "../app/modules/admin/ui/catalog-hose-end-maintenance";
import type { HoseEndSeriesRecord } from "../app/modules/catalog/domain/catalog-hose-end-maintenance";

afterEach(cleanup);

const series: HoseEndSeriesRecord = {
  angle: "0° Straight",
  gender: "Female",
  interfaceFamily: "JIC 37°",
  interfaceStandard: "SAE J514",
  representativeImageReference:
    "hose-end-shape:JIC 37°-Female-Swivel-0° Straight",
  sealingForm: "37° flare",
  seriesCode: "FJX",
  seriesName: "JIC Female Swivel",
  swivelForm: "Swivel",
};

function renderMaintenance(action: "series" | "variant" | null) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <HoseEndMaintenanceActions />
            <CatalogHoseEndMaintenance
              action={action}
              findings={[]}
              formError={null}
              requestedSku=""
              saved={null}
              selectedSeries={null}
              series={[series]}
              variant={null}
            />
          </>
        ),
        path: "/admin/catalog/import",
      },
    ],
    {
      initialEntries: [
        "/admin/catalog/import?mode=manual&productType=hose_end",
      ],
    },
  );
  render(<RouterProvider router={router} />);
}

describe("Hose End maintenance bilingual modal forms", () => {
  it("exposes Add Series and Add Variant from a keyboard-operable menu", () => {
    renderMaintenance(null);
    const menu = screen.getByRole("group", {
      name: "Hose End maintenance / 压接接头维护",
    });
    fireEvent.click(within(menu).getByText("Hose End / 压接接头"));
    expect(
      within(menu).getByRole("link", { name: "Add Series / 增加系列" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("link", { name: "Add Variant / 增加子体" }),
    ).toBeTruthy();
  });

  it("renders the exact bilingual series contract in a dismissible modal", () => {
    renderMaintenance("series");
    const dialog = screen.getByRole("dialog", {
      name: "Add Hose End Series / 增加压接接头系列",
    });
    for (const label of [
      "Series Code / 系列编号",
      "Series Name / 系列名称",
      "Interface Family / 接口体系",
      "Interface Standard / 接口标准",
      "Gender / 公母",
      "Swivel/Fixed / 旋转或固定",
      "Angle / 角度",
      "Sealing Form / 密封形式",
      "Representative Image / 系列代表图",
    ])
      expect(within(dialog).getByLabelText(label)).toBeTruthy();
    expect(
      within(dialog).getByRole("link", { name: "Cancel / 取消" }),
    ).toBeTruthy();
  });

  it("renders only the confirmed variant-owned fields, lifecycle and image override", () => {
    renderMaintenance("variant");
    const dialog = screen.getByRole("dialog", {
      name: "Add Hose End Variant / 增加压接接头子体",
    });
    expect(
      within(dialog).getByLabelText("Fitting Series / 接头系列"),
    ).toBeTruthy();
    expect(
      within(dialog).getByLabelText("Product Status / 产品状态"),
    ).toBeTruthy();
    for (const option of [
      "Online / 上线",
      "Draft / 草稿",
      "Discontinued / 停用",
    ])
      expect(within(dialog).getByRole("option", { name: option })).toBeTruthy();
    expect(
      within(dialog).getByLabelText("Hose End SKU / 接头SKU"),
    ).toBeTruthy();
    expect(
      within(dialog).getByLabelText("Variant Image Override / 子体图片覆盖"),
    ).toHaveProperty("required", false);
    expect(dialog.querySelector('[name*="interfaceFamily"]')).toBeNull();
    expect(dialog.querySelector('[name*="referencePrice"]')).toBeNull();
    expect(dialog.querySelector('[name*="sales"]')).toBeNull();
  });
});
