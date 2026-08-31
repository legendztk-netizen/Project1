import { redirect } from "react-router";

import type { Route } from "./+types/sign-out";
import { cloudflareContext } from "#workers/context";
import { createCustomerIdentityService } from "../application/customer-identity-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";

export async function action({ context, request }: Route.ActionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  requireTrustedAuthPost({
    environment: runtime.environment,
    request,
    storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
  });
  const setCookie = await createCustomerIdentityService(env).signOut(request);
  return redirect("/", { headers: { "Set-Cookie": setCookie } });
}
