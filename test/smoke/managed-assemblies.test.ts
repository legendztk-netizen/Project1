import * as XLSX from "@e965/xlsx";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, expect, it } from "vitest";
import { seedManagedAssemblyBaseline } from "../fixtures/managed-assembly-baseline";

const directory = mkdtempSync(join(tmpdir(), "item-worker-"));
let origin: string;
let assemblyDraft: unknown;
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
    await seedManagedAssemblyBaseline(platform.env.DB);
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
it("enforces assembly readiness and exclusion at real Worker boundaries and retains original pricing snapshots", async () => {
  const endpointPath =
    "/api/configurator/compatible-end-a?release=active-release&hose=601R1_001";
  const candidates = async () =>
    (await (await fetch(origin + endpointPath)).json()) as {
      candidates: { compatibilityId: string }[];
    };
  expect((await candidates()).candidates).toHaveLength(0);
  const page = await (
    await fetch(origin + "/admin/catalog/assemblies?preview=1")
  ).text();
  expect(page).toContain("admin-sidebar");
  expect(page).toContain("601R1");
  const update = () =>
    post("/admin/catalog/assemblies", {
      intent: "update",
      commandId: crypto.randomUUID(),
    });
  expect((await update()).status).toBe(200);
  const [endpoint] = (await candidates()).candidates;
  expect(endpoint).toBeDefined();
  const registry = sql<{
    registry_type: string;
    entry_key: string;
    record_version: number;
  }>(
    "SELECT registry_type,entry_key,record_version FROM configurator_global_registry_entries",
  );
  const version = (type: string, key: string) =>
    registry.find((r) => r.registry_type === type && r.entry_key === key)
      ?.record_version;
  const end = {
    compatibilityId: endpoint.compatibilityId,
    hoseEnd: { sku: "FJX-04-04" },
    ferrule: { sku: "601R1_1WB_TEST" },
  };
  const draft = {
    catalogRelease: { id: "active-release" },
    hose: { sku: "601R1_001" },
    endA: end,
    endB: end,
    finishedLength: {
      originalUnit: "in",
      originalValue: "24",
      requestedTighterTolerance: false,
      tolerance: {
        scheduleCode: "SAE_J517_ASSEMBLY_LENGTH",
        scheduleVersion: "1.0.0",
      },
    },
    installedProtection: {
      code: "NONE",
      recordVersion: version("installed_protection", "NONE"),
    },
    lengthReferencePricing: {
      scheduleRecordVersion: version("assembly_estimate_schedule", "DEFAULT"),
    },
    measurementSelection: {
      state: "selected",
      method: {
        code: "M02",
        recordVersion: version("measurement_method", "M02"),
      },
    },
  };
  assemblyDraft = draft;
  const quote = () =>
    post("/api/configurator/quote-assembly", {
      draft: JSON.stringify(draft),
      quantity: "1",
    });
  const first = await quote();
  expect(first.status, await first.text()).toBe(200);
  const old = sql<{
    configured_snapshot_json: string;
    configured_unit_estimate_amount: number | null;
  }>(
    "SELECT configured_snapshot_json,configured_unit_estimate_amount FROM anonymous_quote_lines ORDER BY created_at",
  )[0];
  expect(old.configured_unit_estimate_amount).toBeTypeOf("number");
  const identity = JSON.stringify([
    "601R1_001",
    "FJX-04-04",
    "601R1_1WB_TEST",
    "FJX-04-04",
    "601R1_1WB_TEST",
  ]);
  expect(
    (
      await post("/admin/catalog/assemblies", {
        intent: "disable",
        identity,
        reason: "Worker exclusion",
        commandId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  expect((await candidates()).candidates).toHaveLength(0);
  expect((await quote()).status).toBe(409);
  expect(
    (
      await post("/admin/catalog/items", {
        ...publication("20"),
        skiveRequirement: "Other",
      })
    ).status,
  ).toBe(200);
  expect((await update()).status).toBe(200);
  expect(
    (
      await post("/admin/catalog/assemblies", {
        intent: "enable",
        identity,
        reason: "Invalid component cannot bypass",
        commandId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect((await post("/admin/catalog/items", publication("21"))).status).toBe(
    200,
  );
  expect((await update()).status).toBe(200);
  expect((await quote()).status).toBe(409);
  expect(
    (
      await post("/admin/catalog/assemblies", {
        intent: "enable",
        identity,
        reason: "Ready again",
        commandId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  const mixed = await post("/admin/catalog/items", {
    ...publication("22"),
    currency: "EUR",
  });
  expect(mixed.status).toBe(200);
  expect(sql("SELECT * FROM catalog_assembly_pending_series")).toHaveLength(0);
  const quoted = await quote();
  expect(quoted.status, await quoted.text()).toBe(200);
  const snapshots = sql<{
    configured_snapshot_json: string;
    configured_unit_estimate_amount: number | null;
  }>(
    "SELECT configured_snapshot_json,configured_unit_estimate_amount FROM anonymous_quote_lines ORDER BY created_at",
  );
  expect(snapshots[0]).toEqual(old);
  expect(snapshots.at(-1)?.configured_unit_estimate_amount).toBeNull();
  expect(
    JSON.parse(snapshots.at(-1)!.configured_snapshot_json).productBasis[0].offer
      .currency,
  ).toBe("EUR");
  expect(
    await (await fetch(origin + "/api/catalog/products/601R1_001")).text(),
  ).not.toContain("Cost Basis");
}, 60000);

it("approves a real Excel compatibility change, gates immediately, and restores after series update", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["sku", "skiveRequirement"],
      ["601R1_001", "Other"],
    ]),
    "01_胶管主数据",
  );
  const batchId = crypto.randomUUID();
  const form = new FormData();
  form.set("intent", "import");
  form.set("batchId", batchId);
  form.set(
    "workbook",
    new Blob([XLSX.write(workbook, { type: "array", bookType: "xlsx" })]),
    "assembly-change.xlsx",
  );
  expect(
    (
      await fetch(origin + "/admin/catalog/requests", {
        method: "POST",
        body: form,
        headers: { origin },
        redirect: "manual",
      })
    ).status,
  ).toBe(302);
  const [row] = sql<{ id: string; version: number }>(
    `SELECT id,version FROM catalog_product_change_requests WHERE batch_id='${batchId}'`,
  );
  const approved = await post("/admin/catalog/requests", {
    intent: "approve",
    selected: `${row.id}:${row.version}`,
  });
  expect(approved.status, await approved.text()).toBe(200);
  expect(sql("SELECT * FROM catalog_assembly_pending_series")).toHaveLength(1);
  const endpointPath =
    "/api/configurator/compatible-end-a?release=active-release&hose=601R1_001";
  expect(await (await fetch(origin + endpointPath)).json()).toMatchObject({
    candidates: [],
  });
  expect((await post("/admin/catalog/items", publication("25"))).status).toBe(
    200,
  );
  expect(
    (
      await post("/admin/catalog/assemblies", {
        intent: "update",
        commandId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  expect(sql("SELECT * FROM catalog_assembly_pending_series")).toHaveLength(0);
  expect(
    (
      (await (await fetch(origin + endpointPath)).json()) as {
        candidates: unknown[];
      }
    ).candidates,
  ).toHaveLength(1);
}, 60000);
it("rejects a direct customer submit of a disabled combination and preserves a submitted RFQ after later edits", async () => {
  const otp = await post("/register", {
    intent: "request",
    email: "assembly-rfq@example.com",
    returnTo: "/quote-list",
  });
  const html = await otp.text();
  const challenge =
    html.match(/name="challengeId"[^>]*value="([^"]+)"/)?.[1] ?? "";
  const verified = await post("/register", {
    intent: "verify",
    challengeId: challenge,
    code: html.match(/<strong>(\d{6})<\/strong>/)?.[1] ?? "",
    returnTo: "/quote-list",
  });
  expect(verified.status, await verified.text()).toBe(302);
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
      recipientEmail: "assembly-rfq@example.com",
      recipientName: "Assembly Buyer",
      recipientPhone: "+1 212 555 0109",
      stateProvince: "New York",
    },
    cookie,
  );
  expect(address.status).toBe(302);
  const added = await post(
    "/api/configurator/quote-assembly",
    { draft: JSON.stringify(assemblyDraft), quantity: "2" },
    cookie,
  );
  expect(added.status, await added.text()).toBe(200);
  const [line] = sql<{ id: string }>(
    "SELECT l.id FROM anonymous_quote_lines l JOIN anonymous_quote_sessions s ON s.id=l.session_id JOIN customer_profiles p ON p.id=s.profile_id WHERE p.email_normalized='assembly-rfq@example.com'",
  );
  expect(line).toBeDefined();
  const identity = JSON.stringify([
    "601R1_001",
    "FJX-04-04",
    "601R1_1WB_TEST",
    "FJX-04-04",
    "601R1_1WB_TEST",
  ]);
  await post("/admin/catalog/assemblies", {
    intent: "disable",
    identity,
    reason: "Submit guard check",
    commandId: crypto.randomUUID(),
  });
  const values = {
    intent: "submit_individual_quote_request",
    idempotencyKey: crypto.randomUUID(),
    selectedLineId: line.id,
    accuracyConfirmed: "yes",
    commercialReviewConfirmed: "yes",
  };
  const blocked = await post("/quote-list", values, cookie);
  expect(blocked.status).toBeGreaterThanOrEqual(400);
  expect(sql("SELECT * FROM customer_quote_requests")).toHaveLength(0);
  await post("/admin/catalog/assemblies", {
    intent: "enable",
    identity,
    reason: "Submit guard restored",
    commandId: crypto.randomUUID(),
  });
  const submitted = await post("/quote-list", values, cookie);
  expect(submitted.status, await submitted.text()).toBe(302);
  const snapshot = sql("SELECT snapshot_json FROM customer_quote_requests");
  expect(snapshot).toHaveLength(1);
  await post("/admin/catalog/items", publication("35"));
  expect(sql("SELECT snapshot_json FROM customer_quote_requests")).toEqual(
    snapshot,
  );
}, 60000);
