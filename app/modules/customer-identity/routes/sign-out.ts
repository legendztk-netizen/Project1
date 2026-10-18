import { redirect } from "react-router";

import type { Route } from "./+types/sign-out";
import { cloudflareContext } from "#workers/context";
import { createCustomerIdentityService } from "../application/customer-identity-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";

// Signing out needs a trusted POST; a GET (a bookmark, or a stale page's
// document reload) returns to the account page and its Sign Out button.
export function loader() {
  return redirect("/account");
}

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
