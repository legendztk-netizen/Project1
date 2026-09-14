import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { dkimSign } from "mailauth/lib/dkim/sign";
import { unstable_dev } from "wrangler";
import {
  createInboundEmailVerifier,
  RetryableEmailVerificationError,
} from "../workers/inbound-email-verifier";
import {
  sha256,
  MAX_INBOUND_RAW_BYTES,
} from "../app/modules/quote-inbound-email/domain/inbound-email";

const sender = "buyer@customer.test";
function keys(bits = 2048) {
  const pair = generateKeyPairSync("rsa", { modulusLength: bits });
  return {
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    txt: `v=DKIM1; k=rsa; p=${pair.publicKey.export({ type: "spki", format: "der" }).toString("base64")}`,
  };
}
const pair = keys();
const message = `From: Buyer <${sender}>\r\nTo: reply@seller.test\r\nSubject: Quote reply\r\nMessage-ID: <fixture@customer.test>\r\nContent-Type: text/plain\r\n\r\nPlease confirm quantity.\r\n`;
async function signed(
  options: {
    domain?: string;
    body?: string;
    key?: typeof pair;
    length?: number;
    algorithm?: string;
    headerList?: string;
  } = {},
) {
  const raw = Buffer.from(options.body ?? message);
  const result = await dkimSign(raw, {
    algorithm: options.algorithm ?? "rsa-sha256",
    headerList: options.headerList,
    signatureData: [
      {
        signingDomain: options.domain ?? "customer.test",
        selector: "fixture",
        privateKey: (options.key ?? pair).privateKey,
        maxBodyLength: options.length,
      },
    ],
  });
  expect(result.errors).toEqual([]);
  return Buffer.concat([Buffer.from(result.signatures), raw]);
}
function dnsResponse(
  txt = pair.txt,
  name = "fixture._domainkey.customer.test",
) {
  return Response.json({
    Status: 0,
    Answer: [
      {
        name,
        type: 16,
        data: txt
          .match(/.{1,180}/g)!
          .map((part) => JSON.stringify(part))
          .join(" "),
      },
    ],
  });
}
const dns = () => vi.fn<typeof fetch>(async () => dnsResponse());
async function input(raw: Uint8Array, from = sender) {
  return {
    raw,
    rawSha256: await sha256(raw),
    message: {
      from,
      to: "reply@seller.test",
      rawSize: raw.length,
      raw: new ReadableStream<Uint8Array>(),
      headers: new Headers({
        "Authentication-Results": "attacker; dmarc=pass",
      }),
    },
  };
}
afterEach(() => vi.useRealTimers());

it("verifies an actual RSA signature via bounded fixed-endpoint TXT DNS and exact raw checksum", async () => {
  const fetcher = dns();
  const raw = await signed();
  const request = await input(raw, "BUYER@CUSTOMER.TEST");
  expect(await createInboundEmailVerifier({ fetcher })(request)).toEqual({
    provider: "cloudflare-email",
    authenticatedSender: sender,
    rawSha256: request.rawSha256,
    mechanism: "dmarc-aligned",
  });
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe(
    "https://cloudflare-dns.com/dns-query?name=fixture._domainkey.customer.test&type=TXT",
  );
  expect(init?.redirect).toBe("error");
  expect(
    await createInboundEmailVerifier({ fetcher })({
      ...request,
      rawSha256: "0".repeat(64),
    }),
  ).toBeNull();
});

it("rejects forged authentication headers, tampered body, missing/duplicate/group From and envelope mismatch", async () => {
  const valid = await signed();
  const verify = createInboundEmailVerifier({ fetcher: dns() });
  for (const raw of [
    Buffer.from(message),
    Buffer.from(valid.toString().replace("confirm", "alter")),
    await signed({ body: `From: ${sender}\r\n${message}` }),
    await signed({
      body: message.replace(
        `Buyer <${sender}>`,
        `${sender}, other@customer.test`,
      ),
    }),
    await signed({
      body: message.replace(`Buyer <${sender}>`, `Group: ${sender};`),
    }),
    Buffer.from(valid.toString().replace(`From: Buyer <${sender}>\r\n`, "")),
    Buffer.from(valid.toString().replace(/h=[^;]+;/i, "h=subject:to;")),
  ])
    expect(await verify(await input(raw))).toBeNull();
  expect(await verify(await input(valid, "other@customer.test"))).toBeNull();
});

