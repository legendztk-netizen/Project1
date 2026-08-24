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
    expect(storefront).not.toContain('href="/catalog/');
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
      `INSERT INTO catalog_imports (
         id, kind, status, summary_json, error_count, warning_count,
         created_at, completed_at
       ) VALUES (
         '${activeImportId}', 'workbook', 'completed', '{}', 0, 0, '${now}', '${now}'
       );
       INSERT INTO catalog_releases (
         id, release_number, status, source_import_id, version, created_at, published_at
       ) VALUES (
         '${activeReleaseId}', 'ACTIVE-${activeReleaseId}', 'published',
         '${activeImportId}', 1, '${now}', '${now}'
       );
       INSERT INTO catalog_skus (
         id, import_id, sku, source_worksheet, product_type, hose_series,
         catalog_publication_status, rfq_eligibility, technical_data_status,
         supply_availability
       ) VALUES (
         '${activeSkuId}', '${activeImportId}', '601R1_001', '01_胶管主数据',
         'hose', '601R1', 'Published', 'Eligible', 'Complete',
         'temporarily_unavailable'
       );`,
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
  });

  it("keeps a blocking workbook error out of draft releases", async () => {
    const activeImportId = `active-import-${crypto.randomUUID()}`;
    const activeReleaseId = `active-release-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    runLocalD1(
      `INSERT INTO catalog_imports (
        id, kind, status, summary_json, error_count, warning_count, created_at, completed_at
      ) VALUES (
        '${activeImportId}', 'diagnostic', 'completed', '{}', 0, 0, '${now}', '${now}'
      );
      INSERT INTO catalog_releases (
        id, release_number, status, source_import_id, version, created_at, published_at
      ) VALUES (
        '${activeReleaseId}', 'ACTIVE-${activeReleaseId}', 'published',
        '${activeImportId}', 1, '${now}', '${now}'
      );`,
    );
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
