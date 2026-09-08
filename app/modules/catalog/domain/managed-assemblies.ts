import { normalizeDashSize } from "./dash-size";

export interface AssemblyParts {
  hoseSku: string;
  endAHoseEndSku: string;
  endAFerruleSku: string;
  endBHoseEndSku: string;
  endBFerruleSku: string;
}
export function assemblyIdentity(parts: AssemblyParts) {
  return JSON.stringify([
    parts.hoseSku,
    parts.endAHoseEndSku,
    parts.endAFerruleSku,
    parts.endBHoseEndSku,
    parts.endBFerruleSku,
  ]);
}
export interface AssemblyEndpoint {
  compatibility_id: string;
  hose_sku: string;
  hose_end_sku: string;
  ferrule_sku: string;
  hose_series: string;
  source: "automatic" | "import" | "legacy";
  [field: string]: unknown;
}
export interface ManagedCombination extends AssemblyParts {
  identity: string;
  hoseSeries: string;
  endACompatibilityId: string;
  endBCompatibilityId: string;
  source: "automatic" | "import" | "legacy" | "manual";
}
export function deriveManagedCombinations(endpoints: AssemblyEndpoint[]) {
  const result = new Map<string, ManagedCombination>();
  const byHose = new Map<string, AssemblyEndpoint[]>();
  for (const endpoint of endpoints) {
    const group = byHose.get(endpoint.hose_sku) ?? [];
    group.push(endpoint);
    byHose.set(endpoint.hose_sku, group);
  }
  for (const group of byHose.values())
    for (const a of group)
      for (const b of group) {
        const parts = {
          hoseSku: a.hose_sku,
          endAHoseEndSku: a.hose_end_sku,
          endAFerruleSku: a.ferrule_sku,
          endBHoseEndSku: b.hose_end_sku,
          endBFerruleSku: b.ferrule_sku,
        };
        const identity = assemblyIdentity(parts);
        result.set(identity, {
          ...parts,
          identity,
          hoseSeries: a.hose_series,
          endACompatibilityId: a.compatibility_id,
          endBCompatibilityId: b.compatibility_id,
          source:
            a.source === "import" || b.source === "import"
              ? "import"
              : a.source,
        });
      }
  return [...result.values()];
}
export function assemblyDashMatches(
  hose: string,
  end: string,
  ferrule: string,
) {
  const dash = normalizeDashSize(hose);
  return (
    dash !== null &&
    dash === normalizeDashSize(end) &&
    dash === normalizeDashSize(ferrule)
  );
}
