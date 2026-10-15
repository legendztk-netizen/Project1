import { describe, expect, it } from "vitest";
import {
  acceptedLineFor,
  parseAcceptedFittingLines,
  referenceCrimpDiameterMm,
} from "../app/modules/catalog/domain/fitting-line";
import { assemblyDashMatches } from "../app/modules/catalog/domain/managed-assemblies";
import { compatibleHoseEndCandidateFromRow } from "../app/modules/configurator/infrastructure/d1-configurator-repository";

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

describe("one-piece hose end display names", () => {
  const row = (fittingSeries: string, angle = "90°") => ({
    angle,
    assembly_working_bar: null,
    compatibility_id: "AUTO:H:E",
    competitor_part_number: null,
    connection_dash: "-6",
    connection_standard: "SAE J514 / ISO 8434-2",
    ferrule_hose_construction: null,
    ferrule_hose_tail_dash: null,
    ferrule_series: null,
    ferrule_skive_requirement: null,
    ferrule_sku: null,
    fitting_series: fittingSeries,
    gender: "Female",
    hose_end_sku: `${fittingSeries}_06_06`,
    hose_tail_dash: "-6",
    interface_family: "JIC 37°",
    max_working_bar: null,
    sealing_form: "37° cone seat",
    swivel_form: "Swivel",
    thread: "9/16-18 UNF",
  });

  it("tells braided, bite-the-wire, six-wire and stainless ends apart", () => {
    const name = (series: string) =>
      compatibleHoseEndCandidateFromRow(row(series)).displayName;
    expect(name("B_JIC90L_F_SW")).toBe(
      "JIC 37° Female Swivel 90° Long Hose End",
    );
    expect(name("W_JIC90_F_SW")).toBe(
      "JIC 37° Female Swivel 90° Hose End (W-Series)",
    );
    expect(name("JJ_JIC90_F_SW")).toBe(
      "JIC 37° Female Swivel 90° Hose End (JJ-Series)",
    );
    expect(name("SSW_JIC90_F_SW")).toBe(
      "Stainless JIC 37° Female Swivel 90° Hose End (W-Series)",
    );
    expect(
      compatibleHoseEndCandidateFromRow({
        ...row("B_BSPFF_F_SW", "0° Straight"),
        interface_family: "BSPP",
      }).displayName,
    ).toBe("BSPP Flat Face Female Swivel 0° Straight Hose End");
    expect(compatibleHoseEndCandidateFromRow(row("W_JIC90_F_SW")).ferrule).toBe(
      null,
    );
  });
});
