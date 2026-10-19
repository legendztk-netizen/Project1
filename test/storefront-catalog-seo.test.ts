import { describe, expect, it } from "vitest";

import {
  groupCatalogFamilies,
  type PublicCatalogItem,
} from "../app/modules/catalog/domain/public-catalog";
import {
  canonicalUrl,
  catalogCategorySeo,
  catalogFamilySeo,
  catalogFamilyTitle,
  fitDescription,
} from "../app/modules/storefront/domain/catalog-seo";
import { publicHoseFixture } from "./fixtures/public-hose";

const origin = "https://customhoseco.com";

function hose(
  series: string,
  primaryStandard: string,
  equivalentStandard: string,
  dash: `-${number}`,
  workingPsi: number,
  nominalId: string,
): PublicCatalogItem {
  const key = series.toLowerCase();
  return publicHoseFixture({
    familyKey: key,
    familyName: `${primaryStandard.replace(" R", "R")} Hydraulic Hose (${series.slice(3)})`,
    sku: `${series}_${dash}`,
    specs: [{ label: "Nominal ID", value: nominalId }],
    offer: {
      currency: "USD",
      leadTimeDays: 10,
      lengthOrdering: {
        cuttingLabelingFee: {
          currency: "USD",
          ratePerPiece: 1,
          scope: "all",
          version: 1,
        },
        incrementFt: 1,
        minimumLengthFt: 1,
        presetsFt: [],
        unit: "ft",
      },
      madeToOrder: true,
      moq: 1,
      referencePrice: 1,
      salesUnit: "ft",
    },
    variantSelection: {
      dash,
      equivalentStandard,
      hoseSeries: series,
      kind: "hose",
      nominalIdIn: null,
      performance: {
        temperatureMaxC: 100,
        temperatureMinC: -40,
        workingBar: null,
        workingPsi,
      },
      primaryStandard,
      reinforcement: "1 high-tensile steel wire braid",
    },
  });
}

const hoses = groupCatalogFamilies([
  hose("601R1", "SAE 100 R1AT", "EN 853 1SN", "-4", 3263, "0.25 in"),
  hose("601R1", "SAE 100 R1AT", "EN 853 1SN", "-16", 1450, "1 in"),
  hose("601R4", "SAE 100 R4", "N/A", "-12", 305, "0.75 in"),
  hose("601R4", "SAE 100 R4", "N/A", "-32", 102, "2 in"),
]);

function weldEnd(dash: `-${number}`): PublicCatalogItem {
  return publicHoseFixture({
    category: "hose-ends",
    familyKey: "weld-female-fixed-0-straight",
    familyName: "Weld Female Fixed 0° Straight Hose End",
    offer: null,
    productType: "hose_end",
    sku: `W-WELD${dash}`,
    specs: [
      { label: "Connection standard", value: "Socket weld" },
      { label: "Sealing form", value: "Weld" },
      { label: "Thread", value: "N/A (weld end)" },
    ],
    variantSelection: {
      compatibleHoses: [
        { shortName: "R1", standard: "SAE 100R1AT" },
        { shortName: "R2", standard: "SAE 100R2AT" },
      ],
      connectionDash: dash,
      hoseTailDash: dash,
      kind: "hose_end",
      thread: "N/A (weld end)",
    },
  });
}

