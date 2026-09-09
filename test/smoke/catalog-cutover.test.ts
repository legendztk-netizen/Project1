import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
import { seedCatalogItemBaseline } from "../fixtures/catalog-item-baseline";

type ProductResponse = {
  product: {
    offer: { referencePrice: number };
    catalogBasis: { skuRevisionId: string | null };
  };
};
const directory = mkdtempSync(join(tmpdir(), "cutover-worker-"));
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
function publication(amount: string, commandId: string = crypto.randomUUID()) {
  return {
    commandId,
    mode: "edit",
    targetState: "online",
    sku: "601R1_001",
    hoseSeries: "601R1",
    dash: "-4",
    nominalIdIn: "0.25",
    idMm: "6.4",
    odMm: "13.4",
    workingBar: "180",
    workingPsi: "2610",
    burstBar: "720",
    bendRadiusMm: "100",
    weightKgM: "0.2",
    skiveRequirement: "No Skive",
    mshaMarking: "N/A",
    technicalDataStatus: "Complete",
    source: "Worker test",
    notes: "Reviewed Hose",
    amount,
    currency: "USD",
  };
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

it("switches a legacy Worker, blocks retired writes and keeps item prices live", async () => {
  const legacyProduct = (await (
    await fetch(origin + "/api/catalog/products/601R1_001")
  ).json()) as ProductResponse;
  const migrationPage = await (
    await fetch(origin + "/admin/catalog/cutover")
  ).text();
  const id = hidden(migrationPage, "id");
  expect(id).toBeTruthy();
  expect(
    (await post("/admin/catalog/cutover", { intent: "inventory", id })).status,
  ).toBe(200);
  expect(
    (await post("/admin/catalog/cutover", { intent: "freeze", id })).status,
  ).toBe(200);
  expect(
    (await post("/admin/catalog/cutover", { intent: "commit", id })).status,
  ).toBe(200);
  expect(
    (await post("/admin/catalog/cutover", { intent: "commit", id })).status,
  ).toBe(200);
  const currentProduct = (await (
    await fetch(origin + "/api/catalog/products/601R1_001")
  ).json()) as ProductResponse;
  expect(currentProduct.product.offer).toEqual(legacyProduct.product.offer);
  expect(currentProduct.product.catalogBasis.skuRevisionId).toBeTruthy();
  expect(
    (await post("/admin/catalog/review", { intent: "publish_catalog" })).status,
  ).toBe(409);
  expect(
    (await post("/admin/catalog/import", { intent: "import" })).status,
  ).toBe(409);
  const bulk = await (
    await fetch(origin + "/admin/catalog/bulk-import")
  ).text();
  expect(bulk).toContain("<h1>批量导入产品</h1>");
  expect(bulk).not.toContain("<h1>产品更新请求审核</h1>");
  expect((await post("/admin/catalog/items", publication("15"))).status).toBe(
    200,
  );
  const changed = (await (
    await fetch(origin + "/api/catalog/products/601R1_001")
  ).json()) as ProductResponse;
  expect(changed.product.offer.referencePrice).toBe(15);
  expect(
    sql<{ status: string }>("SELECT status FROM catalog_cutover_runs"),
  ).toEqual([{ status: "committed" }]);
});
