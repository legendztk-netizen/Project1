import type { PDFDocument } from "pdf-lib";
import { piSha256, type ProformaInvoiceSnapshot } from "./proforma-invoice";
import { proformaInvoicePdfContent } from "./proforma-invoice-pdf";
import { PI_FONT_MANIFEST, type PiFontAsset } from "./fonts/font-manifest";

export const PI_NOTO_SANS_FONT = PI_FONT_MANIFEST.latin;
export const PI_MAX_SELECTED_FONT_BYTES = 8 * 1024 * 1024;

function covers(asset: PiFontAsset, point: number) {
  return asset.ranges.some(([start, end]) => point >= start && point <= end);
}

export function selectPiFontAssets(
  snapshot: ProformaInvoiceSnapshot,
): readonly PiFontAsset[] {
  const selected = new Map<number, PiFontAsset>();
  for (const block of proformaInvoicePdfContent(snapshot)) {
    for (const character of block.text) {
      if ("\r\n\t".includes(character)) continue;
      const point = character.codePointAt(0)!;
      if (covers(PI_FONT_MANIFEST.latin, point)) continue;
      const index = Math.floor(point / PI_FONT_MANIFEST.chunkSize);
      const chunk = PI_FONT_MANIFEST.chunks.find(
        (chunk) => chunk.block === index,
      );
      if (!chunk || !covers(chunk, point))
        throw new Error(
          `PI font does not cover U+${point.toString(16).toUpperCase()}; original text was not changed.`,
        );
      selected.set(index, chunk);
    }
  }
  const assets = [
    PI_FONT_MANIFEST.latin,
    ...[...selected].sort(([a], [b]) => a - b).map(([, asset]) => asset),
  ];
  if (
    assets.reduce((sum, asset) => sum + asset.byteLength, 0) >
    PI_MAX_SELECTED_FONT_BYTES
  )
    throw new Error(
      "PI selected fonts exceed the 8 MiB rendering budget; use a resource-sized rendering job",
    );
  return assets;
}

export interface PiUnicodeFontSource {
  fontkit: Parameters<PDFDocument["registerFontkit"]>[0];
  snapshot: ProformaInvoiceSnapshot;
  loadFont: (asset: Readonly<PiFontAsset>) => Promise<Uint8Array>;
}

// Asset I/O is supplied by the application. Selection happens before loading,
// and only the manifest-pinned fonts needed by this exact PDF are parsed.
export function piUnicodeFonts(source: PiUnicodeFontSource) {
  const assets = selectPiFontAssets(source.snapshot);
  return async (document: PDFDocument) => {
    document.registerFontkit(source.fontkit);
    const fonts = [];
    for (const asset of assets) {
      const loaded = await source.loadFont(asset);
      if (loaded.byteLength !== asset.byteLength)
        throw new Error("PI font byte length mismatch");
      const bytes = new Uint8Array(loaded);
      if ((await piSha256(bytes)) !== asset.sha256)
        throw new Error("PI font checksum mismatch");
      fonts.push(
        await document.embedFont(bytes, {
          // These are offline FontTools subsets. Runtime fontkit subsetting
          // corrupts CJK outlines even when semantic extraction succeeds.
          subset: false,
          customName: `PiUnicode-${asset.sha256.slice(0, 16)}`,
          features: { liga: false, clig: false },
        }),
      );
    }
    return {
      regular: fonts[0],
      bold: fonts[0],
      fallbackFonts: fonts.slice(1),
      fontSha256s: assets.map((asset) => asset.sha256),
    };
  };
}
