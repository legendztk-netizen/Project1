import { data, redirect } from "react-router";

import type { AppEnvironment, ApplicationBindings } from "#workers/environment";

import {
  createCustomerIdentityService,
  CustomerIdentityError,
} from "../application/customer-identity-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";
import {
  validatedCustomerReturnPath,
  type EmailOtpPurpose,
} from "../domain/email-otp";

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function authReturnPath(request: Request, storefrontOrigin: string) {
  return validatedCustomerReturnPath(
    new URL(request.url).searchParams.get("returnTo"),
    storefrontOrigin,
  );
}

export async function handleEmailOtpAction(input: {
  env: ApplicationBindings;
  environment: AppEnvironment;
  purpose: EmailOtpPurpose;
  request: Request;
}) {
  requireTrustedAuthPost({
    environment: input.environment,
    request: input.request,
    storefrontOrigin: input.env.PUBLIC_STOREFRONT_ORIGIN,
  });
  const form = await input.request.formData();
  const intent = textValue(form, "intent");
  const registrationTransactionId = textValue(
    form,
    "registrationTransactionId",
  );
  const returnTo = validatedCustomerReturnPath(
    textValue(form, "returnTo"),
    input.env.PUBLIC_STOREFRONT_ORIGIN,
  );
  const service = createCustomerIdentityService(input.env);

  try {
    if (intent === "request") {
      const result = await service.requestOtp({
        email: textValue(form, "email"),
        purpose: input.purpose,
        request: input.request,
      });
      return data({ ...result, returnTo, step: "verify" as const });
    }
    if (intent === "verify") {
      const result = await service.verifyOtp({
        challengeId: textValue(form, "challengeId"),
        code: textValue(form, "code"),
        purpose: input.purpose,
        request: input.request,
      });
      const destination =
        input.purpose === "register" && result.newlyRegistered
          ? `/account/security?welcome=1&returnTo=${encodeURIComponent(returnTo)}`
          : returnTo;
      return redirect(destination, {
        headers: { "Set-Cookie": result.setCookie },
      });
    }
    throw new Response("Unknown authentication command", { status: 400 });
  } catch (error) {
    if (!(error instanceof CustomerIdentityError)) throw error;
    const verify = intent === "verify";
    return data(
      {
        challengeId: verify ? textValue(form, "challengeId") : undefined,
        email: textValue(form, "email") || undefined,
        error: error.message,
        registrationTransactionId:
          verify && registrationTransactionId
            ? registrationTransactionId
            : undefined,
        returnTo,
        step: verify ? ("verify" as const) : ("email" as const),
      },
      {
        status:
          error.code === "COOLDOWN" || error.code === "RATE_LIMITED"
            ? 429
            : 422,
      },
    );
  }
}
