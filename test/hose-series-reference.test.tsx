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

import { groupCatalogFamilies } from "../app/modules/catalog/domain/public-catalog";
import { publicCatalogItemFromRow } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import {
  buildHoseSpecTableRows,
  formatDualPressure,
  formatDualTemperatureRange,
  HoseSeriesReference,
} from "../app/modules/storefront/ui/hose-series-reference";

afterEach(cleanup);

const SERIES_601R1_VARIANTS = [
  {
    sku: "601R1_002",
    dash: "-4",
    nominal_id_in: 0.25,
    id_mm: 6.3,
    od_mm: 13.7,
    working_bar: 225,
    working_psi: 3263,
    burst_bar: 900,
    bend_radius_mm: 100,
    hose_weight_kg_m: 0.23,
    reference_price_usd: 1.84,
  },
  {
    sku: "601R1_003",
    dash: "-5",
    nominal_id_in: 0.3125,
    id_mm: 8,
    od_mm: 15.3,
    working_bar: 215,
    working_psi: 3118,
    burst_bar: 860,
    bend_radius_mm: 115,
    hose_weight_kg_m: 0.26,
    reference_price_usd: 2.01,
  },
  {
    sku: "601R1_004",
    dash: "-6",
    nominal_id_in: 0.375,
    id_mm: 10,
    od_mm: 17.7,
    working_bar: 180,
    working_psi: 2611,
    burst_bar: 720,
    bend_radius_mm: 125,
    hose_weight_kg_m: 0.33,
    reference_price_usd: 1.84,
  },
  {
    sku: "601R1_005",
    dash: "-8",
    nominal_id_in: 0.5,
    id_mm: 12.5,
    od_mm: 20.7,
    working_bar: 160,
    working_psi: 2321,
    burst_bar: 640,
    bend_radius_mm: 180,
    hose_weight_kg_m: 0.45,
    reference_price_usd: 2.55,
  },
  {
    sku: "601R1_006",
    dash: "-10",
    nominal_id_in: 0.625,
    id_mm: 16,
    od_mm: 23.9,
    working_bar: 130,
    working_psi: 1885,
    burst_bar: 520,
    bend_radius_mm: 205,
    hose_weight_kg_m: 0.52,
    reference_price_usd: 3.26,
  },
  {
    sku: "601R1_007",
    dash: "-12",
    nominal_id_in: 0.75,
    id_mm: 19,
    od_mm: 27.9,
    working_bar: 105,
    working_psi: 1523,
    burst_bar: 420,
    bend_radius_mm: 240,
    hose_weight_kg_m: 0.62,
    reference_price_usd: 3.77,
  },
  {
    sku: "601R1_008",
    dash: "-14",
    nominal_id_in: 0.875,
    id_mm: 22,
    od_mm: 30.8,
    working_bar: 100,
    working_psi: 1450,
    burst_bar: 400,
    bend_radius_mm: 280,
    hose_weight_kg_m: 0.7,
    reference_price_usd: 5.34,
  },
  {
    sku: "601R1_009",
    dash: "-16",
    nominal_id_in: 1,
    id_mm: 25,
    od_mm: 35.6,
    working_bar: 87,
    working_psi: 1262,
    burst_bar: 348,
    bend_radius_mm: 300,
    hose_weight_kg_m: 0.91,
    reference_price_usd: 4.59,
  },
  {
    sku: "601R1_010",
    dash: "-20",
    nominal_id_in: 1.25,
    id_mm: 31.5,
    od_mm: 43.4,
    working_bar: 62,
    working_psi: 899,
    burst_bar: 248,
    bend_radius_mm: 420,
    hose_weight_kg_m: 1.3,
    reference_price_usd: 6.57,
  },
  {
    sku: "601R1_011",
    dash: "-24",
    nominal_id_in: 1.5,
    id_mm: 38,
    od_mm: 50.6,
    working_bar: 50,
    working_psi: 725,
    burst_bar: 200,
    bend_radius_mm: 500,
    hose_weight_kg_m: 1.7,
    reference_price_usd: 8.43,
  },
  {
    sku: "601R1_012",
    dash: "-32",
    nominal_id_in: 2,
    id_mm: 51,
    od_mm: 64.2,
    working_bar: 40,
    working_psi: 580,
    burst_bar: 160,
    bend_radius_mm: 630,
    hose_weight_kg_m: 1.9,
    reference_price_usd: 10.05,
  },
  {
    sku: "601R1_013",
    dash: "-40",
    nominal_id_in: 2.5,
    id_mm: 63,
    od_mm: 78.4,
    working_bar: 25,
    working_psi: 363,
    burst_bar: 100,
    bend_radius_mm: 760,
    hose_weight_kg_m: 2.5,
    reference_price_usd: 14.69,
  },
  {
    sku: "601R1_014",
    dash: "-48",
    nominal_id_in: 3,
    id_mm: 76,
    od_mm: 92.4,
    working_bar: 20,
    working_psi: 290,
    burst_bar: 80,
    bend_radius_mm: 900,
    hose_weight_kg_m: 3.33,
    reference_price_usd: 16.63,
  },
  {
    sku: "601R1_015",
    dash: "-56",
    nominal_id_in: 3.5,
    id_mm: 89,
    od_mm: 105.2,
    working_bar: 20,
    working_psi: 290,
    burst_bar: 88, // the factory catalog prints 8.8 MPa (4.4× working); shown as printed
    bend_radius_mm: 1100,
    hose_weight_kg_m: 4.28,
    reference_price_usd: 21.07,
  },
  {
    sku: "601R1_016",
    dash: "-64",
    nominal_id_in: 4,
    id_mm: 102,
    od_mm: 119.4,
    working_bar: 18,
    working_psi: 261,
    burst_bar: 72,
    bend_radius_mm: 1300,
    hose_weight_kg_m: 5.03,
    reference_price_usd: 24.17,
  },
] as const;

