import type {
  QuoteLineEdit,
  ReviewedQuoteLine,
} from "../domain/quote-line-revision";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import { createD1ConfiguratorRepository } from "../../configurator/infrastructure/d1-configurator-repository";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../../configurator/domain/compatible-end-a";
import {
  selectMeasurementMethod,
  selectMeasurementNotSure,
} from "../../configurator/domain/finished-assembly-length";
import {
  confirmClockingForDraft,
  requiresAssemblyClocking,
  selectClockingNotSure,
  specifyClocking,
} from "../../configurator/domain/assembly-clocking";
import { prepareConfiguredAssembly } from "../../quote-list/application/prepare-configured-assembly";
import { captureQuoteRequestProductSnapshot } from "../../quote-request/domain/quote-request";
import { createHoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";

export function assemblyAmendmentFields(
  line: ReviewedQuoteLine,
): QuoteLineEdit["assembly"] {
  if (line.lineKind !== "configured_assembly") return undefined;
  const c = line.configuredAssembly.snapshot.configuration;
  return {
    endASku: c.endA?.hoseEnd.sku ?? "",
    endAFerruleSku: c.endA?.ferrule.sku ?? "",
    endBSku: c.endB?.hoseEnd.sku ?? "",
    endBFerruleSku: c.endB?.ferrule.sku ?? "",
    measurement:
      c.measurementSelection?.state === "selected"
        ? c.measurementSelection.method.code
        : "not_sure",
    clocking:
      c.clocking?.status === "specified"
        ? String(c.clocking.targetDegrees)
        : "not_sure",
    protectionCode: c.installedProtection?.code ?? "",
  };
}

export async function prepareQuoteAssemblyAmendment(
  db: D1Database,
  existing: ReviewedQuoteLine,
  revised: ReviewedQuoteLine,
  edit: QuoteLineEdit,
) {
  if (!edit.assembly) return { line: revised, changed: false };
  if (
    existing.lineKind !== "configured_assembly" ||
    revised.lineKind !== "configured_assembly"
  )
    throw new Error(
      "Assembly amendments require an existing configured assembly",
    );
  const { confirmCurrentComponentRefresh, ...fields } = edit.assembly;
  if (
    existing.sku === revised.sku &&
    JSON.stringify(fields) === JSON.stringify(assemblyAmendmentFields(existing))
  )
    return { line: revised, changed: false };
  if (!confirmCurrentComponentRefresh)
    throw new Error(
      "Confirm revalidation of all assembly components against the current catalogue before saving the amendment",
    );
  const selection = edit.assembly;
  const hose = await createD1PublicCatalogRepository(db).findItem(revised.sku);
  if (!hose?.canAddToQuote)
    throw new Error("The selected hose is no longer available");
  const candidates = await createD1ConfiguratorRepository(
    db,
  ).findCompatibleEndA(hose.releaseId, hose.sku);
  const resolve = (sku: string, ferrule: string) => {
    const matches = candidates.filter(
      (c) => c.hoseEndSku === sku && c.ferrule.sku === ferrule,
    );
    if (matches.length !== 1)
      throw new Error(
        "Choose one available compatible End and ferrule combination",
      );
    return matches[0];
  };
  const currentHose = createHoseConfigurationDraft(hose);
  if (!currentHose) throw new Error("Published assembly hose required");
  let configuration = attachEndBToDraft(
    attachEndAToDraft(
      { ...revised.configuredAssembly.snapshot.configuration, ...currentHose },
      resolve(selection.endASku, selection.endAFerruleSku),
    ),
    resolve(selection.endBSku, selection.endBFerruleSku),
  );
  const refs =
    await createD1ConfiguratorReferenceRepository(db).findActiveSnapshot();
  if (!refs) throw new Error("Configuration reference data unavailable");
  const method = refs.measurementMethods.find(
    (m) => m.code === selection.measurement,
  );
  if (selection.measurement !== "not_sure" && !method)
    throw new Error("Invalid measurement method");
  configuration.measurementSelection = method
    ? selectMeasurementMethod(method)
    : selectMeasurementNotSure();
  const protection = refs.installedProtections.find(
    (p) =>
      p.code === selection.protectionCode && p.availability === "available",
  );
  if (!protection) throw new Error("Protection unavailable");
  configuration.installedProtection = protection;
  if (requiresAssemblyClocking(configuration)) {
    const clocking =
      selection.clocking === "not_sure"
        ? selectClockingNotSure(refs.clockingConvention)
        : specifyClocking(refs.clockingConvention, selection.clocking);
    if (!clocking.valid) throw new Error(clocking.error);
    configuration.clocking = confirmClockingForDraft(
      configuration,
      clocking.selection,
    )!;
  } else {
    if (
      selection.clocking !== "not_sure" &&
      selection.clocking !== "not_applicable"
    )
      throw new Error("Clocking is not applicable to these ends");
    delete configuration.clocking;
  }
  const prepared = await prepareConfiguredAssembly({
    database: db,
    draft: configuration,
    quantity: edit.quantity,
    referenceMode: "current",
  });
  revised.configuredAssembly = {
    ...revised.configuredAssembly,
    snapshot: prepared.snapshot,
    estimateBasis: prepared.estimateBasis,
    unitEstimateAmount: prepared.unitEstimateAmount,
    currentIssue: null,
  };
  revised.productSnapshot = captureQuoteRequestProductSnapshot(
    prepared.hoseProduct,
  );
  revised.catalogReleaseId = prepared.hoseProduct.releaseId;
  revised.configuredAssembly.snapshot.review.outcome = "technical_review";
  return { line: revised, changed: true };
}
