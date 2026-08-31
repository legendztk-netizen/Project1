import { LogOut, UserRound } from "lucide-react";
import { Form, redirect } from "react-router";

import type { Route } from "./+types/customer-account";
import { cloudflareContext } from "#workers/context";
import { createCustomerIdentityService } from "../application/customer-identity-service";
import { StorefrontHeader } from "../../storefront/ui/storefront-header";

export function meta() {
  return [{ title: "Personal Center | Hydraulic Supply" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const profile = await createCustomerIdentityService(env).readSession(request);
  if (!profile) throw redirect("/sign-in?returnTo=%2Faccount");
  return { profile };
}

export default function CustomerAccount({ loaderData }: Route.ComponentProps) {
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="customer-account-page">
        <section className="customer-account-panel">
          <UserRound size={28} />
          <span className="eyebrow">Personal Center</span>
          <h1>Your account</h1>
          <dl>
            <div>
              <dt>Verified email</dt>
              <dd>{loaderData.profile.email}</dd>
            </div>
          </dl>
          <Form action="/sign-out" method="post">
            <button className="button button-secondary" type="submit">
              <LogOut size={17} /> Sign out
            </button>
          </Form>
        </section>
      </main>
    </div>
  );
}
