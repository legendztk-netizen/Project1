import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { parseInboundMime } from "../app/modules/quote-inbound-email/infrastructure/mime-parser";
import {
  boundedRaw,
  MAX_INBOUND_RAW_BYTES,
  replyToken,
} from "../app/modules/quote-inbound-email/domain/inbound-email";

const sender = "buyer@customer.test";
function raw(
  body: string,
  headers = "Content-Type: text/plain; charset=utf-8",
  from = sender,
) {
  return new TextEncoder().encode(
    `From: ${from}\r\nTo: reply@seller.test\r\nMessage-ID: <fixture@customer.test>\r\nMIME-Version: 1.0\r\n${headers}\r\n\r\n${body}`,
  );
}

it("parses Unicode text and HTML alternatives as plaintext without publishing HTML", async () => {
  expect(
    (
      await parseInboundMime(
        raw(
          "Hello =E4=B8=96=E7=95=8C",
          "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable",
        ),
        sender,
      )
    ).body,
  ).toBe("Hello \u4e16\u754c");
  const parsed = await parseInboundMime(
    raw(
      "<p>Please confirm <strong>quantity</strong>.</p>",
      "Content-Type: text/html; charset=utf-8",
    ),
    sender,
  );
  expect(parsed.body).toContain("Please confirm");
  expect(parsed.body).not.toContain("<p>");
});

it("rejects duplicate From, forwarded identities, automated mail and malformed Message-ID", async () => {
  for (const bytes of [
    raw("body", `Content-Type: text/plain\r\nFrom: ${sender}`),
    raw(
      "body",
      "Content-Type: text/plain",
      `Attacker <attacker@customer.test>, Buyer <${sender}>`,
    ),
    raw("body", "Content-Type: text/plain\r\nAuto-Submitted: auto-replied"),
    raw(
      "body",
      "Content-Type: text/plain\r\nResent-From: forwarder@customer.test",
    ),
    raw("body", "Content-Type: text/plain\r\nMessage-ID: bad"),
    raw("body", "Content-Type: text/plain\r\nSender: attacker@customer.test"),
  ])
    await expect(parseInboundMime(bytes, sender)).rejects.toThrow();
});

it("bounds bodies, headers, MIME part markers and decoded attachment structures", async () => {
  await expect(
    parseInboundMime(raw("x".repeat(10001)), sender),
  ).rejects.toMatchObject({ reason: "body_out_of_bounds" });
  await expect(parseInboundMime(raw(""), sender)).rejects.toMatchObject({
    reason: "body_out_of_bounds",
  });
  await expect(
    parseInboundMime(raw("body", `X-Large: ${"x".repeat(70000)}`), sender),
  ).rejects.toMatchObject({ reason: "malformed_mime" });
  await expect(
    parseInboundMime(
      raw(Array.from({ length: 129 }, () => "--part").join("\r\n")),
      sender,
    ),
  ).rejects.toMatchObject({ reason: "malformed_mime" });
  const bad = `--part\r\nContent-Type: text/plain\r\n\r\nBody\r\n--part\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="bad.pdf"\r\n\r\n%PDF-pretend\r\n--part--`;
  await expect(
    parseInboundMime(
      raw(bad, 'Content-Type: multipart/mixed; boundary="part"'),
      sender,
    ),
  ).rejects.toMatchObject({ reason: "attachment_rejected" });
});

it("accepts one real validated PDF with a sanitized filename", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await pdf.save();
  const body = `--part\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="../../drawing.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(bytes).toString("base64")}\r\n--part--`;
  const parsed = await parseInboundMime(
    raw(body, 'Content-Type: multipart/mixed; boundary="part"'),
    sender,
  );
  expect(parsed.attachment?.contentType).toBe("application/pdf");
  expect(parsed.attachment?.filename).not.toContain("/");
  expect(parsed.attachment?.checksum).toMatch(/^[0-9a-f]{64}$/);
});

it("caps actual stream bytes even when rawSize lies and rejects unscoped reply addresses", async () => {
  let cancelled = false;
  const message = {
    from: sender,
    to: "reply@seller.test",
    rawSize: 1,
    headers: new Headers(),
    raw: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_INBOUND_RAW_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    }),
  };
  await expect(boundedRaw(message)).rejects.toMatchObject({
    reason: "raw_too_large",
  });
  expect(cancelled).toBe(true);
  expect(
    replyToken(`${"a".repeat(64)}@reply.seller.test`, "reply.seller.test"),
  ).toBe("a".repeat(64));
  expect(
    replyToken(`${"a".repeat(64)}@evil.test`, "reply.seller.test"),
  ).toBeNull();
  expect(
    replyToken("internal-quote-id@reply.seller.test", "reply.seller.test"),
  ).toBeNull();
});