describe("description fitting", () => {
  it("keeps earlier parts before fuller wordings and lands in 150–160 characters", () => {
    const text = fitDescription([
      { options: ["a".repeat(100)], required: true },
      [`, ${"b".repeat(40)}`, `, ${"b".repeat(10)}`],
      [`, ${"c".repeat(30)}`],
      { options: [". Done."], required: true },
    ]);
    // With b's full wording the text is 149 characters without c and 181 with it, so c stays
    // in with b's short wording rather than being dropped.
    expect(text).toBe(
      `${"a".repeat(100)}, ${"b".repeat(10)}, ${"c".repeat(30)}. Done.`,
    );
    expect(text.length).toBeGreaterThanOrEqual(150);
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it("never pads: too little data gives the closest real text", () => {
    expect(
      fitDescription([
        { options: ["Short name"], required: true },
        null,
        { options: [". Quote online."], required: true },
      ]),
    ).toBe("Short name. Quote online.");
  });
});

describe("catalog family titles", () => {
  it("adds the category noun only when the name lacks it, in any case", () => {
    expect(
      catalogFamilyTitle(
        {
          category: "hydraulic-hose",
          familyName: "SAE 100R1AT Hydraulic Hose (R1)",
        },
        "Hydraulic Supply",
      ),
    ).toBe("SAE 100R1AT Hydraulic Hose (R1) | Hydraulic Supply");
    expect(
      catalogFamilyTitle(
        {
          category: "quick-couplers",
          familyName: "ISO 16028 Flat Face Quick Couplers",
        },
        "Hydraulic Supply",
      ),
    ).toBe("ISO 16028 Flat Face Quick Couplers | Hydraulic Supply");
    expect(
      catalogFamilyTitle(
        { category: "hose-ends", familyName: "JIC 37° Female Swivel 0°" },
        "Hydraulic Supply",
      ),
    ).toBe("JIC 37° Female Swivel 0° — Hose End | Hydraulic Supply");
  });

  it("drops the noun, then a bracketed note, to fit 60 characters", () => {
    expect(
      catalogFamilyTitle(
        {
          category: "adapters",
          familyName: "Straight Male JIC 37° to Male NPTF",
        },
        "Hydraulic Supply",
      ),
    ).toBe("Straight Male JIC 37° to Male NPTF | Hydraulic Supply");
    expect(
      catalogFamilyTitle(
        {
          category: "hydraulic-hose",
          familyName: "SAE 100R2AT Hydraulic Hose Bulk Reel (Two Wire R2)",
        },
        "Hydraulic Supply",
      ),
    ).toBe("SAE 100R2AT Hydraulic Hose Bulk Reel | Hydraulic Supply");
  });

  it("keeps the full title past 60 characters rather than cutting model names", () => {
    const familyName =
      "BSPP Female Swivel 0° Straight Bite-the-Wire Hose End for R2, R4, R16, R17, 4SH Hose";
    expect(
      catalogFamilyTitle(
        { category: "hose-ends", familyName },
        "Hydraulic Supply",
      ),
    ).toBe(`${familyName} | Hydraulic Supply`);
  });
});

describe("catalog family SEO", () => {
  it("describes a hose from its own sizes, pressures and standards with a clean canonical", () => {
    const seo = catalogFamilySeo(hoses[0]!, "Hydraulic Supply", origin);
    expect(seo.canonical).toBe(
      "https://customhoseco.com/catalog/hydraulic-hose/601r1",
    );
    expect(seo.description).toContain("3,263 psi");
    expect(seo.description).toContain("-4 to -16");
    expect(seo.description).toContain("EN 853 1SN");
    expect(seo.description).toMatch(/Cut to length/);
    expect(seo.description.length).toBeGreaterThanOrEqual(150);
    expect(seo.description.length).toBeLessThanOrEqual(160);
  });

  it("leaves stored placeholders out and does not call fittings cut to length", () => {
    const [weld] = groupCatalogFamilies([weldEnd("-4"), weldEnd("-16")]);
    const { description } = catalogFamilySeo(weld!, "Hydraulic Supply", origin);
    expect(description).not.toMatch(/N\/A|Cut to length/);
    // `Weld` restates `Socket weld`, so only the standard is named.
    expect(description).not.toMatch(/Socket weld, weld/i);
    expect(description).toContain("for SAE 100R1AT and R2AT hose");
  });
});

describe("catalog category SEO", () => {
  it("names every hose series and the real maximum pressure", () => {
    const seo = catalogCategorySeo(
      "hydraulic-hose",
      hoses,
      "Hydraulic Supply",
      undefined,
    );
    expect(seo.title).toBe(
      "Hydraulic Hose — SAE 100R1AT & R4 | Hydraulic Supply",
    );
    expect(seo.description).toContain("2 hydraulic hose series");
    expect(seo.description).toContain("3,263 psi");
    expect(seo.description).not.toContain("N/A");
    expect(seo.canonical).toBe(
      "https://customhoseco.com/catalog/hydraulic-hose",
    );
  });
});

describe("canonical URLs", () => {
  it("fall back to production and never double a slash", () => {
    expect(canonicalUrl(undefined, "/catalog/adapters")).toBe(
      "https://customhoseco.com/catalog/adapters",
    );
    expect(canonicalUrl(" https://customhoseco.com// ", "/catalog")).toBe(
      "https://customhoseco.com/catalog",
    );
  });
});
