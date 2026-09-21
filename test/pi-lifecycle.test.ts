import { expect, it } from "vitest";
import {
  captureQuoteRequestProductSnapshot,
  type QuoteRequestSnapshot,
} from "../app/modules/quote-request/domain/quote-request";
import type { QuoteRevisionSnapshot } from "../app/modules/quote-review/domain/quote-revision";
import { commercialTotals } from "../app/modules/quote-review/domain/quote-commercial-terms";
import {
  comparePiQuoteMaterial,
  planPiReplacement,
  publicPiLifecycle,
  type PiLifecycleRecord,
  type PiReplacementContext,
  type PiReplacementCommand,
  type PiReplacementReasonCode,
} from "../app/modules/proforma-invoice/domain/pi-lifecycle";
import { conditionsForQuote } from "../app/modules/proforma-invoice/domain/pi-policy";
import { commercialTerms } from "./fixtures/quote-commercial";
import { publicHoseFixture } from "./fixtures/public-hose";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../app/modules/configurator/domain/compatible-end-a";
import {
  evaluateFinishedAssemblyLength,
  selectMeasurementNotSure,
} from "../app/modules/configurator/domain/finished-assembly-length";

function quote(): QuoteRevisionSnapshot {
  const product = publicHoseFixture();
  const source = {
    destination: structuredClone(commercialTerms().destination),
    importResponsibility: { fulfillmentTerm: "DDP", version: "captured" },
    amounts: { manualCommercialReview: true },
    purchasingContext: {
      kind: "individual",
      legalName: "Buyer",
      countryCode: "US",
      registrationOrTaxId: null,
      primaryContactName: "Buyer",
      primaryContactEmail: "buyer@example.test",
    },
    lines: [
      {
        id: "line-a",
        sku: product.sku,
        displayName: product.displayName,
        lineKind: "standard",
        quantity: 2,
        salesUnit: "EA",
        catalogReleaseId: product.releaseId,
        currency: "USD",
        referenceUnitPrice: 10,
        productSnapshot: captureQuoteRequestProductSnapshot(product),
      },
    ],
  } as unknown as QuoteRequestSnapshot;
  const terms = commercialTerms();
  const prices = [{ unitPriceCents: 1500, discountBasisPoints: 0 }];
  return {
    version: 1,
    requestId: "rfq",
    sourceHash: "original",
    source,
    preparationVersion: 1,
    revisionNumber: 1,
    prices,
    terms,
    totals: commercialTotals(source, prices, terms.charges),
    issuedAt: "2026-09-14T09:00:00.000Z",
    issuedBy: "private-admin",
    factoryReviewConfirmed: true,
  };
}
function setup(
  accepted = true,
  mutate: (q: QuoteRevisionSnapshot) => void = (q) => {
    q.terms.charges.freight += 100;
  },
) {
  const previous = quote(),
    next = structuredClone(previous);
  next.revisionNumber = 2;
  next.issuedAt = "2026-09-15T09:00:00.000Z";
  mutate(next);
  next.totals = commercialTotals(next.source, next.prices, next.terms.charges);
  const target = {
    piId: "pi1",
    documentVersion: 1,
    snapshotHash: "a".repeat(64),
  };
  const pi: PiLifecycleRecord = {
    ...target,
    requestId: "rfq",
    quoteRevisionId: "q1",
    totalCents: previous.totals.totalCents,
    issuedAt: "2026-09-14T10:00:00.000Z",
    validUntil: "2026-09-28T10:00:00.000Z",
    acceptance: accepted
      ? { ...target, id: "accept1", acceptedAt: "2026-09-14T11:00:00.000Z" }
      : null,
    supersededAt: null,
    supersededByPiId: null,
  };
  const context: PiReplacementContext = {
    pi,
    head: { piId: "pi1", version: 1 },
    previousQuote: { id: "q1", snapshot: previous },
    nextQuote: { id: "q2", snapshot: next },
    currentQuoteRevisionId: "q2",
    now: "2026-09-15T10:00:00.000Z",
  };
  const command: PiReplacementCommand = {
    expectedPi: target,
    expectedHeadVersion: 1,
    expectedAcceptanceId: accepted ? "accept1" : null,
    nextQuoteRevisionId: "q2",
    reason: {
      code: "seller_freight_estimate_error",
      customerRequested: false,
      customerDataAccurate: true,
      explanation: "Reviewed carrier correction",
      evidenceIds: ["private-evidence"],
    },
  };
  return { context, command };
}

