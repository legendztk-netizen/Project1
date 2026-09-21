import { describe, expect, it } from "vitest";
import {
  createProformaInvoiceSnapshot,
  formatPiDate,
  piValidityDeadline,
  publicPiPaymentInstructions,
  type CreateProformaInvoiceInput,
} from "../app/modules/proforma-invoice/domain/proforma-invoice";
import {
  captureQuoteRequestProductSnapshot,
  type QuoteRequestSnapshot,
} from "../app/modules/quote-request/domain/quote-request";
import { commercialTotals } from "../app/modules/quote-review/domain/quote-commercial-terms";
import { SELLER_LEGAL_NAME } from "../app/modules/seller-settings/domain/seller-commercial-settings";
import { publicHoseFixture } from "./fixtures/public-hose";
import {
  commercialAddress,
  commercialTerms,
} from "./fixtures/quote-commercial";
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

function fixture(): CreateProformaInvoiceInput {
  const product = publicHoseFixture({
    catalogBasis: {
      generation: 4,
      skuRevisionId: "sku-v4",
      seriesRevisionId: "series-v2",
      mediaVersionId: "image-v3",
    },
    specs: [{ label: "Working pressure", value: "250 bar" }],
  });
  const source = {
    version: 2,
    submittedAt: "2026-09-14T08:00:00.000Z",
    destination: commercialAddress,
    acknowledgements: { version: "rfq-ack-v1" },
    amounts: { manualCommercialReview: true },
    importResponsibility: { fulfillmentTerm: "DDP", version: "ddp-v1" },
    purchasingContext: {
      kind: "individual",
      legalName: "Test Buyer",
      tradeName: null,
      countryCode: "US",
      registrationOrTaxId: null,
      primaryContactName: "Test Buyer",
      primaryContactEmail: "test@example.com",
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
        currency: "CNY",
        referenceUnitPrice: 99,
        productSnapshot: captureQuoteRequestProductSnapshot(product),
      },
    ],
  } as unknown as QuoteRequestSnapshot;
  const terms = commercialTerms();
  const prices = [{ unitPriceCents: 1500, discountBasisPoints: 1000 }];
  return {
    documentNumber: "PI-TEST-0001",
    documentVersion: 1,
    issuedAt: "2026-09-14T10:00:00.000Z",
    quoteRevisionId: "revision-a",
    currentQuoteRevisionId: "revision-a",
    revision: {
      version: 1,
      requestId: "rfq-a",
      revisionNumber: 1,
      sourceHash: "captured-source-hash",
      source,
      preparationVersion: 3,
      prices,
      terms,
      totals: commercialTotals(source, prices, terms.charges),
      issuedAt: "2026-09-14T09:00:00.000Z",
      issuedBy: "PRIVATE-ACTOR",
      factoryReviewConfirmed: true,
    },
    seller: {
      id: "seller-1",
      version: 1,
      legalName: SELLER_LEGAL_NAME,
      registeredAddressEn: "1 Test Road\nHangzhou, Zhejiang, China",
      registeredCountryCode: "CN",
      status: "current",
      createdAt: "2026-09-01T00:00:00.000Z",
      createdBy: "PRIVATE-ACTOR",
      supersededAt: null,
    },
    selectedPaymentChannel: "bank_transfer",
    paymentInstructions: {
      id: "payment-1",
      version: 1,
      channel: "bank_transfer",
      instructions: "TEST ONLY\nUse the quoted document reference.",
      status: "current",
      createdAt: "2026-09-01T00:00:00.000Z",
      createdBy: "PRIVATE-ACTOR",
      supersededAt: null,
    },
    conditions: {
      cancellation: {
        version: "cancel-v1",
        text: "Test cancellation conditions.",
      },
      refund: { version: "refund-v1", text: "Test refund conditions." },
      generalAcknowledgement: {
        version: "general-v1",
        text: "Confirm the quoted specifications and commercial terms.",
      },
      madeToOrderAcknowledgements: [],
    },
  };
}

