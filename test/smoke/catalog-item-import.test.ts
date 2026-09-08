import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import { createD1CatalogItemRepository } from "../../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { seedCatalogItemBaseline } from "../fixtures/catalog-item-baseline";

const directory = mkdtempSync(join(tmpdir(), "item-worker-"));
let origin: string;
let preview: ChildProcess;
let exited: Promise<number | null>;
function sql<T>(query: string) {
  const run = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "hydraulic-hose-rfq-local",
      "--local",
      "--persist-to",
      directory,
      "--command",
      query,
      "--json",
    ],
    { encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  expect(run.status, run.stdout + run.stderr).toBe(0);
  return (JSON.parse(run.stdout) as { results: T[] }[])[0].results;
}
function post(path: string, values: Record<string, string>, cookie = "") {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return fetch(origin + path, {
    method: "POST",
    body,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    redirect: "manual",
  });
}
function hidden(html: string, name: string) {
  return (
    html.match(new RegExp(`name="${name}"[^>]*value="([^"]+)"`))?.[1] ?? ""
  );
}
beforeAll(async () => {
  const migrated = spawnSync("pnpm", ["migrate"], {
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migrated.status, migrated.stdout + migrated.stderr).toBe(0);
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(process.cwd(), "wrangler.jsonc"),
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  try {
    await seedCatalogItemBaseline(platform.env.DB);
    const items = createD1CatalogItemRepository(platform.env.DB);
    await items.enable({ environment: "local", actorId: "local-owner" });
    const payload = (await items.findPayload("sku", "601R1_001"))!;
    if (payload.kind === "sku") payload.variant.notes = "Reviewed baseline";
    await items.apply({
      payload,
      targetState: "online",
      mode: "edit",
      commandId: crypto.randomUUID(),
      actorId: "local-owner",
      ipAddress: "local",
      baselineRevisionId: null,
      source: { channel: "manual" },
    });
  } finally {
    await platform.dispose();
  }
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      if (!a || typeof a === "string") return reject(new Error("port missing"));
      server.close(() => resolve(a.port));
    });
  });
  origin = `http://127.0.0.1:${port}`;
  preview = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      env: { ...process.env, CLOUDFLARE_PERSIST_PATH: directory },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  exited = new Promise((resolve) => preview.once("exit", resolve));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/health")).ok) return;
    } catch {
      /* workerd starts asynchronously */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Worker did not start");
}, 60000);
afterAll(async () => {
  if (preview?.exitCode === null) {
    preview.kill("SIGTERM");
    await exited;
  }
  rmSync(directory, { force: true, recursive: true });
});

