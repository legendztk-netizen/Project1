export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export async function readPrivateReviewForm(request: Request) {
  const limit = MAX_EVIDENCE_BYTES + 64 * 1024;
  if (Number(request.headers.get("Content-Length")) > limit)
    throw new Response("Request too large", { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw new Response("Form required", { status: 400 });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Response("Request too large", { status: 413 });
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  const form = await new Response(new Blob(chunks), {
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
  }).formData();
  if (
    [...form.values()].filter((value) => typeof value !== "string").length > 1
  )
    throw new Response("Only one file is permitted", { status: 400 });
  return form;
}

export function requireReviewMutation(request: Request) {
  if (request.method !== "POST")
    throw new Response("Method not allowed", { status: 405 });
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    throw new Response("Invalid origin", { status: 403 });
}

export function privateNote(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 10000)
    throw new Response("Note must contain 1-10000 characters", { status: 400 });
  return value.trim();
}

export async function digest(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}

export async function validateEvidence(file: File) {
  if (!file.size || file.size > MAX_EVIDENCE_BYTES)
    throw new Response("File must be between 1 byte and 10 MB", {
      status: 400,
    });
  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes).slice(0, 12);
  const signatures: Record<string, number[]> = {
    "application/pdf": [37, 80, 68, 70, 45],
    "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
    "image/jpeg": [255, 216, 255],
  };
  const signature = signatures[file.type];
  if (!signature || !signature.every((byte, index) => head[index] === byte))
    throw new Response("Only PDF, PNG and JPEG evidence is permitted", {
      status: 400,
    });
  const filename =
    file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "evidence";
  return {
    bytes,
    filename,
    checksum: await digest(bytes),
    contentType: file.type,
  };
}
