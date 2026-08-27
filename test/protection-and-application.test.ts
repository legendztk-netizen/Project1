import { describe, expect, it } from "vitest";

import {
  calculateAssemblyLengthReferencePricing,
  evaluateApplicationRequirements,
} from "../app/modules/configurator/domain/protection-and-application";
import { evaluateFinishedAssemblyLength } from "../app/modules/configurator/domain/finished-assembly-length";
import type {
  AssemblyEstimateSchedule,
  InstalledProtection,
} from "../app/modules/configurator-reference/domain/configurator-reference";

const schedule: AssemblyEstimateSchedule = {
  assemblyServicePricePerStartedFootUsd: 0.5,
  assemblyServicePriceUsd: null,
  currency: "USD",
  ferrulePriceSource: "catalog_sales_offer",
  hoseEndPriceSource: "catalog_sales_offer",
  hosePriceSource: "catalog_sales_offer_per_ft",
  protectionPriceSource: "installed_protection_registry",
  recordVersion: 2,
};

function protection(
  overrides: Partial<InstalledProtection> = {},
): InstalledProtection {
  return {
    availability: "available",
    code: "NYLON",
    currency: "USD",
    isNoAdditionalProtection: false,
    publicName: "Nylon Protective Sleeving",
    recordVersion: 2,
    referenceBasePriceUsd: 8,
    referenceInstallationPricePerStartedFootUsd: 1,
    referenceMaterialPricePerFootUsd: 1.35,
    referencePriceUsd: null,
    specification: "Abrasion-resistant nylon sleeve",
    ...overrides,
  };
}

describe("protection and application requirements", () => {
  it("uses exact feet for material, started feet for both installation terms, and rounds at the end", () => {
    expect(
      calculateAssemblyLengthReferencePricing({
        canonicalLengthMm: "762",
        protection: protection(),
        schedule,
      }),
    ).toEqual({
      assemblyServiceUsd: 1.5,
      exactLengthFeet: 2.5,
      missingInputs: [],
      protectionUsd: 14.38,
      startedFeet: 3,
    });
  });

  it("prices equivalent inch and millimetre lengths identically", () => {
    const inchLength = evaluateFinishedAssemblyLength({
      hasBothEnds: true,
      requestedTighterTolerance: false,
      unit: "in",
      value: "10",
    });
    const millimetreLength = evaluateFinishedAssemblyLength({
      hasBothEnds: true,
      requestedTighterTolerance: false,
      unit: "mm",
      value: "254",
    });
    if (!inchLength.valid || !millimetreLength.valid) {
      throw new Error("Expected equivalent valid lengths");
    }
    const fromInches = calculateAssemblyLengthReferencePricing({
      canonicalLengthMm: inchLength.length.canonicalMm,
      protection: protection(),
      schedule,
    });
    const fromMillimetres = calculateAssemblyLengthReferencePricing({
      canonicalLengthMm: millimetreLength.length.canonicalMm,
      protection: protection(),
      schedule,
    });
    expect(fromInches).toEqual(fromMillimetres);
    expect(fromInches).toMatchObject({
      assemblyServiceUsd: 0.5,
      protectionUsd: 10.13,
      startedFeet: 1,
    });
  });

  it("does not guess missing rates and keeps no added protection at zero", () => {
    expect(
      calculateAssemblyLengthReferencePricing({
        canonicalLengthMm: "254",
        protection: protection({ referenceMaterialPricePerFootUsd: null }),
        schedule: { ...schedule, assemblyServicePricePerStartedFootUsd: null },
      }),
    ).toMatchObject({
      assemblyServiceUsd: null,
      missingInputs: ["assembly_service", "installed_protection"],
      protectionUsd: null,
    });
    expect(
      calculateAssemblyLengthReferencePricing({
        canonicalLengthMm: "254",
        protection: protection({
          code: "NONE",
          isNoAdditionalProtection: true,
          referenceBasePriceUsd: 0,
          referenceInstallationPricePerStartedFootUsd: 0,
          referenceMaterialPricePerFootUsd: 0,
        }),
        schedule,
      }).protectionUsd,
    ).toBe(0);
  });

  it("normalizes application units and screens hose boundaries without claiming certification", () => {
    const result = evaluateApplicationRequirements({
      componentWorkingBarLimits: [250, 300, 250, 300],
      fluidMedium: "petroleum_hydraulic_fluid",
      hoseLimits: {
        temperatureMaxC: 100,
        temperatureMinC: -40,
        workingBar: 250,
        workingPsi: 3626,
      },
      maximumOperatingTemperature: "212",
      maximumWorkingPressure: "3625.9434",
      minimumOperatingTemperature: "-40",
      pressureUnit: "psi",
      temperatureUnit: "F",
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.application.maximumWorkingPressure.canonicalBar).toBe(
      "249.99999702",
    );
    expect(result.application.minimumOperatingTemperature.canonicalC).toBe(
      "-40",
    );
    expect(result.application.maximumOperatingTemperature.canonicalC).toBe(
      "100",
    );
    expect(result.application.reviewReasons).toEqual([]);
  });

  it("keeps out-of-range and uncertain media quotable with technical review", () => {
    const result = evaluateApplicationRequirements({
      componentWorkingBarLimits: [200, 300, 200, 300],
      fluidMedium: "not_sure",
      hoseLimits: {
        temperatureMaxC: 100,
        temperatureMinC: -40,
        workingBar: 250,
        workingPsi: 3626,
      },
      maximumOperatingTemperature: "101",
      maximumWorkingPressure: "251",
      minimumOperatingTemperature: "-41",
      pressureUnit: "bar",
      temperatureUnit: "C",
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.application.technicalReviewRequired).toBe(true);
    expect(result.application.reviewReasons).toEqual([
      "component_pressure_limit_exceeded",
      "fluid_medium_uncertain",
      "hose_pressure_limit_exceeded",
      "hose_temperature_limit_exceeded",
    ]);
  });

  it("checks known component limits even when another component limit is missing", () => {
    const result = evaluateApplicationRequirements({
      componentWorkingBarLimits: [200, null, 300, 300],
      fluidMedium: "petroleum_hydraulic_fluid",
      hoseLimits: {
        temperatureMaxC: 100,
        temperatureMinC: -40,
        workingBar: 300,
        workingPsi: null,
      },
      maximumOperatingTemperature: "100",
      maximumWorkingPressure: "250",
      minimumOperatingTemperature: "-40",
      pressureUnit: "bar",
      temperatureUnit: "C",
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.application.reviewReasons).toEqual([
      "component_limits_unavailable",
      "component_pressure_limit_exceeded",
    ]);
  });
});
