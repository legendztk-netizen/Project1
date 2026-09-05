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
  CatalogHoseMaintenance,
  HoseMaintenanceActions,
} from "../app/modules/admin/ui/catalog-hose-maintenance";
import type {
  HoseSeriesRecord,
  HoseVariantRecord,
} from "../app/modules/catalog/domain/catalog-hose-maintenance";

afterEach(cleanup);

const series: HoseSeriesRecord = {
  coverColor: "Black",
  coverFinish: null,
  coverMaterial: "Synthetic rubber",
  equivalentStandard: "EN 853 1SN",
  fluidCompatibility: "Hydraulic oil",
  primaryStandard: "SAE 100 R1AT",
  reinforcement: "One wire braid",
  representativeImageReference: "hose-series:601R1",
  seriesCode: "601R1",
  seriesName: "601R1",
  tempMaxC: 100,
  tempMinC: -40,
  tubeMaterial: "NBR",
};

function renderMaintenance(
  action: "series" | "variant" | null,
  options: {
    selectedSeries?: HoseSeriesRecord | null;
    variant?: HoseVariantRecord | null;
  } = {},
) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <HoseMaintenanceActions />
            <CatalogHoseMaintenance
              action={action}
              findings={[]}
              formError={null}
              requestedSku=""
              saved={null}
              selectedSeries={options.selectedSeries ?? null}
              series={[series]}
              variant={options.variant ?? null}
            />
          </>
        ),
        path: "/admin/catalog/import",
      },
    ],
    { initialEntries: ["/admin/catalog/import?mode=manual"] },
  );
  render(<RouterProvider router={router} />);
}

describe("Hose maintenance bilingual modal forms", () => {
  it("exposes the two Hose actions through a keyboard-operable menu", () => {
    renderMaintenance(null);
    const menu = screen.getByRole("group", {
      name: "Hose maintenance / 胶管维护",
    });
    const summary = within(menu).getByText("Hose / 胶管");
    fireEvent.click(summary);
    expect(
      within(menu).getByRole("link", { name: "Add Series / 增加系列" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("link", { name: "Add Variant / 增加子体" }),
    ).toBeTruthy();
  });

  it("renders exactly the bilingual Hose Series contract in a dismissible modal", () => {
    renderMaintenance("series");
    const dialog = screen.getByRole("dialog", {
      name: "Add Hose Series / 增加胶管系列",
    });
    expect(
      within(dialog).getByLabelText("Series Code / 系列编号"),
    ).toHaveProperty("required", true);
    expect(
      within(dialog).getByLabelText("Series Name / 系列名称"),
    ).toHaveProperty("required", true);
    expect(
      within(dialog).getByLabelText("Equivalent Standard / 等效标准"),
    ).toHaveProperty("required", true);
    expect(within(dialog).getByLabelText("Cover Finish / 表面")).toHaveProperty(
      "required",
      false,
    );
    expect(
      within(dialog).getByLabelText("Representative Image / 系列代表图"),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("link", { name: "Cancel / 取消" }),
    ).toBeTruthy();
  });

  it("renders only variant-owned fields, series selection, status, and optional override", () => {
    renderMaintenance("variant");
    const dialog = screen.getByRole("dialog", {
      name: "Add Hose Variant / 增加胶管子体",
    });
    expect(
      within(dialog).getByLabelText("Hose Series / 胶管系列"),
    ).toBeTruthy();
    expect(
      within(dialog).getByLabelText("Product Status / 产品状态"),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("option", { name: "Online / 上线" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("option", { name: "Draft / 草稿" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("option", { name: "Discontinued / 停用" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByLabelText("Variant Image Override / 子体图片覆盖"),
    ).toHaveProperty("required", false);
    expect(within(dialog).getByLabelText("Notes / 备注")).toHaveProperty(
      "required",
      true,
    );
    expect(dialog.querySelector('[name*="primaryStandard"]')).toBeNull();
    expect(dialog.querySelector('[name*="referencePrice"]')).toBeNull();
    expect(dialog.querySelector('[name*="sales"]')).toBeNull();
  });

  it("preserves uploaded media and Inherited technical status while editing", () => {
    renderMaintenance("variant", {
      variant: {
        bendRadiusMm: 100,
        burstBar: 720,
        dash: "-4",
        hoseSeries: "601R1",
        idMm: 6.4,
        imageOverrideReference: "media-version:uploaded-1",
        lifecycleStatus: "online",
        mshaMarking: null,
        nominalIdIn: 0.25,
        notes: "Existing",
        odMm: 13.4,
        skiveRequirement: null,
        sku: "601R1_001",
        source: null,
        technicalDataStatus: "Inherited",
        weightKgM: 0.2,
        workingBar: 180,
        workingPsi: 2610,
      },
    });
    const dialog = screen.getByRole("dialog", {
      name: "Edit Hose Variant / 编辑胶管子体",
    });
    expect(
      within(dialog).getByRole("option", {
        name: "Current uploaded override / 当前上传覆盖图",
      }),
    ).toHaveProperty("selected", true);
    expect(
      within(dialog).getByRole("option", { name: "Inherited / 继承" }),
    ).toHaveProperty("selected", true);
    expect(
      within(dialog).getByRole("option", {
        name: "Inherit Series Image / 继承系列代表图",
      }),
    ).toBeTruthy();
    expect(dialog.querySelector("form")).toHaveProperty("noValidate", true);

    cleanup();
    renderMaintenance("series", {
      selectedSeries: {
        ...series,
        representativeImageReference: "media-version:uploaded-series-1",
      },
    });
    expect(
      screen.getByRole("option", {
        name: "Current uploaded image / 当前上传图片",
      }),
    ).toHaveProperty("selected", true);
  });
});
