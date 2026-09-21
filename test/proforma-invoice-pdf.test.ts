import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, expect, it } from "vitest";
import {
  createProformaInvoiceSnapshot,
  piSha256,
  type CreateProformaInvoiceInput,
} from "../app/modules/proforma-invoice/domain/proforma-invoice";
import {
  proformaInvoicePdfContent,
  renderProformaInvoicePdf,
} from "../app/modules/proforma-invoice/domain/proforma-invoice-pdf";
import {
  PI_NOTO_SANS_FONT,
  piUnicodeFonts,
  selectPiFontAssets,
} from "../app/modules/proforma-invoice/domain/pi-unicode-font";
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

const directory = mkdtempSync(join(tmpdir(), "pi-pdf-test-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const python = process.env.PI_PDF_PYTHON ?? "python3";
const canExtract =
  spawnSync(python, ["-c", "import pypdf"], { encoding: "utf8" }).status === 0;
const acceptance = process.env.PI_PDF_ACCEPTANCE === "1";
if (acceptance && !canExtract)
  throw new Error("PI PDF acceptance requires Python with pypdf");

function assertRenderedPages(path: string, pageCount: number) {
  if (!acceptance) return;
  const rendered = spawnSync(
    python,
    ["test/fixtures/check-pi-pdf-render.py", path],
    { encoding: "utf8" },
  );
  expect(rendered.status, rendered.stderr).toBe(0);
  expect(JSON.parse(rendered.stdout)).toHaveLength(pageCount);
}

function unicodeFonts(
  snapshot: ReturnType<typeof createProformaInvoiceSnapshot>,
  loaded?: string[],
) {
  const require = createRequire(import.meta.url);
  const fontkit = require(
    process.env.PI_PDF_FONTKIT_MODULE ?? "@pdf-lib/fontkit",
  ) as Parameters<PDFDocument["registerFontkit"]>[0];
  return piUnicodeFonts({
    fontkit,
    snapshot,
    loadFont: async (asset) => {
      loaded?.push(asset.filename);
      return readFileSync(
        new URL(
          `../app/modules/proforma-invoice/domain/fonts/${asset.filename === PI_NOTO_SANS_FONT.filename ? "" : "chunks/"}${asset.filename}`,
          import.meta.url,
        ),
      );
    },
  });
}

function multilingualFixture() {
  const input = fixture();
  input.seller!.registeredAddressEn =
    "\u676d\u5dde\u5e02\u6d4b\u8bd5\u8def1\u53f7\nHangzhou, Zhejiang, China";
  const source = input.revision!.source;
  source.purchasingContext.legalName =
    "\u674e\u96f7 / \u9673\u7f8e\u73b2 / \u5c71\u7530\u592a\u90ce / \uae40\ubbfc\uc900";
  source.purchasingContext.primaryContactName =
    "Jos\u00e9 M\u00fcller / \u0141ukasz / \u0418\u0432\u0430\u043d \u041f\u0435\u0442\u0440\u043e\u0432 / \u039d\u03af\u03ba\u03bf\u03c2";
  input.revision!.terms.destination.recipientName =
    source.purchasingContext.legalName;
  input.revision!.terms.destination.addressLine1 =
    "\u6771\u4eac\u90fd\u65b0\u5bbf\u533a 1-2-3";
  input.revision!.terms.addressReplacementReason =
    "Confirmed multilingual destination";
  input.conditions.refund.text = Array.from(
    { length: 30 },
    (_, i) =>
      `Clause ${i + 1}: \u8bf7\u6838\u5bf9\u59d3\u540d\u548c\u5730\u5740\uff0c\u539f\u6587\u4fdd\u7559\u3002`,
  ).join("\n");
  return input;
}

function fixture(): CreateProformaInvoiceInput {
  const product = publicHoseFixture({
    specs: [
      {
        label: "Approved specification",
        value: "250 bar; 1/4 in; plated finish",
      },
    ],
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
        displayName: "TEST ONLY Hydraulic Hose",
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
      sourceHash: "test-source-hash",
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
      instructions: "SEPARATE-PAYMENT-TEXT\nNot a real payment account.",
      status: "current",
      createdAt: "2026-09-01T00:00:00.000Z",
      createdBy: "PRIVATE-ACTOR",
      supersededAt: null,
    },
    conditions: {
      cancellation: {
        version: "cancel-v1",
        text: "Test cancellation conditions.\nNo production or real payments.",
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

it("renders deterministic authoritative bytes and hash independent of the wall clock", async () => {
  const snapshot = createProformaInvoiceSnapshot(fixture());
  const first = await renderProformaInvoicePdf(snapshot);
  const second = await renderProformaInvoicePdf(snapshot);
  expect(first.bytes).toEqual(second.bytes);
  expect(first.sha256).toBe(await piSha256(first.bytes));
  const parsed = await PDFDocument.load(first.bytes, { updateMetadata: false });
  expect(parsed.getTitle()).toBe("PI-TEST-0001 / 1");
  expect(parsed.getCreationDate()?.toISOString()).toBe(snapshot.issuedAt);
  expect(parsed.getModificationDate()?.toISOString()).toBe(snapshot.issuedAt);
  expect(parsed.getPageCount()).toBe(first.pageCount);
  const changed = fixture();
  changed.documentVersion = 2;
  expect(
    (await renderProformaInvoicePdf(createProformaInvoiceSnapshot(changed)))
      .sha256,
  ).not.toBe(first.sha256);
});

it("paginates multiline content and unbroken long identifiers without dropping the final term", async () => {
  const input = fixture();
  input.conditions.refund.text =
    Array.from(
      { length: 110 },
      (_, index) =>
        `Clause ${index + 1}: Test-only refund condition with a multiline explanation.`,
    ).join("\n") +
    "\n" +
    "X".repeat(450) +
    "\nFINAL-REFUND-CLAUSE";
  Object.assign(input.revision!, {
    internalNotes: "PRIVATE-NOTES",
    costBasis: "PRIVATE-COST",
  });
  input.revision!.terms.taxTreatment = "Exempt";
  input.revision!.terms.taxEvidenceId = "PRIVATE-EVIDENCE";
  const snapshot = createProformaInvoiceSnapshot(input);
  const rendered = await renderProformaInvoicePdf(snapshot);
  expect(rendered.pageCount).toBeGreaterThan(3);
  const parsed = await PDFDocument.load(rendered.bytes);
  for (const page of parsed.getPages()) {
    expect(page.getWidth()).toBeCloseTo(595.28);
    expect(page.getHeight()).toBeCloseTo(841.89);
  }
  const content = proformaInvoicePdfContent(snapshot)
    .map((block) => block.text)
    .join("\n");
  expect(content).toContain("FINAL-REFUND-CLAUSE");
  expect(content).not.toMatch(/PRIVATE|SEPARATE-PAYMENT-TEXT/);
  if (process.env.PI_TEST_PDF_PATH)
    writeFileSync(process.env.PI_TEST_PDF_PATH, rendered.bytes);
});

it("fails closed for unsupported font characters instead of silently altering specifications", async () => {
  const input = fixture();
  input.revision!.source.lines[0].productSnapshot.specs[0].value =
    "\u4e2d\u6587";
  await expect(
    renderProformaInvoicePdf(createProformaInvoiceSnapshot(input)),
  ).rejects.toThrow(/embedded Unicode font/);
});

it("embeds licensed multilingual fonts deterministically and preserves original identity values", async () => {
  const snapshot = createProformaInvoiceSnapshot(multilingualFixture());
  const loaded: string[] = [];
  const first = await renderProformaInvoicePdf(
    snapshot,
    unicodeFonts(snapshot, loaded),
  );
  const second = await renderProformaInvoicePdf(
    snapshot,
    unicodeFonts(snapshot),
  );
  expect(first.bytes).toEqual(second.bytes);
  expect(first.fontSha256s).toEqual(
    selectPiFontAssets(snapshot).map((asset) => asset.sha256),
  );
  expect(loaded).toEqual(
    selectPiFontAssets(snapshot).map((asset) => asset.filename),
  );
  expect(first.bytes.length).toBeLessThan(2000000);
  expect((await PDFDocument.load(first.bytes)).getPageCount()).toBeGreaterThan(
    1,
  );
  expect(snapshot.seller.registeredAddressEn).toContain("\u676d\u5dde\u5e02");
  if (process.env.PI_TEST_UNICODE_PDF_PATH)
    writeFileSync(process.env.PI_TEST_UNICODE_PDF_PATH, first.bytes);
}, 30000);

it("loads only Noto Sans for a Latin document", async () => {
  const snapshot = createProformaInvoiceSnapshot(fixture());
  const loaded: string[] = [];
  const pdf = await renderProformaInvoicePdf(
    snapshot,
    unicodeFonts(snapshot, loaded),
  );
  expect(loaded).toEqual([PI_NOTO_SANS_FONT.filename]);
  expect(pdf.bytes.length).toBeLessThan(500000);
});

it("selected font files contain every requested printable glyph", () => {
  const snapshot = createProformaInvoiceSnapshot(multilingualFixture());
  const fontkit = createRequire(import.meta.url)("@pdf-lib/fontkit") as {
    create(bytes: Uint8Array): { characterSet: number[] };
  };
  const coverage = new Set<number>();
  for (const asset of selectPiFontAssets(snapshot)) {
    const bytes = readFileSync(
      new URL(
        `../app/modules/proforma-invoice/domain/fonts/${asset.filename === PI_NOTO_SANS_FONT.filename ? "" : "chunks/"}${asset.filename}`,
        import.meta.url,
      ),
    );
    for (const point of fontkit.create(bytes).characterSet) coverage.add(point);
  }
  for (const block of proformaInvoicePdfContent(snapshot)) {
    for (const character of block.text) {
      if (!"\r\n\t".includes(character))
        expect(coverage.has(character.codePointAt(0)!)).toBe(true);
    }
  }
});

it("rejects a genuine missing glyph instead of embedding a notdef square", async () => {
  const input = multilingualFixture();
  input.revision!.source.purchasingContext.primaryContactName = "\u{13000}";
  expect(() => unicodeFonts(createProformaInvoiceSnapshot(input))).toThrow(
    /U\+13000/,
  );
});

it("checks pinned font bytes before embedding", async () => {
  const fontkit = createRequire(import.meta.url)(
    process.env.PI_PDF_FONTKIT_MODULE ?? "@pdf-lib/fontkit",
  ) as Parameters<PDFDocument["registerFontkit"]>[0];
  await expect(
    renderProformaInvoicePdf(
      createProformaInvoiceSnapshot(fixture()),
      piUnicodeFonts({
        fontkit,
        snapshot: createProformaInvoiceSnapshot(fixture()),
        loadFont: async (asset) => new Uint8Array(asset.byteLength),
      }),
    ),
  ).rejects.toThrow(/checksum/);
});

it.skipIf(!canExtract)(
  "extracts multilingual identities and bilingual seller address exactly from the PDF",
  async () => {
    const snapshot = createProformaInvoiceSnapshot(multilingualFixture());
    const rendered = await renderProformaInvoicePdf(
      snapshot,
      unicodeFonts(snapshot),
    );
    const path = join(directory, "unicode.pdf");
    writeFileSync(path, rendered.bytes);
    assertRenderedPages(path, rendered.pageCount);
    const extracted = spawnSync(
      python,
      [
        "-c",
        "import sys; from pypdf import PdfReader; print('\\n'.join(page.extract_text(extraction_mode='layout') for page in PdfReader(sys.argv[1]).pages))",
        path,
      ],
      { encoding: "utf8" },
    );
    expect(extracted.status, extracted.stderr).toBe(0);
    for (const text of [
      "\u676d\u5dde\u5e02\u6d4b\u8bd5\u8def1\u53f7",
      "\u674e\u96f7",
      "\u9673\u7f8e\u73b2",
      "\u5c71\u7530\u592a\u90ce",
      "\uae40\ubbfc\uc900",
      "Jos\u00e9 M\u00fcller",
      "\u0141ukasz",
      "\u0418\u0432\u0430\u043d \u041f\u0435\u0442\u0440\u043e\u0432",
      "\u039d\u03af\u03ba\u03bf\u03c2",
      "\u6771\u4eac\u90fd\u65b0\u5bbf\u533a",
    ])
      expect(extracted.stdout).toContain(text);
    expect(extracted.stdout).not.toMatch(
      /PRIVATE|SEPARATE-PAYMENT-TEXT|\uFFFD/,
    );
  },
  30000,
);

it.skipIf(!canExtract)(
  "extracts required commercial content, pagination and no private evidence from the actual PDF",
  async () => {
    const input = fixture();
    input.issuedAt = "2026-10-25T04:30:00.000Z";
    input.conditions.refund.text =
      Array.from(
        { length: 80 },
        (_, index) => `Multiline refund clause ${index + 1}.`,
      ).join("\n") + "\nFINAL-REFUND-CLAUSE";
    Object.assign(input.revision!.source.lines[0].productSnapshot, {
      costBasis: "PRIVATE-COST",
    });
    input.revision!.terms.taxTreatment = "Exempt";
    input.revision!.terms.taxEvidenceId = "PRIVATE-EVIDENCE";
    const rendered = await renderProformaInvoicePdf(
      createProformaInvoiceSnapshot(input),
    );
    const path = join(directory, "semantic.pdf");
    writeFileSync(path, rendered.bytes);
    assertRenderedPages(path, rendered.pageCount);
    const extracted = spawnSync(
      python,
      [
        "-c",
        "import sys; from pypdf import PdfReader; print('\\n'.join(page.extract_text() for page in PdfReader(sys.argv[1]).pages))",
        path,
      ],
      { encoding: "utf8" },
    );
    expect(extracted.status, extracted.stderr).toBe(0);
    for (const text of [
      "PROFORMA INVOICE",
      "Issued: Oct 25, 2026, 00:30:00 ET",
      "Valid until: Nov 8, 2026, 00:30:00 ET",
      "UTC 2026-11-08T05:30:00.000Z",
      "PI-TEST-0001",
      SELLER_LEGAL_NAME,
      "Hangzhou, Zhejiang, China",
      "Test Buyer",
      "250 bar",
      "USD 15.00",
      "Discount: 10.00%",
      "DDP",
      "New York, US",
      "Sales tax treatment: Exempt",
      "Freight: USD 20.00",
      "TOTAL: USD 55.00",
      "cancel-v1",
      "general-v1",
      "FINAL-REFUND-CLAUSE",
      "test-source-hash",
      "payment-1",
      "2026-11-08T05:30:00.000Z",
    ])
      expect(extracted.stdout).toContain(text);
    for (let index = 1; index <= rendered.pageCount; index++)
      expect(extracted.stdout).toContain(
        `Page ${index} of ${rendered.pageCount}`,
      );
    expect(extracted.stdout).not.toMatch(/PRIVATE|SEPARATE-PAYMENT-TEXT/);
  },
);