it.each([
  "seller_packing_estimate_error",
  "seller_freight_estimate_error",
  "seller_ddp_duty_estimate_error",
  "seller_import_tax_estimate_error",
  "lower_actual_seller_cost",
] satisfies PiReplacementReasonCode[])(
  "locks accepted total for %s in both directions",
  (code) => {
    for (const delta of [-100, 100]) {
      const { context, command } = setup(true, (q) => {
        q.terms.charges.freight += delta;
      });
      command.reason.code = code;
      expect(planPiReplacement(context, command)).toMatchObject({
        decision: "accepted_total_locked",
        replacement: null,
        automaticRefundCents: 0,
        acceptedTotalCents: context.pi.totalCents,
      });
    }
  },
);
it("does not allow a generic seller reason to hide a freight overrun", () => {
  const { context, command } = setup();
  command.reason.code = "seller_requested_change";
  expect(planPiReplacement(context, command).decision).toBe(
    "accepted_total_locked",
  );
});
it("does not shift a declared seller estimate error into merchandise prices", () => {
  const { context, command } = setup(true, (q) => {
    q.prices[0].unitPriceCents! += 100;
  });
  expect(planPiReplacement(context, command).decision).toBe(
    "accepted_total_locked",
  );
});
it("records lower actual costs without refund or replacement", () => {
  const { context, command } = setup(true, (q) => {
    q.terms.actualPacking = "One actual carton";
  });
  command.reason.code = "lower_actual_seller_cost";
  expect(planPiReplacement(context, command)).toMatchObject({
    decision: "record_actual_cost_only",
    automaticRefundCents: 0,
    replacement: null,
  });
});
it.each([
  [
    "products",
    (q: QuoteRevisionSnapshot) => {
      q.source.lines[0].sku = "replacement";
    },
  ],
  [
    "quantities",
    (q: QuoteRevisionSnapshot) => {
      q.source.lines[0].quantity++;
    },
  ],
  [
    "specifications",
    (q: QuoteRevisionSnapshot) => {
      q.source.lines[0].productSnapshot.specs.push({
        label: "Pressure",
        value: "250 bar",
      });
    },
  ],
  [
    "destination",
    (q: QuoteRevisionSnapshot) => {
      q.terms.destination.addressLine1 = "2 Other Street";
      q.terms.addressReplacementReason = "Customer move";
    },
  ],
  [
    "transport",
    (q: QuoteRevisionSnapshot) => {
      q.terms.transportMethod = "Sea freight";
    },
  ],
  [
    "prices_discounts",
    (q: QuoteRevisionSnapshot) => {
      q.prices[0].discountBasisPoints = 100;
    },
  ],
  [
    "lead_time",
    (q: QuoteRevisionSnapshot) => {
      q.terms.leadTime = "30 days after cleared payment";
    },
  ],
  [
    "other_fees",
    (q: QuoteRevisionSnapshot) => {
      q.terms.charges.insurance++;
    },
  ],
] as const)(
  "requires new acceptance for requested %s change",
  (field, mutate) => {
    const { context, command } = setup(true, mutate);
    command.reason.code = "customer_requested_change";
    command.reason.customerRequested = true;
    const before = JSON.stringify(context);
    const result = planPiReplacement(context, command);
    expect(result.material.changes).toContain(field);
    expect(result).toMatchObject({
      decision: "replacement_required",
      automaticRefundCents: 0,
      replacement: {
        nextDocumentVersion: 2,
        quoteRevisionId: "q2",
        carryAcceptance: false,
        requiresRenewedAcceptance: true,
        preserveHistoricalArtifacts: true,
        expectedHeadVersion: 1,
        expectedAcceptanceId: "accept1",
      },
    });
    expect(JSON.stringify(context)).toBe(before);
    expect(Object.isFrozen(result.replacement)).toBe(true);
  },
);
it("requires renewed acceptance for customer-requested freight even with unchanged quantity", () => {
  const { context, command } = setup();
  command.reason.code = "customer_requested_change";
  command.reason.customerRequested = true;
  expect(planPiReplacement(context, command).decision).toBe(
    "replacement_required",
  );
});
it("allows evidenced inaccurate customer-data correction", () => {
  const { context, command } = setup();
  command.reason.code = "customer_data_correction";
  command.reason.customerDataAccurate = false;
  expect(planPiReplacement(context, command).decision).toBe(
    "replacement_required",
  );
});
it("ignores line reorder with its price, internal packing and catalog reference-price drift", () => {
  const before = quote();
  before.source.lines.push({
    ...structuredClone(before.source.lines[0]),
    id: "line-b",
  });
  before.prices.push({ unitPriceCents: 2000, discountBasisPoints: 0 });
  before.totals = commercialTotals(
    before.source,
    before.prices,
    before.terms.charges,
  );
  const after = structuredClone(before);
  after.source.lines.reverse();
  after.prices.reverse();
  after.source.lines[0].referenceUnitPrice = 999;
  after.terms.actualPacking = "Private actual cost evidence";
  after.terms.destination.label = "Renamed";
  after.terms.addressReplacementReason = "Label only";
  expect(comparePiQuoteMaterial(before, after).changes).toEqual([]);
  after.prices.reverse();
  after.totals = commercialTotals(
    after.source,
    after.prices,
    after.terms.charges,
  );
  expect(comparePiQuoteMaterial(before, after).changes).toContain(
    "prices_discounts",
  );
});
it("rejects wrong source and inconsistent stored totals", () => {
  const a = quote(),
    b = structuredClone(a);
  b.sourceHash = "other";
  expect(() => comparePiQuoteMaterial(a, b)).toThrow();
  b.sourceHash = a.sourceHash;
  b.totals.totalCents++;
  expect(() => comparePiQuoteMaterial(a, b)).toThrow();
});