it("imports a real workbook through Worker, corrects, self approves, filters and preserves baseline", async () => {
  const page = await fetch(origin + "/admin/catalog/review", {
    redirect: "manual",
  });
  expect(page.headers.get("location")).toBe("/admin/catalog/requests");
  const reviewPage = await (
    await fetch(origin + "/admin/catalog/requests")
  ).text();
  expect(reviewPage).toContain("产品更新请求审核");
  const template = await fetch(origin + "/admin/catalog/item-template");
  expect(template.status).toBe(200);
  const templateBook = XLSX.read(await template.arrayBuffer(), {
    type: "array",
  });
  expect(templateBook.SheetNames).toHaveLength(7);
  expect(
    XLSX.utils.sheet_to_json(templateBook.Sheets["07_价格包装"], {
      header: 1,
    })[0],
  ).toContain("Retail Unit Price / 零售单价");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["productType", "baseSku", "referencePriceUsd", "currency"],
      ["Hose Variant", "601R1_001", 28, "CNY"],
    ]),
    "07_价格包装",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["hoseSku", "hoseEndSku", "ferruleSku"],
      ["601R1_001", "FJX-04", "FERRULE-04"],
    ]),
    "04_兼容压接",
  );
  const form = new FormData();
  const batchId = hidden(reviewPage, "batchId");
  form.set("intent", "import");
  form.set("batchId", batchId);
  form.set(
    "workbook",
    new Blob([XLSX.write(workbook, { type: "array", bookType: "xlsx" })]),
    "real-test.xlsx",
  );
  const imported = await fetch(origin + "/admin/catalog/requests", {
    method: "POST",
    body: form,
    headers: { origin },
    redirect: "manual",
  });
  expect(imported.status, await imported.text()).toBe(302);
  const current = async () =>
    (await (
      await fetch(origin + "/api/catalog/products/601R1_001")
    ).json()) as {
      product: { offer: { referencePrice: number; currency: string } };
    };
  expect((await current()).product.offer.referencePrice).toBe(3.25);
  const [row] = sql<{
    id: string;
    version: number;
    payload_json: string;
    original_json: string;
  }>(
    `SELECT id,version,payload_json,original_json FROM catalog_product_change_requests WHERE batch_id='${batchId}'`,
  );
  const blocked = await post("/admin/catalog/requests", {
    intent: "approve",
    selected: `${row.id}:${row.version}`,
  });
  expect(await blocked.text()).toContain("USD 专用价格列只能使用 USD");
  const detail = await (
    await fetch(origin + `/admin/catalog/requests?detail=${row.id}`)
  ).text();
  expect(detail).toContain("完整原始上传内容");
  const command = JSON.parse(row.payload_json);
  const correction: Record<string, string> = {
    intent: "correct",
    id: row.id,
    version: String(row.version),
    targetState: "online",
    reason: "原币种为人民币，通用价格为28",
    mediaVersionId: command.payload.mediaVersionId ?? "",
  };
  for (const [key, value] of Object.entries(command.payload.variant))
    correction[`owned.${key}`] = String(value ?? "");
  for (const [key, value] of Object.entries(command.payload.price))
    correction[`price.${key}`] = String(value ?? "");
  correction["price.amount"] = "28";
  correction["price.currency"] = "CNY";
  const corrected = await post("/admin/catalog/requests", correction);
  expect(corrected.status, await corrected.text()).toBe(200);
  const approved = await post("/admin/catalog/requests", {
    intent: "approve",
    selected: `${row.id}:2`,
  });
  expect(await approved.text()).toContain("已批准");
  expect((await current()).product.offer).toMatchObject({
    referencePrice: 28,
    currency: "CNY",
  });
  expect(JSON.stringify(await current())).not.toContain("factoryUnitPrice");
  expect(
    sql<{ original_json: string }>(
      `SELECT original_json FROM catalog_product_change_requests WHERE id='${row.id}'`,
    )[0].original_json,
  ).toBe(row.original_json);
  expect(
    sql<{ n: number }>(
      "SELECT count(*) n FROM catalog_pending_relation_sources WHERE status='pending'",
    )[0].n,
  ).toBe(1);
  expect(
    sql<{ reference_price_usd: number }>(
      "SELECT reference_price_usd FROM catalog_sales_offers WHERE import_id='active-import'",
    )[0].reference_price_usd,
  ).toBe(3.25);
  const filtered = await (
    await fetch(
      origin +
        `/admin/catalog/requests?status=approved&target=online&batch=${batchId}&series=601R1&q=001&sheet=07_%E4%BB%B7%E6%A0%BC%E5%8C%85%E8%A3%85`,
    )
  ).text();
  expect(filtered).toContain("601R1_001");
  expect(filtered).toContain("待处理总成来源");
  const pending = await (
    await fetch(origin + `/admin/catalog/requests?batch=${batchId}`)
  ).text();
  expect(pending).toContain("没有匹配的更新请求");
  expect(
    (
      await post("/admin/catalog/requests", {
        intent: "approve",
        selected: `${row.id}:2`,
      })
    ).status,
  ).toBe(200);
  expect(
    sql<{ n: number }>(
      `SELECT count(*) n FROM catalog_product_revisions WHERE request_id='${row.id}'`,
    )[0].n,
  ).toBe(1);
}, 120000);
