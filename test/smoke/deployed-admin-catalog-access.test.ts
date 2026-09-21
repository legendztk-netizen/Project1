import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface D1QueryResult<T> {
  results: T[];
  success: boolean;
}

let persistenceDirectory: string;
let port: number;
let worker: ChildProcess;
let workerExit: Promise<number | null>;

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Expected a TCP port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function queryLocalD1<T>(sql: string) {
  const result = spawnSync(
    join(process.cwd(), "node_modules", ".bin", "wrangler"),
    [
      "d1",
      "execute",
      "hydraulic-hose-rfq-local",
      "--config",
      join(process.cwd(), "wrangler.jsonc"),
      "--local",
      "--persist-to",
      persistenceDirectory,
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

function deployedRequest(path: string, body = "") {
  return new Promise<{ body: string; status: number }>((resolve, reject) => {
    const request = httpsRequest(
      {
        headers: {
          "content-length": Buffer.byteLength(body),
          "content-type": "application/x-www-form-urlencoded",
        },
        hostname: "127.0.0.1",
        method: body ? "POST" : "GET",
        path,
        port,
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await deployedRequest("/health")).status === 200) return;
    } catch {
      // The local Worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Deployed-style Worker did not become ready");
}

beforeAll(async () => {
  persistenceDirectory = await mkdtemp(join(tmpdir(), "catalog-auth-smoke-"));
  const migration = spawnSync(
    process.execPath,
    ["scripts/d1-migrations.mjs", "apply", "local"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, D1_PERSIST_TO: persistenceDirectory },
    },
  );
  expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0);

  port = await availablePort();
  const inspectorPort = await availablePort();
  worker = spawn(
    join(process.cwd(), "node_modules", ".bin", "wrangler"),
    [
      "dev",
      "--config",
      join(process.cwd(), "build/server/wrangler.json"),
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--local-protocol",
      "https",
      "--persist-to",
      persistenceDirectory,
      "--log-level",
      "error",
      "--var",
      "APP_ENV:preview",
      "--var",
      "PUBLIC_APP_NAME:Hydraulic Supply Preview",
      "--var",
      "PUBLIC_STOREFRONT_ORIGIN:https://storefront.example.com",
      "--var",
      `ADMIN_ORIGIN:https://127.0.0.1:${port}`,
      "--var",
      "ADMIN_AUTH_MODE:cloudflare-access",
      "--var",
      "CLOUDFLARE_ACCESS_TEAM_DOMAIN:https://team.example.com",
      "--var",
      "CLOUDFLARE_ACCESS_AUD:catalog-auth-smoke",
      "--var",
      "EMAIL_DELIVERY_MODE:resend",
      "--var",
      "EMAIL_FROM:quotes@example.com",
      "--var",
      "EMAIL_REPLY_DOMAIN:reply.example.com",
      "--var",
      "PREVIEW_SESSION_SIGNING_KEY:test-session-key-1234567890",
      "--var",
      "PREVIEW_NOTIFICATION_ENCRYPTION_KEY:test-notification-key-1234567890",
      "--var",
      "PREVIEW_RESEND_API_KEY:test-resend-key",
    ],
    { cwd: process.cwd(), stdio: ["ignore", "ignore", "inherit"] },
  );
  workerExit = new Promise((resolve) => worker.once("exit", resolve));
  await Promise.race([
    waitUntilReady(),
    workerExit.then((code) => {
      throw new Error(`Deployed-style Worker exited early with code ${code}`);
    }),
  ]);
});

afterAll(async () => {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await workerExit;
  }
  if (persistenceDirectory) {
    await rm(persistenceDirectory, { force: true, recursive: true });
  }
});

describe("deployed Admin Catalog access boundary", () => {
  it("rejects unauthenticated Catalog POSTs without changing active or draft state", async () => {
    const before = {
      active: queryLocalD1(
        "SELECT release_id, version FROM catalog_active_release WHERE singleton = 1",
      ),
      drafts: queryLocalD1(
        "SELECT id, version FROM catalog_releases WHERE status = 'draft' ORDER BY id",
      ),
    };

    const [publication, maintenance] = await Promise.all([
      deployedRequest(
        "/admin/catalog/review",
        "intent=publish_catalog&releaseId=unauthorized-draft",
      ),
      deployedRequest(
        "/admin/catalog/import",
        "intent=maintain_component&productType=adapter",
      ),
    ]);

    for (const response of [publication, maintenance]) {
      expect([401, 403]).toContain(response.status);
      expect(JSON.parse(response.body)).toMatchObject({
        error: "admin_access_denied",
      });
    }
    expect({
      active: queryLocalD1(
        "SELECT release_id, version FROM catalog_active_release WHERE singleton = 1",
      ),
      drafts: queryLocalD1(
        "SELECT id, version FROM catalog_releases WHERE status = 'draft' ORDER BY id",
      ),
    }).toEqual(before);
  });
});
