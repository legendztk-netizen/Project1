import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { getPlatformProxy } from "wrangler";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const requestId = "TEST-63-RFQ";
export const buyerId = "TEST-63-BUYER";
export const privateNote = "TEST-63-PRIVATE-NOTE-NEVER-CUSTOMER";
export const address = {
  label: "TEST destination",
  recipientName: "TEST Buyer",
  recipientEmail: "buyer@pi-flow.example.test",
  recipientPhone: "+1 212 555 0100",
  countryCode: "US",
  stateProvince: "NY",
  city: "New York",
  postalCode: "10001",
  addressLine1: "63 TEST Street",
  addressLine2: "",
};

// Parse rendered forms, including entity-encoded JSON and optimistic tokens.
// Scripts and external resources are disabled: this is not browser evidence.
export function formFromHtml(html: string, intent?: string) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  try {
    window.document.body.innerHTML = html;
    const forms = [...window.document.querySelectorAll("form")];
    const form = forms.find((element) =>
      intent === undefined
        ? element.querySelector('[name="version"]')
        : element.querySelector('[name="intent"]')?.getAttribute("value") ===
          intent,
    );
    assert(form, `Expected rendered form ${intent ?? "with version"}`);
    const data = new FormData();
    for (const input of form.querySelectorAll("input, textarea, select")) {
      const name = input.getAttribute("name");
      if (!name || input.hasAttribute("disabled")) continue;
      if (
        ["checkbox", "radio"].includes(input.getAttribute("type") ?? "") &&
        !input.hasAttribute("checked")
      )
        continue;
      const selected =
        input.querySelector("option[selected]") ??
        input.querySelector("option");
      const value =
        input.tagName === "TEXTAREA"
          ? input.textContent
          : input.tagName === "SELECT"
            ? selected?.getAttribute("value")
            : input.getAttribute("value");
      data.append(name, value ?? "");
    }
    return data;
  } finally {
    void window.happyDOM.close();
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function localEnvironment(): Partial<NodeJS.ProcessEnv> {
  // Do not inherit account tokens, deployment targets, .env or .dev.vars.
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    CI: "1",
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  };
}

export async function terminatePiFlowProcess(
  child: ChildProcess,
  graceMs = 5000,
) {
  if (!child.pid) return;
  const pid = child.pid;
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const alive = () => {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      // EPERM still means the group exists; allow its exit to finish before
      // escalating. A denied TERM/KILL remains an error in kill() below.
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
      throw error;
    }
  };
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === "win32")
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
          timeout: 5000,
        });
      else process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  kill("SIGTERM");
  const deadline = Date.now() + graceMs;
  while (alive() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  if (alive()) kill("SIGKILL");
  const forcedDeadline = Date.now() + 5000;
  while (alive() && Date.now() < forcedDeadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert(
    !alive(),
    `TEST process group ${pid} survived cleanup; retaining its state`,
  );
  await exited;
}

export async function runPiFlowCommand(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    children?: Set<ChildProcess>;
  } = {},
) {
  const deadline = piFlowStartup(options.signal, options.timeoutMs ?? 60000);
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: localEnvironment() as NodeJS.ProcessEnv,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  options.children?.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.length > 16 * 1024 * 1024) deadline.abort();
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-16000);
  });
  try {
    const code = await deadline.wait(
      new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      }),
    );
    assert.equal(code, 0, stdout + stderr);
    return stdout;
  } finally {
    deadline.finish();
    await terminatePiFlowProcess(child);
    options.children?.delete(child);
  }
}

