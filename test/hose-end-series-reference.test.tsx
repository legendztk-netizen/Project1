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
  summarizeCatalogFamilies,
} from "../app/modules/catalog/domain/public-catalog";
import { publicCatalogItemFromRow } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import type { CompatibleHose } from "../app/modules/catalog/domain/hose-name";
import { hoseEndInterfaceFilters } from "../app/modules/storefront/domain/catalog-pagination";
import { CatalogBrowser } from "../app/modules/storefront/ui/catalog-browser";
import {
  buildHoseEndSpecTableRows,
  HoseEndSeriesReference,
  selectHoseEndSiblings,
} from "../app/modules/storefront/ui/hose-end-series-reference";

afterEach(cleanup);

function makeHoseEndItem(overrides: {
  angle?: string;
  compatibleHoses?: CompatibleHose[];
  connectionDash: string;
  connectionStandard: string;
  cutoffBMm?: number | null;
  fittingSeries: string;
  gender?: string;
  hex1Mm?: number | null;
  hoseTailDash: string;
  interfaceFamily: string;
  maxWorkingBar?: number | null;
  sealingForm: string;
  sku: string;
  swivelForm?: string;
  thread: string;
}) {
  return publicCatalogItemFromRow({
    angle: overrides.angle ?? "90°",
    compatible_hoses: overrides.compatibleHoses ?? [
      { shortName: "R1", standard: "SAE 100R1AT" },
      { shortName: "R2", standard: "SAE 100R2AT" },
      { shortName: "R16", standard: "SAE 100R16" },
    ],
    competitor_part_number: null,
    connection_dash: overrides.connectionDash,
    connection_standard: overrides.connectionStandard,
    currency: "USD",
    cutoff_b_mm: overrides.cutoffBMm ?? null,
    dimension_a_mm: null,
    fitting_series: overrides.fittingSeries,
    gender: overrides.gender ?? "Female",
    hex_1_mm: overrides.hex1Mm ?? null,
    hex_2_mm: null,
    hose_end_coating: null,
    hose_end_material: null,
    hose_end_max_working_bar: overrides.maxWorkingBar ?? null,
    hose_end_unit_weight_g: null,
    hose_tail_dash: overrides.hoseTailDash,
    interface_family: overrides.interfaceFamily,
    lead_time_days: 10,
    minimum_bore_mm: null,
    moq: 1,
    product_type: "hose_end",
    quantity_input_mode: "unit",
    reference_price_usd: 5.2,
    release_id: "release-1",
    release_number: "CAT-001",
    rfq_eligibility: "Eligible",
    sales_unit: "EA",
    sealing_form: overrides.sealingForm,
    sku: overrides.sku,
    supply_availability: "available_for_quote",
    swivel_form: overrides.swivelForm ?? "Swivel",
    thread: overrides.thread,
  } as never);
}

describe("CatalogBrowser hose-ends interface pills", () => {
  it("renders interface quick-filter pills on /catalog/hose-ends and keeps active state in search and pagination", () => {
    const families = groupCatalogFamilies([
      makeHoseEndItem({
        connectionDash: "-6",
        connectionStandard: "SAE J514 / ISO 8434-2",
        fittingSeries: "B_JIC90_F_SW",
        hoseTailDash: "-6",
        interfaceFamily: "JIC 37°",
        sealingForm: "37° cone seat",
        sku: "B_JIC90_F_SW_06_06",
        thread: "9/16-18 UNF",
      }),
    ]);
    const summaries = summarizeCatalogFamilies(families);
    const router = createMemoryRouter(
      [
        {
          path: "/catalog/hose-ends",
          element: (
            <CatalogBrowser
              data={{
                activeCategory: "hose-ends",
                activeInterface: "jic",
                appName: "Hydraulic Supply",
                families: summaries,
                interfaceFilters: hoseEndInterfaceFilters,
                pagination: { page: 1, pageCount: 2, perPage: 10, total: 20 },
                query: "",
              }}
            />
          ),
        },
      ],
      { initialEntries: ["/catalog/hose-ends?interface=jic"] },
    );

    render(<RouterProvider router={router} />);

    const nav = screen.getByRole("navigation", {
      name: "Filter hose ends by interface",
    });
    expect(
      within(nav).getByRole("link", { name: "All" }).getAttribute("href"),
    ).toBe("/catalog/hose-ends");
    const jicPill = within(nav).getByRole("link", { name: "JIC 37°" });
    expect(jicPill.getAttribute("aria-current")).toBe("true");
    // Clicking the active pill toggles back to All.
    expect(jicPill.getAttribute("href")).toBe("/catalog/hose-ends");
    expect(
      within(nav)
        .getByRole("link", { name: "Code 61/62" })
        .getAttribute("href"),
    ).toBe("/catalog/hose-ends?interface=code-61-62");

    expect(
      screen.getByRole("heading", { name: "JIC 37° hose end families" }),
    ).toBeTruthy();

    // Pagination Next link preserves interface=jic.
    expect(
      screen.getByRole("link", { name: "Next page" }).getAttribute("href"),
    ).toBe("/catalog/hose-ends?interface=jic&page=2");
  });
});

