import type { PendingConfigurationEmailMessage } from "../application/pending-configuration-save-service";
import type { ApplicationBindings } from "#workers/environment";

function resendApiKey(env: ApplicationBindings) {
  if (env.APP_ENV === "preview") return env.PREVIEW_RESEND_API_KEY;
  if (env.APP_ENV === "production") return env.PRODUCTION_RESEND_API_KEY;
  return null;
}

export async function deliverPendingConfigurationVerification(
  env: ApplicationBindings,
  message: PendingConfigurationEmailMessage,
) {
  if (env.EMAIL_DELIVERY_MODE === "stub") return;
  const apiKey = resendApiKey(env);
  if (!apiKey) throw new Error("Resend API key is unavailable");
  const verificationUrl = new URL(
    "/verify-configuration-email",
    env.PUBLIC_STOREFRONT_ORIGIN,
  );
  verificationUrl.searchParams.set("token", message.token);
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      subject: "Verify your saved hose configuration",
      text: `Verify your email to keep this unfinished hose configuration pending for 30 days: ${verificationUrl.toString()}\n\nThis does not create an account or add anything to your Quote List.`,
      to: [message.email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": message.effectId,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Resend rejected verification email: ${response.status}`);
  }
}
