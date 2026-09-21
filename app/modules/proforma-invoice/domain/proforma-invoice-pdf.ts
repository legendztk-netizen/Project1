import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import {
  formatPiDate,
  piSha256,
  type ProformaInvoiceSnapshot,
} from "./proforma-invoice";

export const PI_PDF_RENDERER_VERSION = "pi-pdf-v3";

interface TextBlock {
  text: string;
  heading?: boolean;
}
export interface PiPdfFonts {
  regular: PDFFont;
  bold: PDFFont;
  fallbackFonts?: PDFFont[];
  fontSha256s?: string[];
}
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const usd = (cents: number | null) =>
  cents === null ? "Not specified" : `USD ${(cents / 100).toFixed(2)}`;
const label = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toUpperCase());

function fields(value: unknown, prefix = ""): TextBlock[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object")
    return [{ text: `${prefix}: ${String(value)}` }];
  return Object.entries(value).flatMap(([key, child]) =>
    fields(child, prefix ? `${prefix} / ${label(key)}` : label(key)),
  );
}

export function proformaInvoicePdfContent(
  snapshot: ProformaInvoiceSnapshot,
): readonly TextBlock[] {
  const blocks: TextBlock[] = [
    { text: "PROFORMA INVOICE", heading: true },
    {
      text: `${snapshot.documentNumber} | Version ${snapshot.documentVersion}`,
    },
    {
      text: `Issued: ${formatPiDate(snapshot.issuedAt, "customer")} | UTC ${snapshot.issuedAt}`,
    },
    {
      text: `Valid until: ${formatPiDate(snapshot.validUntil, "customer")} | UTC ${snapshot.validUntil}`,
    },
    { text: "Seller", heading: true },
    { text: snapshot.seller.legalName },
    { text: snapshot.seller.registeredAddressEn },
    { text: "Buyer", heading: true },
    ...fields(snapshot.buyer),
    { text: "Delivery destination", heading: true },
    ...fields(snapshot.destination),
  ];
  for (const [index, line] of snapshot.lines.entries()) {
    blocks.push(
      { text: `Line ${index + 1}: ${line.sku}`, heading: true },
      { text: line.displayName },
      {
        text: `Quantity: ${line.quantity} ${line.salesUnit} | Pricing quantity: ${line.totals.quantity}${line.lineKind === "length_based_hose" ? " ft" : " units"}`,
      },
      {
        text: `Unit price: ${usd(line.price.unitPriceCents)} | Discount: ${(line.price.discountBasisPoints / 100).toFixed(2)}%`,
      },
      {
        text: `Undiscounted: ${usd(line.totals.undiscountedCents)} | Discount: ${usd(line.totals.discountCents)} | Line total: ${usd(line.totals.totalCents)}`,
      },
      {
        text: `Original reference (non-binding): ${line.reference.currency} ${line.reference.unitPrice ?? "Not recorded"}`,
      },
      ...line.product.specifications.map((spec) => ({
        text: `${spec.label}: ${spec.value}`,
      })),
      ...line.quotedSpecificationOverrides.map((spec) => ({
        text: `Approved amendment - ${spec.label}: ${spec.value}`,
      })),
      ...fields(line.lengthOrder, "Length order"),
      ...fields(line.assembly, "Assembly"),
      ...fields(
        {
          lineId: line.id,
          catalogReleaseId: line.catalogReleaseId,
          product: line.product,
        },
        "Captured product basis",
      ),
    );
  }
  blocks.push(
    { text: "Commercial terms", heading: true },
    {
      text: `Incoterm: ${snapshot.terms.incoterm} | Named place: ${snapshot.terms.namedPlace}`,
    },
    {
      text: `Transport: ${snapshot.terms.transportMethod} | Shipment: ${snapshot.terms.shipmentMode}`,
    },
    { text: snapshot.terms.splitPlan },
    { text: `Lead time: ${snapshot.terms.leadTime}` },
    { text: `Sales tax treatment: ${snapshot.terms.taxTreatment}` },
    ...Object.entries(snapshot.terms.charges).map(([key, value]) => ({
      text: `${label(key)}: ${usd(value)}`,
    })),
    {
      text: `Merchandise after discount: ${usd(snapshot.totals.merchandiseCents)}`,
    },
    { text: `Total discount: ${usd(snapshot.totals.discountCents)}` },
    { text: `TOTAL: ${usd(snapshot.totals.totalCents)}`, heading: true },
    { text: "Cancellation and refund conditions", heading: true },
    { text: `Cancellation (${snapshot.conditions.cancellation.version})` },
    { text: snapshot.conditions.cancellation.text },
    { text: `Refund (${snapshot.conditions.refund.version})` },
    { text: snapshot.conditions.refund.text },
    { text: "Acknowledgements", heading: true },
    { text: `General (${snapshot.conditions.generalAcknowledgement.version})` },
    { text: snapshot.conditions.generalAcknowledgement.text },
    ...snapshot.conditions.madeToOrderAcknowledgements.flatMap((value) => [
      { text: `Line ${value.lineId} (${value.version})` },
      { text: value.text },
    ]),
    { text: "Payment", heading: true },
    {
      text: `Selected channel: ${snapshot.paymentSelection.channel === "bank_transfer" ? "Bank Transfer" : "PayPal"}`,
    },
    {
      text: "Current selected Payment Instructions are supplied separately with this PI.",
    },
    { text: "Source versions", heading: true },
    ...fields(snapshot.quoteRevision),
    {
      text: `Seller identity: ${snapshot.seller.id} / version ${snapshot.seller.version}`,
    },
    ...fields(snapshot.paymentSelection),
  );
  return blocks.filter((block) => block.text !== "");
}

