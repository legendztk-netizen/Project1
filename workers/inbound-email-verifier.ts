import { Buffer } from "node:buffer";
import { verify as verifySignature } from "node:crypto";
import { dkimVerify } from "mailauth/lib/dkim/verify";
import { addressParser } from "postal-mime";
import {
  MAX_INBOUND_HEADERS_BYTES,
  MAX_INBOUND_RAW_BYTES,
  normalizedEmail,
  sha256,
  type PlatformEmailVerifier,
} from "../app/modules/quote-inbound-email/domain/inbound-email";

const DNS_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DEADLINE_MS = 10_000;
const DNS_TIMEOUT_MS = 2_000;
const MAX_DNS_BYTES = 16_384;

export class RetryableEmailVerificationError extends Error {
  readonly code = "email_verification_unavailable";
  constructor() {
    super(
      "Email authentication is temporarily unavailable; please resend later.",
    );
    this.name = "RetryableEmailVerificationError";
  }
}

function headersOf(raw: Uint8Array) {
  let end = -1;
  for (
    let i = 0;
    i < Math.min(raw.length - 3, MAX_INBOUND_HEADERS_BYTES + 1);
    i++
  ) {
    if (
      raw[i] === 13 &&
      raw[i + 1] === 10 &&
      raw[i + 2] === 13 &&
      raw[i + 3] === 10
    ) {
      end = i;
      break;
    }
  }
  if (end < 0 || end > MAX_INBOUND_HEADERS_BYTES)
    throw new Error("Header bounds");
  const lines = new TextDecoder("utf-8", { fatal: true })
    .decode(raw.subarray(0, end))
    .split("\r\n");
  if (lines.length > 500) throw new Error("Header count");
  const headers: Array<{ key: string; value: string }> = [];
  for (const line of lines) {
    if (line.includes("\r") || line.includes("\n") || line.includes("\0"))
      throw new Error("Malformed header line");
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1].value += " " + line.trim();
    } else {
      const match = /^([!-9;-~]+):([^\r\n]*)$/.exec(line);
      if (!match) throw new Error("Malformed header");
      headers.push({ key: match[1].toLowerCase(), value: match[2].trim() });
    }
  }
  if (headers.length > 200) throw new Error("Header count");
  const signatures = headers.filter((h) =>
    /^(dkim-signature|arc-message-signature|arc-seal)$/.test(h.key),
  );
  if (!signatures.length || signatures.length > 5)
    throw new Error("Signature count");
  for (const signature of signatures) {
    // Bound work before mailauth creates hashers or performs public-key operations.
    const tags = new Map<string, string>();
    for (const tag of signature.value.split(";")) {
      if (!tag.trim()) continue;
      const match = /^\s*([a-z]+)\s*=\s*([\s\S]*)$/i.exec(tag);
      if (!match || tags.has(match[1].toLowerCase()))
        throw new Error("Signature tags");
      tags.set(match[1].toLowerCase(), match[2].trim());
    }
    if (tags.get("a") !== "rsa-sha256" || tags.has("l"))
      throw new Error("Signature policy");
    if (
      (tags.get("h")?.length ?? 0) > 2048 ||
      (tags.get("h")?.split(":").length ?? 0) > 100
    )
      throw new Error("Signed header count");
    if ((tags.get("b")?.replace(/\s/g, "").length ?? 0) > 704)
      throw new Error("Signature size");
  }
  return headers;
}

function cryptographicPass(
  signature: Awaited<ReturnType<typeof dkimVerify>>["results"][number],
) {
  if (signature.status.result === "pass") return true;
  // workerd rejects OpenSSL's rsa-sha256 alias. Reuse mailauth's canonicalization
  // and resolved key, changing only the digest name passed to the crypto API.
  if (
    signature.status.result !== "neutral" ||
    signature.status.comment !== "Unknown digest: rsa-sha256" ||
    !signature.bodyHash ||
    signature.bodyHash !== signature.bodyHashExpecting ||
    !signature.publicKey ||
    !signature.signature ||
    !signature.signingHeaders?.canonicalizedHeader ||
    signature.signingHeaders.canonicalizedHeader.length > 131072
  )
    return false;
  return verifySignature(
    "sha256",
    Buffer.from(signature.signingHeaders.canonicalizedHeader, "base64"),
    signature.publicKey,
    Buffer.from(signature.signature, "base64"),
  );
}

// DNS JSON TXT records use quoted character strings, potentially split into chunks.
function txtChunks(data: string): string[] {
  if (data.length > 2_048) throw new Error("TXT size");
  const chunks: string[] = [];
  let index = 0;
  while (index < data.length) {
    while (/\s/.test(data[index] ?? "") && index < data.length) index++;
    if (index === data.length) break;
    if (data[index++] !== '"') throw new Error("TXT syntax");
    let chunk = "";
    let closed = false;
    while (index < data.length) {
      const char = data[index++];
      if (char === '"') {
        closed = true;
        break;
      }
      if (char !== "\\") {
        chunk += char;
        continue;
      }
      const digits = data.slice(index, index + 3);
      if (/^\d{3}$/.test(digits)) {
        if (Number(digits) > 255) throw new Error("TXT escape");
        chunk += String.fromCharCode(Number(digits));
        index += 3;
      } else {
        if (index === data.length) throw new Error("TXT escape");
        chunk += data[index++];
      }
    }
    if (!closed) throw new Error("TXT syntax");
    chunks.push(chunk);
  }
  const key = /(?:^|;)\s*p\s*=\s*([^;]*)/.exec(chunks.join(""))?.[1];
  if (!key || key.replace(/\s/g, "").length > 800) throw new Error("Key size");
  return chunks;
}

