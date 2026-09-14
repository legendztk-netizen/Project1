import { expect, it } from "vitest";
import {
  privateNote,
  readPrivateReviewForm,
  requireReviewMutation,
  validateEvidence,
} from "../app/modules/quote-review/domain/private-review";

it("bounds multipart bytes even without Content-Length and rejects extra file parts", async () => {
  const url = "http://admin.localhost/review";
  const oversized = new Request(url, {
    method: "POST",
    body: new Uint8Array(11 * 1024 * 1024),
    headers: { "Content-Type": "multipart/form-data; boundary=test" },
  });
  await expect(readPrivateReviewForm(oversized)).rejects.toMatchObject({
    status: 413,
  });
  const form = new FormData();
  form.set("file", new File(["first"], "a.pdf"));
  form.set("extra", new File(["second"], "b.pdf"));
  await expect(
    readPrivateReviewForm(new Request(url, { method: "POST", body: form })),
  ).rejects.toMatchObject({ status: 400 });
});

it("validates append-only note input and rejects cross-origin mutations", () => {
  expect(privateNote("  factory check  ")).toBe("factory check");
  expect(() => privateNote(" ")).toThrow();
  expect(() => privateNote("a".repeat(10001))).toThrow();
  expect(() =>
    requireReviewMutation(
      new Request("https://admin.example/review", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      }),
    ),
  ).toThrow();
  expect(() =>
    requireReviewMutation(
      new Request("https://admin.example/review", { method: "POST" }),
    ),
  ).toThrow();
  expect(() =>
    requireReviewMutation(
      new Request("https://admin.example/review", {
        method: "POST",
        headers: { Origin: "https://admin.example" },
      }),
    ),
  ).not.toThrow();
});

it("requires approved MIME and matching file signature, sanitizes filenames", async () => {
  const valid = await validateEvidence(
    new File(["%PDF-1.4\nfixture"], '../../tax".pdf', {
      type: "application/pdf",
    }),
  );
  expect(valid.filename).not.toMatch(/["/]/);
  expect(valid.checksum).toMatch(/^[0-9a-f]{64}$/);
  await expect(
    validateEvidence(
      new File(["<script>"], "x.pdf", { type: "application/pdf" }),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    validateEvidence(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    validateEvidence(new File([], "empty.pdf", { type: "application/pdf" })),
  ).rejects.toMatchObject({ status: 400 });
});