it("compares captured assembly ends and ferrules and enforces technical confirmation", () => {
  const before = quote();
  const configuration = attachEndBToDraft(
    attachEndAToDraft(
      createHoseConfigurationDraft(publicHoseFixture())!,
      compatibleEndAFixture(),
    ),
    compatibleEndAFixture(),
  );
  const length = evaluateFinishedAssemblyLength({
    hasBothEnds: true,
    requestedTighterTolerance: false,
    unit: "in",
    value: "30",
  });
  if (!length.valid) throw new Error("Invalid fixture length");
  configuration.finishedLength = length.length;
  configuration.measurementSelection = selectMeasurementNotSure();
  Object.assign(before.source.lines[0], {
    lineKind: "configured_assembly",
    configuredAssembly: {
      snapshot: {
        configuration,
        review: { outcome: "technical_review", issues: [] },
        sourceCatalogRelease: { id: "release-002", number: "CAT-002" },
      },
      estimateBasis: {
        basis: "versioned_reference_inputs",
        catalogReleaseId: "release-002",
        currency: "USD",
        scheduleRecordVersion: 3,
        protectionRecordVersion: 4,
        assemblyServiceUsd: 2,
        ferruleAPriceUsd: 1,
        ferruleBPriceUsd: 1,
        finishedOverallLengthFeet: 2.5,
        hoseCutLengthFeet: 2.25,
        hoseEndAPriceUsd: 3,
        hoseEndBPriceUsd: 3,
        hosePricePerFootUsd: 1.25,
        protectionUsd: 0,
      },
    },
  });
  before.totals = commercialTotals(
    before.source,
    before.prices,
    before.terms.charges,
  );
  const after = structuredClone(before);
  const line = after.source.lines[0];
  if (line.lineKind !== "configured_assembly")
    throw new Error("Invalid fixture kind");
  line.configuredAssembly.estimateBasis.hoseEndAPriceUsd = 999;
  expect(comparePiQuoteMaterial(before, after).changes).toEqual([]);
  line.configuredAssembly.snapshot.configuration.endA!.ferrule.sku =
    "replacement-ferrule";
  expect(comparePiQuoteMaterial(before, after).changes).toContain(
    "specifications",
  );
  after.factoryReviewConfirmed = false;
  expect(() => comparePiQuoteMaterial(before, after)).toThrow(/factory/);
});
it.each(["head", "hash", "acceptance", "currentQuote", "currentPi"])(
  "rejects stale %s optimistic evidence",
  (field) => {
    const { context, command } = setup(false);
    if (field === "head") context.head.version++;
    if (field === "hash") context.pi.snapshotHash = "b".repeat(64);
    if (field === "acceptance")
      context.pi.acceptance = {
        ...command.expectedPi,
        id: "concurrent",
        acceptedAt: "2026-09-14T11:00:00.000Z",
      };
    if (field === "currentQuote") context.currentQuoteRevisionId = "q3";
    if (field === "currentPi") context.head.piId = "pi2";
    expect(() => planPiReplacement(context, command)).toThrow(/reload/);
  },
);
it("requires explicit consistent reviewed reason and evidence", () => {
  const { context, command } = setup();
  command.reason.evidenceIds = [];
  expect(() => planPiReplacement(context, command)).toThrow();
  command.reason.evidenceIds = ["evidence"];
  command.reason.customerRequested = true;
  expect(() => planPiReplacement(context, command)).toThrow(/contradicts/);
});
it("expires at exact stored UTC deadline, but never expires accepted PI", () => {
  const { context } = setup(false);
  const view = {
    currentPiId: "pi1",
    currentQuoteRevisionId: "q1",
    now: "2026-09-28T09:59:59.999Z",
  };
  expect(publicPiLifecycle(context.pi, view)).toMatchObject({
    state: "current",
    canAccept: true,
  });
  view.now = context.pi.validUntil;
  expect(publicPiLifecycle(context.pi, view)).toMatchObject({
    state: "expired",
    canAccept: false,
    canView: true,
    canDownload: true,
  });
  expect(publicPiLifecycle(setup(true).context.pi, view).state).toBe(
    "accepted",
  );
});
it("supersedes accepted history and blocks acceptance when quote advances", () => {
  const { context } = setup();
  const view = {
    currentPiId: "pi2",
    currentQuoteRevisionId: "q2",
    now: context.now,
  };
  expect(publicPiLifecycle(context.pi, view)).toMatchObject({
    state: "superseded",
    canAccept: false,
  });
  const pending = publicPiLifecycle(setup(false).context.pi, {
    ...view,
    currentPiId: "pi1",
  });
  expect(pending).toMatchObject({
    state: "current",
    awaitingReplacement: true,
    canAccept: false,
  });
  expect(JSON.stringify(pending)).not.toMatch(
    /private|snapshotHash|Customs|review/,
  );
});
it("rejects non-UTC timestamps, late acceptance and incomplete supersession", () => {
  const { context } = setup();
  const view = {
    currentPiId: "pi1",
    currentQuoteRevisionId: "q1",
    now: context.now,
  };
  expect(() =>
    publicPiLifecycle(context.pi, {
      ...view,
      now: "2026-09-15T10:00:00+00:00",
    }),
  ).toThrow();
  context.pi.acceptance!.acceptedAt = context.pi.validUntil;
  expect(() =>
    publicPiLifecycle(context.pi, { ...view, now: context.pi.validUntil }),
  ).toThrow();
  context.pi.acceptance = null;
  context.pi.supersededByPiId = "pi2";
  expect(() => publicPiLifecycle(context.pi, view)).toThrow();
});
it("keeps same-basis revisions a no-op", () => {
  const { context, command } = setup(false, () => {});
  expect(planPiReplacement(context, command)).toMatchObject({
    decision: "no_material_change",
    replacement: null,
  });
});

