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

  it("imports the supplied 01-04 workbook into a reviewable D1 draft", async () => {
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
    expect(review).toContain("All imported SKUs start Temporarily Unavailable");
    expect(review).toContain("only Approved + Complete");
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
