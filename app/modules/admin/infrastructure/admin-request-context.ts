import type { RouterContextProvider } from "react-router";

import { cloudflareContext } from "#workers/context";

export function requireAdminRequestContext(
  context: Readonly<RouterContextProvider>,
) {
  const cloudflare = context.get(cloudflareContext);
  if (!cloudflare.adminIdentity)
    throw new Response("Admin identity missing", { status: 403 });
  return {
    adminIdentity: cloudflare.adminIdentity,
    env: cloudflare.env,
  };
}
