import { describe, expect, it } from "vitest";

import {
  parseRegistrationConfigurationSnapshot,
  RegistrationConfigurationRejected,
} from "../app/modules/configurator/domain/registration-configuration";

function snapshot() {
  return {
    catalogContext: { releaseId: "release-1", releaseNumber: "CAT-1" },
    configuration: {
      catalogRelease: { id: "release-1", number: "CAT-1" },
      hose: {
        dash: "-3",
        equivalentStandard: "EN 853 1SN",
        familyKey: "601r1",
        familyName: "601R1 Hydraulic Hose",
        mediaKey: "601R1",
        nominalIdIn: 0.1875,
        performance: {
          temperatureMaxC: 100,
          temperatureMinC: -40,
          workingBar: 250,
          workingPsi: 3626,
        },
        primaryStandard: "SAE 100 R1AT",
        reinforcement: "Single wire braid",
        series: "601R1",
        sku: "601R1_001",
      },
    },
    quantityInput: "1",
    referenceContext: {
      assemblyEstimateScheduleVersion: 2,
      clockingConventionVersion: 2,
      installedProtectionVersion: null,
      measurementDiagramAssetVersion: null,
      measurementMethodVersion: null,
      measurementOverlayVersion: null,
    },
    selectedFamilyKey: "601r1",
    selectedSku: "601R1_001",
    selectionProvenance: {},
    stage: "hose",
    version: 1,
  };
}

function completeSnapshot() {
  const base = snapshot();
  const configuredEnd = (suffix: "A" | "B") => ({
    assemblyWorkingBar: 200,
    compatibilityId: `COMP_${suffix}`,
    ferrule: {
      hoseConstruction: "1 wire braid",
      hoseTailDash: "-3",
      series: "601R1",
      skiveRequirement: "No skive",
      sku: `FERRULE_${suffix}`,
    },
    hoseEnd: {
      aliases: [],
      angle: "45°",
      connectionDash: "-4",
      connectionStandard: "SAE J514",
      displayName: `Configured End ${suffix}`,
      gender: "Female",
      hoseTailDash: "-3",
      interfaceFamily: "JIC 37°",
      interfaceGroup: "JIC 37°",
      maximumWorkingBar: 250,
      mediaKey: `configured-end-${suffix}`,
      sealingForm: "37° flare",
      sku: `END_${suffix}`,
      swivelForm: "Swivel",
      thread: "7/16-20",
    },
  });
  return {
    ...base,
    configuration: {
      ...base.configuration,
      clocking: {
        configuredEnds: {
          endA: { angle: "45°", sku: "END_A" },
          endB: { angle: "45°", sku: "END_B" },
        },
        convention: {
          code: "M08",
          measurementDirection: "clockwise",
          recordVersion: 2,
          rendererVersion: "1.0.0",
          viewDirection: "end_a_toward_end_b",
          zeroReference: "end_b_at_6_oclock",
        },
        manualTechnicalReviewRequired: false,
        standardToleranceDegrees: 3,
        status: "specified",
        targetDegrees: 90,
        targetDisplay: "090",
        validation: "confirmed",
      },
      endA: configuredEnd("A"),
      endB: configuredEnd("B"),
      finishedLength: {
        canonicalMm: "609.6",
        lengthFeasibilityReviewRequired: true,
        manualReviewReasons: [],
        originalUnit: "in",
        originalValue: "24",
        path: "guided",
        requestedTighterTolerance: false,
        tolerance: {
          band: "over_18_through_36_in",
          display: "± 1/4 in (± 6.35 mm)",
          percent: null,
          plusMinusCanonicalMm: "6.35",
          scheduleCode: "SAE_J517_ASSEMBLY_LENGTH",
          scheduleVersion: "1.0.0",
        },
      },
      installedProtection: {
        availability: "available",
        code: "NONE",
        currency: "USD",
        isNoAdditionalProtection: true,
        publicName: "No additional installed protection",
        recordVersion: 2,
        referenceBasePriceUsd: 0,
        referenceInstallationPricePerStartedFootUsd: 0,
        referenceMaterialPricePerFootUsd: 0,
        referencePriceUsd: 0,
        specification: "",
      },
      lengthReferencePricing: {
        assemblyServiceUsd: 1,
        exactLengthFeet: 2,
        missingInputs: [],
        protectionUsd: 0,
        scheduleRecordVersion: 2,
        startedFeet: 2,
      },
      measurementSelection: {
        diagram: {
          assetKey: "M04-diagram.png",
          assetVersion: "1.0.0",
          overlayVersion: "1.0.0",
        },
        method: {
          code: "M04",
          diagramAssetKey: "M04-diagram.png",
          diagramAssetVersion: "1.0.0",
          displayName: "Straight to 90° elbow",
          endpointRule: "Measure sealing surface to elbow centerline",
          overlayVersion: "1.0.0",
          recordVersion: 2,
        },
        state: "selected",
      },
    },
    stage: "review",
  };
}

