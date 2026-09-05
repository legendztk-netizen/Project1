export type AssemblyImpactProductType = "ferrule" | "hose" | "hose_end";

export interface AssemblyImpactProduct {
  derivationFingerprint: string;
  hoseSeries: string | null;
  productType: AssemblyImpactProductType;
  sku: string;
}

export interface AssemblyImpactCompatibility {
  compatibilityId: string;
  derivationFingerprint: string;
  ferruleSku: string;
  hoseEndSku: string;
  hoseSku: string;
}

export interface AssemblyImpactSnapshot {
  compatibilities: AssemblyImpactCompatibility[];
  products: AssemblyImpactProduct[];
  sharedDerivationRuleFingerprint: string;
}

export type AssemblyImpactChangeKind = "added" | "changed" | "removed";

export interface AssemblyImpactSourceChange {
  affectedSeries: string[];
  key: string;
  kind: AssemblyImpactChangeKind;
  sourceType: "compatibility" | "product" | "shared_derivation_rule";
}

export interface AssemblyImpactResult {
  affectedSeries: string[];
  inputFingerprint: string;
  sourceChanges: AssemblyImpactSourceChange[];
  stale: boolean;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "en");
}

function canonicalSnapshot(snapshot: AssemblyImpactSnapshot) {
  return {
    compatibilities: [...snapshot.compatibilities]
      .map((relationship) => ({ ...relationship }))
      .sort((left, right) =>
        compareText(left.compatibilityId, right.compatibilityId),
      ),
    products: [...snapshot.products]
      .map((product) => ({ ...product }))
      .sort((left, right) => compareText(left.sku, right.sku)),
    sharedDerivationRuleFingerprint: snapshot.sharedDerivationRuleFingerprint,
  };
}

function seriesDependencies(snapshot: AssemblyImpactSnapshot) {
  const hoseSeriesBySku = new Map(
    snapshot.products
      .filter(
        (product): product is AssemblyImpactProduct & { hoseSeries: string } =>
          product.productType === "hose" && Boolean(product.hoseSeries),
      )
      .map((product) => [product.sku, product.hoseSeries]),
  );
  const dependencies = new Map<string, Set<string>>();
  const add = (sku: string, series: string | undefined) => {
    if (!series) return;
    const current = dependencies.get(sku) ?? new Set<string>();
    current.add(series);
    dependencies.set(sku, current);
  };

  for (const product of snapshot.products) {
    if (product.productType === "hose")
      add(product.sku, product.hoseSeries ?? undefined);
  }
  for (const relationship of snapshot.compatibilities) {
    const series = hoseSeriesBySku.get(relationship.hoseSku);
    add(relationship.hoseSku, series);
    add(relationship.hoseEndSku, series);
    add(relationship.ferruleSku, series);
  }
  return dependencies;
}

function changedKind(
  beforeFingerprint: string | undefined,
  afterFingerprint: string | undefined,
): AssemblyImpactChangeKind | null {
  if (beforeFingerprint === undefined) return "added";
  if (afterFingerprint === undefined) return "removed";
  return beforeFingerprint === afterFingerprint ? null : "changed";
}

function sortedSeries(values: Iterable<string>) {
  return [...new Set(values)].sort(compareText);
}

export function calculateAssemblyImpact(
  before: AssemblyImpactSnapshot,
  after: AssemblyImpactSnapshot,
): AssemblyImpactResult {
  const beforeDependencies = seriesDependencies(before);
  const afterDependencies = seriesDependencies(after);
  const beforeProducts = new Map(
    before.products.map((product) => [product.sku, product]),
  );
  const afterProducts = new Map(
    after.products.map((product) => [product.sku, product]),
  );
  const beforeRelationships = new Map(
    before.compatibilities.map((relationship) => [
      relationship.compatibilityId,
      relationship,
    ]),
  );
  const afterRelationships = new Map(
    after.compatibilities.map((relationship) => [
      relationship.compatibilityId,
      relationship,
    ]),
  );
  const allSeries = sortedSeries(
    [...before.products, ...after.products]
      .filter((product) => product.productType === "hose")
      .flatMap((product) => (product.hoseSeries ? [product.hoseSeries] : [])),
  );
  const affected = new Set<string>();
  const sourceChanges: AssemblyImpactSourceChange[] = [];

  for (const sku of sortedSeries([
    ...beforeProducts.keys(),
    ...afterProducts.keys(),
  ])) {
    const previous = beforeProducts.get(sku);
    const next = afterProducts.get(sku);
    const kind = changedKind(
      previous?.derivationFingerprint,
      next?.derivationFingerprint,
    );
    if (!kind) continue;
    const series = sortedSeries([
      ...(beforeDependencies.get(sku) ?? []),
      ...(afterDependencies.get(sku) ?? []),
    ]);
    for (const value of series) affected.add(value);
    sourceChanges.push({
      affectedSeries: series,
      key: sku,
      kind,
      sourceType: "product",
    });
  }

  for (const compatibilityId of sortedSeries([
    ...beforeRelationships.keys(),
    ...afterRelationships.keys(),
  ])) {
    const previous = beforeRelationships.get(compatibilityId);
    const next = afterRelationships.get(compatibilityId);
    const kind = changedKind(
      previous?.derivationFingerprint,
      next?.derivationFingerprint,
    );
    if (!kind) continue;
    const series = sortedSeries([
      ...(previous ? (beforeDependencies.get(previous.hoseSku) ?? []) : []),
      ...(next ? (afterDependencies.get(next.hoseSku) ?? []) : []),
    ]);
    for (const value of series) affected.add(value);
    sourceChanges.push({
      affectedSeries: series,
      key: compatibilityId,
      kind,
      sourceType: "compatibility",
    });
  }

  if (
    before.sharedDerivationRuleFingerprint !==
    after.sharedDerivationRuleFingerprint
  ) {
    for (const value of allSeries) affected.add(value);
    sourceChanges.push({
      affectedSeries: allSeries,
      key: "assembly-component-combination-rules",
      kind: "changed",
      sourceType: "shared_derivation_rule",
    });
  }

  const affectedSeries = sortedSeries(affected);
  return {
    affectedSeries,
    inputFingerprint: JSON.stringify({
      after: canonicalSnapshot(after),
      before: canonicalSnapshot(before),
    }),
    sourceChanges,
    stale: affectedSeries.length > 0,
  };
}
