import { expect, it } from "vitest";
import {
  conversationAuthor,
  conversationInput,
  type QuoteConversationActor,
} from "../app/modules/quote-conversation/domain/quote-conversation";
import {
  MAX_EVIDENCE_BYTES,
  readPrivateReviewForm,
  requireReviewMutation,
  validateEvidence,
} from "../app/modules/quote-review/domain/private-review";

it("rejects anonymous, factory, unrecognized admin and empty customer actors", () => {
  for (const actor of [
    null,
    undefined,
    { kind: "factory", profileId: "customer" },
    { kind: "customer", profileId: " " },
    { kind: "admin", identity: { id: "factory", accountType: "factory" } },
  ])
    expect(() => conversationAuthor(actor as QuoteConversationActor)).toThrow();
  expect(
    conversationAuthor({
      kind: "customer",
      profileId: "verified-session-profile",
    }),
  ).toEqual({ role: "customer", id: "verified-session-profile" });
});

it("requires a stable UUID command and text or an attachment", () => {
  const commandId = crypto.randomUUID();
  expect(
    conversationInput({
      commandId,
      body: "  clarification  ",
      hasAttachment: false,
    }),
  ).toEqual({ commandId, body: "clarification" });
  expect(
    conversationInput({ commandId, body: "", hasAttachment: true }).body,
  ).toBe("");
  for (const input of [
    { commandId: "", body: "hello", hasAttachment: false },
    { commandId, body: " ", hasAttachment: false },
    { commandId, body: "x".repeat(10001), hasAttachment: true },
  ])
    expect(() => conversationInput(input)).toThrow();
});

it("reuses same-origin POST protection for both website surfaces", () => {
  for (const origin of ["https://shop.example", "https://admin.example"]) {
    expect(() =>
      requireReviewMutation(
        new Request(`${origin}/conversation`, {
          method: "POST",
          headers: { Origin: origin },
        }),
      ),
    ).not.toThrow();
    for (const options of [
      { method: "GET" },
      { method: "POST" },
      { method: "POST", headers: { Origin: "https://attacker.example" } },
    ])
      expect(() =>
        requireReviewMutation(new Request(`${origin}/conversation`, options)),
      ).toThrow();
  }
});

it("permits signed PDF/PNG/JPEG only and rejects empty and oversized attachments", async () => {
  for (const [type, bytes] of [
    ["application/pdf", [37, 80, 68, 70, 45]],
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/jpeg", [255, 216, 255]],
  ] as const) {
    const file = await validateEvidence(
      new File([new Uint8Array(bytes)], '../unsafe"file', { type }),
    );
    expect(file.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(file.filename).not.toMatch(/["/]/);
  }
  for (const file of [
    new File(["<script>"], "fake.pdf", { type: "application/pdf" }),
    new File(["%PDF-"], "fake.svg", { type: "image/svg+xml" }),
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array(MAX_EVIDENCE_BYTES + 1)], "large.jpg", {
      type: "image/jpeg",
    }),
  ])
    await expect(validateEvidence(file)).rejects.toMatchObject({ status: 400 });
});

it("bounds streamed multipart bytes without Content-Length and rejects multiple file parts", async () => {
  const form = new FormData();
  form.set("body", "message");
  form.set(
    "file",
    new File(["%PDF-"], "first.pdf", { type: "application/pdf" }),
  );
  const request = () =>
    new Request("https://shop.example/conversation", {
      method: "POST",
      body: form,
    });
  expect((await readPrivateReviewForm(request())).get("body")).toBe("message");
  form.set(
    "extra",
    new File(["%PDF-"], "second.pdf", { type: "application/pdf" }),
  );
  await expect(readPrivateReviewForm(request())).rejects.toMatchObject({
    status: 400,
  });
  const streamedBody = {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=test" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_EVIDENCE_BYTES + 65537));
        controller.close();
      },
    }),
    duplex: "half",
  };
  const oversized = new Request(
    "https://shop.example/conversation",
    streamedBody,
  );
  expect(oversized.headers.has("Content-Length")).toBe(false);
  await expect(readPrivateReviewForm(oversized)).rejects.toMatchObject({
    status: 413,
  });
});
