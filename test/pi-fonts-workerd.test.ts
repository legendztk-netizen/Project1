import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";
import type { ProformaInvoiceSnapshot } from "../app/modules/proforma-invoice/domain/proforma-invoice";
import { PI_FONT_MANIFEST } from "../app/modules/proforma-invoice/domain/fonts/font-manifest";

function snapshot(): ProformaInvoiceSnapshot {
  return {
    schemaVersion: 1,
    documentNumber: "PI-WORKER-TEST",
    documentVersion: 1,
    issuedAt: "2026-09-14T10:00:00.000Z",
    validUntil: "2026-09-28T10:00:00.000Z",
    currency: "USD",
    seller: {
      id: "seller-test",
      version: 1,
      legalName: "Hangzhou Rongyao Trading Co., Ltd.",
      registeredAddressEn: "杭州市测试路1号\nHangzhou, Zhejiang, China",
      registeredCountryCode: "CN",
    },
    buyer: {
      kind: "individual",
      legalName: "李雷 / 陳美玲 / 山田太郎 / 김민준",
      tradeName: null,
      countryCode: "US",
      registrationOrTaxId: null,
      contactName: "José Müller / Łukasz / Иван Петров / Νίκος",
      contactEmail: "test@example.com",
    },
    destination: {
      addressLine1: "東京都新宿区 1-2-3",
      addressLine2: "",
      city: "Test City",
      countryCode: "US",
      postalCode: "10001",
      recipientEmail: "test@example.com",
      recipientName: "李雷",
      recipientPhone: "+1 202 555 0100",
      stateProvince: "NY",
    },
    lines: [],
    quoteRevision: {
      id: "revision-test",
      number: 1,
      schemaVersion: 1,
      issuedAt: "2026-09-14T09:00:00.000Z",
      requestId: "request-test",
      sourceHash: "test-source",
      preparationVersion: 1,
      rfqSnapshotVersion: 2,
      rfqSubmittedAt: "2026-09-14T08:00:00.000Z",
      rfqAcknowledgementVersion: "test-v1",
      importResponsibilityVersion: "test-v1",
      previousRevisionId: null,
    },
    terms: {
      shipmentMode: "together",
      splitPlan: "",
      transportMethod: "Air freight",
      incoterm: "DDP",
      namedPlace: "Test City",
      taxTreatment: "Not Collected",
      leadTime: "Test only",
      charges: {
        freight: 0,
        insurance: 0,
        dutiesImport: 0,
        salesTax: 0,
        cuttingLabeling: 0,
        assemblyService: 0,
        protectionService: 0,
      },
    },
    totals: {
      currency: "USD",
      merchandiseCents: 0,
      discountCents: 0,
      totalCents: 0,
    },
    conditions: {
      cancellation: { version: "test-v1", text: "No real transaction." },
      refund: {
        version: "test-v1",
        text: Array.from(
          { length: 100 },
          (_, index) => `Clause ${index + 1}: 请核对姓名和地址，原文保留。`,
        ).join("\n"),
      },
      generalAcknowledgement: { version: "test-v1", text: "Test only" },
      madeToOrderAcknowledgements: [],
    },
    paymentSelection: {
      channel: "bank_transfer",
      instructionId: "test",
      instructionVersion: 1,
    },
  };
}

interface LocalWorker {
  dispatchFetch(url: string, init: RequestInit): Promise<Response>;
  getInspectorURL(): Promise<URL>;
  dispose(): Promise<void>;
}

async function inspector(worker: LocalWorker) {
  const url = await worker.getInspectorURL();
  url.protocol = "http:";
  const targets = (await (
    await fetch(new URL("/json/list", url))
  ).json()) as Array<{ title: string; webSocketDebuggerUrl: string }>;
  const target = targets.find((target) =>
    target.title.includes("pi-font-render-test"),
  );
  expect(target, JSON.stringify(targets)).toBeDefined();
  const socket = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map<number, (value: Record<string, number>) => void>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      pending.get(message.id)?.(message.result ?? {});
      pending.delete(message.id);
    }
  });
  return {
    close: () => socket.close(),
    sample: () =>
      new Promise<number>((resolve) => {
        const requestId = ++id;
        pending.set(requestId, (value) =>
          resolve(
            (value.usedSize ?? 0) +
              (value.backingStorageSize ?? 0) +
              (value.embedderHeapUsedSize ?? 0),
          ),
        );
        socket.send(
          JSON.stringify({ id: requestId, method: "Runtime.getHeapUsage" }),
        );
      }),
  };
}