describe("registration configuration snapshots", () => {
  it("retains the exact partial configuration and version context", () => {
    const serialized = JSON.stringify(snapshot());
    expect(parseRegistrationConfigurationSnapshot(serialized)).toEqual(
      snapshot(),
    );
  });

  it("accepts a complete domain-valid configuration snapshot", () => {
    const complete = completeSnapshot();
    expect(
      parseRegistrationConfigurationSnapshot(JSON.stringify(complete)),
    ).toEqual(complete);
  });

  it.each([
    [
      "clocking angle",
      (value: any) => (value.configuration.clocking.targetDegrees = 360),
    ],
    [
      "clocking display",
      (value: any) => (value.configuration.clocking.targetDisplay = "90"),
    ],
    [
      "clocking tolerance",
      (value: any) =>
        (value.configuration.clocking.standardToleranceDegrees = 4),
    ],
    [
      "manual review reason",
      (value: any) =>
        value.configuration.finishedLength.manualReviewReasons.push(
          "invented_reason",
        ),
    ],
    [
      "protection price",
      (value: any) =>
        (value.configuration.installedProtection.referenceBasePriceUsd = -1),
    ],
    [
      "record version",
      (value: any) =>
        (value.configuration.measurementSelection.method.recordVersion = 0),
    ],
    [
      "clocking dependency",
      (value: any) => delete value.configuration.finishedLength,
    ],
    [
      "protection pricing pair",
      (value: any) => delete value.configuration.lengthReferencePricing,
    ],
  ])("rejects invalid %s semantics", (_label, mutate) => {
    const value = completeSnapshot();
    mutate(value);
    expect(() =>
      parseRegistrationConfigurationSnapshot(JSON.stringify(value)),
    ).toThrow("incomplete or invalid");
  });

  it("rejects empty, mismatched and oversized payloads", () => {
    expect(() =>
      parseRegistrationConfigurationSnapshot(
        JSON.stringify({
          ...snapshot(),
          configuration: null,
          selectedFamilyKey: null,
        }),
      ),
    ).toThrow(RegistrationConfigurationRejected);
    expect(() =>
      parseRegistrationConfigurationSnapshot(
        JSON.stringify({
          ...snapshot(),
          catalogContext: {
            releaseId: "wrong-release",
            releaseNumber: "CAT-1",
          },
        }),
      ),
    ).toThrow("does not match");
    expect(() =>
      parseRegistrationConfigurationSnapshot(
        JSON.stringify({
          ...snapshot(),
          selectionProvenance: {
            endA: {
              catalogReleaseId: "release-1",
            },
          },
        }),
      ),
    ).toThrow("incomplete or invalid");
    expect(() => {
      const invalid = snapshot();
      invalid.configuration.hose = {
        ...invalid.configuration.hose,
        marker: "not-a-configurator-field",
      } as typeof invalid.configuration.hose;
      parseRegistrationConfigurationSnapshot(JSON.stringify(invalid));
    }).toThrow("incomplete or invalid");
    expect(() =>
      parseRegistrationConfigurationSnapshot(
        JSON.stringify({ ...snapshot(), padding: "x".repeat(300_000) }),
      ),
    ).toThrow("too large");
  });
});
