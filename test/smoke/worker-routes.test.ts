import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const host = "127.0.0.1";
let port: number;
let origin: string;
let preview: ChildProcess;
let previewExit: Promise<number | null>;

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
      throw new Error(`Cloudflare Worker preview exited early with code ${code}`);
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
  });

  it("persists a draft release through the Admin diagnostic and exposes no Storefront mutation", async () => {
    const createResponse = await fetch(`${origin}/admin/diagnostics/catalog-release`, {
      method: "POST",
      redirect: "manual",
    });
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
});
