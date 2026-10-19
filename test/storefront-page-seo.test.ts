import { describe, expect, it } from "vitest";

import {
  buildAHoseDescription,
  buildAHoseEndTypes,
  buildAHoseTitle,
  countWord,
  homeDescription,
  homeTitle,
} from "../app/modules/storefront/domain/page-seo";

describe("home page SEO", () => {
  it("leads the title with the product, not the brand", () => {
    const title = homeTitle("Hydraulic Supply");
    expect(title).toBe(
      "Hydraulic Hose Assembly — Made to Length | Hydraulic Supply",
    );
    expect(title).toHaveLength(59);
  });

  it("counts hose series and sizes from the catalog", () => {
    const description = homeDescription({ seriesCount: 6, sizeCount: 52 });
    expect(description).toBe(
      "Custom hydraulic hose assemblies built to your exact length. Pick a hose series, both ends and the length, then request a quote. Six hose series in 52 sizes.",
    );
    expect(description.length).toBeGreaterThanOrEqual(150);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("drops the counts rather than guessing when the catalog is unavailable", () => {
    expect(homeDescription(null)).toBe(
      "Custom hydraulic hose assemblies built to your exact length. Pick a hose series, both ends and the length, then request a quote.",
    );
    expect(homeDescription({ seriesCount: 0, sizeCount: 0 })).not.toMatch(/\d/);
  });
});

describe("Build a Hose SEO", () => {
  it("keeps the exact title and avoids the home page's lead phrase", () => {
    const title = buildAHoseTitle("Hydraulic Supply");
    expect(title).toBe(
      "Custom Hydraulic Hose — Configure & Quote | Hydraulic Supply",
    );
    expect(title).toHaveLength(60);
    expect(title).not.toMatch(/Hydraulic Hose Assembly/i);
  });

  it("names only the connection types the hose ends come in", () => {
    expect(
      buildAHoseEndTypes([
        "JIC 37°",
        "NPT / NPTF",
        "ORFS",
        "BSPP / BSPT",
        "SAE Flange",
      ]),
    ).toEqual(["JIC", "NPT", "ORFS", "BSP"]);
    expect(buildAHoseEndTypes(["JIC 37°", "SAE Flange"])).toEqual(["JIC"]);
  });

  it("describes the configuration flow with the real series count", () => {
    const description = buildAHoseDescription(6, ["JIC", "NPT", "ORFS", "BSP"]);
    expect(description).toBe(
      "Configure your custom hydraulic hose: pick from six hose series, choose both ends, set the finished length and request a quote. JIC, NPT, ORFS and BSP ends.",
    );
    expect(description.length).toBeGreaterThanOrEqual(150);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("spells small counts and keeps digits beyond twelve", () => {
    expect(countWord(6)).toBe("six");
    expect(countWord(13)).toBe("13");
  });
});