it("requires replacement for customer shipment-plan changes", () => {
  const { context, command } = setup(true, (q) => {
    q.terms.shipmentMode = "split";
    q.terms.splitPlan = "Line a: two separately quoted dispatches";
  });
  command.reason.code = "customer_requested_change";
  command.reason.customerRequested = true;
  const result = planPiReplacement(context, command);
  expect(result.decision).toBe("replacement_required");
  expect(result.material.shipmentPlanUnchanged).toBe(false);
});

it("keeps US sales tax separate from fixed DDP import estimates", () => {
  const { context, command } = setup(true, (q) => {
    q.terms.taxTreatment = "Collected";
    q.terms.charges.salesTax = 100;
  });
  command.reason.code = "seller_requested_change";
  expect(planPiReplacement(context, command).decision).toBe(
    "replacement_required",
  );
  for (const q of [
    context.previousQuote.snapshot,
    context.nextQuote.snapshot,
  ]) {
    q.terms.incoterm = "DAP";
    q.terms.termReplacementReason = "Reviewed DAP request";
  }
  command.reason.code = "seller_ddp_duty_estimate_error";
  expect(() => planPiReplacement(context, command)).toThrow(/DDP/);
});

it("can replace an expired unaccepted PI without transferring history or acceptance", () => {
  const { context, command } = setup(false);
  context.now = "2026-09-29T10:00:00.000Z";
  expect(planPiReplacement(context, command)).toMatchObject({
    decision: "replacement_required",
    replacement: {
      carryAcceptance: false,
      expectedAcceptanceId: null,
      preserveHistoricalArtifacts: true,
    },
  });
});

