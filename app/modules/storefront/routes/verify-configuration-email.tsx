import { Check, CircleX } from "lucide-react";

import type { Route } from "./+types/verify-configuration-email";
import { createPendingConfigurationSaveService } from "../../configurator/application/pending-configuration-save-service";
import { StorefrontHeader } from "../ui/storefront-header";
import { cloudflareContext } from "#workers/context";

export async function loader({ context, request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const { env } = context.get(cloudflareContext);
  const verified =
    await createPendingConfigurationSaveService(env).verify(token);
  return { verified: Boolean(verified) };
}

export function meta() {
  return [
    { title: "Verify Saved Configuration | Hydraulic Supply" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function VerifyConfigurationEmail({
  loaderData,
}: Route.ComponentProps) {
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="email-verification-page">
        {loaderData.verified ? (
          <>
            <Check aria-hidden="true" size={32} />
            <h1>Email verified</h1>
            <p>
              Your unfinished hose configuration is pending for 30 days. This
              did not create an account or add an item to your Quote List.
            </p>
          </>
        ) : (
          <>
            <CircleX aria-hidden="true" size={32} />
            <h1>Verification link unavailable</h1>
            <p>
              This link is invalid, expired, or was already used. Return to the
              configuration page and save the draft again.
            </p>
          </>
        )}
        <a className="button button-primary" href="/build-a-hose">
          Return to Build a Hose
        </a>
      </main>
    </div>
  );
}
