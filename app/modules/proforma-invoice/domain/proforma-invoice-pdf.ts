import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  formatPiDate,
  piSha256,
  type ProformaInvoiceSnapshot,
} from "./proforma-invoice";

export const PI_PDF_RENDERER_VERSION = "pi-pdf-v4";

interface TextBlock {
  text: string;
  heading?: boolean;
  subheading?: boolean;
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
  const entries = Object.entries(value).filter(([, child]) => child != null);
  if (entries.length === 0) return [];
  return [
    ...(prefix ? [{ text: prefix, subheading: true }] : []),
    ...entries.reduce<TextBlock[]>((blocks, [key, child], index) => {
      if (typeof child === "object") blocks.push(...fields(child, label(key)));
      else {
        const text = `${label(key)}: ${String(child)}`;
        const previous = blocks.at(-1);
        if (
          prefix &&
          index > 0 &&
          typeof entries[index - 1][1] !== "object" &&
          previous &&
          !previous.heading &&
          !previous.subheading &&
          previous.text.length + text.length < 130
        )
          previous.text += ` | ${text}`;
        else blocks.push({ text });
      }
      return blocks;
    }, []),
  ];
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
    {
      text:
        snapshot.paymentTerms?.kind === "fixed_et_date"
          ? `Payment due: ${snapshot.paymentTerms.dueDateEt} at 23:59 ET`
          : snapshot.paymentTerms?.kind === "ten_us_business_days"
            ? "Payment due: within 10 US bank business days after PI acceptance (23:59 ET on the tenth day)."
            : "Payment terms: consult the separately verified historical agreement.",
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
          product: { ...line.product, specifications: undefined },
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
    ...(snapshot.terms.shipmentGroups ?? []).flatMap((group, index) => [
      { text: `Shipment ${index + 1}: ${group.label}`, heading: true },
      ...group.allocations.map((allocation) => ({
        text: `${snapshot.lines.find((line) => line.id === allocation.lineId)?.displayName ?? allocation.lineId}: ${allocation.physicalQuantity} ${snapshot.lines.find((line) => line.id === allocation.lineId)?.lineKind === "length_based_hose" ? "pieces" : "units"}`,
      })),
      {
        text: `Transport: ${group.transportMethod} | ${group.incoterm} ${group.namedPlace}`,
      },
      {
        text: `Freight: ${usd(group.freightCents)} | Insurance: ${usd(group.insuranceCents)} | Duties/import: ${usd(group.dutiesImportCents)}`,
      },
    ]),
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
    const wholeRunFont = candidates.find((font) => {
      const characters = coverage.get(font)!;
      for (const character of text)
        if (!characters.has(character.codePointAt(0)!)) return false;
      return true;
    });
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
    const font = block.heading || block.subheading ? face.bold : face.regular;
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
    page.drawLine({
      start: { x: margin, y: height - 42 },
      end: { x: width - margin, y: height - 42 },
      thickness: 0.6,
      color: rgb(0.77, 0.81, 0.83),
    });
  }
  nextPage();
  const printable = width - margin * 2;
  const ink = rgb(0.12, 0.19, 0.22);
  const pale = rgb(0.94, 0.96, 0.97);
  function summaryText(
    text: string,
    x: number,
    top: number,
    available: number,
    size = 9,
  ) {
    const lines = wrap(
      text,
      (value) => measure(value, face.regular, size),
      available,
    );
    for (const [index, value] of lines.entries())
      draw(page!, value, face.regular, size, x, top - index * 13);
    return lines.length * 13;
  }
  function band(title: string) {
    if (y < 105) nextPage();
    page!.drawRectangle({
      x: margin,
      y: y - 6,
      width: printable,
      height: 24,
      color: pale,
    });
    draw(page!, title, face.bold, 10, margin + 8, y + 2);
    y -= 30;
  }
  draw(page!, "PROFORMA INVOICE", face.bold, 23, margin, y);
  y -= 28;
  y -= summaryText(
    `Issued: ${formatPiDate(snapshot.issuedAt, "customer")}\nValid until: ${formatPiDate(snapshot.validUntil, "customer")}`,
    margin,
    y,
    printable,
  );
  y -= 14;
  band("PARTIES & DELIVERY");
  const col = (printable - 24) / 2;
  const buyer = snapshot.buyer;
  const destination = snapshot.destination;
  const partyColumns = [
    `SELLER\n${snapshot.seller.legalName}\n${snapshot.seller.registeredAddressEn}`,
    `BUYER / SHIP TO\n${buyer.legalName || buyer.contactName}\n${destination.recipientName}\n${destination.addressLine1}\n${destination.addressLine2 || ""}\n${destination.city}, ${destination.stateProvince} ${destination.postalCode}\n${destination.countryCode}\n${destination.recipientEmail}`,
  ].map((text) => wrap(text, (value) => measure(value, face.regular, 9), col));
  for (
    let row = 0;
    row < Math.max(...partyColumns.map((lines) => lines.length));
    row++
  ) {
    if (y < 65) nextPage();
    partyColumns.forEach((lines, column) => {
      if (lines[row])
        draw(
          page!,
          lines[row],
          face.regular,
          9,
          margin + column * (col + 24),
          y,
        );
    });
    y -= 13;
  }
  y -= 22;
  band("PRODUCT SUMMARY");
  const columns = [margin, margin + 275, margin + 343, margin + 428];
  const tableHeader = () => {
    ["Product / SKU", "Qty", "Unit USD", "Total USD"].forEach((text, index) =>
      draw(page!, text, face.bold, 9, columns[index], y),
    );
    y -= 18;
  };
  tableHeader();
  for (const [index, line] of snapshot.lines.entries()) {
    const cells = [
      `${index + 1}. ${line.displayName}\n${line.sku}`,
      `${line.totals.quantity}\n${line.lineKind === "length_based_hose" ? "ft" : line.salesUnit}`,
      line.price.unitPriceCents === null
        ? "Pending"
        : (line.price.unitPriceCents / 100).toFixed(2),
      line.totals.totalCents === null
        ? "Pending"
        : (line.totals.totalCents / 100).toFixed(2),
    ].map((text, column) =>
      wrap(
        text,
        (value) => measure(value, face.regular, 9),
        [260, 60, 77, printable - 428][column],
      ),
    );
    const rowCount = Math.max(...cells.map((cell) => cell.length));
    const rowHeight = rowCount * 13 + 14;
    if (y - rowHeight < 65) {
      nextPage();
      band("PRODUCT SUMMARY - CONTINUED");
      tableHeader();
    }
    for (let row = 0; row < rowCount; row++) {
      if (y < 65) {
        nextPage();
        band("PRODUCT SUMMARY - CONTINUED");
        tableHeader();
      }
      cells.forEach((cell, column) => {
        if (cell[row])
          draw(page!, cell[row], face.regular, 9, columns[column], y);
      });
      y -= 13;
    }
    y -= 14;
    page!.drawLine({
      start: { x: margin, y: y + 7 },
      end: { x: width - margin, y: y + 7 },
      thickness: 0.5,
      color: rgb(0.82, 0.85, 0.87),
    });
    y -= 8;
  }
  if (y < 250) nextPage();
  y -= 10;
  band("AMOUNT DUE / USD");
  const amounts: Array<[string, number]> = [
    ["Merchandise after discount", snapshot.totals.merchandiseCents],
    ...Object.entries(snapshot.terms.charges)
      .filter(([, amount]) => amount !== 0)
      .map(([key, amount]) => [label(key), amount] as [string, number]),
  ];
  for (const [name, amount] of amounts) {
    if (y < 85) nextPage();
    draw(page!, name, face.regular, 9, margin + 8, y);
    const value = usd(amount);
    draw(
      page!,
      value,
      face.regular,
      9,
      width - margin - 8 - measure(value, face.regular, 9),
      y,
    );
    y -= 18;
  }
  if (y < 125) nextPage();
  page!.drawRectangle({
    x: margin,
    y: y - 26,
    width: printable,
    height: 40,
    color: ink,
  });
  page!.drawText("TOTAL DUE", {
    x: margin + 12,
    y: y - 11,
    font: face.bold,
    size: 13,
    color: rgb(1, 1, 1),
  });
  const totalText = usd(snapshot.totals.totalCents);
  page!.drawText(totalText, {
    x: width - margin - 12 - measure(totalText, face.bold, 16),
    y: y - 11,
    font: face.bold,
    size: 16,
    color: rgb(1, 1, 1),
  });
  y -= 50;
  for (const text of wrap(
    `Delivery: ${snapshot.terms.incoterm} - ${snapshot.terms.namedPlace}\nLead time: ${snapshot.terms.leadTime}`,
    (value) => measure(value, face.regular, 9),
    printable,
  )) {
    if (y < 65) nextPage();
    draw(page!, text, face.regular, 9, margin, y);
    y -= 13;
  }
  nextPage();
  for (const block of content) {
    const font = block.heading || block.subheading ? face.bold : face.regular;
    const size = block.heading ? 11 : 8.5;
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
    if ((block.heading || block.subheading) && y < 105) nextPage();
    if (block.heading) {
      y -= 9;
      page!.drawRectangle({
        x: margin,
        y: y - (lines.length - 1) * 18 - 5,
        width: printable,
        height: lines.length * 18 + 6,
        color: pale,
      });
    }
    for (const text of lines) {
      if (y < 58) nextPage();
      draw(page!, text, font, size, margin, y);
      y -= block.heading ? 18 : 11.5;
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
