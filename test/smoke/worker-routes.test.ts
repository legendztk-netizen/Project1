import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

import * as XLSX from "@e965/xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const host = "127.0.0.1";
let port: number;
let origin: string;
let preview: ChildProcess;
let previewExit: Promise<number | null>;

interface D1QueryResult<T> {
  results: T[];
  success: boolean;
}

function runLocalD1<T>(sql: string) {
  const result = spawnSync(
    join(process.cwd(), "node_modules", ".bin", "wrangler"),
    [
      "d1",
      "execute",
      "hydraulic-hose-rfq-local",
      "--config",
      join(process.cwd(), "wrangler.jsonc"),
      "--local",
      "--command",
      sql,
      "--json",
    ],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const payload = JSON.parse(result.stdout) as Array<D1QueryResult<T>>;
  expect(payload[0]?.success).toBe(true);
  return payload[0]?.results ?? [];
}

function runLocalD1Failure(sql: string) {
  const result = spawnSync(
    join(process.cwd(), "node_modules", ".bin", "wrangler"),
    [
      "d1",
      "execute",
      "hydraulic-hose-rfq-local",
      "--config",
      join(process.cwd(), "wrangler.jsonc"),
      "--local",
      "--command",
      sql,
    ],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  expect(result.status).not.toBe(0);
  return `${result.stdout}\n${result.stderr}`;
}

async function findAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local preview port"));
        return;
      }

      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + 25_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // The workerd preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Cloudflare Worker preview did not become ready");
}

beforeAll(async () => {
  port = await findAvailablePort();
  origin = `http://${host}:${port}`;
  preview = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "preview",
      "--host",
      host,
      "--port",
      String(port),
      "--strictPort",
    ],
    { stdio: "pipe" },
  );
  previewExit = new Promise((resolve) => preview.once("exit", resolve));

  await Promise.race([
    waitUntilReady(),
    previewExit.then((code) => {
      throw new Error(
        `Cloudflare Worker preview exited early with code ${code}`,
      );
    }),
  ]);
});

afterAll(async () => {
  if (preview && preview.exitCode === null) {
    preview.kill("SIGTERM");
    await previewExit;
  }
});