it("builds external font URLs and renders guarded multilingual PDFs in real workerd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-workerd-"));
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare") as {
    Miniflare: new (options: object) => LocalWorker;
    convertV4MiniflareOptions(options: object): object;
  };
  let worker: LocalWorker | undefined;
  let profiler: Awaited<ReturnType<typeof inspector>> | undefined;
  const fetched: string[] = [];
  let mode: "normal" | "oversized" | "missing" | "corrupt" | "hold" = "normal";
  let release: (() => void) | undefined;
  let peak = 0;
  let samples = 0;
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      publicDir: false,
      ssr: { noExternal: true },
      build: {
        ssr: resolve("test/fixtures/pi-font-worker.ts"),
        outDir: directory,
        ssrEmitAssets: true,
        minify: false,
      },
    });
    const script = await readFile(join(directory, "pi-font-worker.js"), "utf8");
    expect(/data:[^"\s]+;base64,[A-Za-z0-9+/=]{1000}/.test(script)).toBe(false);
    worker = new Miniflare(
      convertV4MiniflareOptions({
        name: "pi-font-render-test",
        modules: true,
        script,
        compatibilityDate: "2026-08-15",
        compatibilityFlags: ["nodejs_compat"],
        inspectorPort: 0,
        serviceBindings: {
          ASSETS: async (request: Request) => {
            const pathname = new URL(request.url).pathname;
            expect(pathname).toMatch(
              /^\/assets\/(?:NotoSans-Regular|PiCjkSans-U[0-9A-F]+)-[\w-]+\.ttf$/,
            );
            fetched.push(pathname);
            if (profiler) {
              peak = Math.max(peak, await profiler.sample());
              samples++;
            }
            if (mode === "hold")
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            if (mode === "missing")
              return new Response("missing", { status: 404 });
            const bytes = await readFile(join(directory, pathname));
            if (mode === "oversized")
              return new Response(new Uint8Array(bytes.length + 1));
            if (mode === "corrupt") bytes[0] ^= 255;
            return new Response(bytes);
          },
        },
      }),
    );
    profiler = await inspector(worker);
    for (const [issued, expected] of [
      ["2026-10-25T04:30:00Z", "2026-11-08T05:30:00.000Z"],
      ["2026-03-01T05:30:00Z", "2026-03-15T04:30:00.000Z"],
      ["2026-02-22T07:30:00Z", "2026-03-08T07:30:00.000Z"],
      ["2026-10-18T05:30:00Z", "2026-11-01T05:30:00.000Z"],
    ]) {
      const response = await worker.dispatchFetch("https://pi.test/deadline", {
        method: "POST",
        body: JSON.stringify(issued),
      });
      expect(await response.json()).toBe(expected);
    }
    peak = await profiler.sample();
    samples++;
    const render = async (value = snapshot()) => {
      const response = await worker!.dispatchFetch("https://pi.test", {
        method: "POST",
        body: JSON.stringify(value),
      });
      peak = Math.max(peak, await profiler!.sample());
      samples++;
      return response;
    };
    const first = await render();
    expect(first.status, await first.clone().text()).toBe(200);
    const bytes = new Uint8Array(await first.arrayBuffer());
    expect(bytes.length).toBeLessThan(2000000);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
    const selected = [...fetched];
    expect(selected.length).toBeLessThan(40);
    expect(new Set(selected).size).toBe(selected.length);
    const again = await render();
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(bytes);
    peak = Math.max(peak, await profiler.sample());
    samples++;
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(96 * 1024 * 1024);

    for (const bad of ["oversized", "missing", "corrupt"] as const) {
      mode = bad;
      expect((await render()).status).toBe(bad === "corrupt" ? 422 : 503);
    }
    mode = "normal";
    const before = fetched.length;
    const unsupported = {
      ...snapshot(),
      buyer: { ...snapshot().buyer, legalName: "\u{13000}" },
    };
    expect((await render(unsupported)).status).toBe(422);
    const huge = {
      ...snapshot(),
      seller: { ...snapshot().seller, registeredAddressEn: "A".repeat(50001) },
    };
    expect((await render(huge)).status).toBe(503);
    const manyFonts = {
      ...snapshot(),
      seller: {
        ...snapshot().seller,
        registeredAddressEn: PI_FONT_MANIFEST.chunks
          .slice(0, 150)
          .map((asset) => String.fromCodePoint(asset.ranges[0][0]))
          .join(""),
      },
    };
    expect((await render(manyFonts)).status).toBe(503);
    expect(fetched.length).toBe(before);

    mode = "hold";
    const active = render();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      expect((await render()).status).toBe(503);
    } finally {
      mode = "normal";
      release();
    }
    expect((await active).status).toBe(200);
    expect((await render()).status).toBe(200);
    expect(peak).toBeLessThan(96 * 1024 * 1024);
    if (process.env.PI_WORKER_TEST_PDF_PATH) {
      await writeFile(process.env.PI_WORKER_TEST_PDF_PATH, bytes);
      await writeFile(
        `${process.env.PI_WORKER_TEST_PDF_PATH}.memory.json`,
        JSON.stringify({
          pdfBytes: bytes.length,
          selectedFonts: selected.length,
          sampledHeapAndBackingPeak: peak,
          samples,
        }),
      );
    }
  } finally {
    profiler?.close();
    await worker?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
