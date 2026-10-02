import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { INBOUND_EMAIL_RETRY_REASON } from "../workers/inbound-email-rpc";
import { UNROUTED_RECIPIENT_REASON } from "../workers/email-dispatcher/routing";

const read = async (path: string) =>
  JSON.parse(await readFile(resolve(path), "utf8"));

it("relays each environment's reply domain to that environment's Worker", async () => {
  const app = await read("wrangler.jsonc");
  const dispatcher = await read("workers/email-dispatcher/wrangler.jsonc");
  const services = Object.fromEntries(
    dispatcher.services.map(
      (s: { binding: string; service: string; entrypoint: string }) => [
        s.binding,
        s,
      ],
    ),
  );
  for (const [environment, prefix] of [
    ["preview", "PREVIEW"],
    ["production", "PRODUCTION"],
  ]) {
    expect(dispatcher.vars[`${prefix}_REPLY_DOMAIN`]).toBe(
      app.env[environment].vars.EMAIL_REPLY_DOMAIN,
    );
    expect(services[`${prefix}_INBOUND_EMAIL`]).toEqual({
      binding: `${prefix}_INBOUND_EMAIL`,
      service: app.env[environment].name,
      entrypoint: "InboundEmail",
    });
  }
});

// Real workerd: dispatcher email handler -> service binding -> named entrypoint.
const target = (environment: string, withReceive = true) => `
import { WorkerEntrypoint } from "cloudflare:workers";
${
  withReceive
    ? `export class InboundEmail extends WorkerEntrypoint {
  async receive(envelope, raw) {
    const text = await new Response(raw).text();
    await this.env.SEEN.put(envelope.to, JSON.stringify({ environment: "${environment}", envelope, text }));
    if (envelope.to.startsWith("refuse")) return { accepted: false, reason: "Reply address is no longer valid." };
    if (envelope.to.startsWith("crash")) throw new Error("private infrastructure failure");
    return { accepted: true };
  }
}`
    : "export class InboundEmail extends WorkerEntrypoint {}"
}
export default { fetch() { return new Response("${environment}"); } };
`;

interface LocalWorker {
  ready: Promise<URL>;
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  getKVNamespace(binding: string, worker?: string): Promise<KVNamespace>;
  dispose(): Promise<void>;
}
let directory: string;
let worker: LocalWorker;
let seen: KVNamespace;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "email-dispatcher-"));
  await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    ssr: { noExternal: true },
    build: {
      ssr: resolve("workers/email-dispatcher/index.ts"),
      outDir: directory,
      minify: false,
    },
  });
  const script = await readFile(join(directory, "index.js"), "utf8");
  const config = await read("workers/email-dispatcher/wrangler.jsonc");
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare") as {
    Miniflare: new (options: object) => LocalWorker;
    convertV4MiniflareOptions(options: object): object;
  };
  const dispatcher = (name: string, production: string) => ({
    name,
    modules: true,
    script,
    compatibilityDate: config.compatibility_date,
    routes: [`${name}.test/*`],
    bindings: config.vars,
    serviceBindings: {
      PREVIEW_INBOUND_EMAIL: { name: "preview", entrypoint: "InboundEmail" },
      PRODUCTION_INBOUND_EMAIL: {
        name: production,
        entrypoint: "InboundEmail",
      },
    },
  });
  const stub = (name: string, withReceive = true) => ({
    name,
    modules: true,
    script: target(name, withReceive),
    compatibilityDate: config.compatibility_date,
    kvNamespaces: { SEEN: "seen" },
  });
  worker = new Miniflare(
    convertV4MiniflareOptions({
      unsafeTriggerHandlers: true,
      workers: [
        dispatcher("dispatcher", "production"),
        dispatcher("before-launch", "production-without-receive"),
        stub("preview"),
        stub("production"),
        stub("production-without-receive", false),
      ],
    }),
  );
  await worker.ready;
  seen = await worker.getKVNamespace("SEEN", "preview");
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const raw = (to: string) =>
  [
    "From: Customer <customer@example.com>",
    `To: ${to}`,
    "Subject: Re: Quote",
    `Message-ID: <${to.replace(/[^a-z0-9]/gi, "-")}@example.com>`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Please ship by air.",
    "",
  ].join("\r\n");

async function send(to: string, host = "dispatcher") {
  const url = new URL(`http://${host}.test/cdn-cgi/local/email`);
  url.searchParams.set("from", "customer@example.com");
  url.searchParams.set("to", to);
  // JSON format waits for setReject, which crosses JSRPC locally.
  url.searchParams.set("format", "json");
  const response = await worker.dispatchFetch(url.toString(), {
    method: "POST",
    body: raw(to),
  });
  const result = (await response.json()) as {
    outcome: string;
    rejectReason?: string;
  };
  return { outcome: result.outcome, rejectReason: result.rejectReason ?? null };
}
const accepted = { outcome: "ok", rejectReason: null };
const rejected = (reason: string) => ({ outcome: "ok", rejectReason: reason });
const delivered = async (to: string) =>
  JSON.parse((await seen.get(to)) ?? "null") as {
    environment: string;
    envelope: {
      from: string;
      to: string;
      rawSize: number;
      headers: string[][];
    };
    text: string;
  } | null;

it("relays a preview reply with the original envelope, headers and bytes", async () => {
  const to = "r-preview-token@reply-preview.customhoseco.com";
  expect(await send(to)).toEqual(accepted);
  const received = await delivered(to);
  expect(received?.environment).toBe("preview");
  expect(received?.text).toBe(raw(to));
  expect(received?.envelope).toMatchObject({
    from: "customer@example.com",
    to,
    rawSize: new TextEncoder().encode(raw(to)).byteLength,
  });
  expect(received?.envelope.headers).toContainEqual(["subject", "Re: Quote"]);
});

it("relays the production reply domain case-insensitively", async () => {
  const to = "r-production-token@Reply.CustomHoseCo.com";
  expect(await send(to)).toEqual(accepted);
  expect((await delivered(to))?.environment).toBe("production");
});

it("rejects other recipients without reaching an application Worker", async () => {
  for (const to of [
    "quotes@customhoseco.com",
    "r-token@reply.customhoseco.com.example.net",
    "r-token@preview.customhoseco.com",
  ]) {
    expect(await send(to)).toEqual(rejected(UNROUTED_RECIPIENT_REASON));
    expect(await delivered(to)).toBeNull();
  }
});

it("returns the application's rejection to the sender", async () => {
  expect(await send("refuse@reply-preview.customhoseco.com")).toEqual(
    rejected("Reply address is no longer valid."),
  );
});

it("asks for a resend without exposing a target failure", async () => {
  expect(await send("crash@reply.customhoseco.com")).toEqual(
    rejected(INBOUND_EMAIL_RETRY_REASON),
  );
});

it("asks for a resend while the target Worker cannot receive yet", async () => {
  expect(await send("r-token@reply.customhoseco.com", "before-launch")).toEqual(
    rejected(INBOUND_EMAIL_RETRY_REASON),
  );
  expect(
    await send("r-later@reply-preview.customhoseco.com", "before-launch"),
  ).toEqual(accepted);
});