function build601R1Family() {
  const items = SERIES_601R1_VARIANTS.map((variant) =>
    publicCatalogItemFromRow({
      hose_series: "601R1",
      primary_standard: "SAE 100 R1AT",
      equivalent_standard: "EN 853 1SN",
      product_type: "hose",
      release_id: "rel-1",
      release_number: "CAT-001",
      rfq_eligibility: "Eligible",
      supply_availability: "available_for_quote",
      sales_unit: "FT",
      moq: 1,
      lead_time_days: 10,
      currency: "USD",
      quantity_input_mode: "length_ft",
      minimum_length_per_piece_ft: 1,
      length_increment_ft: 1,
      preset_length_1_ft: 25,
      preset_length_2_ft: 50,
      preset_length_3_ft: 100,
      cutting_labeling_fee_rate: 0,
      cutting_labeling_fee_scope: "series:601R1",
      cutting_labeling_fee_version: 1,
      hose_temp_min_c: -40,
      hose_temp_max_c: 100,
      tube_material: "Oil- and water-resistant synthetic rubber",
      reinforcement: "1 high-tensile steel wire braid",
      cover_material: "Oil- and weather-resistant synthetic rubber",
      cover_color: "Black",
      cover_finish: "Wrapped",
      fluid_compatibility:
        "Petroleum- and water-based hydraulic fluids; verify special media",
      ...variant,
    } as never),
  );
  return groupCatalogFamilies(items)[0]!;
}

/** The 601R1 SKUs Build a Hose offers: the ones with a Hose End compatibility. */
const ASSEMBLY_HOSE_SKUS = [
  "601R1_002",
  "601R1_004",
  "601R1_005",
  "601R1_006",
  "601R1_007",
  "601R1_009",
  "601R1_010",
];

function renderReference(assemblyHoseSkus: readonly string[] | null) {
  const family = build601R1Family();
  const selectSku = vi.fn();
  const selected = family.variants.find((item) => item.sku === "601R1_004")!;
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <HoseSeriesReference
          assemblyHoseSkus={assemblyHoseSkus}
          family={family}
          selected={selected}
          selectionComplete={true}
          selectSku={selectSku}
        />
      ),
    },
  ]);
  return { ...render(<RouterProvider router={router} />), selectSku };
}

