// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import {
  groupCatalogFamilies,
  type PublicCatalogFamily,
} from "../app/modules/catalog/domain/public-catalog";
import { publicCatalogItemFromRow } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import {
  AdapterSeriesReference,
  buildAdapterSpecTableRows,
  hasAdapterSeriesReference,
} from "../app/modules/storefront/ui/adapter-series-reference";

afterEach(cleanup);

function makeAdapterRow(overrides: {
  adapterFamilyId: string;
  catalogModel?: string | null;
  interface1: string;
  interface2: string;
  size1: string;
  size2: string;
  sku: string;
}) {
  return publicCatalogItemFromRow({
    adapter_family_id: overrides.adapterFamilyId,
    catalog_model: overrides.catalogModel ?? null,
    connection_form_1: "M",
    connection_form_2: "M",
    currency: "USD",
    interface_1: overrides.interface1,
    interface_2: overrides.interface2,
    lead_time_days: 10,
    moq: 1,
    product_type: "adapter",
    quantity_input_mode: "unit",
    reference_price_usd: 3.85,
    release_id: "release-1",
    release_number: "CAT-001",
    rfq_eligibility: "Eligible",
    sales_unit: "EA",
    shape_code: "ST",
    size_1: overrides.size1,
    size_2: overrides.size2,
    sku: overrides.sku,
    supply_availability: "available_for_quote",
    website_product_name: null,
  } as never);
}

function build2404Family(): PublicCatalogFamily {
  const items = [
    ["-12", "-12", "2404-12-12", "ADP_ST_JIC_M_12_NPT_M_12"],
    ["-2", "-2", "2404-02-02", "ADP_ST_JIC_M_02_NPT_M_02"],
    ["-3", "-2", "2404-03-02", "ADP_ST_JIC_M_03_NPT_M_02"],
    ["-4", "-4", "2404-04-04", "ADP_ST_JIC_M_04_NPT_M_04"],
    ["-5", "-4", "2404-05-04", "ADP_ST_JIC_M_05_NPT_M_04"],
    ["-6", "-6", "2404-06-06", "ADP_ST_JIC_M_06_NPT_M_06"],
    ["-6", "-8", "2404-06-08", "ADP_ST_JIC_M_06_NPT_M_08"],
    ["-8", "-6", "2404-08-06", "ADP_ST_JIC_M_08_NPT_M_06"],
    ["-8", "-8", "2404-08-08", "ADP_ST_JIC_M_08_NPT_M_08"],
  ].map(([size1, size2, catalogModel, sku]) =>
    makeAdapterRow({
      adapterFamilyId: "ADP_FAM_JIC_NPT_ST",
      catalogModel,
      interface1: "JIC",
      interface2: "NPT",
      size1: size1!,
      size2: size2!,
      sku: sku!,
    }),
  );
  return groupCatalogFamilies(items)[0]!;
}

function build6400Family(): PublicCatalogFamily {
  const items = [
    ["-4", "-4", "6400-04-04", "ADP_ST_JIC_M_04_ORB_M_04"],
    ["-6", "-6", "6400-06-06", "ADP_ST_JIC_M_06_ORB_M_06"],
    ["-6", "-8", "6400-06-08", "ADP_ST_JIC_M_06_ORB_M_08"],
    ["-8", "-8", "6400-08-08", "ADP_ST_JIC_M_08_ORB_M_08"],
    ["-12", "-12", "6400-12-12", "ADP_ST_JIC_M_12_ORB_M_12"],
  ].map(([size1, size2, catalogModel, sku]) =>
    makeAdapterRow({
      adapterFamilyId: "ADP_FAM_JIC_ORB_ST",
      catalogModel,
      interface1: "JIC",
      interface2: "ORB",
      size1: size1!,
      size2: size2!,
      sku: sku!,
    }),
  );
  return groupCatalogFamilies(items)[0]!;
}

function buildFs2404Family(): PublicCatalogFamily {
  const items = [
    ["-4", "-4", "FS2404-04-04", "ADP_ST_ORFS_M_04_NPT_M_04"],
    ["-6", "-6", "FS2404-06-06", "ADP_ST_ORFS_M_06_NPT_M_06"],
    ["-6", "-8", "FS2404-06-08", "ADP_ST_ORFS_M_06_NPT_M_08"],
    ["-8", "-8", "FS2404-08-08", "ADP_ST_ORFS_M_08_NPT_M_08"],
    ["-12", "-12", "FS2404-12-12", "ADP_ST_ORFS_M_12_NPT_M_12"],
  ].map(([size1, size2, catalogModel, sku]) =>
    makeAdapterRow({
      adapterFamilyId: "ADP_FAM_ORFS_NPT_ST",
      catalogModel,
      interface1: "ORFS",
      interface2: "NPT",
      size1: size1!,
      size2: size2!,
      sku: sku!,
    }),
  );
  return groupCatalogFamilies(items)[0]!;
}

