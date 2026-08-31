import type { AppEnvironment } from "#workers/environment";

export function requireTrustedAuthPost(input: {
  environment: AppEnvironment;
  request: Request;
  storefrontOrigin: string;
}) {
  if (input.request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  const origin = input.request.headers.get("origin");
  if (!origin)
    throw new Response("Request origin is required", { status: 403 });
  const requestOrigin = new URL(input.request.url).origin;
  const trusted =
    origin === input.storefrontOrigin ||
    (input.environment === "local" && origin === requestOrigin);
  if (!trusted) throw new Response("Untrusted request origin", { status: 403 });
}
