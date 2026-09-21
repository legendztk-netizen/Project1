import fontkit from "@pdf-lib/fontkit";
import {
  piUnicodeFonts,
  selectPiFontAssets,
} from "../app/modules/proforma-invoice/domain/pi-unicode-font";
import {
  proformaInvoicePdfContent,
  renderProformaInvoicePdf,
} from "../app/modules/proforma-invoice/domain/proforma-invoice-pdf";
import type { ProformaInvoiceSnapshot } from "../app/modules/proforma-invoice/domain/proforma-invoice";

const urls = import.meta.glob<string>(
  [
    "../app/modules/proforma-invoice/domain/fonts/NotoSans-Regular.ttf",
    "../app/modules/proforma-invoice/domain/fonts/chunks/*.ttf",
  ],
  { eager: true, query: "?url&no-inline", import: "default" },
);
const assetUrls = new Map(
  Object.entries(urls).map(([path, url]) => [path.split("/").pop()!, url]),
);

export const PI_WORKER_MAX_FONT_BYTES = 2 * 1024 * 1024;
export const PI_WORKER_MAX_TEXT_CHARACTERS = 50000;
export interface PiFontAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

// Shared across factories: concurrent requests share the same Worker isolate.
let rendering = false;

function unavailable(message: string) {
  return new Response(message, {
    status: 503,
    headers: {
      "Cache-Control": "private, no-store",
      "Retry-After": "5",
    },
  });
}

export function createPiPdfRenderer(assets: PiFontAssetsBinding) {
  return async (snapshot: ProformaInvoiceSnapshot) => {
    if (rendering) throw unavailable("PI renderer is busy; retry issuance");
    const selected = selectPiFontAssets(snapshot);
    if (
      selected.reduce((size, asset) => size + asset.byteLength, 0) >
      PI_WORKER_MAX_FONT_BYTES
    )
      throw unavailable(
        "PI font selection exceeds the Worker rendering budget",
      );
    const characters = proformaInvoicePdfContent(snapshot).reduce(
      (size, block) => size + block.text.length,
      0,
    );
    if (characters > PI_WORKER_MAX_TEXT_CHARACTERS)
      throw unavailable("PI document exceeds the Worker rendering budget");
    rendering = true;
    try {
      return await renderProformaInvoicePdf(
        snapshot,
        piUnicodeFonts({
          fontkit,
          snapshot,
          loadFont: async (asset) => {
            const path = assetUrls.get(asset.filename);
            if (!path || !path.startsWith("/") || path.startsWith("//"))
              throw unavailable("PI font asset URL is unavailable");
            const response = await assets.fetch(
              new Request(new URL(path, "https://pi-assets.invalid"), {
                redirect: "manual",
              }),
            );
            if (!response.ok || !response.body) {
              await response.body?.cancel();
              throw unavailable("PI font asset is unavailable");
            }
            // Do not trust Content-Length or buffer an unbounded asset response.
            const bytes = new Uint8Array(asset.byteLength);
            const reader = response.body.getReader();
            let offset = 0;
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (offset + value.byteLength > bytes.byteLength)
                  throw unavailable("PI font asset exceeds its pinned length");
                bytes.set(value, offset);
                offset += value.byteLength;
              }
            } finally {
              await reader.cancel();
              reader.releaseLock();
            }
            if (offset !== bytes.byteLength)
              throw unavailable("PI font asset is truncated");
            return bytes;
          },
        }),
      );
    } finally {
      rendering = false;
    }
  };
}
