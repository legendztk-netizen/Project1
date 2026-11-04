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
import type { PublicCatalogFamily } from "../app/modules/catalog/domain/public-catalog";
import {
  buildHoseSpecTableRows,
  formatDualPressure,
  formatDualTemperatureRange,
  HoseSeriesReference,
  hoseSeriesComparedWith,
  type HoseSpecTableRow,
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

/** sku, dash, nominal in, metric size, OD mm, working bar, working psi, burst bar, bend radius mm, kg/m. */
type HoseRowValues = readonly [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function hoseVariants(rows: readonly HoseRowValues[]) {
  return rows.map(
    ([
      sku,
      dash,
      nominal_id_in,
      id_mm,
      od_mm,
      working_bar,
      working_psi,
      burst_bar,
      bend_radius_mm,
      hose_weight_kg_m,
    ]) => ({
      sku,
      dash,
      nominal_id_in,
      id_mm,
      od_mm,
      working_bar,
      working_psi,
      burst_bar,
      bend_radius_mm,
      hose_weight_kg_m,
      reference_price_usd: 1,
    }),
  );
}

/** The published 601R2 sizes as the catalogue (and factory catalogue p.16) lists them. */
const SERIES_601R2_VARIANTS = hoseVariants([
  ["601R2_002", "-4", 0.25, 6.3, 15.2, 400, 5802, 1600, 100, 0.35],
  ["601R2_003", "-5", 0.3125, 8, 16.8, 350, 5076, 1400, 115, 0.39],
  ["601R2_004", "-6", 0.375, 10, 19.2, 330, 4786, 1320, 125, 0.49],
  ["601R2_005", "-8", 0.5, 12.5, 22.4, 275, 3989, 1100, 180, 0.61],
  ["601R2_006", "-10", 0.625, 16, 25.6, 250, 3626, 1000, 205, 0.74],
  ["601R2_007", "-12", 0.75, 19, 29.5, 215, 3118, 860, 240, 0.93],
  ["601R2_008", "-14", 0.875, 22, 32.6, 175, 2538, 700, 280, 1.04],
  ["601R2_009", "-16", 1, 25, 38.3, 165, 2393, 660, 300, 1.4],
  ["601R2_010", "-20", 1.25, 31.5, 47.9, 125, 1813, 500, 420, 2.03],
  ["601R2_011", "-24", 1.5, 38, 54.6, 90, 1305, 360, 500, 2.26],
  ["601R2_012", "-32", 2, 51, 67.3, 80, 1160, 320, 630, 2.92],
  ["601R2_013", "-40", 2.5, 63, 78.4, 70, 1015, 280, 760, 3.43],
  ["601R2_014", "-48", 3, 76, 95.4, 40, 580, 160, 900, 4.38],
  ["601R2_015", "-56", 3.5, 89, 107, 45, 653, 180, 1100, 5.68],
  ["601R2_016", "-64", 4, 102, 121, 35, 508, 140, 1300, 6.45],
]);

/** The published 601R16 sizes as the catalogue (and factory catalogue p.18) lists them. */
const SERIES_601R16_VARIANTS = hoseVariants([
  ["601R16_001", "-4", 0.25, 6.3, 14.4, 400, 5800, 1400, 50, 0.31],
  ["601R16_003", "-6", 0.375, 10, 18.2, 330, 4785, 1120, 65, 0.47],
  ["601R16_004", "-8", 0.5, 12.5, 21.4, 275, 3990, 980, 90, 0.54],
  ["601R16_005", "-10", 0.625, 16, 24.9, 250, 3625, 770, 100, 0.7],
  ["601R16_006", "-12", 0.75, 19, 28.4, 215, 3120, 630, 120, 0.86],
  ["601R16_007", "-16", 1, 25, 36.6, 165, 2390, 560, 150, 1.2],
]);

/** The published 601R4 sizes as the catalogue (and factory catalogue p.34) lists them. */
const SERIES_601R4_VARIANTS = hoseVariants([
  ["601R4_001", "-12", 0.75, 19, 34.9, 21, 305, 84, 125, 0.92],
  ["601R4_002", "-16", 1, 25, 41.3, 17, 247, 68, 150, 1.1],
  ["601R4_003", "-20", 1.25, 31.5, 50.8, 14, 203, 56, 200, 1.3],
  ["601R4_004", "-24", 1.5, 38, 57.2, 10.5, 152, 42, 255, 1.8],
  ["601R4_006", "-32", 2, 51, 69.9, 7, 102, 28, 300, 2.23],
]);

/** The published 601R17 sizes as the catalogue (and factory catalogue p.19) lists them. */
const SERIES_601R17_VARIANTS = hoseVariants([
  ["601R17_002", "-4", 0.25, 6.3, 13.2, 210, 3045, 840, 50, 0.21],
  ["601R17_004", "-6", 0.375, 10, 17, 210, 3045, 840, 65, 0.32],
  ["601R17_005", "-8", 0.5, 12.5, 20.7, 210, 3045, 840, 90, 0.42],
  ["601R17_006", "-10", 0.625, 16, 25.8, 210, 3045, 840, 100, 0.73],
  ["601R17_007", "-12", 0.75, 19, 30, 210, 3045, 840, 120, 0.93],
  ["601R17_008", "-16", 1, 25, 38.5, 210, 3045, 840, 150, 1.32],
]);

/** The published EN4SH sizes as the catalogue (and factory catalogue p.2) lists them. */
const SERIES_EN4SH_VARIANTS = hoseVariants([
  ["EN4SH_002", "-12", 0.75, 19, 32.4, 420, 6092, 1680, 280, 1.7],
  ["EN4SH_003", "-16", 1, 25, 38.5, 380, 5511, 1520, 340, 2.5],
  ["EN4SH_004", "-20", 1.25, 31.5, 44.9, 325, 4714, 1300, 460, 3],
  ["EN4SH_005", "-24", 1.5, 38, 52.9, 290, 4206, 1160, 560, 3.6],
  ["EN4SH_006", "-32", 2, 51, 67.5, 250, 3626, 1000, 700, 5],
]);

function build601R4Family() {
  return buildHoseFamily(
    {
      code: "601R4",
      equivalent: "N/A",
      primary: "SAE 100 R4",
      reinforcement: "Textile fiber plies with spiral body steel wire",
    },
    SERIES_601R4_VARIANTS,
  );
}

function build601R17Family() {
  return buildHoseFamily(
    {
      code: "601R17",
      equivalent: "N/A",
      primary: "SAE 100 R17",
      reinforcement: "1 or 2 high-tensile steel wire braids (per hose design)",
    },
    SERIES_601R17_VARIANTS,
  );
}

function buildEn4shFamily() {
  return buildHoseFamily(
    {
      code: "EN4SH",
      equivalent: "N/A",
      primary: "EN 856 4SH",
      reinforcement: "4 high-tensile steel wire spirals",
    },
    SERIES_EN4SH_VARIANTS,
  );
}

function qaTexts(container: HTMLElement) {
  return [...container.querySelectorAll(".hose-qa-item")].map((item) => ({
    answer: item.querySelector("p")!.textContent!,
    question: item.querySelector("h3")!.textContent!,
  }));
}

function build601R1Family() {
  return buildHoseFamily(
    {
      code: "601R1",
      equivalent: "EN 853 1SN",
      primary: "SAE 100 R1AT",
      reinforcement: "1 high-tensile steel wire braid",
    },
    SERIES_601R1_VARIANTS,
  );
}

function build601R2Family() {
  return buildHoseFamily(
    {
      code: "601R2",
      equivalent: "EN 853 2SN",
      primary: "SAE 100 R2AT",
      reinforcement: "2 high-tensile steel wire braids",
    },
    SERIES_601R2_VARIANTS,
  );
}

function build601R16Family() {
  return buildHoseFamily(
    {
      code: "601R16",
      equivalent: "N/A",
      primary: "SAE 100 R16",
      reinforcement: "1 or 2 high-tensile steel wire braids (per hose design)",
    },
    SERIES_601R16_VARIANTS,
  );
}

function buildHoseFamily(
  series: {
    code: string;
    equivalent: string;
    primary: string;
    reinforcement: string;
  },
  variants: readonly object[],
) {
  const items = variants.map((variant) =>
    publicCatalogItemFromRow({
      hose_series: series.code,
      primary_standard: series.primary,
      equivalent_standard: series.equivalent,
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
      cutting_labeling_fee_scope: `series:${series.code}`,
      cutting_labeling_fee_version: 1,
      hose_temp_min_c: -40,
      hose_temp_max_c: 100,
      tube_material: "Oil- and water-resistant synthetic rubber",
      reinforcement: series.reinforcement,
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

/** The 601R2 SKUs Build a Hose offers. */
const R2_ASSEMBLY_HOSE_SKUS = [
  "601R2_002",
  "601R2_004",
  "601R2_005",
  "601R2_006",
  "601R2_007",
  "601R2_009",
  "601R2_010",
  "601R2_011",
  "601R2_012",
];

function comparisonRowsFor601R2(): Record<string, HoseSpecTableRow[]> {
  return {
    "601R1": buildHoseSpecTableRows(build601R1Family(), null),
    "601R16": buildHoseSpecTableRows(build601R16Family(), null),
  };
}

function renderReference(
  assemblyHoseSkus: readonly string[] | null,
  {
    comparisonRows,
    family = build601R1Family(),
  }: {
    comparisonRows?: Record<string, readonly HoseSpecTableRow[]>;
    family?: PublicCatalogFamily;
  } = {},
) {
  const selectSku = vi.fn();
  // The -6 size, 601R1_004 or 601R2_004.
  const selected = family.variants.find((item) => item.sku.endsWith("_004"))!;
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <HoseSeriesReference
          assemblyHoseSkus={assemblyHoseSkus}
          comparisonRows={comparisonRows}
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

describe("601R2 hose series reference content", () => {
  it("names the series each reference text compares with", () => {
    expect(hoseSeriesComparedWith("601r2")).toEqual(["601R1", "601R16"]);
    expect(hoseSeriesComparedWith("601R1")).toEqual([]);
    expect(hoseSeriesComparedWith("601R4")).toEqual([]);
    expect(hoseSeriesComparedWith("601R16")).toEqual(["601R2"]);
    expect(hoseSeriesComparedWith("601R17")).toEqual(["601R16"]);
    expect(hoseSeriesComparedWith("en4sh")).toEqual(["601R2"]);
    expect(hoseSeriesComparedWith("601R3")).toEqual([]);
    expect(hoseSeriesComparedWith(null)).toEqual([]);
  });

  it("compares 601R2 with 601R1 and 601R16 from catalogue rows", () => {
    const { container } = renderReference(R2_ASSEMBLY_HOSE_SKUS, {
      comparisonRows: comparisonRowsFor601R2(),
      family: build601R2Family(),
    });

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "SAE 100R2AT / EN 853 2SN Hydraulic Hose Size Chart & Full Specifications",
      "Dash Size Conversion",
      "SAE 100R2AT (601R2) Ordering & Engineering Questions",
    ]);
    expect(container.textContent).toContain(
      '-4 is 15.2 mm across the cover, about 0.6 in, but it is a 1/4" hose.',
    );

    const qa = qaTexts(container);
    expect(qa.map((item) => item.question)).toEqual([
      "1. Which 601R2 sizes can be built as hose assemblies online?",
      "2. What is the difference between R2 and R1 hydraulic hose?",
      "3. How does 100R16 compare with 100R2?",
      "4. What does the minimum bend radius mean for routing?",
      "5. Does the working pressure include pressure spikes?",
      "6. What working pressures do the large-bore 601R2 sizes (-24 to -64) carry?",
    ]);
    expect(qa[0]!.answer).toBe(
      "-4, -6, -8, -10, -12, -16, -20, -24 and -32 have matching crimp hose ends and can be configured by length in Build a Hose. -5, -14, -40, -48, -56 and -64 are sold as cut-length hose; contact our team for a manual assembly quote.",
    );
    expect(qa[1]!.answer).toBe(
      '601R1 has one steel wire braid and is listed under EN 853 1SN and SAE 100R1AT; 601R2 has two braids and is listed under EN 853 2SN and SAE 100R2AT. From 1/4" (-4) to 1" (-16), 601R2 is rated for a higher working pressure at every size, with a larger outside diameter and more weight. The factory lists the same minimum bend radius for both at every size. For 1/2" (-8), 601R2 vs 601R1: 275 vs 160 bar working pressure, 22.4 vs 20.7 mm outside diameter, 0.61 vs 0.45 kg/m, and 180 mm minimum bend radius for both. See every size in the 601R1 size chart.',
    );
    expect(qa[2]!.answer).toBe(
      '601R16 (SAE 100R16) is a compact hose with one or two steel wire braids, depending on the hose design; we offer it in -4, -6, -8, -10, -12 and -16. At each of these sizes it has the same working pressure in bar as 601R2, a smaller outside diameter, about half the minimum bend radius and less weight. For 1/2" (-8), 601R16 vs 601R2: 275 bar working pressure for both, 21.4 vs 22.4 mm outside diameter, 0.54 vs 0.61 kg/m, and 90 vs 180 mm minimum bend radius. See every size in the 601R16 size chart.',
    );
    // The 601R16 burst-to-working ratio is still unconfirmed, so burst pressure is never compared.
    expect(qa[2]!.answer).not.toMatch(/burst/i);
    expect(qa[3]!.answer).toContain(
      '180 mm for 1/2" (-8) and 240 mm for 3/4" (-12)',
    );
    expect(qa[5]!.answer).toBe(
      'Between 508 psi / 35 bar and 1,305 psi / 90 bar, against 3,989 psi / 275 bar for 1/2" (-8); the minimum bend radius is 500 mm to 1300 mm. -24 and -32 can be built online; -40, -48, -56 and -64 are sold as cut-length hose with assemblies quoted by our team.',
    );

    const links = [...container.querySelectorAll(".hose-qa-item a")].map(
      (link) => link.getAttribute("href"),
    );
    expect(links).toEqual([
      "/catalog/hydraulic-hose/601r1",
      "/catalog/hydraulic-hose/601r16",
    ]);
    const nav = screen.getByRole("navigation", {
      name: "Related hose tools and series",
    });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/build-a-hose",
      "/assembly-measurement-guide",
      "/catalog/hydraulic-hose/601r16",
    ]);
    expect(container.textContent).toContain(
      "Configure 601R2 in -4, -6, -8, -10, -12, -16, -20, -24 and -32 with crimped hose ends.",
    );
    expect(container.textContent).not.toMatch(
      /one-piece|Series B|CustomHoseCo|SAE J517 sets|SAE J517 and EN 853 size tables/,
    );
  });

  it("drops a comparison the catalogue rows no longer support", () => {
    const rows = comparisonRowsFor601R2();
    const { container } = renderReference(R2_ASSEMBLY_HOSE_SKUS, {
      comparisonRows: {
        // A 601R1 -6 rated above 601R2, and a 601R16 -10 wider than 601R2.
        "601R1": rows["601R1"]!.map((row) =>
          row.dash === "-6" ? { ...row, workingBar: 400 } : row,
        ),
        "601R16": rows["601R16"]!.map((row) =>
          row.dash === "-10" ? { ...row, outsideDiameterMm: 30 } : row,
        ),
      },
      family: build601R2Family(),
    });

    const [, r1, r16] = qaTexts(container);
    expect(r1!.answer).not.toContain("higher working pressure at every size");
    expect(r1!.answer).toContain(
      "The factory lists the same minimum bend radius for both at every size.",
    );
    expect(r16!.answer).not.toContain("about half the minimum bend radius");
    expect(r16!.answer).toContain('For 1/2" (-8), 601R16 vs 601R2:');
  });

  it("leaves out the comparisons when the compared series could not be read", () => {
    const { container } = renderReference(R2_ASSEMBLY_HOSE_SKUS, {
      family: build601R2Family(),
    });

    expect(qaTexts(container).map((item) => item.question)).toEqual([
      "1. Which 601R2 sizes can be built as hose assemblies online?",
      "2. What does the minimum bend radius mean for routing?",
      "3. Does the working pressure include pressure spikes?",
      "4. What working pressures do the large-bore 601R2 sizes (-24 to -64) carry?",
    ]);
    expect(container.querySelectorAll(".hose-qa-item a")).toHaveLength(0);
  });
});

describe("601R4, 601R16, 601R17 and EN4SH reference content", () => {
  function renderSeries(
    family: PublicCatalogFamily,
    comparisonRows: Record<string, readonly HoseSpecTableRow[]> = {},
  ) {
    return renderReference(
      family.variants.map((item) => item.sku),
      { comparisonRows, family },
    );
  }

  function headings() {
    return screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
  }

  function relatedLinks(container: HTMLElement) {
    return [...container.querySelectorAll(".hose-next-steps-links a")].map(
      (link) => link.getAttribute("href"),
    );
  }

  it("describes 601R4 as the factory's suction hose without claiming a return-line rating", () => {
    const { container } = renderSeries(build601R4Family());

    expect(headings()).toEqual([
      "SAE 100R4 Hydraulic Suction Hose Size Chart & Full Specifications",
      "Dash Size Conversion",
      "SAE 100R4 (601R4) Ordering & Engineering Questions",
    ]);
    // The catalogue's "N/A" equivalent standard is not shown.
    expect(container.querySelector(".eyebrow")!.textContent).toBe(
      "Series 601R4 · SAE 100 R4",
    );
    expect(container.textContent).not.toContain("N/A");
    expect(container.textContent).toContain(
      "as the factory catalogue lists it: 19 for -12, 25 for -16.",
    );
    expect(container.textContent).toContain(
      "For -16 the factory's range is 24.6 to 26.2 mm, so a hose measuring 25.4 mm (exactly 1\") is a normal -16.",
    );
    expect(container.textContent).toContain(
      '-12 is 34.9 mm across the cover, about 1.4 in, but it is a 3/4" hose.',
    );

    const qa = qaTexts(container);
    expect(qa.map((item) => item.question)).toEqual([
      "1. Which 601R4 sizes can be built as hose assemblies online?",
      "2. What is SAE 100R4 hydraulic hose used for?",
      "3. Can 601R4 be used as a suction and return hose?",
      "4. What does the minimum bend radius mean for routing?",
      "5. Does the working pressure include pressure spikes?",
    ]);
    expect(qa[0]!.answer).toBe(
      "-12, -16, -20, -24 and -32 have matching crimp hose ends and can be configured by length in Build a Hose.",
    );
    expect(qa[1]!.answer).toBe(
      "The factory catalogue lists 601R4 under SAE 100R4 as a wire-inserted hydraulic suction hose for low-pressure and vacuum applications. Its reinforcement is a ply or plies of woven or braided textile fibre with a spiral of body steel wire, and it carries petroleum-based hydraulic fluids, air and water-based fluids from -40°C to +100°C (-40°F to +212°F).",
    );
    expect(qa[2]!.answer).toBe(
      'The factory catalogue rates 601R4 for low-pressure and vacuum service and gives no separate rating for return lines. Whatever the line, the pressure in the hose must stay within the working pressure in the size chart: 305 psi / 21 bar for 3/4" (-12) down to 102 psi / 7 bar for 2" (-32).',
    );
    expect(qa[3]!.answer).toContain(
      '125 mm for 3/4" (-12) and 300 mm for 2" (-32)',
    );
    expect(relatedLinks(container)).toEqual([
      "/build-a-hose",
      "/assembly-measurement-guide",
      "/catalog/hydraulic-hose",
    ]);
  });

  it("compares 601R16 with 601R2 from the 601R16 side", () => {
    const { container } = renderSeries(build601R16Family(), {
      "601R2": buildHoseSpecTableRows(build601R2Family(), null),
    });

    expect(headings()[0]).toBe(
      "SAE 100R16 Hydraulic Hose Size Chart & Full Specifications",
    );
    expect(container.querySelector(".eyebrow")!.textContent).toBe(
      "Series 601R16 · SAE 100 R16",
    );
    const qa = qaTexts(container);
    expect(qa.map((item) => item.question)).toEqual([
      "1. Which 601R16 sizes can be built as hose assemblies online?",
      "2. How does 100R16 compare with 100R2?",
      "3. What does the minimum bend radius mean for routing?",
      "4. Does the working pressure include pressure spikes?",
    ]);
    expect(qa[1]!.answer).toBe(
      '601R16 (SAE 100R16) is a compact hose with one or two steel wire braids, depending on the hose design; we offer it in -4, -6, -8, -10, -12 and -16. At each of these sizes it has the same working pressure in bar as 601R2, a smaller outside diameter, about half the minimum bend radius and less weight. For 1/2" (-8), 601R16 vs 601R2: 275 bar working pressure for both, 21.4 vs 22.4 mm outside diameter, 0.54 vs 0.61 kg/m, and 90 vs 180 mm minimum bend radius. See every size in the 601R2 size chart.',
    );
    // The 601R16 burst-to-working ratio is still unconfirmed, so burst pressure is never compared.
    expect(qa[1]!.answer).not.toMatch(/burst/i);
    expect(
      [...container.querySelectorAll(".hose-qa-item a")].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["/catalog/hydraulic-hose/601r2"]);
    expect(relatedLinks(container).at(-1)).toBe(
      "/catalog/hydraulic-hose/601r2",
    );
  });

  it("states the uniform 601R17 rating and compares it with 601R16 size by size", () => {
    const { container } = renderSeries(build601R17Family(), {
      "601R16": buildHoseSpecTableRows(build601R16Family(), null),
    });

    expect(headings()[0]).toBe(
      "SAE 100R17 Hydraulic Hose Size Chart & Full Specifications",
    );
    const qa = qaTexts(container);
    expect(qa.map((item) => item.question)).toEqual([
      "1. Which 601R17 sizes can be built as hose assemblies online?",
      "2. What working pressure does 100R17 hydraulic hose carry?",
      "3. How does 100R17 compare with 100R16?",
      "4. What does the minimum bend radius mean for routing?",
      "5. Does the working pressure include pressure spikes?",
    ]);
    expect(qa[1]!.answer).toBe(
      'Every 601R17 size, from 1/4" (-4) to 1" (-16), has the same maximum working pressure: 3,045 psi / 210 bar. The factory catalogue lists 601R17 as a 21 MPa compact wire-braided hose.',
    );
    // Outside diameter and weight differ in both directions, so neither is claimed.
    expect(qa[2]!.answer).toBe(
      'Both are compact wire-braided hoses in the factory catalogue: 601R17 under SAE 100R17 and 601R16 under SAE 100R16. 601R17 is rated higher than 601R16 at -16 and lower at -4, -6, -8, -10 and -12. Both list the same minimum bend radius at every size they share. For 1/2" (-8), 601R17 vs 601R16: 210 vs 275 bar working pressure, 20.7 vs 21.4 mm outside diameter, 0.42 vs 0.54 kg/m, and 90 mm minimum bend radius for both. See every size in the 601R16 size chart.',
    );
  });

  it("drops the uniform 601R17 rating sentence once a size differs", () => {
    const family = buildHoseFamily(
      {
        code: "601R17",
        equivalent: "N/A",
        primary: "SAE 100 R17",
        reinforcement:
          "1 or 2 high-tensile steel wire braids (per hose design)",
      },
      SERIES_601R17_VARIANTS.map((variant) =>
        variant.dash === "-16"
          ? { ...variant, working_bar: 175, working_psi: 2538 }
          : variant,
      ),
    );
    const { container } = renderSeries(family);

    const answer = qaTexts(container)[1]!.answer;
    expect(answer).toBe(
      'Working pressure runs from 3,045 psi / 210 bar for -4, -6, -8, -10 and -12 to 2,538 psi / 175 bar for 1" (-16).',
    );
    expect(answer).not.toContain("21 MPa");
  });

  it("compares EN4SH with 601R2 without an outside diameter claim the sizes disagree on", () => {
    const { container } = renderSeries(buildEn4shFamily(), {
      "601R2": buildHoseSpecTableRows(build601R2Family(), null),
    });

    expect(headings()).toEqual([
      "EN 856 4SH Hydraulic Hose Size Chart & Full Specifications",
      "Dash Size Conversion",
      "EN 856 4SH (EN4SH) Ordering & Engineering Questions",
    ]);
    expect(container.textContent).toContain(
      "For -16 the factory's range is 25.0 to 26.0 mm, so a hose measuring 25.4 mm (exactly 1\") is a normal -16.",
    );
    const qa = qaTexts(container);
    expect(qa.map((item) => item.question)).toEqual([
      "1. Which EN4SH sizes can be built as hose assemblies online?",
      "2. What is EN 856 4SH hydraulic hose?",
      "3. How does 4SH hydraulic hose compare with two-wire braided hose?",
      "4. What does the minimum bend radius mean for routing?",
      "5. Does the working pressure include pressure spikes?",
    ]);
    expect(qa[1]!.answer).toBe(
      "The factory catalogue lists EN4SH under EN 856 4SH and China's GB/T 10544 4SH as a four-spiral extra-high-pressure hose: an oil- and water-resistant synthetic rubber lining, four spiral plies of steel wire wrapped in alternating directions and an oil- and weather-resistant synthetic rubber cover, for petroleum- and water-based hydraulic fluids from -40°C to +100°C (-40°F to +212°F).",
    );
    expect(qa[2]!.answer).toBe(
      '601R2 is a two-wire braided hose listed under EN 853 2SN and SAE 100R2AT; EN4SH has four spiral plies of steel wire. Compared with 601R2 at every size both list, from 3/4" (-12) to 2" (-32), EN4SH is rated for a higher working pressure, needs a larger minimum bend radius and weighs more. For 3/4" (-12), EN4SH vs 601R2: 420 vs 215 bar working pressure, 32.4 vs 29.5 mm outside diameter, 1.7 vs 0.93 kg/m, and 280 vs 240 mm minimum bend radius. See every size in the 601R2 size chart.',
    );
    expect(container.textContent).not.toMatch(/4SP|N\/A/);
  });

  it("leaves out each comparison when the compared series could not be read", () => {
    for (const family of [
      build601R16Family(),
      build601R17Family(),
      buildEn4shFamily(),
    ]) {
      const { container, unmount } = renderSeries(family);
      expect(container.querySelectorAll(".hose-qa-item a")).toHaveLength(0);
      expect(container.textContent).not.toMatch(
        /compare with 100R|compare with two-wire/,
      );
      unmount();
    }
  });
});