it("rejects an older successor and missing manual USD review", () => {
  const { context, command } = setup(false);
  context.nextQuote.snapshot.revisionNumber = 1;
  expect(() => planPiReplacement(context, command)).toThrow(/newer/);
  context.nextQuote.snapshot.revisionNumber = 2;
  context.nextQuote.snapshot.terms.manualCurrencyConfirmed = false;
  expect(() => planPiReplacement(context, command)).toThrow();
});

it("selects versioned policy acknowledgements per standard, cut, assembly and made-to-order offer", () => {
  const revision = quote();
  const standard = revision.source.lines[0];
  revision.source.lines = [
    standard,
    { ...structuredClone(standard), id: "cut", lineKind: "length_based_hose" },
    {
      ...structuredClone(standard),
      id: "assembly",
      lineKind: "configured_assembly",
    },
    { ...structuredClone(standard), id: "custom" },
  ] as QuoteRequestSnapshot["lines"];
  revision.source.lines[3].productSnapshot.offer = {
    ...publicHoseFixture().offer!,
    madeToOrder: true,
  };
  const result = conditionsForQuote(revision);
  expect(result.madeToOrderAcknowledgements.map((a) => a.lineId)).toEqual([
    "cut",
    "assembly",
    "custom",
  ]);
  for (const policy of [
    result.cancellation,
    result.refund,
    result.generalAcknowledgement,
    ...result.madeToOrderAcknowledgements,
  ]) {
    expect(policy.version).toMatch(/^pi-.+-v1$/);
    expect(policy.text.length).toBeGreaterThan(30);
  }
  expect(result.cancellation.text).toContain("before cutting begins");
  expect(result.refund.text).toContain("No restocking fee");
});
it("policy resolution leaves frozen source immutable and returns independent snapshots", () => {
  const revision = quote();
  revision.source.lines[0].productSnapshot.offer = {
    ...publicHoseFixture().offer!,
    madeToOrder: true,
  };
  const original = JSON.stringify(revision);
  const deepFreeze = (value: object) => {
    Object.values(value).forEach((v) => {
      if (v && typeof v === "object") deepFreeze(v);
    });
    Object.freeze(value);
  };
  deepFreeze(revision);
  const first = conditionsForQuote(revision),
    second = conditionsForQuote(revision);
  first.cancellation.text = "mutated";
  first.refund.version = "mutated";
  first.generalAcknowledgement.text = "mutated";
  first.madeToOrderAcknowledgements[0].lineId = "mutated";
  expect(conditionsForQuote(revision)).toEqual(second);
  expect(JSON.stringify(revision)).toBe(original);
});
