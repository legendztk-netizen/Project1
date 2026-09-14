import { PDFDocument, PDFName } from "pdf-lib";
import { expect, it } from "vitest";
import { validateConversationAttachment } from "../app/modules/quote-conversation/domain/conversation-attachment";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
    "base64",
  ),
);
const jpeg = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EF//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EF//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EF//2Q==",
    "base64",
  ),
);

async function pdfBytes(pages = 1) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage();
  return new Uint8Array(await document.save());
}

it("accepts structurally valid documents and normalizes only permitted extensions", async () => {
  for (const [bytes, type, name, expected] of [
    [await pdfBytes(), "application/pdf", "quote.PDF", "quote.pdf"],
    [png, "image/png", "image.PNG", "image.png"],
    [jpeg, "image/jpeg", "photo.JPEG", "photo.jpg"],
  ] as const) {
    const attachment = await validateConversationAttachment(
      new File([bytes], name, { type }),
    );
    expect(attachment.filename).toBe(expected);
    expect(attachment.bytes.byteLength).toBe(bytes.length);
    expect(attachment.checksum).toMatch(/^[0-9a-f]{64}$/);
  }
});

it("rejects extension spoofing, prefix-only HTML and truncated image containers", async () => {
  for (const file of [
    new File([await pdfBytes()], "quote.html", { type: "application/pdf" }),
    new File(
      ["%PDF-1.7\n<html><script>alert(1)</script></html>"],
      "quote.pdf",
      { type: "application/pdf" },
    ),
    new File([png.slice(0, 8), "<html>"], "image.png", { type: "image/png" }),
    new File([jpeg.slice(0, 3), "<html>"], "photo.jpg", { type: "image/jpeg" }),
    new File([png.slice(0, -12)], "truncated.png", { type: "image/png" }),
    new File([jpeg.slice(0, -2)], "truncated.jpg", { type: "image/jpeg" }),
  ])
    await expect(validateConversationAttachment(file)).rejects.toMatchObject({
      status: 400,
    });
});

it("rejects oversized dimensions before image decompression and bounds PDF page counts", async () => {
  const enormousPng = png.slice();
  new DataView(enormousPng.buffer).setUint32(16, 100000);
  await expect(
    validateConversationAttachment(
      new File([enormousPng], "large.png", { type: "image/png" }),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    validateConversationAttachment(
      new File([await pdfBytes(201)], "large.pdf", { type: "application/pdf" }),
    ),
  ).rejects.toMatchObject({ status: 400 });
});

it("rejects PDFs declaring encryption", async () => {
  const document = await PDFDocument.create();
  document.addPage();
  document.context.trailerInfo.Encrypt = document.context.register(
    document.context.obj({ Filter: PDFName.of("Standard") }),
  );
  const bytes = new Uint8Array(
    await document.save({ useObjectStreams: false }),
  );
  await expect(
    validateConversationAttachment(
      new File([bytes], "encrypted.pdf", { type: "application/pdf" }),
    ),
  ).rejects.toMatchObject({ status: 400 });
});