function resolverFor(
  domain: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
  unavailable: () => void,
) {
  let requests = 0;
  const cache = new Map<string, Promise<string[][]>>();
  return (name: string, type: string): Promise<string[][]> => {
    name = name.toLowerCase().replace(/\.$/, "");
    const suffix = `._domainkey.${domain}`;
    const selector = name.slice(0, -suffix.length);
    if (
      type !== "TXT" ||
      name.length > 253 ||
      !name.endsWith(suffix) ||
      !selector
        .split(".")
        .every((label) => /^[a-z0-9_][a-z0-9_-]{0,62}$/.test(label))
    ) {
      return Promise.reject(new Error("DNS scope"));
    }
    const previous = cache.get(name);
    if (previous) return previous;
    const lookup = async () => {
      if (++requests > 5 || signal.aborted)
        throw new RetryableEmailVerificationError();
      const url = new URL(DNS_ENDPOINT);
      url.searchParams.set("name", name);
      url.searchParams.set("type", "TXT");
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { Accept: "application/dns-json" },
          redirect: "error",
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(DNS_TIMEOUT_MS),
          ]),
        });
      } catch {
        throw new RetryableEmailVerificationError();
      }
      if (response.status >= 500 || [408, 429].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        throw new RetryableEmailVerificationError();
      }
      if (!response.ok || !response.body) throw new Error("DNS response");
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          let part: ReadableStreamReadResult<Uint8Array>;
          try {
            part = await reader.read();
          } catch {
            throw new RetryableEmailVerificationError();
          }
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_DNS_BYTES) throw new Error("DNS response size");
          parts.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const result = JSON.parse(Buffer.concat(parts).toString("utf8")) as {
        Status: number;
        TC?: boolean;
        Answer?: Array<{ name: string; type: number; data: string }>;
      };
      if (result.Status === 2 || result.TC)
        throw new RetryableEmailVerificationError();
      if (
        result.Status !== 0 ||
        result.TC ||
        !Array.isArray(result.Answer) ||
        result.Answer.length > 10
      )
        throw new Error("DNS answers");
      const answers = result.Answer.filter(
        (row) =>
          row.type === 16 && row.name.toLowerCase().replace(/\.$/, "") === name,
      );
      if (answers.length !== 1) throw new Error("Ambiguous key");
      return [txtChunks(answers[0].data)];
    };
    const task = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await lookup();
        } catch (error) {
          if (!(error instanceof RetryableEmailVerificationError)) throw error;
          if (attempt === 0 && requests < 5 && !signal.aborted) continue;
          // mailauth converts resolver exceptions into results; retain provenance
          // outside that result so an outage never becomes a permanent rejection.
          unavailable();
          throw error;
        }
      }
    })();
    cache.set(name, task);
    return task;
  };
}

/** Strict DKIM alignment is sufficient for the existing dmarc-aligned proof contract.
 * This does not evaluate a domain's DMARC policy or trust Authentication-Results.
 * Call only at the Cloudflare Email handler boundary, never with HTTP-supplied proofs.
 * Launch policy supports RSA-SHA256 keys of 2048-4096 bits, not partial-body signatures.
 */
export function createInboundEmailVerifier({
  fetcher = fetch,
}: { fetcher?: typeof fetch } = {}): PlatformEmailVerifier {
  return async ({ message, raw, rawSha256 }) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const sender = normalizedEmail(message.from);
      if (!sender || !raw.length || raw.length > MAX_INBOUND_RAW_BYTES)
        return null;
      const headers = headersOf(raw);
      const from = headers.filter((h) => h.key === "from");
      if (from.length !== 1) return null;
      const mailboxes = addressParser(from[0].value);
      if (
        mailboxes.length !== 1 ||
        mailboxes[0].group ||
        normalizedEmail(mailboxes[0].address ?? "") !== sender
      )
        return null;
      const domain = sender.slice(sender.lastIndexOf("@") + 1);
      const verification = (async () => {
        if ((await sha256(raw)) !== rawSha256) return null;
        let dnsUnavailable = false;
        const result = await dkimVerify(Buffer.from(raw), {
          sender,
          minBitLength: 2048,
          resolver: resolverFor(domain, fetcher, controller.signal, () => {
            dnsUnavailable = true;
          }),
        });
        if (controller.signal.aborted)
          throw new RetryableEmailVerificationError();
        if (
          controller.signal.aborted ||
          result.headerFrom.length !== 1 ||
          normalizedEmail(result.headerFrom[0]) !== sender
        )
          return null;
        const valid = result.results.some(
          (signature) =>
            signature.signingDomain?.toLowerCase() === domain &&
            signature.algo === "rsa-sha256" &&
            (signature.modulusLength ?? 0) >= 2048 &&
            (signature.modulusLength ?? 0) <= 4096 &&
            signature.signatureTimeValid === true &&
            signature.canonBodyLengthLimited === false &&
            signature.signingHeaders?.keys
              .split(":")
              .some((key) => key.trim().toLowerCase() === "from") &&
            cryptographicPass(signature),
        );
        if (!valid && dnsUnavailable)
          throw new RetryableEmailVerificationError();
        return valid
          ? {
              provider: "cloudflare-email" as const,
              authenticatedSender: sender,
              rawSha256,
              mechanism: "dmarc-aligned" as const,
            }
          : null;
      })();
      return await Promise.race([
        verification,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new RetryableEmailVerificationError());
          }, DEADLINE_MS);
        }),
      ]);
    } catch (error) {
      if (error instanceof RetryableEmailVerificationError) throw error;
      return null;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