describe("HoseEndSeriesReference", () => {
  it("sorts rows numerically, omits blank optional columns, and pairs same-shape crimp siblings", () => {
    const items = [
      makeHoseEndItem({
        connectionDash: "-12",
        connectionStandard: "SAE J514 / ISO 8434-2",
        fittingSeries: "B_JIC90_F_SW",
        hoseTailDash: "-12",
        interfaceFamily: "JIC 37°",
        sealingForm: "37° cone seat",
        sku: "B_JIC90_F_SW_12_12",
        thread: "1-1/16-12 UN",
        compatibleHoses: [
          { shortName: "R1", standard: "SAE 100R1AT" },
          { shortName: "R2", standard: "SAE 100R2AT" },
          { shortName: "R4", standard: "SAE 100R4" },
          { shortName: "R16", standard: "SAE 100R16" },
        ],
      }),
      makeHoseEndItem({
        connectionDash: "-6",
        connectionStandard: "SAE J514 / ISO 8434-2",
        fittingSeries: "B_JIC90_F_SW",
        hoseTailDash: "-8",
        interfaceFamily: "JIC 37°",
        sealingForm: "37° cone seat",
        sku: "B_JIC90_F_SW_06_08",
        thread: "9/16-18 UNF",
      }),
      makeHoseEndItem({
        connectionDash: "-6",
        connectionStandard: "SAE J514 / ISO 8434-2",
        fittingSeries: "B_JIC90_F_SW",
        hoseTailDash: "-6",
        interfaceFamily: "JIC 37°",
        sealingForm: "37° cone seat",
        sku: "B_JIC90_F_SW_06_06",
        thread: "9/16-18 UNF",
      }),
      makeHoseEndItem({
        connectionDash: "-8",
        connectionStandard: "SAE J514 / ISO 8434-2",
        fittingSeries: "W_JIC90_F_SW",
        hoseTailDash: "-8",
        interfaceFamily: "JIC 37°",
        sealingForm: "37° cone seat",
        sku: "W_JIC90_F_SW_08_08",
        thread: "3/4-16 UNF",
        compatibleHoses: [
          { shortName: "R2", standard: "SAE 100R2AT" },
          { shortName: "4SH", standard: "EN 856 4SH" },
        ],
      }),
    ];
    const allFamilies = groupCatalogFamilies(items);
    const braided = allFamilies.find(
      (family) => family.familyKey === "jic-37-female-swivel-90",
    )!;
    const summaries = summarizeCatalogFamilies(allFamilies);
    const siblings = selectHoseEndSiblings(braided, summaries);

    expect(siblings).toEqual([
      expect.objectContaining({
        crimpStyle: "Bite-the-Wire",
        familyKey: "jic-37-female-swivel-90-bite-the-wire",
        sameShape: true,
      }),
    ]);

    const rows = buildHoseEndSpecTableRows(braided);
    expect(rows.map((row) => row.pairingCode)).toEqual([
      "-6 × -6",
      "-6 × -8",
      "-12 × -12",
    ]);

    const selectSku = vi.fn();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <HoseEndSeriesReference
              family={braided}
              hoseEndSiblings={siblings}
              selected={braided.variants[1]!}
              selectionComplete={true}
              selectSku={selectSku}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    const table = screen.getByRole("table");
    // Optional blank dimensions are left out completely.
    expect(table.textContent).not.toContain("Cutoff B");
    expect(table.textContent).not.toContain("Hex");
    // Internal Fitting Line codes (B_, W_) never appear as standalone labels.
    expect(table.textContent).not.toContain("B_JIC90_F_SW_06_08");

    // Tail-specific hose differences (-6, -8 vs -12 with R4) are explained in Q1.
    expect(screen.getByText(/Pairing varies by hose tail size:/)).toBeTruthy();
    expect(screen.getByText("4 Questions")).toBeTruthy();
    expect(screen.queryByText(/return policy/i)).toBeNull();

    // Same-shape Bite-the-Wire sibling is linked in both Q4 and the bottom card.
    expect(
      screen
        .getAllByRole("link", {
          name: /JIC 37° Female Swivel 90° Bite-the-Wire Hose End/,
        })[0]
        ?.getAttribute("href"),
    ).toBe("/catalog/hose-ends/jic-37-female-swivel-90-bite-the-wire");

    // Filter to Connection Dash -6 and select -6 x -6.
    fireEvent.click(screen.getByRole("button", { name: "-6" }));
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    fireEvent.click(
      within(table).getByRole("button", {
        name: "Select Connection Dash -6 with Hose Tail Dash -6",
      }),
    );
    expect(selectSku).toHaveBeenCalledWith("B_JIC90_F_SW_06_06");
  });

  it("replaces N/A flange threads with sealing form, explains external skive on JJ series, and shows populated dimensions", () => {
    const skiveFlange = groupCatalogFamilies([
      makeHoseEndItem({
        angle: "0° Straight",
        compatibleHoses: [{ shortName: "4SH", standard: "EN 856 4SH" }],
        connectionDash: "-20",
        connectionStandard: "SAE J518 Code 62 / ISO 6162-2",
        cutoffBMm: 68,
        fittingSeries: "JJ_C62_N_FX",
        gender: "N/A",
        hoseTailDash: "-20",
        interfaceFamily: "SAE Flange",
        maxWorkingBar: 420,
        sealingForm: "Flange face with O-ring",
        sku: "JJ_C62_N_FX_20_20",
        swivelForm: "Fixed",
        thread: "N/A (SAE Code 62 flange)",
      }),
    ])[0]!;

    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <HoseEndSeriesReference
              family={skiveFlange}
              selected={skiveFlange.variants[0]!}
              selectionComplete={false}
              selectSku={() => {}}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    const table = screen.getByRole("table");
    expect(table.textContent).not.toContain("N/A");
    expect(table.textContent).toContain("Flange face with O-ring");
    expect(table.textContent).toContain("Cutoff B");
    expect(table.textContent).toContain("68 mm");
    expect(table.textContent).toContain("420 bar");
    expect(
      screen.getByText(/One-Piece Skive Crimp · External Skive/),
    ).toBeTruthy();
    expect(document.querySelector(".is-selected")).toBeNull();
  });
});
