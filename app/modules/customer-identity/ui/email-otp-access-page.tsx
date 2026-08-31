import { ArrowRight, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";

import type { EmailOtpPurpose } from "../domain/email-otp";
import { StorefrontHeader } from "../../storefront/ui/storefront-header";

export interface EmailOtpActionData {
  challengeId?: string;
  email?: string;
  error?: string;
  localPreviewCode?: string | null;
  step?: "email" | "password" | "verify";
}

export function EmailOtpAccessPage(input: {
  actionData?: EmailOtpActionData;
  initialMethod?: "email-code" | "password";
  purpose: EmailOtpPurpose;
  returnTo: string;
}) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const register = input.purpose === "register";
  const verify = input.actionData?.step === "verify";
  const password =
    !register &&
    (input.actionData?.step === "password" ||
      (!input.actionData?.step && input.initialMethod === "password"));
  const title = register ? "Create your account" : "Sign in to your account";

  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="customer-auth-page">
        <section className="customer-auth-panel">
          <span className="customer-auth-icon" aria-hidden="true">
            {verify ? (
              <ShieldCheck size={24} />
            ) : password ? (
              <KeyRound size={24} />
            ) : (
              <Mail size={24} />
            )}
          </span>
          <span className="eyebrow">Personal Center</span>
          <h1>{verify ? "Enter your email code" : title}</h1>
          <p>
            {verify
              ? `We sent a six-digit code to ${input.actionData?.email ?? "your email"}. It expires in 10 minutes.`
              : password
                ? "Enter your email and password, or switch to an email code at any time."
                : register
                  ? "Use your email to create a verified customer account. No password is required."
                  : "Use a six-digit email code to sign in without a password."}
          </p>

          {!register && !verify ? (
            <nav className="customer-auth-methods" aria-label="Sign-in method">
              <Link
                aria-current={!password ? "page" : undefined}
                to={`/sign-in?returnTo=${encodeURIComponent(input.returnTo)}`}
              >
                Email code
              </Link>
              <Link
                aria-current={password ? "page" : undefined}
                to={`/sign-in?method=password&returnTo=${encodeURIComponent(input.returnTo)}`}
              >
                Password
              </Link>
            </nav>
          ) : null}

          {input.actionData?.error ? (
            <div className="customer-auth-error" role="alert">
              {input.actionData.error}
            </div>
          ) : null}
          {input.actionData?.localPreviewCode ? (
            <div className="local-mail-stub" role="status">
              <span>Local email delivery stub</span>
              <strong>{input.actionData.localPreviewCode}</strong>
            </div>
          ) : null}

          <Form method="post" className="customer-auth-form">
            <input name="returnTo" type="hidden" value={input.returnTo} />
            <input
              name="intent"
              type="hidden"
              value={password ? "password" : verify ? "verify" : "request"}
            />
            {password ? (
              <>
                <label htmlFor="customer-email">Email address</label>
                <input
                  autoComplete="email"
                  autoFocus
                  defaultValue={input.actionData?.email ?? ""}
                  id="customer-email"
                  inputMode="email"
                  name="email"
                  placeholder="you@company.com"
                  required
                  type="email"
                />
                <label htmlFor="customer-password">Password</label>
                <input
                  autoComplete="current-password"
                  id="customer-password"
                  name="password"
                  required
                  type="password"
                />
              </>
            ) : verify ? (
              <>
                <input
                  name="challengeId"
                  type="hidden"
                  value={input.actionData?.challengeId ?? ""}
                />
                <input
                  name="email"
                  type="hidden"
                  value={input.actionData?.email ?? ""}
                />
                <label htmlFor="otp-code">Verification code</label>
                <input
                  autoComplete="one-time-code"
                  autoFocus
                  id="otp-code"
                  inputMode="numeric"
                  maxLength={6}
                  name="code"
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  required
                />
              </>
            ) : (
              <>
                <label htmlFor="customer-email">Email address</label>
                <input
                  autoComplete="email"
                  autoFocus
                  defaultValue={input.actionData?.email ?? ""}
                  id="customer-email"
                  inputMode="email"
                  name="email"
                  placeholder="you@company.com"
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
              {busy
                ? "Please wait..."
                : password
                  ? "Sign in with password"
                  : verify
                    ? register
                      ? "Verify and create account"
                      : "Verify and sign in"
                    : "Send email code"}
              {!busy ? <ArrowRight size={18} /> : null}
            </button>
          </Form>

          {password ? (
            <Link className="customer-auth-switch" to="/forgot-password">
              Forgot password?
            </Link>
          ) : null}

          {verify ? (
            <Link
              className="customer-auth-switch"
              to={register ? "/register" : "/sign-in"}
            >
              Use a different email
            </Link>
          ) : (
            <p className="customer-auth-switch">
              {register ? "Already registered?" : "New customer?"}{" "}
              <Link to={register ? "/sign-in" : "/register"}>
                {register ? "Sign in" : "Create an account"}
              </Link>
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
