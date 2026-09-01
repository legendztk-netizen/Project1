import type { Route } from "./+types/register";
import { cloudflareContext } from "#workers/context";
import { data, redirect } from "react-router";

import { authReturnPath, handleEmailOtpAction } from "./email-otp-route";
import { EmailOtpAccessPage } from "../ui/email-otp-access-page";
import { CustomerIdentityError } from "../application/customer-identity-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";
import { createRegistrationConfigurationService } from "../application/registration-configuration-service";
import { RegistrationConfigurationRejected } from "../../configurator/domain/registration-configuration";
import { validatedCustomerReturnPath } from "../domain/email-otp";

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function meta() {
  return [{ title: "Register | Hydraulic Supply" }];
}

export function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { returnTo: authReturnPath(request, env.PUBLIC_STOREFRONT_ORIGIN) };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  const form = await request.clone().formData();
  const intent = textValue(form, "intent");
  if (
    intent === "request-configuration-registration" ||
    intent === "abandon-configuration-registration"
  ) {
    requireTrustedAuthPost({
      environment: runtime.environment,
      request,
      storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
    });
    const registration = createRegistrationConfigurationService(env);
    if (intent === "abandon-configuration-registration") {
      await registration.abandon({
        challengeId: textValue(form, "challengeId"),
        transactionId: textValue(form, "registrationTransactionId"),
      });
      return redirect("/register");
    }
    const registrationSnapshot = textValue(form, "registrationSnapshot");
    const returnTo = validatedCustomerReturnPath(
      textValue(form, "returnTo"),
      env.PUBLIC_STOREFRONT_ORIGIN,
    );
    try {
      const result = await registration.start({
        email: textValue(form, "email"),
        request,
        snapshotJson: registrationSnapshot,
      });
      return data({ ...result, returnTo, step: "verify" as const });
    } catch (error) {
      if (
        !(error instanceof CustomerIdentityError) &&
        !(error instanceof RegistrationConfigurationRejected)
      ) {
        throw error;
      }
      return data(
        {
          email: textValue(form, "email") || undefined,
          error: error.message,
          registrationSnapshot,
          returnTo,
          step: "email" as const,
        },
        {
          status:
            error instanceof CustomerIdentityError &&
            (error.code === "COOLDOWN" || error.code === "RATE_LIMITED")
              ? 429
              : 422,
        },
      );
    }
  }
  if (intent === "verify") {
    await createRegistrationConfigurationService(env).cleanupExpired();
  }
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
