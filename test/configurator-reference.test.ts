import { describe, expect, it } from "vitest";

import {
  evaluateClocking,
  estimateAssemblyReferencePrice,
  resolveInstalledProtectionOptions,
  resolveMeasurementMethod,
  validateConfiguratorReferenceSnapshot,
  type ConfiguratorReferenceSnapshot,
} from "../app/modules/configurator-reference/domain/configurator-reference";

const snapshot: ConfiguratorReferenceSnapshot = {
  assemblyEstimateSchedule: {
    assemblyServicePricePerStartedFootUsd: null,
    assemblyServicePriceUsd: null,
    currency: "USD",
    ferrulePriceSource: "catalog_sales_offer",
    hoseEndPriceSource: "catalog_sales_offer",
    hosePriceSource: "catalog_sales_offer_per_ft",
    protectionPriceSource: "installed_protection_registry",
    recordVersion: 1,
  },
  clockingConvention: {
    acceptedMaximumDegrees: 359,
    acceptedMinimumDegrees: 0,
    code: "M08",
    measurementDirection: "clockwise",
    notSureOutcome: "manual_review",
    presets: [0, 45, 90, 135, 180, 225, 270, 315],
    recordVersion: 1,
    rendererVersion: "1.0.1-draft",
    standardToleranceDegrees: 3,
    tighterToleranceOutcome: "manual_review",
    viewDirection: "end_a_toward_end_b",
    zeroReference: "end_b_at_6_oclock",
  },
  endpointAssignments: [
    { endpointClassCode: "STRAIGHT_MALE_END", hoseEndSku: "END-A" },
    { endpointClassCode: "ELBOW_90_CENTERLINE", hoseEndSku: "END-B" },
  ],
  endpointClasses: [
    {
      code: "STRAIGHT_MALE_END",
      displayName: "Straight male end point",
      recordVersion: 1,
      referenceKind: "defined_straight_male_end_point",
    },
    {
      code: "ELBOW_90_CENTERLINE",
      displayName: "90 degree elbow centerline",
      recordVersion: 1,
      referenceKind: "elbow_centerline_and_sealing_surface_intersection",
    },
  ],
  installedProtectionRules: [],
  installedProtections: [
    {
      availability: "available",
      code: "NONE",
      currency: "USD",
      isNoAdditionalProtection: true,
      publicName: "No additional installed protection",
      recordVersion: 1,
      referenceBasePriceUsd: 0,
      referenceInstallationPricePerStartedFootUsd: 0,
      referenceMaterialPricePerFootUsd: 0,
      referencePriceUsd: 0,
      specification: "No additional installed sleeve or guard",
    },
    {
      availability: "available",
      code: "TEXTILE_SLEEVE",
      currency: "USD",
      isNoAdditionalProtection: false,
      publicName: "Textile protective sleeve",
      recordVersion: 1,
      referenceBasePriceUsd: 0,
      referenceInstallationPricePerStartedFootUsd: 0,
      referenceMaterialPricePerFootUsd: 0,
      referencePriceUsd: 4,
      specification: "Abrasion protection",
    },
  ],
  measurementMappings: [
    {
      endAClassCode: "STRAIGHT_MALE_END",
      endBClassCode: "ELBOW_90_CENTERLINE",
      guidanceStatus: "guided",
      id: "MAPPING-1",
      methodCode: "M04",
    },
  ],
  measurementMethods: [
    {
      code: "M04",
      diagramAssetKey: "M04-straight-to-90-elbow.png",
      diagramAssetVersion: "diagram-1.0.1-draft",
      displayName: "Straight to 90 degree elbow",
      endpointRule: "straight end to elbow centerline intersection",
      overlayVersion: "1.0.1-draft",
      recordVersion: 1,
    },
  ],
  release: {
    id: "release-1",
    releaseNumber: "R1",
    status: "draft",
  },
};

