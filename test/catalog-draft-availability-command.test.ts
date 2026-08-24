import { describe, expect, it } from "vitest";

import {
  applyDraftSupplyAvailabilityChange,
  previewDraftSupplyAvailabilityChange,
  type ApplyDraftAvailabilityChangeOperation,
  type DraftAvailabilityCandidate,
  type DraftAvailabilityRepository,
  type DraftProductSelector,
} from "../app/modules/catalog/domain/catalog-draft-availability";

function repositoryDouble(
  candidatesFor: (
    selector: DraftProductSelector,
  ) => DraftAvailabilityCandidate[],
) {
  const applied: ApplyDraftAvailabilityChangeOperation[] = [];
  const selectors: DraftProductSelector[] = [];
  const repository: DraftAvailabilityRepository = {
    async applyAvailabilityChange(operation) {
      applied.push(operation);
    },
    async findAvailabilityCandidates(_releaseId, selector) {
      selectors.push(selector);
      return candidatesFor(selector);
    },
  };
  return { applied, repository, selectors };
}

describe("draft Supply Availability command", () => {
  it.each([
    [
      { mode: "worksheet", sourceWorksheet: "02_压接接头" } as const,
      "worksheet",
    ],
    [{ hoseSeries: "601R2", mode: "hose_series" } as const, "hose_series"],
    [
      { mode: "selected", skus: ["601R2_001", "601R2_002"] } as const,
      "selected",
    ],
  ])(
    "previews the %s selection mode without writing",
    async (selector, mode) => {
      const { applied, repository, selectors } = repositoryDouble(() => [
        { sku: "601R2_001", supplyAvailability: "temporarily_unavailable" },
      ]);

      const preview = await previewDraftSupplyAvailabilityChange(repository, {
        releaseId: "draft-1",
        selector,
        target: "available_for_quote",
      });

      expect(preview).toMatchObject({ affectedCount: 1, matchedCount: 1 });
      expect(selectors[0].mode).toBe(mode);
      expect(applied).toHaveLength(0);
    },
  );

  it("changes only candidates whose current state differs and records one command", async () => {
    const { applied, repository } = repositoryDouble(() => [
      { sku: "601R2_001", supplyAvailability: "available_for_quote" },
      { sku: "601R2_002", supplyAvailability: "temporarily_unavailable" },
      { sku: "601R2_003", supplyAvailability: "discontinued" },
    ]);

    const result = await applyDraftSupplyAvailabilityChange(repository, {
      actorId: "owner-1",
      generateId: () => "audit-1",
      now: () => new Date("2026-08-24T04:00:00.000Z"),
      releaseId: "draft-1",
      selector: {
        mode: "selected",
        skus: ["601R2_001", "601R2_002", "601R2_003"],
      },
      target: "available_for_quote",
    });

    expect(result).toMatchObject({
      affectedCount: 2,
      applied: true,
      matchedCount: 3,
    });
    expect(applied).toEqual([
      expect.objectContaining({
        actorId: "owner-1",
        affectedSkus: ["601R2_002", "601R2_003"],
        auditEventId: "audit-1",
        occurredAt: "2026-08-24T04:00:00.000Z",
        target: "available_for_quote",
      }),
    ]);
  });

  it("does not write or audit a zero-change selection", async () => {
    const { applied, repository } = repositoryDouble(() => [
      { sku: "601R2_001", supplyAvailability: "discontinued" },
    ]);

    const result = await applyDraftSupplyAvailabilityChange(repository, {
      actorId: "owner-1",
      releaseId: "draft-1",
      selector: { hoseSeries: "601R2", mode: "hose_series" },
      target: "discontinued",
    });

    expect(result).toMatchObject({
      affectedCount: 0,
      applied: false,
      matchedCount: 1,
    });
    expect(applied).toHaveLength(0);
  });

  it("normalizes duplicate selected SKUs before resolving candidates", async () => {
    const { repository, selectors } = repositoryDouble(() => []);

    await previewDraftSupplyAvailabilityChange(repository, {
      releaseId: "draft-1",
      selector: {
        mode: "selected",
        skus: [" 601R2_001 ", "601R2_001", "", "601R2_002"],
      },
      target: "temporarily_unavailable",
    });

    expect(selectors).toEqual([
      { mode: "selected", skus: ["601R2_001", "601R2_002"] },
    ]);
  });
});
