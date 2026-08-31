import type { Route } from "./+types/sign-in";
import { cloudflareContext } from "#workers/context";
import { data, redirect } from "react-router";

import { authReturnPath, handleEmailOtpAction } from "./email-otp-route";
import { EmailOtpAccessPage } from "../ui/email-otp-access-page";
import {
  createCustomerIdentityService,
  CustomerIdentityError,
} from "../application/customer-identity-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";

export function meta() {
  return [{ title: "Sign In | Hydraulic Supply" }];
}

export function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return {
    method:
      new URL(request.url).searchParams.get("method") === "password"
        ? ("password" as const)
        : ("email-code" as const),
    returnTo: authReturnPath(request, env.PUBLIC_STOREFRONT_ORIGIN),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  const form = await request.clone().formData();
  if (form.get("intent") === "password") {
    requireTrustedAuthPost({
      environment: runtime.environment,
      request,
      storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
    });
    const email = String(form.get("email") ?? "").trim();
    try {
      const result = await createCustomerIdentityService(
        env,
      ).signInWithPassword({
        email,
        password: String(form.get("password") ?? ""),
        request,
      });
      return redirect(authReturnPath(request, env.PUBLIC_STOREFRONT_ORIGIN), {
        headers: { "Set-Cookie": result.setCookie },
      });
    } catch (error) {
      if (!(error instanceof CustomerIdentityError)) throw error;
      return data(
        {
          email,
          error: error.message,
          step: "password" as const,
        },
        { status: error.code === "RATE_LIMITED" ? 429 : 422 },
      );
    }
  }
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
      initialMethod={loaderData.method}
      purpose="sign_in"
      returnTo={loaderData.returnTo}
    />
  );
}
