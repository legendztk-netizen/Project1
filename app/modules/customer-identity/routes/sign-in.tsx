import type { Route } from "./+types/sign-in";
import { cloudflareContext } from "#workers/context";

import { authReturnPath, handleEmailOtpAction } from "./email-otp-route";
import { EmailOtpAccessPage } from "../ui/email-otp-access-page";

export function meta() {
  return [{ title: "Sign In | Hydraulic Supply" }];
}

export function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { returnTo: authReturnPath(request, env.PUBLIC_STOREFRONT_ORIGIN) };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  return handleEmailOtpAction({
    env,
    environment: runtime.environment,
    purpose: "sign_in",
    request,
  });
}

export default function SignIn({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  return (
    <EmailOtpAccessPage
      actionData={actionData}
      purpose="sign_in"
      returnTo={loaderData.returnTo}
    />
  );
}
