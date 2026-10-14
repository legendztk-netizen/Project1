import { describe, expect, it } from "vitest";
import {
  acceptedLineFor,
  parseAcceptedFittingLines,
  referenceCrimpDiameterMm,
} from "../app/modules/catalog/domain/fitting-line";
import { assemblyDashMatches } from "../app/modules/catalog/domain/managed-assemblies";

describe("Fitting Line pairing", () => {
  it("parses accepted lines in canonical order and rejects unknown lines", () => {
    expect(parseAcceptedFittingLines("w, b")).toEqual(["B", "W"]);
    expect(parseAcceptedFittingLines("JJ/W；")).toEqual(["W", "JJ"]);
    expect(parseAcceptedFittingLines("B W X")).toBeUndefined();
    expect(parseAcceptedFittingLines("JJ / W")).toEqual(["W", "JJ"]);
    expect(parseAcceptedFittingLines("B、W")).toEqual(["B", "W"]);
    expect(parseAcceptedFittingLines("  ")).toBeNull();
    expect(parseAcceptedFittingLines(null)).toBeNull();
    expect(parseAcceptedFittingLines("B,SS")).toBeUndefined();
  });

  it("pairs stainless lines like their carbon-steel lines", () => {
    const hose = { acceptedFittingLines: "B", crimpDiameterBMm: 15 };
    expect(acceptedLineFor(hose, "B")).toBe("B");
    expect(acceptedLineFor(hose, "SS")).toBe("B");
    expect(acceptedLineFor(hose, "W")).toBeNull();
    expect(acceptedLineFor(hose, "SSW")).toBeNull();
    expect(acceptedLineFor(hose, null)).toBeNull();
    expect(acceptedLineFor({}, "B")).toBeNull();
    expect(referenceCrimpDiameterMm(hose, "B")).toBe(15);
    expect(referenceCrimpDiameterMm(hose, "W")).toBeNull();
  });

  it("matches one-piece dashes without a ferrule", () => {
    expect(assemblyDashMatches("-4", "-04")).toBe(true);
    expect(assemblyDashMatches("-4", "-6")).toBe(false);
    expect(assemblyDashMatches("-4", "-4", "-6")).toBe(false);
  });
});
