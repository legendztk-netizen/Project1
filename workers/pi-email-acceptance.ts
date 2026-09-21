import type { ApplicationBindings } from "./environment";
import { notificationProtector } from "./quote-notifications";
import { createPiEmailAcceptanceService } from "../app/modules/proforma-invoice/application/pi-email-acceptance-service";
import { createPiAcceptanceCopies } from "../app/modules/proforma-invoice/application/pi-acceptance-copies";
import type { NotificationQueueMessage } from "../app/modules/quote-notifications";

function lazyProtector(env: ApplicationBindings) {
  return {
    async seal(plaintext: string, context: string) {
      return (await notificationProtector(env)).seal(plaintext, context);
    },
    async open(ciphertext: string, context: string) {
      return (await notificationProtector(env)).open(ciphertext, context);
    },
  };
}

export async function piEmailAcceptance(env: ApplicationBindings) {
  return createPiEmailAcceptanceService(env.DB, env.PRIVATE_FILES, {
    inboundProtector: lazyProtector(env),
    appEnvironment: env.APP_ENV,
  });
}

export async function piAcceptanceCopies(env: ApplicationBindings) {
  return createPiAcceptanceCopies({
    database: env.DB,
    env,
    protector: lazyProtector(env),
  });
}

// Wire into the existing scheduled dispatcher and queue fallback, not the
// acceptance request: transport/configuration failures cannot undo acceptance.
export async function dispatchPiAcceptanceCopies(env: ApplicationBindings) {
  return (await piAcceptanceCopies(env)).dispatch(env.ASYNC_JOBS, 100);
}

export async function consumePiAcceptanceCopy(
  message: NotificationQueueMessage,
  env: ApplicationBindings,
) {
  if (
    !message.body ||
    typeof message.body !== "object" ||
    !("type" in message.body) ||
    message.body.type !== "pi-acceptance-copy"
  )
    return false;
  return (await piAcceptanceCopies(env)).consume(message);
}

export async function readPiEmailCommand(request: Request): Promise<unknown> {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new Response("JSON command required", { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) throw new Response("Command required", { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Response("Command too large", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new Response("Invalid JSON command", { status: 400 });
  }
}

export const piEmailPrivateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