describe("Cloudflare Worker route surfaces", () => {
  it("serves machine-readable health from the Worker", async () => {
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("keeps the Storefront and Admin shells distinct", async () => {
    const [storefrontResponse, adminResponse] = await Promise.all([
      fetch(origin),
      fetch(`${origin}/admin`),
    ]);
    expect(storefrontResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);

    const [storefront, admin] = await Promise.all([
      storefrontResponse.text(),
      adminResponse.text(),
    ]);

    expect(storefront).toContain('data-surface="storefront"');
    expect(storefront).not.toContain('data-surface="admin"');
    expect(storefront).toContain('href="/catalog/hydraulic-hose"');
    expect(admin).toContain('data-surface="admin"');
    expect(admin).not.toContain('data-surface="storefront"');
    expect(admin).not.toContain('href="#"');
    expect(admin).toContain("owner@local.invalid");
    expect(admin).toContain("local-development");
  });

  it("persists a draft release through the Admin diagnostic and exposes no Storefront mutation", async () => {
    const createResponse = await fetch(
      `${origin}/admin/diagnostics/catalog-release`,
      {
        method: "POST",
        redirect: "manual",
      },
    );
    expect(createResponse.status).toBe(302);
    expect(createResponse.headers.get("location")).toMatch(
      /^\/admin\/diagnostics\/catalog-release\?created=/,
    );

    const diagnosticResponse = await fetch(
      `${origin}${createResponse.headers.get("location")}`,
    );
    expect(diagnosticResponse.status).toBe(200);
    const diagnostic = await diagnosticResponse.text();
    expect(diagnostic).toContain("Catalog release diagnostic");
    expect(diagnostic).toContain("Draft");
    expect(diagnostic).toContain("Not published");

    const storefrontMutation = await fetch(origin, { method: "POST" });
    expect(storefrontMutation.status).toBe(405);
  });

  it("imports the supplied 01-07 workbook into one reviewable D1 draft", async () => {
    const workbook = await readFile(
      "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    );
    const form = new FormData();
    form.set(
      "workbook",
      new File([workbook], "hose-product-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const importResponse = await fetch(`${origin}/admin/catalog/import`, {
      body: form,
      method: "POST",
      redirect: "manual",
    });
    expect(importResponse.status).toBe(302);
    expect(importResponse.headers.get("location")).toMatch(
      /^\/admin\/catalog\/import\?import=/,
    );
    const importId = new URL(
      importResponse.headers.get("location") ?? "",
      origin,
    ).searchParams.get("import");
    expect(importId).toBeTruthy();

    const reviewResponse = await fetch(
      `${origin}${importResponse.headers.get("location")}`,
    );
    expect(reviewResponse.status).toBe(200);
    const review = await reviewResponse.text();
    expect(review).toContain("Draft release created");
    expect(review).toContain("Hose variants");
    expect(review).toContain(">61<");
    expect(review).toContain("Hose ends");
    expect(review).toContain(">200<");
    expect(review).toContain("Exact combinations");
    expect(review).toContain(">1081<");
    expect(review).toContain("Adapter families");
    expect(review).toContain(">17<");
    expect(review).toContain("Adapter SKUs");
    expect(review).toContain(">136<");
    expect(review).toContain("Quick couplers");
    expect(review).toContain(">57<");
    expect(review).toContain("Sales offers");
    expect(review).toContain("USD reference prices");
    expect(review).toContain("Total sale SKUs");
    expect(review).toContain(">515<");
    expect(review).toContain("All imported SKUs start Temporarily Unavailable");
    expect(review).toContain("only Approved + Complete");

    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_adapters WHERE import_id = '${importId}'`,
      ),
    ).toEqual([{ count: 136 }]);
    expect(
      runLocalD1<{
        connection_form_1: string;
        connection_form_2: string;
        interface_1: string;
        interface_2: string;
        shape_code: string;
        size_1: string;
        size_2: string;
      }>(
        `SELECT shape_code, interface_1, connection_form_1, size_1,
                interface_2, connection_form_2, size_2
         FROM catalog_adapters
         WHERE import_id = '${importId}' AND sku = 'ADP_ST_JIC_M_10_NPT_M_04'`,
      ),
    ).toEqual([
      {
        connection_form_1: "M",
        connection_form_2: "M",
        interface_1: "JIC",
        interface_2: "NPT",
        shape_code: "ST",
        size_1: "-10",
        size_2: "-4",
      },
    ]);
    expect(
      runLocalD1<{
        body_dash: string;
        max_working_bar: number | null;
        port_code: string;
        port_dash: string;
        role: string;
        sku_standard_code: string;
      }>(
        `SELECT sku_standard_code, role, body_dash, port_code, port_dash, max_working_bar
         FROM catalog_quick_couplers
         WHERE import_id = '${importId}' AND sku = 'QDC_16028_SOC_04_FNPT_04'`,
      ),
    ).toEqual([
      {
        body_dash: "04",
        max_working_bar: null,
        port_code: "FNPT",
        port_dash: "04",
        role: "Coupler/Socket",
        sku_standard_code: "16028",
      },
    ]);
    expect(
      runLocalD1<{ currency: string; reference_price_usd: number }>(
        `SELECT currency, reference_price_usd FROM catalog_sales_offers
         WHERE import_id = '${importId}' AND sales_sku = '601R1_001'`,
      ),
    ).toEqual([{ currency: "USD", reference_price_usd: 2.16 }]);
    expect(
      runLocalD1<{ name: string }>("PRAGMA table_info(catalog_sales_offers)")
        .map((column) => column.name)
        .includes("factory_unit_price"),
    ).toBe(false);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_cost_bases
         WHERE import_id = '${importId}' AND factory_unit_price IS NOT NULL`,
      ),
    ).toEqual([{ count: 0 }]);

    const storefront = await (await fetch(origin)).text();
    expect(storefront).not.toContain("Cost Basis");
    expect(storefront).not.toContain("factory_unit_price");
    const publicCostBasis = await fetch(
      `${origin}/api/catalog/cost-basis/601R1_001`,
    );
    expect(publicCostBasis.status).toBe(404);
  });

  it("reviews and changes only draft Supply Availability through confirmation", async () => {
    const [draft] = runLocalD1<{
      id: string;
      source_import_id: string;
    }>(
      `SELECT catalog_releases.id, catalog_releases.source_import_id
       FROM catalog_releases
       INNER JOIN catalog_imports
         ON catalog_imports.id = catalog_releases.source_import_id
       WHERE catalog_releases.status = 'draft'
         AND catalog_imports.kind = 'workbook'
         AND catalog_imports.status = 'completed'
       ORDER BY catalog_releases.created_at DESC LIMIT 1`,
    );
    expect(draft).toBeTruthy();
    if (!draft) throw new Error("Expected one imported workbook draft");

    runLocalD1(
      `UPDATE catalog_cost_bases SET factory_unit_price = 1.11
       WHERE import_id = '${draft.source_import_id}' AND sales_sku = '601R1_001'`,
    );
    const reviewResponse = await fetch(
      `${origin}/admin/catalog/review?release=${draft.id}&sku=601R1_001`,
    );
    const review = await reviewResponse.text();
    expect(reviewResponse.status).toBe(200);
    expect(review).toContain("Review draft products");
    expect(review).toContain("601R1_001");
    expect(review).toContain("Cost Basis");
    expect(review).toContain("USD 1.11");

    const activeImportId = `availability-active-import-${crypto.randomUUID()}`;
    const activeReleaseId = `availability-active-release-${crypto.randomUUID()}`;
    const activeSkuId = `availability-active-sku-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    runLocalD1(
      `UPDATE catalog_releases SET status = 'superseded' WHERE status = 'published';
       INSERT INTO catalog_imports (
         id, kind, status, summary_json, error_count, warning_count,
         created_at, completed_at
       ) VALUES (
         '${activeImportId}', 'workbook', 'completed', '{}', 0, 0, '${now}', '${now}'
       );
       INSERT INTO catalog_skus (
         id, import_id, sku, source_worksheet, product_type, hose_series,
         catalog_publication_status, rfq_eligibility, technical_data_status,
         supply_availability
       ) VALUES (
         '${activeSkuId}', '${activeImportId}', '601R1_001', '01_胶管主数据',
         'hose', '601R1', 'Published', 'Eligible', 'Complete',
         'temporarily_unavailable'
       );
       INSERT INTO catalog_releases (
         id, release_number, status, source_import_id, version, created_at, published_at
       ) VALUES (
         '${activeReleaseId}', 'ACTIVE-${activeReleaseId}', 'published',
         '${activeImportId}', 1, '${now}', '${now}'
       );
       UPDATE catalog_active_release
       SET release_id = '${activeReleaseId}', version = version + 1, updated_at = '${now}'
       WHERE singleton = 1;`,
    );

    const auditBefore = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM admin_audit_events
       WHERE entity_id = '${draft.id}'
         AND event_type = 'catalog_release.supply_availability_bulk_changed'`,
    )[0]?.count;

    const previewSelected = new FormData();
    previewSelected.set("intent", "preview");
    previewSelected.set("releaseId", draft.id);
    previewSelected.set("selectorMode", "selected");
    previewSelected.set("selectedSku", "601R1_001");
    previewSelected.set("target", "available_for_quote");
    const previewResponse = await fetch(`${origin}/admin/catalog/review`, {
      body: previewSelected,
      method: "POST",
    });
    const preview = await previewResponse.text();
    expect(previewResponse.status).toBe(200);
    expect(preview).toContain("Confirm bulk change");
    expect(preview).toContain('data-affected-count="1"');
    expect(preview).toContain('data-matched-count="1"');
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_001'`,
      ),
    ).toEqual([{ supply_availability: "temporarily_unavailable" }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM admin_audit_events
         WHERE entity_id = '${draft.id}'
           AND event_type = 'catalog_release.supply_availability_bulk_changed'`,
      )[0]?.count,
    ).toBe(auditBefore);

    for (const [selectorMode, selectorName, selectorValue] of [
      ["worksheet", "sourceWorksheet", "02_压接接头"],
      ["hose_series", "hoseSeries", "601R1"],
    ] as const) {
      const form = new FormData();
      form.set("intent", "preview");
      form.set("releaseId", draft.id);
      form.set("selectorMode", selectorMode);
      form.set(selectorName, selectorValue);
      form.set("target", "discontinued");
      const response = await fetch(`${origin}/admin/catalog/review`, {
        body: form,
        method: "POST",
      });
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain("Confirm bulk change");
      expect(html).toMatch(/data-affected-count="[1-9][0-9]*"/);
      expect(html).toMatch(/data-matched-count="[1-9][0-9]*"/);
    }

    const applySelected = new FormData();
    applySelected.set("intent", "apply");
    applySelected.set("releaseId", draft.id);
    applySelected.set("selectorMode", "selected");
    applySelected.set("selectedSku", "601R1_001");
    applySelected.set("target", "available_for_quote");
    const applyResponse = await fetch(`${origin}/admin/catalog/review`, {
      body: applySelected,
      method: "POST",
      redirect: "manual",
    });
    const applyBody = await applyResponse.text();
    expect(applyResponse.status, applyBody).toBe(302);
    expect(applyResponse.headers.get("location")).toContain("updated=1");
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_001'`,
      ),
    ).toEqual([{ supply_availability: "available_for_quote" }]);
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${activeImportId}' AND sku = '601R1_001'`,
      ),
    ).toEqual([{ supply_availability: "temporarily_unavailable" }]);

    const audits = runLocalD1<{ payload_json: string }>(
      `SELECT payload_json FROM admin_audit_events
       WHERE entity_id = '${draft.id}'
         AND event_type = 'catalog_release.supply_availability_bulk_changed'
       ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(JSON.parse(audits[0]?.payload_json ?? "{}")).toMatchObject({
      affectedCount: 1,
      affectedSkus: ["601R1_001"],
      selector: { mode: "selected", skus: ["601R1_001"] },
      target: "available_for_quote",
    });

    const mixed = new FormData();
    mixed.set("intent", "preview");
    mixed.set("releaseId", draft.id);
    mixed.set("selectorMode", "selected");
    mixed.append("selectedSku", "601R1_001");
    mixed.append("selectedSku", "601R1_002");
    mixed.set("target", "available_for_quote");
    const mixedHtml = await (
      await fetch(`${origin}/admin/catalog/review`, {
        body: mixed,
        method: "POST",
      })
    ).text();
    expect(mixedHtml).toContain('data-affected-count="1"');
    expect(mixedHtml).toContain('data-matched-count="2"');

    const zero = new FormData();
    zero.set("intent", "preview");
    zero.set("releaseId", draft.id);
    zero.set("selectorMode", "selected");
    zero.set("selectedSku", "601R1_001");
    zero.set("target", "available_for_quote");
    const zeroHtml = await (
      await fetch(`${origin}/admin/catalog/review`, {
        body: zero,
        method: "POST",
      })
    ).text();
    expect(zeroHtml).toContain('data-affected-count="0"');
    expect(zeroHtml).toContain('data-matched-count="1"');
    expect(zeroHtml).not.toContain("Apply to 0 products");
    runLocalD1(
      `UPDATE catalog_cost_bases SET factory_unit_price = NULL
       WHERE import_id = '${draft.source_import_id}' AND sales_sku = '601R1_001'`,
    );
  });

  it("atomically publishes one release and rejects stale or invalid publication", async () => {
    const [draft] = runLocalD1<{
      id: string;
      release_number: string;
      source_import_id: string;
      version: number;
    }>(
      `SELECT id, release_number, source_import_id, version
       FROM catalog_releases
       WHERE status = 'draft' AND source_import_id IN (
         SELECT id FROM catalog_imports WHERE kind = 'workbook' AND status = 'completed'
       ) ORDER BY created_at DESC LIMIT 1`,
    );
    const [activeBefore] = runLocalD1<{
      active_generation: number;
      id: string;
      release_number: string;
      source_import_id: string;
    }>(
      `SELECT catalog_active_release.version AS active_generation,
              catalog_releases.id, catalog_releases.release_number,
              catalog_releases.source_import_id
       FROM catalog_active_release
       INNER JOIN catalog_releases ON catalog_releases.id = catalog_active_release.release_id
       WHERE catalog_active_release.singleton = 1`,
    );
    expect(draft).toBeTruthy();
    expect(activeBefore).toBeTruthy();
    if (!draft || !activeBefore)
      throw new Error("Expected draft and active releases");

    runLocalD1(
      `UPDATE catalog_skus
       SET catalog_publication_status = 'Published'
       WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_002'`,
    );
    const [revalidatedDraftVersion] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
    );
    expect(revalidatedDraftVersion?.version).toBeGreaterThan(draft.version);
    draft.version = revalidatedDraftVersion?.version ?? draft.version;

    const storefrontBefore = await (await fetch(origin)).text();
    expect(storefrontBefore).toContain("Current catalog");
    const activeProductBefore = await fetch(
      `${origin}/api/catalog/products/601R1_001`,
    );
    expect(activeProductBefore.status).toBe(200);
    const activeProductBeforePayload = await activeProductBefore.json();
    expect(activeProductBeforePayload).toMatchObject({
      product: {
        canAddToQuote: false,
        releaseId: activeBefore.id,
        sku: "601R1_001",
        supplyAvailability: "temporarily_unavailable",
      },
    });

    const previewResponse = await fetch(
      `${origin}/admin/catalog/releases?release=${draft.id}`,
    );
    const previewHtml = await previewResponse.text();
    expect(previewResponse.status).toBe(200);
    expect(previewHtml).toContain("Catalog Releases");
    expect(previewHtml).toContain("Additions");
    expect(previewHtml).toContain("Changes");
    expect(previewHtml).toContain("Hose Series 601R1");
    expect(previewHtml).toContain("View all");
    expect(previewHtml).toContain("Deactivations");
    expect(previewHtml).toContain("Warnings");
    expect(previewHtml).toContain("Blockers");
    expect(previewHtml).not.toContain("Cost Basis");

    const confirm = new FormData();
    confirm.set("intent", "confirm");
    confirm.set("releaseId", draft.id);
    const confirmationResponse = await fetch(
      `${origin}/admin/catalog/releases`,
      { body: confirm, method: "POST" },
    );
    const confirmationHtml = await confirmationResponse.text();
    expect(confirmationResponse.status).toBe(200);
    expect(confirmationHtml).toContain("Final confirmation");
    expect(confirmationHtml).toContain("Publish Catalog Release");

    const publish = new FormData();
    publish.set("intent", "publish");
    publish.set("releaseId", draft.id);
    publish.set("expectedDraftVersion", String(draft.version));
    publish.set(
      "expectedActiveGeneration",
      String(activeBefore.active_generation),
    );
    publish.set("expectedActiveReleaseId", activeBefore.id);
    const publishResponse = await fetch(`${origin}/admin/catalog/releases`, {
      body: publish,
      headers: { "x-request-id": `smoke-publish-${draft.id}` },
      method: "POST",
      redirect: "manual",
    });
    expect(publishResponse.status, await publishResponse.text()).toBe(302);
    expect(publishResponse.headers.get("location")).toContain(
      `published=${draft.id}`,
    );

    const releases = runLocalD1<{
      id: string;
      published_at: string | null;
      status: string;
    }>(
      `SELECT id, status, published_at FROM catalog_releases
       WHERE id IN ('${activeBefore.id}', '${draft.id}') ORDER BY id`,
    );
    expect(
      releases.find((release) => release.id === activeBefore.id)?.status,
    ).toBe("superseded");
    expect(releases.find((release) => release.id === draft.id)).toMatchObject({
      status: "published",
    });
    expect(
      releases.find((release) => release.id === draft.id)?.published_at,
    ).toBeTruthy();
    const [activeAfter] = runLocalD1<{
      active_generation: number;
      release_id: string;
    }>(
      `SELECT version AS active_generation, release_id
       FROM catalog_active_release WHERE singleton = 1`,
    );
    expect(activeAfter?.release_id).toBe(draft.id);
    expect(activeAfter?.active_generation).toBe(
      activeBefore.active_generation + 1,
    );

    const audit = runLocalD1<{
      actor_id: string;
      payload_json: string;
    }>(
      `SELECT actor_id, payload_json FROM admin_audit_events
       WHERE entity_id = '${draft.id}' AND event_type = 'catalog_release.published'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_id).toBe("local-owner");
    const auditPayload = JSON.parse(audit[0]?.payload_json ?? "{}");
    expect(auditPayload).toMatchObject({
      previousReleaseId: activeBefore.id,
      requestCorrelationId: `smoke-publish-${draft.id}`,
    });
    expect(auditPayload).not.toHaveProperty("factoryUnitPrice");
    expect(auditPayload).not.toHaveProperty("costBasis");

    const storefrontAfter = await (await fetch(origin)).text();
    expect(storefrontAfter).toContain("Current catalog");
    expect(storefrontAfter).not.toContain("Cost Basis");
    const activeProductAfter = await fetch(
      `${origin}/api/catalog/products/601R1_002`,
    );
    expect(activeProductAfter.status).toBe(200);
    const activeProductAfterText = await activeProductAfter.text();
    expect(JSON.parse(activeProductAfterText)).toMatchObject({
      product: {
        canAddToQuote: false,
        releaseId: draft.id,
        sku: "601R1_002",
        supplyAvailability: "temporarily_unavailable",
      },
    });
    expect(activeProductAfterText).not.toContain("factory_unit_price");
    expect(activeProductAfterText).not.toContain("costBasis");
    expect(
      (await fetch(`${origin}/api/catalog/products/601R1_001`)).status,
    ).toBe(404);
    const historicalProduct = await fetch(
      `${origin}/api/catalog/releases/${activeBefore.id}/products/601R1_001`,
    );
    expect(historicalProduct.status).toBe(200);
    await expect(historicalProduct.json()).resolves.toMatchObject({
      product: { releaseId: activeBefore.id, sku: "601R1_001" },
    });
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}'
           AND supply_availability = 'temporarily_unavailable'`,
      )[0]?.count,
    ).toBeGreaterThan(0);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_skus
         WHERE import_id = '${activeBefore.source_import_id}'`,
      )[0]?.count,
    ).toBe(1);

    const immutableEdit = runLocalD1Failure(
      `UPDATE catalog_skus SET supply_availability = 'discontinued'
       WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_002'`,
    );
    expect(immutableEdit).toContain("published catalog data is immutable");
    const immutableInsert = runLocalD1Failure(
      `INSERT INTO catalog_skus (
         id, import_id, sku, source_worksheet, product_type, hose_series,
         catalog_publication_status, rfq_eligibility, technical_data_status,
         supply_availability
       ) VALUES (
         'forbidden-${crypto.randomUUID()}', '${draft.source_import_id}',
         'FORBIDDEN_001', '01_胶管主数据', 'hose', '601R1',
         'Published', 'Eligible', 'Complete', 'available_for_quote'
       )`,
    );
    expect(immutableInsert).toContain("published catalog data is immutable");

    const publishedSkuBefore = runLocalD1<{
      supply_availability: string;
    }>(
      `SELECT supply_availability FROM catalog_skus
       WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_001'`,
    );
    const publishedVersionBefore = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
    );
    const forbiddenEdit = new FormData();
    forbiddenEdit.set("intent", "apply");
    forbiddenEdit.set("releaseId", draft.id);
    forbiddenEdit.set("selectorMode", "selected");
    forbiddenEdit.set("selectedSku", "601R1_001");
    forbiddenEdit.set("target", "discontinued");
    const forbiddenEditResponse = await fetch(
      `${origin}/admin/catalog/review`,
      { body: forbiddenEdit, method: "POST" },
    );
    expect(forbiddenEditResponse.status).toBe(200);
    expect(await forbiddenEditResponse.text()).toContain(
      "No draft products require this change",
    );
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_001'`,
      ),
    ).toEqual(publishedSkuBefore);
    expect(
      runLocalD1<{ version: number }>(
        `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
      ),
    ).toEqual(publishedVersionBefore);

    const workbook = await readFile(
      "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    );
    const nextImport = new FormData();
    nextImport.set(
      "workbook",
      new File([workbook], "next-product-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const nextImportResponse = await fetch(`${origin}/admin/catalog/import`, {
      body: nextImport,
      method: "POST",
      redirect: "manual",
    });
    const nextImportLocation = nextImportResponse.headers.get("location");
    expect(nextImportResponse.status).toBe(302);
    const nextImportId = new URL(
      nextImportLocation ?? "",
      origin,
    ).searchParams.get("import");
    const [nextDraft] = runLocalD1<{
      id: string;
      version: number;
    }>(
      `SELECT id, version FROM catalog_releases
       WHERE source_import_id = '${nextImportId}' AND status = 'draft'`,
    );
    expect(nextDraft).toBeTruthy();
    if (!nextDraft || !activeAfter) throw new Error("Expected next draft");

    const competingImport = new FormData();
    competingImport.set(
      "workbook",
      new File([workbook], "competing-product-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const competingImportResponse = await fetch(
      `${origin}/admin/catalog/import`,
      { body: competingImport, method: "POST", redirect: "manual" },
    );
    expect(competingImportResponse.status).toBe(302);
    const competingImportId = new URL(
      competingImportResponse.headers.get("location") ?? "",
      origin,
    ).searchParams.get("import");
    const [competingDraft] = runLocalD1<{ id: string; version: number }>(
      `SELECT id, version FROM catalog_releases
       WHERE source_import_id = '${competingImportId}' AND status = 'draft'`,
    );
    expect(competingDraft).toBeTruthy();
    if (!competingDraft) throw new Error("Expected competing draft");

    const publicationForm = (releaseId: string, releaseVersion: number) => {
      const form = new FormData();
      form.set("intent", "publish");
      form.set("releaseId", releaseId);
      form.set("expectedDraftVersion", String(releaseVersion));
      form.set(
        "expectedActiveGeneration",
        String(activeAfter.active_generation),
      );
      form.set("expectedActiveReleaseId", draft.id);
      return form;
    };
    const competingResponses = await Promise.all(
      [nextDraft, competingDraft].map((candidate) =>
        fetch(`${origin}/admin/catalog/releases`, {
          body: publicationForm(candidate.id, candidate.version),
          headers: { "x-request-id": `concurrent-${candidate.id}` },
          method: "POST",
          redirect: "manual",
        }),
      ),
    );
    expect(
      competingResponses.map((response) => response.status).sort(),
    ).toEqual([200, 302]);
    const [activeWinner] = runLocalD1<{
      active_generation: number;
      release_id: string;
    }>(
      `SELECT release_id, version AS active_generation
       FROM catalog_active_release WHERE singleton = 1`,
    );
    expect([nextDraft.id, competingDraft.id]).toContain(
      activeWinner?.release_id,
    );
    const loser =
      activeWinner?.release_id === nextDraft.id ? competingDraft : nextDraft;
    const loserImportId =
      loser.id === nextDraft.id ? nextImportId : competingImportId;
    expect(loserImportId).toBeTruthy();
    const candidateReleases = runLocalD1<{ id: string; status: string }>(
      `SELECT id, status FROM catalog_releases
       WHERE id IN ('${nextDraft.id}', '${competingDraft.id}') ORDER BY id`,
    );
    expect(
      candidateReleases.find(
        (release) => release.id === activeWinner?.release_id,
      )?.status,
    ).toBe("published");
    expect(
      candidateReleases.find((release) => release.id === loser.id)?.status,
    ).toBe("draft");
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_release_publications
         WHERE release_id = '${loser.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM admin_audit_events
         WHERE entity_id = '${loser.id}'
           AND event_type = 'catalog_release.published'`,
      ),
    ).toEqual([{ count: 0 }]);

    const [nextImportSummary] = runLocalD1<{ summary_json: string }>(
      `SELECT summary_json FROM catalog_imports WHERE id = '${loserImportId}'`,
    );
    const expectedSalesOfferCount = Number(
      JSON.parse(nextImportSummary?.summary_json ?? "{}").salesOfferCount,
    );
    const [versionBeforeCorruption] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${loser.id}'`,
    );
    runLocalD1(
      `UPDATE catalog_imports
       SET summary_json = json_set(summary_json, '$.salesOfferCount', ${expectedSalesOfferCount + 1})
       WHERE id = '${loserImportId}'`,
    );
    const [versionAfterCorruption] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${loser.id}'`,
    );
    expect(versionAfterCorruption?.version).toBe(
      (versionBeforeCorruption?.version ?? 0) + 1,
    );
    const invalidDatabaseAttempt = runLocalD1Failure(
      `INSERT INTO catalog_release_publications (
         release_id, previous_release_id, expected_active_version,
         expected_draft_version, published_by, request_correlation_id, published_at
       ) VALUES (
         '${loser.id}', '${activeWinner?.release_id}', ${activeWinner?.active_generation},
         ${versionAfterCorruption?.version}, 'local-owner',
         'invalid-${loser.id}', CURRENT_TIMESTAMP
       )`,
    );
    expect(invalidDatabaseAttempt).toContain(
      "catalog publication precondition failed",
    );
    const blockedResponse = await fetch(
      `${origin}/admin/catalog/releases?release=${loser.id}`,
    );
    const blockedHtml = await blockedResponse.text();
    expect(blockedHtml).toContain("count_mismatch_salesOfferCount");
    expect(blockedHtml).toContain("Resolve blockers before publishing");
    expect(
      runLocalD1<{ release_id: string }>(
        "SELECT release_id FROM catalog_active_release WHERE singleton = 1",
      ),
    ).toEqual([{ release_id: activeWinner?.release_id }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_release_publications
         WHERE release_id = '${loser.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
    runLocalD1(
      `UPDATE catalog_imports
       SET summary_json = json_set(summary_json, '$.salesOfferCount', ${expectedSalesOfferCount})
       WHERE id = '${loserImportId}'`,
    );

    const metadataMutation = runLocalD1Failure(
      `UPDATE catalog_releases SET source_import_id = '${draft.source_import_id}'
       WHERE id = '${loser.id}'`,
    );
    expect(metadataMutation).toContain(
      "draft catalog release metadata is immutable",
    );

    const [rollbackDraft] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${loser.id}'`,
    );
    const rollbackRequestId = `rollback-${loser.id}`;
    runLocalD1(
      `INSERT INTO admin_audit_events (
         id, event_type, entity_type, entity_id,
         actor_id, payload_json, occurred_at
       ) VALUES (
         'catalog-release-published:${rollbackRequestId}',
         'catalog_release.rollback_fixture', 'catalog_release', '${loser.id}',
         'local-owner', '{}', CURRENT_TIMESTAMP
       )`,
    );
    const rollbackForm = new FormData();
    rollbackForm.set("intent", "publish");
    rollbackForm.set("releaseId", loser.id);
    rollbackForm.set("expectedDraftVersion", String(rollbackDraft?.version));
    rollbackForm.set(
      "expectedActiveGeneration",
      String(activeWinner?.active_generation),
    );
    rollbackForm.set("expectedActiveReleaseId", activeWinner?.release_id ?? "");
    const rollbackResponse = await fetch(`${origin}/admin/catalog/releases`, {
      body: rollbackForm,
      headers: { "x-request-id": rollbackRequestId },
      method: "POST",
      redirect: "manual",
    });
    expect(rollbackResponse.status).toBe(200);
    expect(await rollbackResponse.text()).toContain(
      "Catalog Release publication failed.",
    );
    expect(
      runLocalD1<{ release_id: string }>(
        "SELECT release_id FROM catalog_active_release WHERE singleton = 1",
      ),
    ).toEqual([{ release_id: activeWinner?.release_id }]);
    expect(
      runLocalD1<{ status: string }>(
        `SELECT status FROM catalog_releases WHERE id = '${loser.id}'`,
      ),
    ).toEqual([{ status: "draft" }]);
    expect(
      runLocalD1<{ status: string }>(
        `SELECT status FROM catalog_releases WHERE id = '${activeWinner?.release_id}'`,
      ),
    ).toEqual([{ status: "published" }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_release_publications
         WHERE release_id = '${loser.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
  }, 120_000);

  it("serves the five-class published storefront without exposing cost data", async () => {
    const workbook = await readFile(
      "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    );
    const form = new FormData();
    form.set(
      "workbook",
      new File([workbook], "published-storefront-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const importResponse = await fetch(`${origin}/admin/catalog/import`, {
      body: form,
      method: "POST",
      redirect: "manual",
    });
    expect(importResponse.status).toBe(302);
    const importId = new URL(
      importResponse.headers.get("location") ?? "",
      origin,
    ).searchParams.get("import");
    expect(importId).toBeTruthy();

    const [draft] = runLocalD1<{ id: string }>(
      `SELECT id FROM catalog_releases
       WHERE source_import_id = '${importId}' AND status = 'draft'`,
    );
    const [active] = runLocalD1<{
      active_generation: number;
      release_id: string;
    }>(
      `SELECT version AS active_generation, release_id
       FROM catalog_active_release WHERE singleton = 1`,
    );
    expect(draft).toBeTruthy();
    expect(active).toBeTruthy();
    if (!draft || !active || !importId)
      throw new Error("Expected imported draft and active release");

    runLocalD1(
      `UPDATE catalog_skus
       SET catalog_publication_status = 'Published'
       WHERE import_id = '${importId}';
       UPDATE catalog_skus
       SET supply_availability = 'available_for_quote'
       WHERE import_id = '${importId}'
         AND sku IN (
           '601R1_001', 'JIC_F_SW_04_04', '601R1_1WB_001',
           'ADP_ST_JIC_M_02_NPT_M_02'
         );
       UPDATE catalog_skus
       SET supply_availability = 'discontinued'
       WHERE import_id = '${importId}' AND sku = 'QDC_16028_PLG_04_FNPT_04';`,
    );
    const [draftState] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
    );

    const publish = new FormData();
    publish.set("intent", "publish");
    publish.set("releaseId", draft.id);
    publish.set("expectedDraftVersion", String(draftState?.version));
    publish.set("expectedActiveGeneration", String(active.active_generation));
    publish.set("expectedActiveReleaseId", active.release_id);
    const publishResponse = await fetch(`${origin}/admin/catalog/releases`, {
      body: publish,
      headers: { "x-request-id": `storefront-${draft.id}` },
      method: "POST",
      redirect: "manual",
    });
    expect(publishResponse.status, await publishResponse.text()).toBe(302);

    const storefrontResponse = await fetch(origin);
    const storefront = await storefrontResponse.text();
    expect(storefrontResponse.status).toBe(200);
    expect(storefront).toContain('href="/catalog/hydraulic-hose/');
    expect(storefront).toContain('href="/catalog/hose-ends/');
    expect(storefront).toContain('href="/catalog/ferrules/');
    expect(storefront).toContain('href="/catalog/adapters/');
    expect(storefront).toContain('href="/catalog/quick-couplers/');
    expect(storefront).not.toMatch(
      /href="\/catalog\/(?:hydraulic-hose|hose-ends)\/[^"?]+\?sku=/,
    );
    expect(storefront).not.toContain("Cost Basis");
    expect(storefront).not.toContain("factory_unit_price");

    const search = await (await fetch(`${origin}/?q=9%2F16-18+UNF`)).text();
    expect(search).toContain("JIC 37° Female Swivel 0° Straight Hose End");
    expect(search).toContain("JIC_F_SW_06_");

    const aliasSearch = await (await fetch(`${origin}/?q=FBSPX-04-04W`)).text();
    expect(aliasSearch).toContain("BSPP Female Swivel 0° Straight Hose End");
    expect(aliasSearch).toContain("BSPP_F_SW_04_04");

    const availablePath =
      "/catalog/hose-ends/jic-37-female-swivel-0-straight?sku=JIC_F_SW_04_04";
    const available = await (await fetch(`${origin}${availablePath}`)).text();
    expect(available).toContain("SAE J514");
    expect(available).toContain("9/16-18 UNF");
    expect(available).toContain("Available for Quote");
    expect(available).toContain("1. Connection Dash");
    expect(available).toContain("2. Hose Tail Dash");
    expect(available).toContain('data-connection-dash="-4"');
    expect(available).toContain('data-hose-tail-dash="-4"');
    expect(available).toContain("7/16-20 UNF");
    expect(available).toContain("1/4 in hose ID");
    expect(available).not.toContain("Size / connection variant");
    expect(available).toMatch(
      /<button[^>]*product-quote-command[^>]*>[^]*Add to Quote/,
    );
    expect(available).toContain('data-command="add-to-quote"');
    expect(available).toContain('data-sku="JIC_F_SW_04_04"');
    expect(available).not.toMatch(/product-quote-command[^>]*disabled/);
    expect(available).toContain("14 calendar days");
    expect(available).toContain("10% restocking fee");

    const unselectedHoseEnd = await (
      await fetch(`${origin}/catalog/hose-ends/jic-37-female-swivel-0-straight`)
    ).text();
    expect(unselectedHoseEnd).toContain("1. Connection Dash");
    expect(unselectedHoseEnd).not.toContain("2. Hose Tail Dash");
    expect(unselectedHoseEnd).toContain("Choose a size to continue.");
    expect(unselectedHoseEnd).not.toContain('data-sku="JIC_F_SW_04_04"');
    expect(unselectedHoseEnd).not.toContain("Technical specifications");
    expect(unselectedHoseEnd).toMatch(/product-quote-command[^>]*disabled/);

    const unavailable = await (
      await fetch(`${origin}/catalog/hydraulic-hose/601r1?sku=601R1_002`)
    ).text();
    expect(unavailable).toContain("Temporarily Unavailable");
    expect(unavailable).toMatch(/product-quote-command[^>]*disabled/);

    const discontinued = await (
      await fetch(
        `${origin}/catalog/quick-couplers/iso-16028-flat-face-plug-nipple-nptf-female?sku=QDC_16028_PLG_04_FNPT_04`,
      )
    ).text();
    expect(discontinued).toContain("Discontinued");
    expect(discontinued).toMatch(/product-quote-command[^>]*disabled/);

    const mediaFallback = await (
      await fetch(
        `${origin}/catalog/ferrules/601r1-1-wire-braid-other?sku=601R1_1WB_001`,
      )
    ).text();
    expect(mediaFallback).toContain("Technical image pending");

    const hoseVariant = await (
      await fetch(`${origin}/catalog/hydraulic-hose/601r1?sku=601R1_001`)
    ).text();
    expect(hoseVariant).toContain("Hose Size");
    expect(hoseVariant).toContain('data-hose-dash="-4"');
    expect(hoseVariant).toContain("1/4 in hose ID");
    expect(hoseVariant).not.toContain("Size / connection variant");

    const unselectedHose = await (
      await fetch(`${origin}/catalog/hydraulic-hose/601r1`)
    ).text();
    expect(unselectedHose).toContain("Hose Size");
    expect(unselectedHose).toContain("Choose a size to continue.");
    expect(unselectedHose).not.toContain('data-sku="601R1_001"');
    expect(unselectedHose).not.toContain("Technical specifications");
    expect(unselectedHose).toMatch(/product-quote-command[^>]*disabled/);

    const productResponse = await fetch(
      `${origin}/api/catalog/products/JIC_F_SW_04_04`,
    );
    const productText = await productResponse.text();
    expect(productResponse.status).toBe(200);
    expect(productText).toContain("SAE J514");
    expect(productText).not.toContain("factory_unit_price");
    expect(productText).not.toContain("costBasis");
  }, 120_000);

  it("keeps a blocking workbook error out of draft releases", async () => {
    const activeBefore = runLocalD1<{ id: string }>(
      "SELECT id FROM catalog_releases WHERE status = 'published' ORDER BY id",
    );

    const source = await readFile(
      "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    );
    const workbook = XLSX.read(source, { type: "buffer" });
    const compatibility = workbook.Sheets["04_兼容压接"];
    compatibility.C5.v = "UNKNOWN_HOSE";
    const invalidWorkbook = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    });
    const form = new FormData();
    form.set(
      "workbook",
      new File([invalidWorkbook], "invalid-product-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const importResponse = await fetch(`${origin}/admin/catalog/import`, {
      body: form,
      method: "POST",
      redirect: "manual",
    });
    expect(importResponse.status).toBe(302);
    const importLocation = importResponse.headers.get("location");
    expect(importLocation).toMatch(/^\/admin\/catalog\/import\?import=/);
    const failedImportId = new URL(
      importLocation ?? "",
      origin,
    ).searchParams.get("import");
    expect(failedImportId).toBeTruthy();

    const reviewResponse = await fetch(`${origin}${importLocation}`);
    const review = await reviewResponse.text();
    expect(reviewResponse.status).toBe(200);
    expect(review).toContain("Import blocked");
    expect(review).toContain("Not created");
    expect(review).toContain("UNKNOWN_HOSE");
    expect(review).toContain("does not exist in 01_胶管主数据");
    expect(review).not.toContain("Draft release created");

    const activeAfter = runLocalD1<{ id: string }>(
      "SELECT id FROM catalog_releases WHERE status = 'published' ORDER BY id",
    );
    const failedDrafts = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM catalog_releases
       WHERE source_import_id = '${failedImportId}'`,
    );
    expect(activeAfter).toEqual(activeBefore);
    expect(failedDrafts).toEqual([{ count: 0 }]);
  });
});
