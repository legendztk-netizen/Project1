import { Resend } from "resend";

import type { ApplicationBindings } from "#workers/environment";

import type { EmailOtpPurpose } from "../domain/email-otp";

interface OtpEmailPayload {
  from: string;
  html: string;
  subject: string;
  text: string;
  to: string[];
}

interface OtpEmailSendResult {
  error: unknown | null;
}

export interface ResendOtpClient {
  send(
    payload: OtpEmailPayload,
    options: { idempotencyKey: string },
  ): Promise<OtpEmailSendResult>;
}

export type ResendOtpClientFactory = (apiKey: string) => ResendOtpClient;

export interface CustomerOtpDeliveryInput {
  challengeId: string;
  code: string;
  email: string;
  env: ApplicationBindings;
  purpose: EmailOtpPurpose;
}

function createResendOtpClient(apiKey: string): ResendOtpClient {
  const resend = new Resend(apiKey);
  return {
    send: (payload, options) => resend.emails.send(payload, options),
  };
}

function resendApiKey(env: ApplicationBindings) {
  if (env.APP_ENV === "preview") return env.PREVIEW_RESEND_API_KEY;
  if (env.APP_ENV === "production") return env.PRODUCTION_RESEND_API_KEY;
  throw new Error("Resend delivery is not available in local mode");
}

export async function deliverCustomerOtp(
  input: CustomerOtpDeliveryInput,
  createClient: ResendOtpClientFactory = createResendOtpClient,
) {
  if (input.env.EMAIL_DELIVERY_MODE === "stub") return;

  const apiKey = resendApiKey(input.env);
  if (!apiKey) throw new Error("Resend API key is not configured");

  const purposeLabel =
    input.purpose === "register" ? "registration" : "sign-in";
  const text = `Your verification code is ${input.code}. It expires in 10 minutes. If you did not request this ${purposeLabel}, you can ignore this email.`;
  const { error } = await createClient(apiKey).send(
    {
      from: input.env.EMAIL_FROM,
      html: [
        "<p>Your Hydraulic Supply verification code is:</p>",
        `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${input.code}</p>`,
        `<p>This code expires in 10 minutes. If you did not request this ${purposeLabel}, you can ignore this email.</p>`,
      ].join(""),
      subject: "Your Hydraulic Supply verification code",
      text,
      to: [input.email],
    },
    { idempotencyKey: `customer-otp/${input.challengeId}` },
  );

  if (error) throw new Error("Email delivery failed");
}
