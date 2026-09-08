import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
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

it("publishes through the protected Worker, creates a current RFQ, and preserves its history", async () => {
  expect(
    (await post("/admin/catalog/items", { intent: "enable" })).status,
  ).toBe(200);
  const page = await (
    await fetch(origin + "/admin/catalog/items?sku=601R1_001")
  ).text();
  expect(page).toContain("胶管条目发布");
  const first = publication("12", hidden(page, "commandId"));
  expect((await post("/admin/catalog/items", first)).status).toBe(200);
  const { product: current } = (await (
    await fetch(origin + "/api/catalog/products/601R1_001")
  ).json()) as {
    product: {
      familyKey: string;
      offer?: { referencePrice: number };
      catalogBasis?: { skuRevisionId: string };
    };
  };
  expect(current.offer?.referencePrice).toBe(12);
  expect(current.catalogBasis?.skuRevisionId).toBeTruthy();
  expect(
    (await post("/admin/catalog/review", { intent: "publish_catalog" })).status,
  ).toBe(409);
  expect((await post("/admin/catalog/items", publication("-1"))).status).toBe(
    400,
  );

  const otp = await post("/register", {
    intent: "request",
    email: "item-test@example.com",
    returnTo: "/quote-list",
  });
  const otpHtml = await otp.text();
  const verified = await post("/register", {
    intent: "verify",
    challengeId: hidden(otpHtml, "challengeId"),
    code: otpHtml.match(/<strong>(\d{6})<\/strong>/)?.[1] ?? "",
    returnTo: "/quote-list",
  });
  expect(verified.status).toBe(302);
  const cookie = verified.headers.get("set-cookie")!.split(";", 1)[0];
  const address = await post(
    "/account?view=addresses",
    {
      intent: "create_address",
      addressLine1: "200 Park Avenue",
      city: "New York",
      countryCode: "US",
      label: "Main",
      postalCode: "10166",
      recipientEmail: "item-test@example.com",
      recipientName: "Buyer",
      recipientPhone: "+1 212 555 0109",
      stateProvince: "New York",
    },
    cookie,
  );
  expect(address.status).toBe(302);
  const added = await post(
    `/catalog/hydraulic-hose/${current.familyKey}`,
    {
      intent: "add-length-hose",
      sku: "601R1_001",
      lengthPerPiece: "10",
      lengthUnit: "ft",
      pieceCount: "1",
    },
    cookie,
  );
  expect(added.status, await added.text()).toBe(302);
  const quoteHtml = await (
    await fetch(origin + "/quote-list", { headers: { cookie } })
  ).text();
  const lines = sql<{ id: string }>(
    "SELECT id FROM anonymous_quote_lines WHERE sku='601R1_001'",
  );
  expect(lines).toHaveLength(1);
  const submit = await post(
    "/quote-list",
    {
      intent: "submit_individual_quote_request",
      idempotencyKey:
        hidden(quoteHtml, "idempotencyKey") || crypto.randomUUID(),
      selectedLineId: lines[0].id,
      accuracyConfirmed: "yes",
      commercialReviewConfirmed: "yes",
    },
    cookie,
  );
  expect(submit.status, await submit.text()).toBe(302);
  const stored = sql<{ snapshot_json: string }>(
    "SELECT snapshot_json FROM customer_quote_requests",
  );
  expect(stored).toHaveLength(1);
  const snapshot = JSON.parse(stored[0].snapshot_json);
  expect(snapshot.lines[0].productSnapshot.catalogBasis.skuRevisionId).toBe(
    current.catalogBasis?.skuRevisionId,
  );
  expect(snapshot.lines[0].productSnapshot.offer).toMatchObject({
    referencePrice: 12,
    currency: "USD",
  });
  expect((await post("/admin/catalog/items", publication("15"))).status).toBe(
    200,
  );
  expect((await post("/admin/catalog/items", first)).status).toBe(200);
  expect(
    sql<{ snapshot_json: string }>(
      "SELECT snapshot_json FROM customer_quote_requests",
    ),
  ).toEqual(stored);
  expect(
    sql<{ price: number }>(
      "SELECT reference_price_usd AS price FROM catalog_sales_offers WHERE id='active-offer'",
    ),
  ).toEqual([{ price: 3.25 }]);
  expect(
    sql<{ n: number }>(
      "SELECT count(*) AS n FROM admin_audit_events WHERE event_type='catalog_item.applied'",
    ),
  ).toEqual([{ n: 2 }]);
  const { product: after } = (await (
    await fetch(origin + "/api/catalog/products/601R1_001")
  ).json()) as { product: { offer: { referencePrice: number } } };
  expect(after.offer.referencePrice).toBe(15);
}, 120000);
