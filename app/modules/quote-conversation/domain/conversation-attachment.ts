import { PDFDocument } from "pdf-lib";
import { validateEvidence } from "../../quote-review/domain/private-review";

const maximumImagePixels = 4_000_000;
const maximumImageDimension = 4096;
const maximumPdfPages = 200;

function dimensions(width: number, height: number) {
  if (
    !width ||
    !height ||
    width > maximumImageDimension ||
    height > maximumImageDimension ||
    width * height > maximumImagePixels
  )
    throw new Error("Image dimensions exceed the permitted bounds");
}

function pngContainer(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 33 ||
    data.getUint32(8) !== 13 ||
    data.getUint32(12) !== 0x49484452
  )
    throw new Error("PNG header required");
  dimensions(data.getUint32(16), data.getUint32(20));
  let offset = 8;
  let hasPixels = false;
  while (offset + 12 <= bytes.length) {
    const length = data.getUint32(offset);
    const type = data.getUint32(offset + 4);
    if (length > bytes.length - offset - 12)
      throw new Error("Truncated PNG chunk");
    if (type === 0x6163544c) throw new Error("Animated PNG is not permitted");
    if (type === 0x49484452 && offset !== 8)
      throw new Error("Duplicate PNG header");
    if (type === 0x49444154 && length > 0) hasPixels = true;
    offset += length + 12;
    if (type === 0x49454e44) {
      if (length || offset !== bytes.length || !hasPixels)
        throw new Error("Invalid PNG end");
      return;
    }
  }
  throw new Error("PNG end required");
}

function jpegContainer(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("JPEG marker required");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!hasFrame || !hasScan || offset !== bytes.length)
        throw new Error("Invalid JPEG end");
      return;
    }
    if (offset + 2 > bytes.length) throw new Error("Truncated JPEG marker");
    const length = data.getUint16(offset);
    if (length < 2 || length > bytes.length - offset)
      throw new Error("Truncated JPEG segment");
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) throw new Error("Truncated JPEG frame");
      dimensions(data.getUint16(offset + 5), data.getUint16(offset + 3));
      hasFrame = true;
    }
    offset += length;
    if (marker === 0xda) {
      if (!hasFrame) throw new Error("JPEG frame required before scan");
      const start = offset;
      // Skip byte-stuffed entropy and restart markers to find the next segment.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        break;
      }
      hasScan ||= offset > start;
    }
  }
  throw new Error("JPEG end required");
}

export async function validateConversationAttachment(file: File) {
  const validated = await validateEvidence(file);
  const extension = validated.filename.split(".").pop()?.toLowerCase();
  const permitted: Record<string, readonly string[]> = {
    "application/pdf": ["pdf"],
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
  };
  if (!extension || !permitted[validated.contentType]?.includes(extension))
    throw new Response("Attachment extension must match its file type", {
      status: 400,
    });
  try {
    const bytes = new Uint8Array(validated.bytes);
    if (validated.contentType === "application/pdf") {
      const document = await PDFDocument.load(bytes, {
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      if (
        document.isEncrypted ||
        document.getPageCount() < 1 ||
        document.getPageCount() > maximumPdfPages
      )
        throw new Error("PDF must be unencrypted and contain 1-200 pages");
    } else {
      const document = await PDFDocument.create();
      if (validated.contentType === "image/png") {
        pngContainer(bytes);
        await document.embedPng(bytes);
      } else {
        jpegContainer(bytes);
        await document.embedJpg(bytes);
      }
    }
  } catch {
    throw new Response("Invalid or unsupported attachment structure", {
      status: 400,
    });
  }
  const normalizedExtension =
    validated.contentType === "image/jpeg" ? "jpg" : extension;
  return {
    ...validated,
    filename:
      validated.filename.slice(0, -extension.length) + normalizedExtension,
  };
}
