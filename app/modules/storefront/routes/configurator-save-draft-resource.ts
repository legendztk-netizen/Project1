import type { Route } from "./+types/configurator-save-draft-resource";
import { createPendingConfigurationSaveService } from "../../configurator/application/pending-configuration-save-service";
import { PendingConfigurationSaveRejected } from "../../configurator/domain/pending-configuration-save";
import { cloudflareContext } from "#workers/context";

function parseJson(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

class RequestBodyTooLarge extends Error {}

async function readBoundedFormData(request: Request, maximumBytes: number) {
  if (!request.body) return new FormData();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RequestBodyTooLarge();
    }
    chunks.push(value);
  }
  const body = new Blob(
    chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer),
  );
  return new Response(body, { headers: request.headers }).formData();
}

export async function action({ context, request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed", ok: false },
      { status: 405 },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 200_000) {
    return Response.json(
      { error: "The configuration is too large to save.", ok: false },
      { status: 413 },
    );
  }
  let form: FormData;
  try {
    form = await readBoundedFormData(request, 200_000);
  } catch (error) {
    if (!(error instanceof RequestBodyTooLarge)) throw error;
    return Response.json(
      { error: "The configuration is too large to save.", ok: false },
      { status: 413 },
    );
  }
  const { env } = context.get(cloudflareContext);
  try {
    const saved = await createPendingConfigurationSaveService(env).save({
      configuration: parseJson(form.get("configuration")),
      email: form.get("email"),
      pageState: parseJson(form.get("pageState")),
      requestAddress: request.headers.get("CF-Connecting-IP"),
    });
    return Response.json({ error: null, ok: true, ...saved });
  } catch (error) {
    if (!(error instanceof PendingConfigurationSaveRejected)) throw error;
    return Response.json(
      { error: error.message, ok: false },
      {
        status:
          error.code === "EMAIL_UNAVAILABLE"
            ? 503
            : error.code === "RATE_LIMITED"
              ? 429
              : 422,
      },
    );
  }
}
