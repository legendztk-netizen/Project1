import { KeyRound, MailCheck } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/account-security";
import { cloudflareContext } from "#workers/context";

import {
  createCustomerIdentityService,
  CustomerIdentityError,
} from "../application/customer-identity-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";
import { validatedCustomerReturnPath } from "../domain/email-otp";
import { StorefrontHeader } from "../../storefront/ui/storefront-header";

function value(form: FormData, name: string) {
  const item = form.get(name);
  return typeof item === "string" ? item : "";
}

function matchingPassword(form: FormData) {
  const password = value(form, "newPassword");
  if (password !== value(form, "confirmPassword")) {
    throw new CustomerIdentityError(
      "The new passwords do not match.",
      "PASSWORD_POLICY",
    );
  }
  return password;
}

export function meta() {
  return [{ title: "Account Security | Hydraulic Supply" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const status =
    await createCustomerIdentityService(env).readPasswordStatus(request);
  if (!status) throw redirect("/sign-in?returnTo=%2Faccount%2Fsecurity");
  const url = new URL(request.url);
  return {
    ...status,
    returnTo: validatedCustomerReturnPath(
      url.searchParams.get("returnTo"),
      env.PUBLIC_STOREFRONT_ORIGIN,
    ),
    saved: url.searchParams.get("saved") === "1",
    welcome: url.searchParams.get("welcome") === "1",
  };
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
    if (intent === "set") {
      await service.setInitialPassword({
        password: matchingPassword(form),
        request,
      });
      return redirect("/account/security?saved=1");
    }
    if (intent === "change-current") {
      const result = await service.changePasswordWithCurrent({
        currentPassword: value(form, "currentPassword"),
        newPassword: matchingPassword(form),
        request,
      });
      return redirect("/account/security?saved=1", {
        headers: { "Set-Cookie": result.setCookie },
      });
    }
    if (intent === "request-code") {
      const result = await service.requestPasswordAuthorizationOtp({
        request,
        scope: "password_change",
      });
      return data({ ...result, step: "verify" as const });
    }
    if (intent === "verify-code") {
      const result = await service.verifyPasswordAuthorizationOtp({
        challengeId: value(form, "challengeId"),
        code: value(form, "code").trim(),
        request,
        scope: "password_change",
      });
      return redirect("/reset-password?mode=change", {
        headers: { "Set-Cookie": result.setCookie },
      });
    }
    throw new Response("Unknown account-security command", { status: 400 });
  } catch (error) {
    if (!(error instanceof CustomerIdentityError)) throw error;
    return data(
      {
        challengeId: value(form, "challengeId") || undefined,
        error: error.message,
        step: intent === "verify-code" ? ("verify" as const) : undefined,
      },
      { status: error.code === "RATE_LIMITED" ? 429 : 422 },
    );
  }
}

function PasswordFields(input: { current?: boolean }) {
  return (
    <>
      {input.current ? (
        <>
          <label htmlFor="current-password">Current password</label>
          <input
            autoComplete="current-password"
            id="current-password"
            name="currentPassword"
            required
            type="password"
          />
        </>
      ) : null}
      <label htmlFor="new-password">New password</label>
      <input
        autoComplete="new-password"
        id="new-password"
        minLength={15}
        name="newPassword"
        required
        type="password"
      />
      <label htmlFor="confirm-password">Confirm new password</label>
      <input
        autoComplete="new-password"
        id="confirm-password"
        minLength={15}
        name="confirmPassword"
        required
        type="password"
      />
      <p className="password-guidance">
        Use at least 15 characters. Spaces and passphrases are welcome; no
        symbol recipe is required.
      </p>
    </>
  );
}

export default function AccountSecurity({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const verify = actionData?.step === "verify";
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="customer-auth-page">
        <section className="customer-auth-panel customer-security-panel">
          <span className="customer-auth-icon" aria-hidden="true">
            <KeyRound size={24} />
          </span>
          <span className="eyebrow">Personal Center</span>
          <h1>
            {loaderData.welcome ? "Secure your account" : "Account security"}
          </h1>
          <p>
            Email code sign-in always remains available. Adding a password is
            optional.
          </p>
          {loaderData.saved ? (
            <div className="customer-auth-success" role="status">
              Password saved. Other active sessions were signed out when the
              password was replaced.
            </div>
          ) : null}
          {actionData && "error" in actionData && actionData.error ? (
            <div className="customer-auth-error" role="alert">
              {actionData.error}
            </div>
          ) : null}

          {!loaderData.hasPassword ? (
            <Form className="customer-auth-form" method="post">
              <input name="intent" type="hidden" value="set" />
              <PasswordFields />
              <button
                className="button button-primary"
                disabled={busy}
                type="submit"
              >
                Set password
              </button>
            </Form>
          ) : (
            <>
              <Form className="customer-auth-form" method="post">
                <input name="intent" type="hidden" value="change-current" />
                <PasswordFields current />
                <button
                  className="button button-primary"
                  disabled={busy}
                  type="submit"
                >
                  Change password
                </button>
              </Form>
              <div className="customer-auth-divider">
                <span>or</span>
              </div>
              <Form className="customer-auth-form" method="post">
                <input
                  name="intent"
                  type="hidden"
                  value={verify ? "verify-code" : "request-code"}
                />
                {verify ? (
                  <>
                    <input
                      name="challengeId"
                      type="hidden"
                      value={actionData?.challengeId ?? ""}
                    />
                    <label htmlFor="security-code">
                      Email verification code
                    </label>
                    <input
                      autoComplete="one-time-code"
                      id="security-code"
                      inputMode="numeric"
                      maxLength={6}
                      name="code"
                      pattern="[0-9]{6}"
                      required
                    />
                  </>
                ) : null}
                {actionData &&
                "localPreviewCode" in actionData &&
                actionData.localPreviewCode ? (
                  <div className="local-mail-stub" role="status">
                    <span>Local email delivery stub</span>
                    <strong>{actionData.localPreviewCode}</strong>
                  </div>
                ) : null}
                <button
                  className="button button-secondary"
                  disabled={busy}
                  type="submit"
                >
                  <MailCheck size={17} />
                  {verify ? "Verify email code" : "Change using email code"}
                </button>
              </Form>
            </>
          )}

          {loaderData.welcome ? (
            <Link className="customer-auth-switch" to={loaderData.returnTo}>
              Skip for now
            </Link>
          ) : (
            <Link className="customer-auth-switch" to="/account">
              Back to Personal Center
            </Link>
          )}
        </section>
      </main>
    </div>
  );
}
