import { describe, expect, it, vi } from "vitest";

import {
  AssemblyRegenerationRejected,
  deriveAssemblyCombinations,
  diffDerivedAssemblyCombinations,
  regenerateDerivedAssemblyData,
  type AssemblyRegenerationPlan,
  type AssemblyRegenerationRepository,
  type DerivedAssemblyEndpoint,
} from "../app/modules/catalog/domain/catalog-assembly-regeneration";

const endpoints: DerivedAssemblyEndpoint[] = [
  {
    compatibilityId: "COMP-A",
    ferruleSku: "FERRULE-A",
    hoseEndSku: "END-A",
    hoseSeries: "SERIES-A",
    hoseSku: "HOSE-A",
    relationshipFingerprint: "relationship-a-v1",
  },
  {
    compatibilityId: "COMP-B",
    ferruleSku: "FERRULE-B",
    hoseEndSku: "END-B",
    hoseSeries: "SERIES-A",
    hoseSku: "HOSE-A",
    relationshipFingerprint: "relationship-b-v1",
  },
];

function plan(overrides: Partial<AssemblyRegenerationPlan> = {}) {
  return {
    affectedSeries: ["SERIES-A"],
    allDraftSeries: ["SERIES-A", "SERIES-B"],
    baselineReleaseId: "active-release",
    beforeAffectedCombinations: [],
    endpoints,
    inputFingerprint: "impact-v1",
    releaseId: "draft-release",
    sourceImportId: "draft-import",
    status: "stale" as const,
    ...overrides,
  };
}

function repository(currentPlan: AssemblyRegenerationPlan) {
  return {
    findPlan: vi.fn(async () => currentPlan),
    recordAlreadyCurrent: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
    regenerate: vi.fn(async () => undefined),
  } satisfies AssemblyRegenerationRepository;
}

describe("Derived Assembly Data regeneration", () => {
  it("builds every ordered End A/End B tuple from explicit relationships", () => {
    const combinations = deriveAssemblyCombinations(endpoints);
    expect(combinations).toHaveLength(4);
    expect(
      combinations.map((combination) => [
        combination.endACompatibilityId,
        combination.endBCompatibilityId,
      ]),
    ).toEqual([
      ["COMP-A", "COMP-A"],
      ["COMP-A", "COMP-B"],
      ["COMP-B", "COMP-A"],
      ["COMP-B", "COMP-B"],
    ]);
    expect(combinations[1]).toMatchObject({
      endAFerruleSku: "FERRULE-A",
      endAHoseEndSku: "END-A",
      endBFerruleSku: "FERRULE-B",
      endBHoseEndSku: "END-B",
      hoseSku: "HOSE-A",
    });
    expect(combinations[1]).not.toHaveProperty("length");
    expect(combinations[1]).not.toHaveProperty("clocking");
    expect(combinations[1]).not.toHaveProperty("installedProtection");
    expect(combinations[1]).not.toHaveProperty("measurementMethod");
    expect(combinations[1]).not.toHaveProperty("price");
  });

  it("counts relationship provenance changes without changing tuple identity", () => {
    const before = deriveAssemblyCombinations(endpoints);
    const after = deriveAssemblyCombinations([
      endpoints[0],
      { ...endpoints[1], relationshipFingerprint: "relationship-b-v2" },
    ]);
    expect(diffDerivedAssemblyCombinations(before, after)).toEqual({
      additionCount: 0,
      changeCount: 3,
      removalCount: 0,
    });
  });

  it("regenerates all and only system-computed affected series", async () => {
    const data = plan({
      affectedSeries: ["SERIES-A", "SERIES-DELETED"],
      allDraftSeries: ["SERIES-A", "SERIES-B"],
    });
    const store = repository(data);
    const result = await regenerateDerivedAssemblyData(store, {
      actorId: "owner-1",
      generateId: () => "generation-1",
      ipAddress: "203.0.113.10",
      now: () => new Date("2026-09-04T08:00:00.000Z"),
      releaseId: "draft-release",
      requestCorrelationId: "request-generation-1",
    });

    expect(result).toMatchObject({
      affectedSeries: ["SERIES-A", "SERIES-DELETED"],
      combinationCount: 4,
      status: "succeeded",
    });
    expect(store.regenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedSeries: ["SERIES-A"],
        generationId: "generation-1",
      }),
    );
  });

  it("records an idempotent already-current attempt without regenerating", async () => {
    const store = repository(plan({ affectedSeries: [], status: "current" }));
    await expect(
      regenerateDerivedAssemblyData(store, {
        actorId: "owner-1",
        generateId: () => "attempt-2",
        ipAddress: "203.0.113.10",
        releaseId: "draft-release",
        requestCorrelationId: "request-attempt-2",
      }),
    ).resolves.toMatchObject({ status: "already_current" });
    expect(store.regenerate).not.toHaveBeenCalled();
    expect(store.recordAlreadyCurrent).toHaveBeenCalledOnce();
  });

  it("audits a failed attempt and leaves the rejection explicit", async () => {
    const store = repository(plan());
    store.regenerate.mockRejectedValueOnce(new Error("consistency rejected"));
    await expect(
      regenerateDerivedAssemblyData(store, {
        actorId: "owner-1",
        generateId: () => "generation-failed",
        ipAddress: "203.0.113.10",
        releaseId: "draft-release",
        requestCorrelationId: "request-generation-failed",
      }),
    ).rejects.toBeInstanceOf(AssemblyRegenerationRejected);
    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        affectedSeries: ["SERIES-A"],
        attemptId: "generation-failed",
        error: "consistency rejected",
      }),
    );
  });
});