function wrap(text: string, measure: (text: string) => number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")) {
    let line = "";
    for (const { segment: character } of graphemes.segment(
      paragraph.replaceAll("\t", "    "),
    )) {
      if (measure(character) > width)
        throw new Error("PDF glyph exceeds printable width");
      const candidate = line + character;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      const space = line.lastIndexOf(" ");
      if (space > 0) {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1) + character;
      } else {
        lines.push(line);
        line = character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderProformaInvoicePdf(
  snapshot: ProformaInvoiceSnapshot,
  fonts?: (document: PDFDocument) => Promise<PiPdfFonts>,
) {
  const document = await PDFDocument.create();
  const face: PiPdfFonts = fonts
    ? await fonts(document)
    : {
        regular: await document.embedFont("Helvetica"),
        bold: await document.embedFont("Helvetica-Bold"),
      };
  const content = proformaInvoicePdfContent(snapshot);
  const header = `${snapshot.documentNumber} | Version ${snapshot.documentVersion}`;
  const coverage = new Map(
    [face.regular, face.bold, ...(face.fallbackFonts ?? [])].map((font) => [
      font,
      new Set(font.getCharacterSet()),
    ]),
  );
  function runs(text: string, preferred: PDFFont) {
    if (!text) return [];
    const candidates = [preferred, ...(face.fallbackFonts ?? [])];
    const wholeRunFont = candidates.find((font) =>
      [...text].every((character) =>
        coverage.get(font)!.has(character.codePointAt(0)!),
      ),
    );
    if (wholeRunFont) return [{ text, font: wholeRunFont }];
    const runs: Array<{ text: string; font: PDFFont }> = [];
    for (const { segment } of graphemes.segment(text)) {
      const font = candidates.find((font) =>
        [...segment].every((character) =>
          coverage.get(font)!.has(character.codePointAt(0)!),
        ),
      );
      if (!font)
        throw new Error(
          `PI font does not cover ${[...segment].map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`).join(" ")}; supply a covering embedded Unicode font. Original text was not changed.`,
        );
      const previous = runs.at(-1);
      if (previous?.font === font) previous.text += segment;
      else runs.push({ text: segment, font });
    }
    return runs;
  }
  const measure = (text: string, font: PDFFont, size: number) =>
    runs(text, font).reduce(
      (width, run) => width + run.font.widthOfTextAtSize(run.text, size),
      0,
    );
  function draw(
    page: PDFPage,
    text: string,
    font: PDFFont,
    size: number,
    x: number,
    y: number,
  ) {
    for (const run of runs(text, font)) {
      page.drawText(run.text, { x, y, size, font: run.font });
      x += run.font.widthOfTextAtSize(run.text, size);
    }
  }
  for (const block of [
    ...content,
    { text: header },
    { text: `Page 0123456789 of | ${PI_PDF_RENDERER_VERSION}` },
  ]) {
    const font = block.heading ? face.bold : face.regular;
    runs(block.text.replaceAll(/[\r\n\t]/g, " "), font);
  }
  document.setTitle(`${snapshot.documentNumber} / ${snapshot.documentVersion}`);
  document.setAuthor(snapshot.seller.legalName);
  document.setCreator(PI_PDF_RENDERER_VERSION);
  document.setProducer(PI_PDF_RENDERER_VERSION);
  document.setCreationDate(new Date(snapshot.issuedAt));
  document.setModificationDate(new Date(snapshot.issuedAt));
  const width = 595.28,
    height = 841.89,
    margin = 42;
  const pages: PDFPage[] = [];
  let page: PDFPage;
  let y = 0;
  let headerSize = 9;
  while (
    measure(header, face.regular, headerSize) > width - margin * 2 &&
    headerSize > 6
  )
    headerSize -= 0.5;
  if (measure(header, face.regular, headerSize) > width - margin * 2)
    throw new Error("PI document number is too long for the page header");
  function nextPage() {
    page = document.addPage([width, height]);
    pages.push(page);
    y = height - 68;
    draw(page, header, face.regular, headerSize, margin, height - 32);
  }
  nextPage();
  for (const block of content) {
    const font = block.heading ? face.bold : face.regular;
    const size = block.heading ? 12 : 9;
    let lines: string[];
    try {
      lines = wrap(
        block.text,
        (text) => measure(text, font, size),
        width - margin * 2,
      );
    } catch {
      throw new Error(
        "PI text cannot be rendered with the selected font; supply an embedded font covering all document characters",
      );
    }
    if (block.heading && y < 105) nextPage();
    for (const text of lines) {
      if (y < 58) nextPage();
      draw(page!, text, font, size, margin, y);
      y -= block.heading ? 18 : 13;
    }
    y -= block.heading ? 4 : 3;
  }
  for (const [index, page] of pages.entries()) {
    draw(
      page,
      `Page ${index + 1} of ${pages.length} | ${PI_PDF_RENDERER_VERSION}`,
      face.regular,
      8,
      margin,
      28,
    );
  }
  const bytes = await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
  });
  return {
    bytes,
    sha256: await piSha256(bytes),
    pageCount: pages.length,
    contentType: "application/pdf" as const,
    rendererVersion: PI_PDF_RENDERER_VERSION,
    fontSha256s: face.fontSha256s ?? [],
  };
}
