import type { Route } from "./+types/register";
import { cloudflareContext } from "#workers/context";

import { authReturnPath, handleEmailOtpAction } from "./email-otp-route";
import { EmailOtpAccessPage } from "../ui/email-otp-access-page";

export function meta() {
  return [{ title: "Register | Hydraulic Supply" }];
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
    purpose: "register",
    request,
  });
}

export default function Register({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  return (
    <EmailOtpAccessPage
      actionData={actionData}
      purpose="register"
      returnTo={loaderData.returnTo}
    />
  );
}
