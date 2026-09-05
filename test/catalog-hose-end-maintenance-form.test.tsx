// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryRouter,
  RouterProvider,
  useSearchParams,
} from "react-router";

import {
  CatalogHoseEndMaintenance,
  HoseEndMaintenanceActions,
} from "../app/modules/admin/ui/catalog-hose-end-maintenance";
import type {
  HoseEndSeriesRecord,
  HoseEndVariantRecord,
} from "../app/modules/catalog/domain/catalog-hose-end-maintenance";

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

function TestHarness({
  findings = [],
  variant = null,
}: {
  findings?: Parameters<typeof CatalogHoseEndMaintenance>[0]["findings"];
  variant?: HoseEndVariantRecord | null;
}) {
  const [search] = useSearchParams();
  const action = search.get("manualAction");
  return (
    <>
      <HoseEndMaintenanceActions />
      <CatalogHoseEndMaintenance
        action={action === "series" || action === "variant" ? action : null}
        findings={findings}
        formError={findings.length > 0 ? "Invalid / 无效" : null}
        requestedSku=""
        saved={null}
        selectedSeries={null}
        series={[series]}
        variant={variant}
      />
    </>
  );
}

function renderMaintenance(
  action: "series" | "variant" | null,
  options: Parameters<typeof TestHarness>[0] = {},
) {
  const router = createMemoryRouter(
    [
      {
        element: <TestHarness {...options} />,
        path: "/admin/catalog/import",
      },
    ],
    {
      initialEntries: [
        `/admin/catalog/import?mode=manual&productType=hose_end${action ? `&manualAction=${action}` : ""}`,
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
    const summary = within(menu).getByText("Hose End / 压接接头");
    summary.focus();
    expect(document.activeElement).toBe(summary);
    fireEvent.mouseEnter(summary);
    fireEvent.keyDown(summary, { code: "Enter", key: "Enter" });
    fireEvent.keyUp(summary, { code: "Enter", key: "Enter" });
    expect(summary.closest("details")).toHaveProperty("open", true);
    expect(
      within(menu).getByRole("link", { name: "Add Series / 增加系列" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("link", { name: "Add Variant / 增加子体" }),
    ).toBeTruthy();
  });

  it("renders the exact bilingual series contract and dismisses the modal", async () => {
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
    fireEvent.click(
      within(dialog).getByRole("link", { name: "Cancel / 取消" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

  it("selects an existing series, preserves an override, and shows bilingual validation", () => {
    renderMaintenance("variant", {
      findings: [
        {
          code: "required",
          field: "Thread / 螺纹",
          message: "Thread is required / 螺纹为必填项",
          row: 0,
          severity: "error",
          sku: "FJX-04-04",
          worksheet: "02_压接接头",
        },
      ],
      variant: {
        coating: "Zinc nickel",
        competitorPartNumber: null,
        connectionDash: "-04",
        cutoffBMm: 0,
        dimensionAMm: 45,
        drawingNumber: null,
        drawingRevision: null,
        fittingSeries: "FJX",
        hex1Mm: 14,
        hex2Mm: 0,
        hoseTailDash: "-04",
        imageOverrideReference: "media-version:uploaded-end-1",
        lifecycleStatus: "online",
        material: "Carbon steel",
        maxWorkingBar: 350,
        minimumBoreMm: 5,
        notes: "Existing",
        saltSprayHours: 0,
        sku: "FJX-04-04",
        source: null,
        technicalDataStatus: "Inherited",
        thread: "7/16-20 UNF",
        unitWeightG: 82,
      },
    });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("option", { name: /FJX/ })).toHaveProperty(
      "selected",
      true,
    );
    expect(
      within(dialog).getByRole("option", {
        name: "Current uploaded override / 当前上传覆盖图",
      }),
    ).toHaveProperty("selected", true);
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Thread is required / 螺纹为必填项",
    );
  });
});