it("rejects relaxed-only alignment, unsigned From, weak keys/algorithms and partial-body signatures", async () => {
  const fetcher = dns();
  const verify = createInboundEmailVerifier({ fetcher });
  for (const options of [
    { domain: "sub.customer.test" },
    { domain: "attacker.test" },
    { length: 0 },
    { length: 5 },
    { algorithm: "rsa-sha1" },
  ]) {
    expect(await verify(await input(await signed(options)))).toBeNull();
  }
  const weak = keys(1024);
  expect(
    await createInboundEmailVerifier({
      fetcher: vi.fn(async () => dnsResponse(weak.txt)),
    })(await input(await signed({ key: weak }))),
  ).toBeNull();
});

it("rejects raw/header/signature excess before DNS and fails closed on malformed or oversized DNS", async () => {
  const fetcher = dns();
  const valid = await signed();
  for (const raw of [
    new Uint8Array(MAX_INBOUND_RAW_BYTES + 1),
    Buffer.from(`X-Large: ${"a".repeat(65536)}\r\n${valid}`),
    Buffer.from(`DKIM-Signature: a=rsa-sha256\r\n`.repeat(6) + message),
    Buffer.from(`X-Test: x\r\n`.repeat(201) + valid),
  ]) {
    expect(
      await createInboundEmailVerifier({ fetcher })(await input(raw)),
    ).toBeNull();
  }
  expect(fetcher).not.toHaveBeenCalled();
  for (const response of [
    () => Response.json({ Status: 3 }),
    () => new Response("x".repeat(17000)),
    () => dnsResponse(pair.txt, "wrong._domainkey.customer.test"),
    () =>
      Response.json({
        Status: 0,
        Answer: [
          {
            name: "fixture._domainkey.customer.test",
            type: 16,
            data: "unquoted",
          },
        ],
      }),
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://internal/" },
      }),
  ]) {
    expect(
      await createInboundEmailVerifier({
        fetcher: vi.fn(async () => response()),
      })(await input(valid)),
    ).toBeNull();
  }
});

it("bounds elapsed time even when a DNS transport does not honor abort", async () => {
  const request = await input(await signed());
  const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
  vi.useFakeTimers();
  const result = createInboundEmailVerifier({ fetcher })(request);
  const assertion = expect(result).rejects.toBeInstanceOf(
    RetryableEmailVerificationError,
  );
  await vi.advanceTimersByTimeAsync(10001);
  await assertion;
});

it.each(["network", "timeout", "http", "servfail", "truncated", "stream"])(
  "throws retryable for exhausted %s DNS failure, then verifies identical mail on redelivery",
  async (failure) => {
    const request = await input(await signed());
    let offline = true;
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (!offline) return dnsResponse();
      if (failure === "network") throw new TypeError("network unavailable");
      if (failure === "timeout")
        throw new DOMException("timeout", "TimeoutError");
      if (failure === "http") return new Response(null, { status: 503 });
      if (failure === "servfail") return Response.json({ Status: 2 });
      if (failure === "truncated")
        return Response.json({ Status: 0, TC: true });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("connection lost"));
          },
        }),
      );
    });
    const verify = createInboundEmailVerifier({ fetcher });
    await expect(verify(request)).rejects.toMatchObject({
      code: "email_verification_unavailable",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    offline = false;
    expect(await verify(request)).toMatchObject({
      rawSha256: request.rawSha256,
      authenticatedSender: sender,
    });
  },
);

it("recovers one transient DNS failure within the same verification, but does not retry NXDOMAIN or invalid keys", async () => {
  const request = await input(await signed());
  const fetcher = dns().mockRejectedValueOnce(
    new TypeError("network unavailable"),
  );
  expect(await createInboundEmailVerifier({ fetcher })(request)).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const response of [
    () => Response.json({ Status: 3 }),
    () => dnsResponse("v=DKIM1; p=invalid"),
  ]) {
    const invalid = vi.fn<typeof fetch>(async () => response());
    expect(
      await createInboundEmailVerifier({ fetcher: invalid })(request),
    ).toBeNull();
    expect(invalid).toHaveBeenCalledTimes(1);
  }
});

