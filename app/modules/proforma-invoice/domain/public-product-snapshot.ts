import type {
  QuoteRequestLine,
  QuoteRequestProductSnapshot,
} from "../../quote-request/domain/quote-request";
import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import type { HoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";
import type { ReviewedQuoteLine } from "../../quote-review/domain/quote-line-revision";
import {
  quoteLineTotals,
  type QuotedLinePrice,
} from "../../quote-review/domain/quote-pricing";

function catalogBasis(basis: PublicCatalogItem["catalogBasis"]) {
  return basis
    ? {
        generation: basis.generation,
        skuRevisionId: basis.skuRevisionId,
        seriesRevisionId: basis.seriesRevisionId,
        mediaVersionId: basis.mediaVersionId,
      }
    : null;
}

function offer(value: PublicCatalogItem["offer"]) {
  if (!value) return null;
  const length = value.lengthOrdering;
  return {
    currency: value.currency,
    referencePrice: value.referencePrice,
    salesUnit: value.salesUnit,
    leadTimeDays: value.leadTimeDays,
    madeToOrder: value.madeToOrder,
    moq: value.moq,
    lengthOrdering: length
      ? {
          incrementFt: length.incrementFt,
          minimumLengthFt: length.minimumLengthFt,
          presetsFt: length.presetsFt.map((value) => value),
          unit: length.unit,
          cuttingLabelingFee: {
            currency: length.cuttingLabelingFee.currency,
            ratePerPiece: length.cuttingLabelingFee.ratePerPiece,
            scope: length.cuttingLabelingFee.scope,
            version: length.cuttingLabelingFee.version,
          },
        }
      : null,
  };
}

function product(value: QuoteRequestProductSnapshot) {
  if (!value || !Array.isArray(value.specs))
    throw new Error("Captured product specifications required");
  const variant = value.variantSelection;
  return {
    catalogBasis: catalogBasis(value.catalogBasis),
    category: value.category,
    familyName: value.familyName,
    productType: value.productType,
    releaseId: value.releaseId,
    releaseNumber: value.releaseNumber,
    mediaKey: value.mediaKey,
    mainImageUrl: value.mainImageUrl ?? null,
    specifications: value.specs.map(({ label, value }) => ({ label, value })),
    offer: offer(value.offer ?? null),
    variantSelection: !variant
      ? null
      : variant.kind === "hose_end"
        ? {
            kind: variant.kind,
            connectionDash: variant.connectionDash,
            hoseTailDash: variant.hoseTailDash,
            thread: variant.thread,
          }
        : {
            kind: variant.kind,
            dash: variant.dash,
            equivalentStandard: variant.equivalentStandard,
            hoseSeries: variant.hoseSeries,
            nominalIdIn: variant.nominalIdIn,
            primaryStandard: variant.primaryStandard,
            reinforcement: variant.reinforcement,
            performance: {
              temperatureMaxC: variant.performance.temperatureMaxC,
              temperatureMinC: variant.performance.temperatureMinC,
              workingBar: variant.performance.workingBar,
              workingPsi: variant.performance.workingPsi,
            },
          },
  };
}

function end(value: HoseConfigurationDraft["endA"]) {
  if (!value) throw new Error("Captured assembly ends required");
  const h = value.hoseEnd;
  const f = value.ferrule;
  return {
    assemblyWorkingBar: value.assemblyWorkingBar,
    compatibilityId: value.compatibilityId,
    ferrule: {
      hoseConstruction: f.hoseConstruction,
      hoseTailDash: f.hoseTailDash,
      series: f.series,
      skiveRequirement: f.skiveRequirement,
      sku: f.sku,
    },
    hoseEnd: {
      aliases: h.aliases.map((alias) => alias),
      angle: h.angle,
      connectionDash: h.connectionDash,
      connectionStandard: h.connectionStandard,
      displayName: h.displayName,
      gender: h.gender,
      hoseTailDash: h.hoseTailDash,
      interfaceFamily: h.interfaceFamily,
      interfaceGroup: h.interfaceGroup,
      maximumWorkingBar: h.maximumWorkingBar,
      mediaKey: h.mediaKey,
      sealingForm: h.sealingForm,
      sku: h.sku,
      swivelForm: h.swivelForm,
      thread: h.thread,
    },
  };
}

function assembly(
  line: Extract<QuoteRequestLine, { lineKind: "configured_assembly" }>,
) {
  const snapshot = line.configuredAssembly.snapshot;
  const c = snapshot.configuration;
  const h = c.hose;
  const length = c.finishedLength;
  if (!length || !c.measurementSelection)
    throw new Error("Captured assembly length and measurement required");
  const measurement = c.measurementSelection;
  const method = measurement.method;
  const clock = c.clocking;
  const protection = c.installedProtection;
  const application = c.applicationRequirements;
  const basis = line.configuredAssembly.estimateBasis;
  return {
    sourceCatalogRelease: {
      id: snapshot.sourceCatalogRelease.id,
      number: snapshot.sourceCatalogRelease.number,
    },
    catalogRelease: {
      id: c.catalogRelease.id,
      number: c.catalogRelease.number,
    },
    productBasis: (snapshot.productBasis ?? []).map((p) => ({
      sku: p.sku,
      catalogBasis: catalogBasis(p.catalogBasis),
      offer: offer(p.offer),
      mainImageUrl: p.mainImageUrl ?? null,
    })),
    hose: {
      sku: h.sku,
      series: h.series,
      dash: h.dash,
      equivalentStandard: h.equivalentStandard,
      familyKey: h.familyKey,
      familyName: h.familyName,
      mediaKey: h.mediaKey,
      nominalIdIn: h.nominalIdIn,
      primaryStandard: h.primaryStandard,
      reinforcement: h.reinforcement,
      performance: {
        temperatureMaxC: h.performance.temperatureMaxC,
        temperatureMinC: h.performance.temperatureMinC,
        workingBar: h.performance.workingBar,
        workingPsi: h.performance.workingPsi,
      },
    },
    endA: end(c.endA),
    endB: end(c.endB),
    finishedLength: {
      canonicalMm: length.canonicalMm,
      originalUnit: length.originalUnit,
      originalValue: length.originalValue,
      requestedTighterTolerance: length.requestedTighterTolerance,
      tolerance: {
        band: length.tolerance.band,
        display: length.tolerance.display,
        percent: length.tolerance.percent,
        plusMinusCanonicalMm: length.tolerance.plusMinusCanonicalMm,
        scheduleCode: length.tolerance.scheduleCode,
        scheduleVersion: length.tolerance.scheduleVersion,
      },
    },
    measurement: {
      state: measurement.state,
      diagram: measurement.diagram
        ? {
            assetKey: measurement.diagram.assetKey,
            assetVersion: measurement.diagram.assetVersion,
            overlayVersion: measurement.diagram.overlayVersion,
          }
        : null,
      method: method
        ? {
            code: method.code,
            diagramAssetKey: method.diagramAssetKey,
            diagramAssetVersion: method.diagramAssetVersion,
            displayName: method.displayName,
            endpointRule: method.endpointRule,
            overlayVersion: method.overlayVersion,
            recordVersion: method.recordVersion,
          }
        : null,
    },
    clocking: clock
      ? {
          status: clock.status,
          targetDegrees: clock.targetDegrees,
          targetDisplay: clock.targetDisplay,
          standardToleranceDegrees: clock.standardToleranceDegrees,
          convention: {
            code: clock.convention.code,
            measurementDirection: clock.convention.measurementDirection,
            recordVersion: clock.convention.recordVersion,
            rendererVersion: clock.convention.rendererVersion,
            viewDirection: clock.convention.viewDirection,
            zeroReference: clock.convention.zeroReference,
          },
          configuredEnds: {
            endA: {
              sku: clock.configuredEnds.endA.sku,
              angle: clock.configuredEnds.endA.angle,
            },
            endB: {
              sku: clock.configuredEnds.endB.sku,
              angle: clock.configuredEnds.endB.angle,
            },
          },
        }
      : null,
    protection: protection
      ? {
          code: protection.code,
          publicName: protection.publicName,
          specification: protection.specification,
          recordVersion: protection.recordVersion,
          isNoAdditionalProtection: protection.isNoAdditionalProtection,
          currency: protection.currency,
          referenceBasePriceUsd: protection.referenceBasePriceUsd,
          referenceInstallationPricePerStartedFootUsd:
            protection.referenceInstallationPricePerStartedFootUsd,
          referenceMaterialPricePerFootUsd:
            protection.referenceMaterialPricePerFootUsd,
          referencePriceUsd: protection.referencePriceUsd,
        }
      : null,
    application: application
      ? {
          fluidMedium: application.fluidMedium,
          maximumWorkingPressure: {
            canonicalBar: application.maximumWorkingPressure.canonicalBar,
            originalUnit: application.maximumWorkingPressure.originalUnit,
            originalValue: application.maximumWorkingPressure.originalValue,
          },
          maximumOperatingTemperature: {
            canonicalC: application.maximumOperatingTemperature.canonicalC,
            originalUnit: application.maximumOperatingTemperature.originalUnit,
            originalValue:
              application.maximumOperatingTemperature.originalValue,
          },
          minimumOperatingTemperature: {
            canonicalC: application.minimumOperatingTemperature.canonicalC,
            originalUnit: application.minimumOperatingTemperature.originalUnit,
            originalValue:
              application.minimumOperatingTemperature.originalValue,
          },
        }
      : null,
    referenceEstimate: {
      basis: basis.basis,
      catalogReleaseId: basis.catalogReleaseId,
      currency: basis.currency,
      protectionRecordVersion: basis.protectionRecordVersion,
      scheduleRecordVersion: basis.scheduleRecordVersion,
      assemblyServiceUsd: basis.assemblyServiceUsd,
      ferruleAPriceUsd: basis.ferruleAPriceUsd,
      ferruleBPriceUsd: basis.ferruleBPriceUsd,
      finishedOverallLengthFeet: basis.finishedOverallLengthFeet,
      hoseCutLengthFeet: basis.hoseCutLengthFeet,
      hoseEndAPriceUsd: basis.hoseEndAPriceUsd,
      hoseEndBPriceUsd: basis.hoseEndBPriceUsd,
      hosePricePerFootUsd: basis.hosePricePerFootUsd,
      protectionUsd: basis.protectionUsd,
    },
  };
}

// Never spread transaction/catalog objects into this customer-facing boundary.
export function publicPiLine(line: QuoteRequestLine, price: QuotedLinePrice) {
  if (!line.id || !line.sku || !line.displayName || !line.salesUnit)
    throw new Error("Captured line identity and sales unit required");
  if (
    !["standard", "length_based_hose", "configured_assembly"].includes(
      line.lineKind,
    )
  )
    throw new Error("Unknown PI line kind");
  const totals = quoteLineTotals(line, price);
  if (totals.totalCents === null)
    throw new Error("Complete all final USD prices");
  const length =
    line.lineKind === "length_based_hose" ? line.lengthOrder : null;
  return {
    id: line.id,
    sku: line.sku,
    displayName: line.displayName,
    lineKind: line.lineKind,
    quantity: line.quantity,
    salesUnit: line.salesUnit,
    catalogReleaseId: line.catalogReleaseId,
    reference: { currency: line.currency, unitPrice: line.referenceUnitPrice },
    product: product(line.productSnapshot),
    quotedSpecificationOverrides: (
      (line as ReviewedQuoteLine).quotedSpecificationOverrides ?? []
    ).map(({ label, value }) => ({ label, value })),
    lengthOrder: length
      ? {
          normalizedLengthFt: length.normalizedLengthFt,
          originalLengthUnit: length.originalLengthUnit,
          originalLengthValue: length.originalLengthValue,
          pieceCount: length.pieceCount,
          totalFootage: length.totalFootage,
        }
      : null,
    assembly: line.lineKind === "configured_assembly" ? assembly(line) : null,
    price: {
      unitPriceCents: price.unitPriceCents,
      discountBasisPoints: price.discountBasisPoints,
    },
    totals,
    madeToOrder:
      line.lineKind !== "standard" ||
      line.productSnapshot.offer?.madeToOrder === true,
  };
}