export function piFlowStartup(signal?: AbortSignal, timeoutMs = 120000) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(signal?.reason ?? new Error("TEST startup aborted"));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(
    () => controller.abort(new Error("TEST startup deadline exceeded")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    abort,
    finish() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
    async wait<T>(
      pending: Promise<T>,
      disposeLate?: (value: T) => Promise<unknown>,
    ): Promise<T> {
      let onAbort = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      });
      const guarded = pending.then(async (value) => {
        if (controller.signal.aborted) {
          await disposeLate?.(value);
          throw controller.signal.reason;
        }
        return value;
      });
      try {
        return await Promise.race([guarded, cancelled]);
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

export async function startPiFlowServer(
  options: {
    signal?: AbortSignal;
    startupTimeoutMs?: number;
    onCleanup?: (stop: () => Promise<void>) => void;
  } = {},
) {
  const startup = piFlowStartup(options.signal, options.startupTimeoutMs);
  let cleanup = async () => {};
  let stopped: Promise<void> | undefined;
  const stop = () => {
    startup.abort();
    startup.finish();
    return (stopped ??= cleanup());
  };
  options.onCleanup?.(stop);
  try {
    const server = await startup.wait(
      startPiFlowServerInternal(startup, (handle) => {
        cleanup = handle;
      }),
    );
    startup.finish();
    return { ...server, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function startPiFlowServerInternal(
  startup: ReturnType<typeof piFlowStartup>,
  registerCleanup: (stop: () => Promise<void>) => void,
) {
  const built = JSON.parse(
    await startup.wait(
      readFile(join(root, "build/server/wrangler.json"), "utf8"),
    ),
  );
  assert.equal(built.vars.APP_ENV, "local", "Requires a local build");
  const directory = await startup.wait(
    mkdtemp(join(tmpdir(), "TEST-pi-flow-63-")),
    (path) => rm(path, { recursive: true, force: true }),
  );
  registerCleanup(() => rm(directory, { recursive: true, force: true }));
  const port = await startup.wait(availablePort());
  const origin = `http://127.0.0.1:${port}`;
  const configPath = join(directory, "wrangler.json");
  const persistence = join(directory, "state");
  const config = {
    name: "test-pi-flow-63",
    main: join(directory, "worker.mjs"),
    compatibility_date: built.compatibility_date,
    compatibility_flags: built.compatibility_flags,
    assets: { directory: join(root, "build/client"), binding: "ASSETS" },
    vars: {
      APP_ENV: "local",
      PUBLIC_APP_NAME: "TEST DATA - PI Acceptance",
      PUBLIC_STOREFRONT_ORIGIN: origin,
      ADMIN_ORIGIN: `http://localhost:${port}`,
      ADMIN_AUTH_MODE: "local-stub",
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://local.invalid",
      CLOUDFLARE_ACCESS_AUD: "local-stub",
      EMAIL_DELIVERY_MODE: "stub",
      EMAIL_FROM: "test@local.invalid",
      EMAIL_REPLY_DOMAIN: "reply.local.invalid",
      PI_FLOW_TEST_ONLY: "TEST DATA - NEVER DEPLOY",
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "test-pi-flow-63",
        database_id: "00000000-0000-4000-8000-000000000063",
        migrations_dir: join(root, "migrations"),
      },
    ],
    r2_buckets: [
      { binding: "PRIVATE_FILES", bucket_name: "test-pi-flow-63-private" },
    ],
    images: { binding: "IMAGES" },
    queues: {
      producers: [{ binding: "ASYNC_JOBS", queue: "test-pi-flow-63-unused" }],
    },
  };
  let preview: ChildProcess | undefined;
  const setupChildren = new Set<ChildProcess>();
  let platform:
    | Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>
    | undefined;
  let logs = "";
  let cleanupPromise: Promise<void> | undefined;
  const stop = () =>
    (cleanupPromise ??= (async () => {
      for (const child of setupChildren) await terminatePiFlowProcess(child);
      if (preview) await terminatePiFlowProcess(preview);
      await platform?.dispose();
      platform = undefined;
      await rm(directory, { recursive: true, force: true });
    })());
  registerCleanup(stop);
  try {
    startup.signal.throwIfAborted();
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const template = await readFile(
      join(root, "test/fixtures/pi-flow-worker.mjs.txt"),
      "utf8",
    );
    await writeFile(
      config.main,
      template.replace(
        "__PI_FLOW_BUILT_WORKER__",
        join(root, "build/server/index.js"),
      ),
    );
    await writeFile(join(directory, ".dev.vars"), "# TEST: no secrets\n");
    const wrangler = join(root, "node_modules/.bin/wrangler");
    const run = (args: string[]) =>
      runPiFlowCommand(wrangler, args, {
        cwd: directory,
        signal: startup.signal,
        children: setupChildren,
      });
    const migrationArgs = [
      "d1",
      "migrations",
      "apply",
      "test-pi-flow-63",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      persistence,
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      startup.signal.throwIfAborted();
      const child = spawn(wrangler, migrationArgs, {
        cwd: directory,
        env: localEnvironment() as NodeJS.ProcessEnv,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      setupChildren.add(child);
      let output = "";
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) => {
          output = (output + chunk).slice(-16000);
        });
      const code = await startup.wait(
        new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", resolve);
        }),
      );
      assert.equal(code, 0, output);
      await terminatePiFlowProcess(child);
      setupChildren.delete(child);
    }
    platform = await startup.wait(
      getPlatformProxy<{ DB: D1Database }>({
        configPath,
        persist: { path: join(persistence, "v3") },
        remoteBindings: false,
      }),
      async (late) => {
        await late.dispose();
        await rm(directory, { recursive: true, force: true });
      },
    );
    const db = platform.env.DB;
    const { seedCatalogItemBaseline } = (await import(
      new URL("./catalog-item-baseline.ts", import.meta.url).href
    )) as typeof import("./catalog-item-baseline");
    await startup.wait(seedCatalogItemBaseline(db));
    const now = new Date().toISOString();
    for (const id of [buyerId, "TEST-63-OTHER"]) {
      const email =
        id === buyerId ? address.recipientEmail : "other@pi-flow.example.test";
      await startup.wait(
        db.batch([
          db
            .prepare(
              "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at,full_name,phone_number) VALUES(?,?,?,?,?,?,?,?)",
            )
            .bind(
              id,
              email,
              email,
              now,
              now,
              now,
              "TEST Buyer",
              address.recipientPhone,
            ),
          db
            .prepare(
              "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,created_at,updated_at) VALUES(?,'individual',?,?,?)",
            )
            .bind(id, id, now, now),
          db
            .prepare(
              "INSERT INTO customer_profile_purchasing_context_access(profile_id,context_id,created_at) VALUES(?,?,?)",
            )
            .bind(id, id, now),
        ]),
      );
    }
    const source = {
      version: 2,
      submittedAt: now,
      actor: {
        id: buyerId,
        email: address.recipientEmail,
        fullName: "TEST Buyer",
        phoneNumber: address.recipientPhone,
        verifiedAt: now,
      },
      destination: { ...address, id: "TEST-63-ADDRESS" },
      acknowledgements: {
        accuracyConfirmed: true,
        commercialReviewConfirmed: true,
        version: "individual-request-v1",
      },
      amounts: {
        currency: "CNY",
        merchandiseSubtotal: 198,
        serviceFeeTotal: 0,
        manualCommercialReview: true,
      },
      importResponsibility: {
        fulfillmentTerm: "DDP",
        version: "individual-ddp-v1",
      },
      purchasingContext: {
        id: buyerId,
        kind: "individual",
        legalName: "TEST Buyer",
        countryCode: "US",
        primaryContactName: "TEST Buyer",
        primaryContactEmail: address.recipientEmail,
      },
      lines: [
        {
          id: "TEST-63-LINE",
          sku: "601R1_001",
          displayName: "TEST made-to-order hydraulic hose",
          lineKind: "standard",
          quantity: 2,
          salesUnit: "EA",
          catalogReleaseId: "active-release",
          currency: "CNY",
          referenceUnitPrice: 99,
          productSnapshot: {
            category: "hydraulic-hose",
            familyName: "TEST Hose",
            mediaKey: null,
            productType: "hose",
            releaseId: "active-release",
            releaseNumber: "TEST-63",
            specs: [{ label: "Working pressure", value: "250 bar" }],
            variantSelection: null,
            catalogBasis: {
              generation: 4,
              skuRevisionId: "TEST-captured-sku",
              seriesRevisionId: "TEST-captured-series",
              mediaVersionId: "TEST-captured-image",
            },
            offer: {
              currency: "CNY",
              referencePrice: 99,
              salesUnit: "EA",
              madeToOrder: true,
              moq: 1,
              leadTimeDays: 10,
              lengthOrdering: null,
            },
          },
        },
      ],
    };
    await startup.wait(
      db
        .prepare(
          "INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at) VALUES(?,?,?,?,?,'1','TEST-63-ADDRESS','individual','DDP','CNY',198,0,?,?,?)",
        )
        .bind(
          requestId,
          requestId,
          buyerId,
          buyerId,
          "TEST-63-SESSION",
          randomUUID(),
          JSON.stringify(source),
          now,
        )
        .run(),
    );
    await platform.dispose();
    platform = undefined;
    startup.signal.throwIfAborted();
    preview = spawn(
      wrangler,
      [
        "dev",
        "--local",
        "--config",
        configPath,
        "--persist-to",
        persistence,
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--inspector-port",
        "0",
      ],
      {
        cwd: directory,
        env: localEnvironment() as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );
    preview.on("error", (error) => {
      logs += String(error);
      startup.abort();
    });
    for (const stream of [preview.stdout, preview.stderr])
      stream!.on("data", (chunk) => {
        logs = (logs + chunk).slice(-16000);
      });
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      startup.signal.throwIfAborted();
      if (preview.exitCode !== null) throw new Error(logs);
      try {
        const response = await fetch(`${origin}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* workerd is starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert(ready, `Worker not ready\n${logs}`);
    const query = async <T = Record<string, unknown>>(
      sql: string,
    ): Promise<T[]> => {
      const result = JSON.parse(
        await run([
          "d1",
          "execute",
          "test-pi-flow-63",
          "--local",
          "--config",
          configPath,
          "--persist-to",
          persistence,
          "--command",
          sql,
          "--json",
        ]),
      );
      assert(result[0]?.success);
      return result[0].results;
    };
    const request = async (path: string, options: RequestInit = {}) => {
      try {
        // Synchronous Wrangler queries can outlive the dev server's keep-alive
        // timeout. Do not reuse an idle socket or retry a possibly sent mutation.
        const headers = new Headers(options.headers);
        headers.set("connection", "close");
        return await fetch(`${origin}${path}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(45000),
          ...options,
          headers,
        });
      } catch (cause) {
        throw new Error(
          `TEST Worker transport failed: ${options.method ?? "GET"} ${path}\n${logs}`,
          { cause },
        );
      }
    };
    const post = (path: string, body: FormData, cookie = "") =>
      request(path, { method: "POST", body, headers: { origin, cookie } });
    // Configure only the newly allocated database, never the shared local DB.
    for (const values of [
      {
        intent: "save_seller_identity",
        registeredAddressEn: "63 TEST Road, Hangzhou, Zhejiang, China",
      },
      {
        intent: "save_payment_instructions",
        channel: "bank_transfer",
        instructions:
          "TEST ONLY - DO NOT PAY. No bank account exists. TEST payment reference required.",
      },
    ]) {
      const form = new FormData();
      for (const [key, value] of Object.entries(values)) form.set(key, value);
      form.set("commandId", randomUUID());
      const response = await post("/admin/settings/commercial", form);
      assert.equal(response.status, 302, await response.text());
    }
    const login = async (email: string) => {
      const form = new FormData();
      form.set("intent", "request");
      form.set("email", email);
      form.set("returnTo", "/account?view=my-quotes");
      const challenge = await post("/sign-in", form);
      const html = await challenge.text();
      assert.equal(challenge.status, 200, html);
      const code = html.match(/<strong>(\d{6})<\/strong>/)?.[1];
      assert(code, "Local OTP stub preview required");
      const verify = formFromHtml(html, "verify");
      verify.set("code", code);
      const signedIn = await post("/sign-in", verify);
      assert.equal(signedIn.status, 302, await signedIn.text());
      const cookie = signedIn.headers.get("set-cookie")?.split(";", 1)[0];
      assert(cookie, "Real OTP verification must set a session cookie");
      return cookie;
    };
    return {
      origin,
      directory,
      request,
      post,
      query,
      stop,
      source,
      login,
      logs: () => logs,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

type PiFlowServer = Awaited<ReturnType<typeof startPiFlowServer>>;
export interface PiFlowInvoiceRow {
  id: string;
  snapshot_hash: string;
  snapshot_json: string;
  pdf_sha256: string;
  pdf_byte_size: number;
  pdf_page_count: number;
  pdf_object_key: string;
  document_version: number;
  quote_revision_id: string;
}
async function flowHtml(server: PiFlowServer, path: string) {
  const response = await server.request(path);
  const content = await response.text();
  assert.equal(response.status, 200, `${path}\n${content.slice(0, 3000)}`);
  return content;
}
async function flowPost(
  server: PiFlowServer,
  path: string,
  form: FormData,
  status = 302,
) {
  const response = await server.post(path, form);
  assert.equal(
    response.status,
    status,
    `${path}\n${(await response.text()).slice(0, 3000)}`,
  );
}
export async function savePiFlowTerms(
  server: PiFlowServer,
  freight = "20.00",
  transport = "Air freight",
) {
  const path = `/admin/quotes/${requestId}/terms`;
  const form = formFromHtml(await flowHtml(server, path));
  // Resolve the .ts extension at runtime for the standalone Node CLI, while
  // retaining the existing fixture's TypeScript contract and single source.
  const { commercialTerms }: typeof import("./quote-commercial") = await import(
    new URL("./quote-commercial.ts", import.meta.url).href
  );
  const terms = commercialTerms();
  for (const [key, value] of Object.entries(address)) form.set(key, value);
  for (const [key, value] of Object.entries(terms)) {
    if (["destination", "charges", "taxEvidenceId"].includes(key)) continue;
    form.set(
      key,
      typeof value === "boolean" ? (value ? "on" : "") : String(value),
    );
  }
  for (const [key, cents] of Object.entries(terms.charges))
    form.set(key, (cents / 100).toFixed(2));
  form.set("freight", freight);
  form.set("transportMethod", transport);
  await flowPost(server, path, form);
}
export async function issuePiFlowQuote(
  server: PiFlowServer,
  changeReason = "",
) {
  const path = `/admin/quotes/${requestId}/issue`;
  const form = formFromHtml(await flowHtml(server, path));
  form.set("factoryReviewConfirmed", "on");
  form.set("changeReason", changeReason);
  await flowPost(server, path, form, 200);
  await flowPost(server, path, form, 200);
}
export async function issueTestPi(
  server: PiFlowServer,
  checkpoints: {
    afterPrices?: (stale: FormData) => Promise<void>;
    afterQuote?: () => Promise<void>;
    beforePdf?: () => Promise<void>;
  } = {},
) {
  const admin = `/admin/quotes/${requestId}`;
  assert((await flowHtml(server, admin)).includes(requestId));
  const note = new FormData();
  note.set("intent", "note");
  note.set("body", privateNote);
  note.set("commandId", randomUUID());
  await flowPost(server, `${admin}/private`, note);
  await flowPost(server, `${admin}/private`, note);
  assert((await flowHtml(server, `${admin}/private`)).includes(privateNote));
  const start = new FormData();
  start.set("intent", "start");
  await flowPost(server, `${admin}/pricing`, start);
  const stale = formFromHtml(
    await flowHtml(server, `${admin}/pricing`),
    "prices",
  );
  const prices = formFromHtml(
    await flowHtml(server, `${admin}/pricing`),
    "prices",
  );
  prices.set("price-0", "15.00");
  prices.set("discount-0", "10");
  prices.set(
    "reason",
    "TEST explicitly reviewed USD price, not currency conversion",
  );
  await flowPost(server, `${admin}/pricing`, prices);
  await flowPost(server, `${admin}/pricing`, prices);
  await checkpoints.afterPrices?.(stale);
  await savePiFlowTerms(server);
  await issuePiFlowQuote(server);
  await checkpoints.afterQuote?.();
  const issue = formFromHtml(await flowHtml(server, `${admin}/pi`), "issue");
  const payment = (
    await server.query<{
      id: string;
      version: number;
      channel: string;
    }>(
      "SELECT id,version,channel FROM seller_payment_instruction_versions WHERE status='current' AND channel='bank_transfer'",
    )
  )[0];
  assert(payment, "TEST payment selection required");
  issue.set("paymentSelection", JSON.stringify(payment));
  await flowPost(server, `${admin}/pi`, issue);
  await flowPost(server, `${admin}/pi`, issue);
  await checkpoints.beforePdf?.();
  // Dispatch the durable outbox explicitly even when the route's best-effort
  // dispatch failed. The test wrapper awaits the scheduled event's lifecycle.
  const scheduled = await server.post("/__test/pi/scheduled", new FormData());
  assert.equal(scheduled.status, 200, await scheduled.text());
  const response = await server.post("/__test/pi/queue", new FormData());
  assert.equal(response.status, 200, await response.clone().text());
  const queue = (await response.json()) as {
    delivered: number;
    acknowledged: number;
    retries: number;
  };
  assert(queue.delivered > 0);
  assert.equal(queue.retries, 0);
  assert.equal(queue.acknowledged, queue.delivered);
  const rows = await server.query<PiFlowInvoiceRow>(
    `SELECT p.* FROM proforma_invoices p JOIN proforma_invoice_heads h ON h.pi_id=p.id WHERE h.request_id='${requestId}'`,
  );
  assert.equal(
    rows.length,
    1,
    "The actual queued PDF must finish before browser handoff",
  );
  assert.equal(rows[0].document_version, 1);
  assert.equal((await server.query("SELECT id FROM pi_acceptances")).length, 0);
  assert.equal(
    (await server.query("SELECT id FROM pi_customer_views")).length,
    0,
  );
  return rows[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issued = process.argv.includes("--test-data-issued");
  assert(
    issued || process.argv.includes("--test-data"),
    "Explicit --test-data or --test-data-issued required",
  );
  const server = await startPiFlowServer();
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await server.stop();
      process.exit(0);
    });
  try {
    if (issued) {
      const pi = await issueTestPi(server);
      const path = `/account/quotes/${requestId}/pi/${pi.id}`;
      console.log(
        `Issued through HTTP + Queue, unviewed and unaccepted.\nPI: ${server.origin}${path}\nAccept: ${server.origin}${path}/accept\nSign in for PI: ${server.origin}/sign-in?returnTo=${encodeURIComponent(path)}`,
      );
    }
  } catch (error) {
    await server.stop();
    throw error;
  }
  console.log(
    `TEST DATA ONLY. No payments or external email.\nAdmin: ${server.origin}/admin/quotes/${requestId}\nBuyer: ${server.origin}/sign-in?returnTo=%2Faccount%3Fview%3Dmy-quotes\nBuyer email: ${address.recipientEmail}\nOther customer email: other@pi-flow.example.test\nUse the normal email-code form and its local OTP preview.\nScheduler: POST ${server.origin}/__test/pi/scheduled with Origin: ${server.origin}\nQueue: POST ${server.origin}/__test/pi/queue with Origin: ${server.origin}\nIsolated state: ${server.directory}\nCtrl-C removes all fixture data.`,
  );
}
