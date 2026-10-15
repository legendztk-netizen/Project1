import { describe, expect, it } from "vitest";

import {
  formatCompatibleHoses,
  hoseFamilyName,
  hoseStandardName,
  sortedCompatibleHoses,
} from "../app/modules/catalog/domain/hose-name";

describe("hose names", () => {
  it("names hoses by the standard printed on them, as US buyers do", () => {
    expect(hoseStandardName("601R2", "SAE 100 R2AT")).toEqual({
      shortName: "R2",
      standard: "SAE 100R2AT",
    });
    expect(hoseStandardName("EN4SH", "EN 856 4SH")).toEqual({
      shortName: "4SH",
      standard: "EN 856 4SH",
    });
    expect(hoseFamilyName("601R4", "SAE 100 R4")).toBe(
      "SAE 100R4 Hydraulic Hose (R4)",
    );
    expect(hoseFamilyName("EN4SH", "EN 856 4SH")).toBe(
      "EN 856 4SH Hydraulic Hose (4SH)",
    );
  });

  it("falls back to the series code when the standard is unknown", () => {
    expect(hoseStandardName("601R1", null)).toEqual({
      shortName: "601R1",
      standard: null,
    });
    expect(hoseFamilyName("601R1", "")).toBe("601R1 Hydraulic Hose");
  });

  it("lists SAE hoses by number, then EN hoses, once each", () => {
    const hose = (shortName: string) => ({ shortName, standard: null });
    expect(
      sortedCompatibleHoses(
        ["4SH", "R17", "R2", "R4", "R16", "R1", "R2"].map(hose),
      ).map((h) => h.shortName),
    ).toEqual(["R1", "R2", "R4", "R16", "R17", "4SH"]);
    expect(
      formatCompatibleHoses([
        { shortName: "R2", standard: "SAE 100R2AT" },
        hose("601R1"),
      ]),
    ).toBe("R2 (SAE 100R2AT), 601R1");
  });
});