describe("PI readiness and fixed public snapshots", () => {
  it("rejects a Chinese-only seller address without changing customer identity strings", () => {
    const input = fixture();
    input.seller!.registeredAddressEn =
      "\u4e2d\u56fd\u6d59\u6c5f\u7701\u676d\u5dde\u5e02\u6d4b\u8bd5\u8def1\u53f7";
    input.revision!.source.purchasingContext.legalName = "\u674e\u96f7";
    expect(() => createProformaInvoiceSnapshot(input)).toThrow(
      "Current seller China registered address required",
    );
    input.seller!.registeredAddressEn = fixture().seller!.registeredAddressEn;
    const snapshot = createProformaInvoiceSnapshot(input);
    expect(snapshot.seller.registeredAddressEn).toBe(
      input.seller!.registeredAddressEn,
    );
    expect(snapshot.buyer.legalName).toBe("\u674e\u96f7");
  });
  it("captures exact source versions, original currencies, specifications, prices and charges", () => {
    const input = fixture();
    const snapshot = createProformaInvoiceSnapshot(input);
    expect(snapshot.validUntil).toBe("2026-09-28T10:00:00.000Z");
    expect(snapshot.lines[0].reference).toEqual({
      currency: "CNY",
      unitPrice: 99,
    });
    expect(snapshot.lines[0].product.catalogBasis).toEqual({
      generation: 4,
      skuRevisionId: "sku-v4",
      seriesRevisionId: "series-v2",
      mediaVersionId: "image-v3",
    });
    expect(snapshot.lines[0].product.specifications).toEqual(
      input.revision!.source.lines[0].productSnapshot.specs,
    );
    expect(snapshot.terms.charges).toEqual(input.revision!.terms.charges);
    expect(snapshot.totals).toEqual(input.revision!.totals);
    expect(snapshot.quoteRevision).toMatchObject({
      id: "revision-a",
      sourceHash: "captured-source-hash",
      preparationVersion: 3,
      rfqAcknowledgementVersion: "rfq-ack-v1",
    });
    expect(snapshot.seller.registeredAddressEn).toContain("\n");
    input.revision!.source.lines[0].productSnapshot.specs[0].value = "999 bar";
    input.revision!.terms.charges.freight = 99999;
    expect(snapshot.lines[0].product.specifications[0].value).toBe("250 bar");
    expect(snapshot.terms.charges.freight).toBe(2000);
    expect(Object.isFrozen(snapshot.lines[0].product.specifications[0])).toBe(
      true,
    );
    expect(Object.isFrozen(input.revision!.source)).toBe(false);
  });

  const guards: Array<
    [string, (input: CreateProformaInvoiceInput) => void, RegExp]
  > = [
    [
      "missing revision",
      (i) => {
        i.revision = null;
      },
      /Current Quote/,
    ],
    [
      "stale revision",
      (i) => {
        i.currentQuoteRevisionId = "revision-b";
      },
      /Current Quote/,
    ],
    [
      "missing seller",
      (i) => {
        i.seller = null;
      },
      /seller China/,
    ],
    [
      "missing address",
      (i) => {
        i.seller!.registeredAddressEn = "";
      },
      /seller China/,
    ],
    [
      "return address",
      (i) => {
        i.seller!.registeredAddressEn = "542 Haggard, Plano, China";
      },
      /seller China/,
    ],
    [
      "superseded seller",
      (i) => {
        i.seller!.status = "superseded";
      },
      /seller China/,
    ],
    [
      "missing instructions",
      (i) => {
        i.paymentInstructions = null;
      },
      /Payment Instructions/,
    ],
    [
      "superseded instructions",
      (i) => {
        i.paymentInstructions!.status = "superseded";
      },
      /Payment Instructions/,
    ],
    [
      "wrong channel",
      (i) => {
        i.selectedPaymentChannel = "paypal";
      },
      /Payment Instructions/,
    ],
    [
      "placeholder instructions",
      (i) => {
        i.paymentInstructions!.instructions = "REPLACE WITH account";
      },
      /Payment Instructions/,
    ],
    [
      "tax treatment",
      (i) => {
        i.revision!.terms.taxTreatment = "" as never;
      },
      /tax treatment/,
    ],
    [
      "tax evidence",
      (i) => {
        i.revision!.terms.taxTreatment = "Exempt";
      },
      /evidence/,
    ],
    [
      "missing price",
      (i) => {
        i.revision!.prices[0].unitPriceCents = null;
      },
      /prices/,
    ],
    [
      "negative charge",
      (i) => {
        i.revision!.terms.charges.freight = -1;
      },
      /freight/,
    ],
    [
      "currency review",
      (i) => {
        i.revision!.terms.manualCurrencyConfirmed = false;
      },
      /manual USD/,
    ],
    [
      "freight review",
      (i) => {
        i.revision!.terms.freightReviewConfirmed = false;
      },
      /freight review/,
    ],
    [
      "lead time",
      (i) => {
        i.revision!.terms.leadTime = "";
      },
      /lead time/,
    ],
    [
      "named place",
      (i) => {
        i.revision!.terms.namedPlace = "";
      },
      /Named place/,
    ],
    [
      "address confirmation",
      (i) => {
        i.revision!.terms.addressConfirmed = false;
      },
      /address/,
    ],
    [
      "inconsistent total",
      (i) => {
        i.revision!.totals.totalCents++;
      },
      /totals/,
    ],
    [
      "missing cancellation",
      (i) => {
        i.conditions.cancellation.version = "";
      },
      /Cancellation/,
    ],
    [
      "missing refund",
      (i) => {
        i.conditions.refund.text = "";
      },
      /Refund/,
    ],
    [
      "missing acknowledgement",
      (i) => {
        i.conditions.generalAcknowledgement.version = "";
      },
      /acknowledgement/,
    ],
    [
      "document version",
      (i) => {
        i.documentVersion = 0;
      },
      /version/,
    ],
    [
      "PI before revision",
      (i) => {
        i.issuedAt = "2026-09-14T08:00:00.000Z";
      },
      /precede/,
    ],
  ];
  it.each(guards)("rejects %s", (_, change, error) => {
    const input = fixture();
    change(input);
    expect(() => createProformaInvoiceSnapshot(input)).toThrow(error);
  });

  it("checks technical confirmation for approved specification amendments", () => {
    const input = fixture();
    Object.assign(input.revision!.source.lines[0], {
      quotedSpecificationOverrides: [{ label: "Marking", value: "Batch 17" }],
    });
    input.revision!.factoryReviewConfirmed = false;
    expect(() => createProformaInvoiceSnapshot(input)).toThrow(/factory/);
    input.revision!.factoryReviewConfirmed = true;
    expect(
      createProformaInvoiceSnapshot(input).lines[0]
        .quotedSpecificationOverrides[0].value,
    ).toBe("Batch 17");
  });

  it("strips nested private metadata and keeps payment text out of the immutable snapshot", () => {
    const input = fixture();
    const revision = input.revision!;
    revision.terms.taxTreatment = "Exempt";
    revision.terms.taxEvidenceId = "PRIVATE-TAX";
    revision.terms.packingEstimate = "PRIVATE-PACKING";
    revision.terms.addressReplacementReason = "PRIVATE-REASON";
    Object.assign(revision, {
      internalNotes: "PRIVATE-NOTE",
      costBasis: "PRIVATE-COST",
    });
    Object.assign(revision.source.lines[0].productSnapshot.offer!, {
      costBasis: "PRIVATE-NESTED-COST",
    });
    Object.assign(revision.source.lines[0].productSnapshot.specs[0], {
      privateEvidence: "PRIVATE-EVIDENCE",
    });
    const before = createProformaInvoiceSnapshot(input);
    expect(JSON.stringify(before)).not.toMatch(
      /PRIVATE|taxEvidenceId|packingEstimate|instructions"/,
    );
    input.paymentInstructions!.instructions =
      "Updated separately\nDo not put this into the fixed PDF.";
    expect(createProformaInvoiceSnapshot(input)).toEqual(before);
    expect(
      publicPiPaymentInstructions(input.paymentInstructions, "bank_transfer")
        .instructions,
    ).toContain("Updated separately");
    expect(
      JSON.stringify(
        publicPiPaymentInstructions(input.paymentInstructions, "bank_transfer"),
      ),
    ).not.toContain("PRIVATE");
  });

  it("retains exact footage and requires a line-scoped made-to-order acknowledgement", () => {
    const input = fixture(),
      revision = input.revision!;
    Object.assign(revision.source.lines[0], {
      lineKind: "length_based_hose",
      quantity: 3,
      salesUnit: "ft",
      lengthOrder: {
        normalizedLengthFt: 2.5,
        originalLengthUnit: "ft",
        originalLengthValue: 2.5,
        pieceCount: 3,
        totalFootage: 7.5,
      },
    });
    revision.totals = commercialTotals(
      revision.source,
      revision.prices,
      revision.terms.charges,
    );
    expect(() => createProformaInvoiceSnapshot(input)).toThrow(/made-to-order/);
    input.conditions.madeToOrderAcknowledgements = [
      { lineId: "line-a", version: "mto-v2", text: "Confirm cut lengths." },
    ];
    const snapshot = createProformaInvoiceSnapshot(input);
    expect(snapshot.lines[0].totals.quantity).toBe(7.5);
    expect(snapshot.lines[0].lengthOrder?.pieceCount).toBe(3);
    input.conditions.madeToOrderAcknowledgements.push(
      input.conditions.madeToOrderAcknowledgements[0],
    );
    expect(() => createProformaInvoiceSnapshot(input)).toThrow(
      /Each made-to-order/,
    );
  });

  it("preserves assembly ends, ferrules, measurement, tolerances and rule versions without review notes", () => {
    const input = fixture(),
      revision = input.revision!;
    let configuration = createHoseConfigurationDraft(publicHoseFixture())!;
    configuration = attachEndBToDraft(
      attachEndAToDraft(configuration, compatibleEndAFixture()),
      compatibleEndAFixture(),
    );
    const length = evaluateFinishedAssemblyLength({
      hasBothEnds: true,
      requestedTighterTolerance: false,
      unit: "in",
      value: "30",
    });
    if (!length.valid) throw new Error("Fixture length invalid");
    configuration.finishedLength = length.length;
    configuration.measurementSelection = selectMeasurementNotSure();
    Object.assign(configuration, { internalNotes: "PRIVATE-ASSEMBLY" });
    Object.assign(revision.source.lines[0], {
      lineKind: "configured_assembly",
      configuredAssembly: {
        snapshot: {
          configuration,
          review: {
            outcome: "technical_review",
            issues: [{ message: "PRIVATE-REVIEW" }],
          },
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
    input.conditions.madeToOrderAcknowledgements = [
      {
        lineId: "line-a",
        version: "assembly-ack-v1",
        text: "Confirm exact assembly specifications.",
      },
    ];
    revision.factoryReviewConfirmed = false;
    expect(() => createProformaInvoiceSnapshot(input)).toThrow(/factory/);
    revision.factoryReviewConfirmed = true;
    const snapshot = createProformaInvoiceSnapshot(input);
    expect(snapshot.lines[0].assembly?.endA.ferrule.sku).toBe("601R1_1WB_002");
    expect(
      snapshot.lines[0].assembly?.finishedLength.tolerance.scheduleVersion,
    ).toBe("1.0.0");
    expect(
      snapshot.lines[0].assembly?.referenceEstimate.scheduleRecordVersion,
    ).toBe(3);
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
  });
});

describe("PI Eastern calendar deadlines and audience display", () => {
  it.each([
    ["2026-03-01T15:00:00Z", "2026-03-15T14:00:00.000Z"],
    ["2026-10-25T15:00:00Z", "2026-11-08T16:00:00.000Z"],
    ["2026-10-25T04:30:00Z", "2026-11-08T05:30:00.000Z"],
    ["2026-03-01T05:30:00Z", "2026-03-15T04:30:00.000Z"],
    // Compatible disambiguation advances a nonexistent time and chooses the
    // earlier occurrence of a repeated time, without inventing an offset.
    ["2026-02-22T07:30:00Z", "2026-03-08T07:30:00.000Z"],
    ["2026-10-18T05:30:00Z", "2026-11-01T05:30:00.000Z"],
    ["2028-02-20T23:30:00Z", "2028-03-05T23:30:00.000Z"],
    ["2026-12-25T10:00:00Z", "2027-01-08T10:00:00.000Z"],
  ])("adds 14 Eastern calendar days to %s", (issued, expected) =>
    expect(piValidityDeadline(issued)).toBe(expected),
  );
  it("allows an explicit future deadline and rejects invalid, local or nonfuture dates", () => {
    const issued = "2026-09-14T10:00:00.000Z";
    expect(piValidityDeadline(issued, "2026-09-15T10:00:00Z")).toBe(
      "2026-09-15T10:00:00.000Z",
    );
    for (const invalid of [
      issued,
      "2026-09-13T10:00:00Z",
      "2026-02-30T10:00:00Z",
      "2026-09-15",
      "2026-09-15T10:00:00",
      "",
    ])
      expect(() => piValidityDeadline(issued, invalid)).toThrow();
  });
  it("uses Eastern DST and Beijing time for the same stored instant", () => {
    expect(formatPiDate("2026-07-01T12:00:00Z", "customer")).toBe(
      "Jul 1, 2026, 08:00:00 ET",
    );
    expect(formatPiDate("2026-01-01T12:00:00Z", "customer")).toBe(
      "Jan 1, 2026, 07:00:00 ET",
    );
    expect(formatPiDate("2026-07-01T12:00:00Z", "admin")).toBe(
      "2026-07-01 20:00:00 北京时间",
    );
    expect(formatPiDate("2026-01-01T23:30:00Z", "admin")).toBe(
      "2026-01-02 07:30:00 北京时间",
    );
  });
});