describe("configurator reference registries", () => {
  it("resolves exactly one ordered guided measurement mapping", () => {
    expect(resolveMeasurementMethod(snapshot, "END-A", "END-B")).toEqual({
      method: snapshot.measurementMethods[0],
      status: "guided",
    });
    expect(resolveMeasurementMethod(snapshot, "END-B", "END-A")).toEqual({
      reason: "missing_mapping",
      status: "manual_quote_only",
    });
  });

  it("fails safely for missing assignments, explicit manual mappings, and ambiguity", () => {
    expect(resolveMeasurementMethod(snapshot, "UNKNOWN", "END-B")).toEqual({
      reason: "missing_endpoint_assignment",
      status: "manual_quote_only",
    });

    const explicitManual = {
      ...snapshot,
      measurementMappings: [
        {
          ...snapshot.measurementMappings[0],
          guidanceStatus: "manual_quote_only" as const,
          methodCode: null,
        },
      ],
    };
    expect(resolveMeasurementMethod(explicitManual, "END-A", "END-B")).toEqual({
      reason: "explicit_manual",
      status: "manual_quote_only",
    });

    const ambiguous = {
      ...snapshot,
      measurementMappings: [
        ...snapshot.measurementMappings,
        { ...snapshot.measurementMappings[0], id: "MAPPING-2" },
      ],
    };
    expect(resolveMeasurementMethod(ambiguous, "END-A", "END-B")).toEqual({
      reason: "ambiguous_mapping",
      status: "manual_quote_only",
    });
  });

  it("accepts whole-degree clocking and routes uncertainty or tighter tolerance to review", () => {
    expect(
      evaluateClocking(snapshot.clockingConvention, {
        status: "specified",
        targetDegrees: 359,
        toleranceDegrees: 3,
      }),
    ).toEqual({ manualReview: false, normalizedTarget: "359", valid: true });
    expect(
      evaluateClocking(snapshot.clockingConvention, {
        status: "specified",
        targetDegrees: 360,
        toleranceDegrees: 3,
      }).valid,
    ).toBe(false);
    expect(
      evaluateClocking(snapshot.clockingConvention, {
        status: "not_sure",
        targetDegrees: null,
        toleranceDegrees: 3,
      }).manualReview,
    ).toBe(true);
    expect(
      evaluateClocking(snapshot.clockingConvention, {
        status: "specified",
        targetDegrees: 90,
        toleranceDegrees: 2,
      }).manualReview,
    ).toBe(true);
  });

  it("keeps no additional protection unless a matching rule requires protection", () => {
    expect(
      resolveInstalledProtectionOptions(snapshot, {
        applicationCode: "GENERAL_HYDRAULIC",
        hoseSeries: "601R1",
      }).map((option) => option.code),
    ).toEqual(["NONE", "TEXTILE_SLEEVE"]);

    const required = {
      ...snapshot,
      installedProtectionRules: [
        {
          applicationCode: null,
          hoseSeries: "601R1",
          id: "RULE-1",
          requiresProtection: true,
        },
      ],
    };
    expect(
      resolveInstalledProtectionOptions(required, {
        applicationCode: "GENERAL_HYDRAULIC",
        hoseSeries: "601R1",
      }).map((option) => option.code),
    ).toEqual(["TEXTILE_SLEEVE"]);
  });

  it("never guesses missing assembly or protection prices", () => {
    expect(
      estimateAssemblyReferencePrice({
        assemblyServicePriceUsd: null,
        componentPricesUsd: {
          ferruleA: 3,
          ferruleB: 3,
          hose: 20,
          hoseEndA: 8,
          hoseEndB: 8,
        },
        protectionPriceUsd: 4,
      }),
    ).toEqual({ missingInputs: ["assembly_service"], totalUsd: null });
    expect(
      estimateAssemblyReferencePrice({
        assemblyServicePriceUsd: 6,
        componentPricesUsd: {
          ferruleA: 3,
          ferruleB: 3,
          hose: 20,
          hoseEndA: 8,
          hoseEndB: null,
        },
        protectionPriceUsd: null,
      }),
    ).toEqual({
      missingInputs: ["component_price", "installed_protection"],
      totalUsd: null,
    });
    expect(
      estimateAssemblyReferencePrice({
        assemblyServicePriceUsd: 6,
        componentPricesUsd: {
          ferruleA: 3,
          ferruleB: 3,
          hose: 20,
          hoseEndA: 8,
          hoseEndB: 8,
        },
        protectionPriceUsd: 0,
      }),
    ).toEqual({ missingInputs: [], totalUsd: 48 });
  });

  it("validates required registry structure without requiring assignments or prices", () => {
    const completeSeedSnapshot = {
      ...snapshot,
      endpointAssignments: [],
      measurementMethods: Array.from({ length: 7 }, (_, index) => ({
        ...snapshot.measurementMethods[0],
        code: `M0${index + 1}` as (typeof snapshot.measurementMethods)[number]["code"],
      })),
    };
    expect(validateConfiguratorReferenceSnapshot(completeSeedSnapshot)).toEqual(
      [],
    );

    expect(
      validateConfiguratorReferenceSnapshot({
        ...completeSeedSnapshot,
        measurementMappings: [
          ...completeSeedSnapshot.measurementMappings,
          {
            ...completeSeedSnapshot.measurementMappings[0],
            id: "AMBIGUOUS-RUNTIME-FALLBACK",
          },
        ],
      }),
    ).toEqual([]);

    expect(
      validateConfiguratorReferenceSnapshot({
        ...completeSeedSnapshot,
        clockingConvention: null,
        installedProtections: [],
        measurementMethods: completeSeedSnapshot.measurementMethods.slice(1),
      }).map(({ code }) => code),
    ).toEqual([
      "missing_measurement_method",
      "missing_clocking_convention",
      "invalid_no_additional_protection",
    ]);

    expect(
      validateConfiguratorReferenceSnapshot({
        ...completeSeedSnapshot,
        installedProtections: [
          {
            ...completeSeedSnapshot.installedProtections[0],
            availability: "temporarily_unavailable",
          },
        ],
      }).map(({ code }) => code),
    ).toEqual(["invalid_no_additional_protection"]);
  });
});