function renderReference(options: {
  family: PublicCatalogFamily;
  publishedAdapterKeys?: readonly string[] | null;
  selectedSku?: string;
  selectionComplete?: boolean;
  selectSku?: (sku: string) => void;
}) {
  const {
    family,
    publishedAdapterKeys = null,
    selectedSku = family.variants[0]!.sku,
    selectionComplete = false,
    selectSku = () => {},
  } = options;
  const selected =
    family.variants.find((variant) => variant.sku === selectedSku) ??
    family.variants[0]!;
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AdapterSeriesReference
            family={family}
            publishedAdapterKeys={publishedAdapterKeys}
            selected={selected}
            selectionComplete={selectionComplete}
            selectSku={selectSku}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("AdapterSeriesReference", () => {
  it("recognizes the three reviewed launch adapter families", () => {
    expect(hasAdapterSeriesReference("adp-fam-jic-npt-st")).toBe(true);
    expect(hasAdapterSeriesReference("ADP-FAM-JIC-ORB-ST")).toBe(true);
    expect(hasAdapterSeriesReference("adp-fam-orfs-npt-st")).toBe(true);
    expect(hasAdapterSeriesReference("adp-fam-1cn")).toBe(false);
    expect(hasAdapterSeriesReference(null)).toBe(false);
  });

  it("sorts adapter rows numerically by End 1 Dash then End 2 Dash and marks equal vs jump sizes", () => {
    const family = build2404Family();
    const rows = buildAdapterSpecTableRows(family);
    expect(rows.map((row) => row.pairingCode)).toEqual([
      "-2 × -2",
      "-3 × -2",
      "-4 × -4",
      "-5 × -4",
      "-6 × -6",
      "-6 × -8",
      "-8 × -6",
      "-8 × -8",
      "-12 × -12",
    ]);
    expect(rows[0]).toMatchObject({
      catalogModel: "2404-02-02",
      end1Thread: "5/16-24 UNF",
      end2Thread: "1/8-27 NPTF",
      isSameDash: true,
      pairingType: "Same dash",
    });
    expect(rows[5]).toMatchObject({
      catalogModel: "2404-06-08",
      end1SizeLabel: '-6 (3/8")',
      end1Thread: "9/16-18 UNF",
      end2SizeLabel: '-8 (1/2")',
      end2Thread: "1/2-14 NPTF",
      isSameDash: false,
      pairingType: "Jump size",
    });
  });

  it("renders the 2404 reference sections, omits price and SKU from the table, and supports End 1 Dash filtering and row selection", () => {
    const family = build2404Family();
    const selectSku = vi.fn();
    renderReference({
      family,
      selectedSku: "ADP_ST_JIC_M_06_NPT_M_08",
      selectionComplete: true,
      selectSku,
    });

    expect(
      screen.getByRole("heading", {
        name: "2404 Straight Male JIC 37° to Male NPTF Adapter Size & Thread Chart",
      }),
    ).toBeTruthy();

    const table = screen.getByRole("table");
    expect(table.textContent).not.toContain("3.85");
    expect(table.textContent).not.toContain("ADP_ST_JIC_M_06_NPT_M_08");

    const selectedRow = table.querySelector(
      '[data-spec-row-sku="ADP_ST_JIC_M_06_NPT_M_08"]',
    );
    expect(selectedRow?.classList.contains("is-selected")).toBe(true);

    // Filter down to End 1 = -6 (2 rows: -6 x -6 and -6 x -8).
    fireEvent.click(screen.getByRole("button", { name: "-6" }));
    expect(within(table).getAllByRole("row")).toHaveLength(3); // 1 header + 2 body rows

    fireEvent.click(
      within(table).getByRole("button", {
        name: "Select Male JIC 37° -6 to Male NPTF -6 (2404-06-06)",
      }),
    );
    expect(selectSku).toHaveBeenCalledWith("ADP_ST_JIC_M_06_NPT_M_06");

    // Step-only odd JIC sizes (-3, -5) are explained in Q&A, with 4 technical questions and no return policy Q&A.
    expect(
      screen.getByText(
        /Male JIC 37° -3 and -5 are offered exclusively as jump sizes/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("4 Questions")).toBeTruthy();
    expect(screen.queryByText(/return policy/i)).toBeNull();
  });

  it("explains the shared JIC and ORB straight threads on 6400 and does not highlight a row before selection completes", () => {
    const family = build6400Family();
    renderReference({ family, selectionComplete: false });

    expect(
      screen.getByRole("heading", {
        name: "6400 Straight Male JIC 37° to Male SAE ORB Adapter Size & Thread Chart",
      }),
    ).toBeTruthy();
    expect(document.querySelector(".is-selected")).toBeNull();
    expect(
      screen.getByText(/Same straight thread, different sealing surface:/),
    ).toBeTruthy();
    expect(
      screen.getByText(/6400-08-08 has 3\/4-16 UNF on both ends/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: /Compare 2404 Male JIC 37° to Male NPTF Adapters/,
        })
        .getAttribute("href"),
    ).toBe("/catalog/adapters/adp-fam-jic-npt-st");
  });

  it("explains ORFS vs JIC thread overlap on FS2404 and falls back cleanly when a sibling series is unpublished", () => {
    const family = buildFs2404Family();
    renderReference({
      family,
      publishedAdapterKeys: ["adp-fam-orfs-npt-st"],
    });

    expect(
      screen.getByRole("heading", {
        name: "FS2404 Straight Male ORFS to Male NPTF Adapter Size & Thread Chart",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Verify the flat face, not just the thread gauge:/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Compare Every Hydraulic Adapter Series/ })
        .getAttribute("href"),
    ).toBe("/catalog/adapters");
    expect(
      screen
        .getByRole("link", { name: /Browse ORFS Crimp Hose Ends/ })
        .getAttribute("href"),
    ).toBe("/catalog/hose-ends?interface=orfs");
  });

  it("renders nothing for unreviewed adapter families", () => {
    const unreviewed = groupCatalogFamilies([
      makeAdapterRow({
        adapterFamilyId: "ADP_FAM_1CN",
        interface1: "DINL",
        interface2: "NPT",
        size1: "-6",
        size2: "-4",
        sku: "ADP_ST_DINL_06_NPT_04",
      }),
    ])[0]!;
    const { container } = renderReference({ family: unreviewed });
    expect(container.querySelector(".adapter-series-reference")).toBeNull();
  });
});