it("memoizes repeated selectors per verification and rejects hidden bare-LF headers", async () => {
  const raw = await signed();
  const header = raw.subarray(0, raw.indexOf("From: Buyer"));
  const fetcher = dns();
  expect(
    await createInboundEmailVerifier({ fetcher })(
      await input(Buffer.concat([header, raw])),
    ),
  ).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    await createInboundEmailVerifier({ fetcher })(
      await input(
        Buffer.concat([
          Buffer.from(
            "X-Folded: value\r\n continuation\nDKIM-Signature: hidden\r\n",
          ),
          raw,
        ]),
      ),
    ),
  ).toBeNull();
});

it("hashes non-UTF8 body bytes without decoding them as headers", async () => {
  const unsigned = Buffer.concat([
    Buffer.from(message),
    Buffer.from([255, 254, 128, 13, 10]),
  ]);
  const signature = await dkimSign(unsigned, {
    signatureData: [
      {
        signingDomain: "customer.test",
        selector: "fixture",
        privateKey: pair.privateKey,
      },
    ],
  });
  expect(signature.errors).toEqual([]);
  const raw = Buffer.concat([Buffer.from(signature.signatures), unsigned]);
  expect(
    await createInboundEmailVerifier({ fetcher: dns() })(await input(raw)),
  ).toMatchObject({ rawSha256: await sha256(raw) });
});

it("bundles and cryptographically verifies in real workerd with nodejs_compat, without network DNS", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inbound-verifier-"));
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined;
  try {
    const entry = join(dir, "worker.ts");
    const config = join(dir, "wrangler.json");
    await writeFile(
      config,
      JSON.stringify({
        name: "inbound-verifier-test",
        compatibility_date: "2026-08-15",
        compatibility_flags: ["nodejs_compat"],
      }),
    );
    await writeFile(
      entry,
      `import { createInboundEmailVerifier } from ${JSON.stringify(resolve("workers/inbound-email-verifier.ts"))};
      import { sha256 } from ${JSON.stringify(resolve("app/modules/quote-inbound-email/domain/inbound-email.ts"))};
      export default {async fetch(request) { const raw = new Uint8Array(await request.arrayBuffer());
        const verify = createInboundEmailVerifier({fetcher: async () => request.headers.has('x-test-dns-down') ? new Response(null, {status:503}) : Response.json(${JSON.stringify(await dnsResponse().json())})});
        try { return Response.json(await verify({raw, rawSha256: await sha256(raw), message: {from: ${JSON.stringify(sender)}, to: 'reply@seller.test', rawSize: raw.length, headers: new Headers(), raw: new ReadableStream()}})); }
        catch(error) { return Response.json({code:error.code}, {status:503}); } }};`,
    );
    worker = await unstable_dev(entry, {
      config,
      local: true,
      logLevel: "error",
      port: 0,
      inspectorPort: 0,
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        watch: false,
      },
    });
    const raw = await signed();
    const unavailable = await worker.fetch("/", {
      method: "POST",
      body: raw,
      headers: { "x-test-dns-down": "1" },
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      code: "email_verification_unavailable",
    });
    const proof = await (
      await worker.fetch("/", { method: "POST", body: raw })
    ).json();
    expect(proof).toMatchObject({
      provider: "cloudflare-email",
      authenticatedSender: sender,
      rawSha256: await sha256(raw),
    });
    for (const invalid of [
      raw.toString().replace("confirm", "alter"),
      raw.toString().replace("Quote reply", "Changed subject"),
      (await signed({ length: 0 })).toString(),
      (await signed({ domain: "sub.customer.test" })).toString(),
    ]) {
      expect(
        await (
          await worker.fetch("/", { method: "POST", body: invalid })
        ).json(),
      ).toBeNull();
    }
  } finally {
    await worker?.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
