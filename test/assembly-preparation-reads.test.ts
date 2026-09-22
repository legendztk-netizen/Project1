import { beforeEach, expect, it, vi } from "vitest";
import { createAssemblyPreparationReads } from "../app/modules/quote-list/application/assembly-preparation-reads";

const reads = vi.hoisted(() => ({
  findSelectedEnds: vi.fn(),
  hasDerivedAssemblyCombination: vi.fn(),
  findActiveSnapshot: vi.fn(),
}));
vi.mock(
  "../app/modules/configurator/infrastructure/d1-configurator-repository",
  () => ({
    createD1ConfiguratorRepository: () => reads,
  }),
);
vi.mock(
  "../app/modules/configurator-reference/infrastructure/d1-configurator-reference-repository",
  () => ({
    createD1ConfiguratorReferenceRepository: () => reads,
  }),
);
beforeEach(() => {
  vi.resetAllMocks();
  reads.findSelectedEnds.mockResolvedValue([]);
  reads.hasDerivedAssemblyCombination.mockResolvedValue(true);
  reads.findActiveSnapshot.mockResolvedValue(null);
});
const db = {} as D1Database;
const pair = {
  releaseId: "release-1",
  hoseSku: "hose-1",
  endACompatibilityId: "end-a",
  endBCompatibilityId: "end-b",
  identity: '["hose-1","end-a","ferrule-a","end-b","ferrule-b"]',
};

it("coalesces concurrent component and reference reads without caching per-line calculations", async () => {
  const context = createAssemblyPreparationReads(db);
  await Promise.all(
    Array.from({ length: 50 }, async () => {
      await context.findSelectedEnds("release-1", "hose-1", "end-a", "end-b");
      await context.hasDerivedAssemblyCombination({ ...pair });
      await context.findActiveSnapshot();
    }),
  );
  for (const method of Object.values(reads))
    expect(method).toHaveBeenCalledTimes(1);
});

it("keeps ordered pairs and catalog releases separate", async () => {
  const context = createAssemblyPreparationReads(db);
  await context.findSelectedEnds("release-1", "hose-1", "end-a", "end-b");
  await context.findSelectedEnds("release-1", "hose-1", "end-b", "end-a");
  await context.findSelectedEnds("release-2", "hose-1", "end-a", "end-b");
  await context.hasDerivedAssemblyCombination(pair);
  await context.hasDerivedAssemblyCombination({
    ...pair,
    identity: "different-ferrule",
  });
  expect(reads.findSelectedEnds).toHaveBeenCalledTimes(3);
  expect(reads.hasDerivedAssemblyCombination).toHaveBeenCalledTimes(2);
});

it("observes publication changes in the next list refresh", async () => {
  const first = createAssemblyPreparationReads(db);
  expect(await first.hasDerivedAssemblyCombination(pair)).toBe(true);
  reads.hasDerivedAssemblyCombination.mockResolvedValue(false);
  const next = createAssemblyPreparationReads(db);
  expect(await next.hasDerivedAssemblyCombination(pair)).toBe(false);
  expect(reads.hasDerivedAssemblyCombination).toHaveBeenCalledTimes(2);
});

it("does not retain failed database reads", async () => {
  const context = createAssemblyPreparationReads(db);
  reads.findActiveSnapshot.mockRejectedValueOnce(new Error("read failed"));
  await expect(context.findActiveSnapshot()).rejects.toThrow("read failed");
  await expect(context.findActiveSnapshot()).resolves.toBeNull();
  expect(reads.findActiveSnapshot).toHaveBeenCalledTimes(2);
});
