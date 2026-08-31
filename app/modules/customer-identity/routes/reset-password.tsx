import { KeyRound } from "lucide-react";
import { data, Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/reset-password";
import { cloudflareContext } from "#workers/context";

import {
  confirmedCustomerPassword,
  createCustomerIdentityService,
  CustomerIdentityError,
} from "../application/customer-identity-service";
import { requireTrustedAuthPost } from "../application/trusted-auth-request";
import { clearPasswordAuthorizationCookie } from "../domain/password-authorization";
import { StorefrontHeader } from "../../storefront/ui/storefront-header";

function value(form: FormData, key: string) {
  const item = form.get(key);
  return typeof item === "string" ? item : "";
}

export function meta() {
  return [{ title: "Choose Password | Hydraulic Supply" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const authorization =
    await createCustomerIdentityService(env).readPasswordAuthorization(request);
  if (!authorization) throw redirect("/forgot-password");
  return { authorization };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env, runtime } = context.get(cloudflareContext);
  requireTrustedAuthPost({
    environment: runtime.environment,
    request,
    storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
  });
  const form = await request.formData();
  try {
    const password = confirmedCustomerPassword(
      value(form, "newPassword"),
      value(form, "confirmPassword"),
    );
    const result = await createCustomerIdentityService(
      env,
    ).replacePasswordWithAuthorization({
      newPassword: password,
      request,
    });
    const headers = new Headers();
    headers.append("Set-Cookie", result.setCookie);
    headers.append(
      "Set-Cookie",
      clearPasswordAuthorizationCookie(env.APP_ENV !== "local"),
    );
    return redirect("/account/security?saved=1", { headers });
  } catch (error) {
    if (!(error instanceof CustomerIdentityError)) throw error;
    return data(
      { error: error.message },
      { status: error.code === "RATE_LIMITED" ? 429 : 422 },
    );
  }
}

export default function ResetPassword({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="customer-auth-page">
        <section className="customer-auth-panel">
          <span className="customer-auth-icon" aria-hidden="true">
            <KeyRound size={24} />
          </span>
          <span className="eyebrow">Verified email</span>
          <h1>Choose a new password</h1>
          <p>
            Set a password for {loaderData.authorization.email}. Email code
            sign-in will continue to work.
          </p>
          {actionData?.error ? (
            <div className="customer-auth-error" role="alert">
              {actionData.error}
            </div>
          ) : null}
          <Form className="customer-auth-form" method="post">
            <label htmlFor="reset-new-password">New password</label>
            <input
              autoComplete="new-password"
              autoFocus
              id="reset-new-password"
              minLength={15}
              name="newPassword"
              required
              type="password"
            />
            <label htmlFor="reset-confirm-password">Confirm new password</label>
            <input
              autoComplete="new-password"
              id="reset-confirm-password"
              minLength={15}
              name="confirmPassword"
              required
              type="password"
            />
            <p className="password-guidance">
              Use at least 15 characters. Your complete password is hashed; it
              is never shortened or stored as readable text.
            </p>
            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              Save new password
            </button>
          </Form>
        </section>
      </main>
    </div>
  );
}