describe("601R1 hose series reference content", () => {
  it("formats dual pressures (psi / bar) and dual temperatures (°C / °F)", () => {
    expect(formatDualPressure(3263, 225)).toBe("3,263 psi / 225 bar");
    expect(formatDualPressure(null, 900)).toBe("13,053 psi / 900 bar");
    expect(formatDualTemperatureRange(-40, 100)).toBe(
      "-40°C to +100°C (-40°F to +212°F)",
    );
  });

  it("builds all 15 dash size rows from -4 to -64 from the catalog values", () => {
    const family = build601R1Family();
    const rows = buildHoseSpecTableRows(family, new Set(ASSEMBLY_HOSE_SKUS));

    expect(rows).toHaveLength(15);
    expect(rows.map((row) => row.dash)).toEqual([
      "-4",
      "-5",
      "-6",
      "-8",
      "-10",
      "-12",
      "-14",
      "-16",
      "-20",
      "-24",
      "-32",
      "-40",
      "-48",
      "-56",
      "-64",
    ]);

    // Check -4 (601R1_002) and -6 (601R1_004)
    expect(rows[0]).toMatchObject({
      sku: "601R1_002",
      dash: "-4",
      metricSizeMm: 6.3,
      nominalId: '1/4" (0.25 in)',
      odMm: "13.7 mm",
      workingPressure: "3,263 psi / 225 bar",
      burstPressure: "13,053 psi / 900 bar",
      bendRadius: "100 mm",
      weight: "0.23 kg/m",
      onlineAssembly: true,
    });
    expect(rows[2]).toMatchObject({
      sku: "601R1_004",
      dash: "-6",
      metricSizeMm: 10,
      odMm: "17.7 mm",
      workingPressure: "2,611 psi / 180 bar",
      burstPressure: "10,443 psi / 720 bar",
      bendRadius: "125 mm",
      weight: "0.33 kg/m",
      onlineAssembly: true,
    });
    expect(rows.find((row) => row.dash === "-20")!.onlineAssembly).toBe(true);
    expect(rows.find((row) => row.dash === "-14")!.onlineAssembly).toBe(false);

    // -56 (601R1_015) keeps the factory's printed burst pressure.
    const dash56 = rows.find((row) => row.dash === "-56")!;
    expect(dash56.workingPressure).toBe("290 psi / 20 bar");
    expect(dash56.burstPressure).toBe("1,276 psi / 88 bar");
    expect(dash56.onlineAssembly).toBe(false);

    expect(
      buildHoseSpecTableRows(family, null).every(
        (row) => row.onlineAssembly === null,
      ),
    ).toBe(true);
  });

  it("renders the 3 fixed sections in order, highlights the active row, and links to the 3 required destinations", async () => {
    const { container, selectSku } = renderReference(ASSEMBLY_HOSE_SKUS);

    // Verify 3 sections in fixed order
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "SAE 100R1AT / EN 853 1SN Hydraulic Hose Size Chart & Full Specifications",
      "Dash Size Conversion",
      "SAE 100R1AT (601R1) Ordering & Engineering Questions",
    ]);

    // Verify Block 1 real HTML <table> with 15 rows and highlighted -6 row
    const specTable = container.querySelector("table.hose-spec-table")!;
    expect(specTable).not.toBeNull();
    const bodyRows = specTable.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(15);
    // Price, lead time and SKU stay in the order panel, not in the size chart.
    const columnHeaders = [...specTable.querySelectorAll("thead th")].map(
      (header) => header.textContent,
    );
    expect(columnHeaders.join(" ")).not.toMatch(/Price|Lead Time|SKU/);
    expect(specTable.textContent).not.toMatch(/\$1\.84|601R1_002/);
    const selectedRow = specTable.querySelector(
      'tbody tr[data-spec-row-dash="-6"]',
    )!;
    expect(selectedRow.classList.contains("is-selected")).toBe(true);

    // Clicking another row invokes selectSku
    const dash8Button = within(specTable as HTMLElement).getByRole("button", {
      name: /Select Dash -8/i,
    });
    fireEvent.click(dash8Button);
    expect(selectSku).toHaveBeenCalledWith("601R1_005");

    // Verify 4 Q&A items in Block 3 and zero price-change Q&A items
    const qaItems = container.querySelectorAll(".hose-qa-item");
    expect(qaItems).toHaveLength(4);
    for (const item of qaItems) {
      expect(item.textContent).not.toMatch(/\$1\.84|\$2\.01|\$5\.34/);
    }
    expect(qaItems[0]!.textContent).toContain(
      "-4, -6, -8, -10, -12, -16 and -20 have matching crimp hose ends",
    );
    expect(qaItems[0]!.textContent).toContain(
      "-5, -14, -24, -32, -40, -48, -56 and -64 are sold as cut-length hose",
    );
    // Removed for lack of a source: standards table, adjacent-size guide, SAE pressure comparison.
    expect(container.textContent).not.toMatch(
      /Standards Cross-Reference|Adjacent Size|SAE J517 sets/,
    );
    // Storefront wording rules: no internal fitting line codes or "one-piece".
    expect(container.textContent).not.toMatch(
      /one-piece|Series B|CustomHoseCo|DN22|Competitor/i,
    );

    // Verify the 3 required internal links at the end of Block 3
    const nav = screen.getByRole("navigation", {
      name: "Related hose tools and series",
    });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/build-a-hose",
      "/assembly-measurement-guide",
      "/catalog/hydraulic-hose/601r2",
    ]);
  });

  it("leaves out the assembly column and question when the assembly list is unavailable", () => {
    const { container } = renderReference(null);

    expect(container.textContent).not.toContain("Online Assembly");
    expect(container.querySelectorAll(".hose-qa-item")).toHaveLength(3);
    expect(container.textContent).toContain(
      "Configure a 601R1 hose assembly with crimped hose ends.",
    );
  });
});
