import { expect, it } from "vitest";
import {
  assemblyIdentity,
  deriveManagedCombinations,
  assemblyDashMatches,
  type AssemblyEndpoint,
} from "../app/modules/catalog/domain/managed-assemblies";
it("uses ordered component identities independent of revision and compatibility IDs", () => {
  const endpoints: AssemblyEndpoint[] = ["A", "B"].map((e) => ({
    compatibility_id: e,
    hose_sku: "H",
    hose_end_sku: e,
    ferrule_sku: "F",
    hose_series: "S",
    source: "automatic",
  }));
  const combinations = deriveManagedCombinations(endpoints);
  expect(combinations).toHaveLength(4);
  const ab = combinations.find(
    (c) => c.endAHoseEndSku === "A" && c.endBHoseEndSku === "B",
  )!;
  const ba = combinations.find(
    (c) => c.endAHoseEndSku === "B" && c.endBHoseEndSku === "A",
  )!;
  expect(ab.identity).not.toBe(ba.identity);
  expect(
    assemblyIdentity({ ...ab, endACompatibilityId: "revision2" } as typeof ab),
  ).toBe(ab.identity);
  expect(
    deriveManagedCombinations([
      ...endpoints,
      { ...endpoints[0], compatibility_id: "revision2" },
    ]),
  ).toHaveLength(4);
  expect(assemblyDashMatches("-04", "4", "-4")).toBe(true);
  expect(assemblyDashMatches("-4", "-8", "-4")).toBe(false);
  expect(assemblyDashMatches("", "", "")).toBe(false);
});
