import { KeyRound } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/forgot-password";
import { cloudflareContext } from "#workers/context";

import {
  createCustomerIdentityService,
  CustomerIdentityError,
} from "../application/customer-identity-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";
import { StorefrontHeader } from "../../storefront/ui/storefront-header";

function value(form: FormData, key: string) {
  const item = form.get(key);
  return typeof item === "string" ? item.trim() : "";
}

export function meta() {
  return [{ title: "Reset Password | Hydraulic Supply" }];
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  requireTrustedAuthPost({
    environment: runtime.environment,
    request,
    storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
  });
  const form = await request.formData();
  const intent = value(form, "intent");
  const service = createCustomerIdentityService(env);
  try {
    if (intent === "request") {
      const result = await service.requestPasswordAuthorizationOtp({
        email: value(form, "email"),
        request,
        scope: "password_reset",
      });
      return data({ ...result, step: "verify" as const });
    }
    if (intent === "verify") {
      const result = await service.verifyPasswordAuthorizationOtp({
        challengeId: value(form, "challengeId"),
        code: value(form, "code"),
        request,
        scope: "password_reset",
      });
      return redirect("/reset-password", {
        headers: { "Set-Cookie": result.setCookie },
      });
    }
    throw new Response("Unknown password-reset command", { status: 400 });
  } catch (error) {
    if (!(error instanceof CustomerIdentityError)) throw error;
    return data(
      {
        challengeId: value(form, "challengeId") || undefined,
        email: value(form, "email") || undefined,
        error: error.message,
        step: intent === "verify" ? ("verify" as const) : ("email" as const),
      },
      { status: error.code === "RATE_LIMITED" ? 429 : 422 },
    );
  }
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const verify = actionData?.step === "verify";
  const busy = useNavigation().state !== "idle";
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="customer-auth-page">
        <section className="customer-auth-panel">
          <span className="customer-auth-icon" aria-hidden="true">
            <KeyRound size={24} />
          </span>
          <span className="eyebrow">Personal Center</span>
          <h1>{verify ? "Enter your email code" : "Forgot password"}</h1>
          <p>
            {verify
              ? "Enter the six-digit code. For privacy, the same response is used whether or not an account exists."
              : "We will send a fresh email code before allowing a password replacement."}
          </p>
          {actionData && "error" in actionData && actionData.error ? (
            <div className="customer-auth-error" role="alert">
              {actionData.error}
            </div>
          ) : null}
          {actionData &&
          "localPreviewCode" in actionData &&
          actionData.localPreviewCode ? (
            <div className="local-mail-stub" role="status">
              <span>Local email delivery stub</span>
              <strong>{actionData.localPreviewCode}</strong>
            </div>
          ) : null}
          <Form className="customer-auth-form" method="post">
            <input
              name="intent"
              type="hidden"
              value={verify ? "verify" : "request"}
            />
            {verify ? (
              <>
                <input
                  name="challengeId"
                  type="hidden"
                  value={actionData?.challengeId ?? ""}
                />
                <input
                  name="email"
                  type="hidden"
                  value={actionData?.email ?? ""}
                />
                <label htmlFor="reset-code">Verification code</label>
                <input
                  autoComplete="one-time-code"
                  autoFocus
                  id="reset-code"
                  inputMode="numeric"
                  maxLength={6}
                  name="code"
                  pattern="[0-9]{6}"
                  required
                />
              </>
            ) : (
              <>
                <label htmlFor="reset-email">Email address</label>
                <input
                  autoComplete="email"
                  autoFocus
                  defaultValue={actionData?.email ?? ""}
                  id="reset-email"
                  name="email"
                  required
                  type="email"
                />
              </>
            )}
            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              {verify ? "Verify code" : "Send email code"}
            </button>
          </Form>
          <Link className="customer-auth-switch" to="/sign-in?method=password">
            Back to sign in
          </Link>
        </section>
      </main>
    </div>
  );
}
