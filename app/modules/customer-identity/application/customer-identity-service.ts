import type { ApplicationBindings } from "#workers/environment";
import { customerIdentitySigningKey } from "#workers/session-secrets";

import {
  digestEmailOtp,
  emailOtpLifetimeSeconds,
  emailOtpMaximumFailedAttempts,
  emailOtpMaximumRequestsPerEmailHour,
  emailOtpMaximumRequestsPerIpHour,
  emailOtpResendCooldownSeconds,
  generateSixDigitOtp,
  isSixDigitOtp,
  normalizeCustomerEmail,
  type EmailOtpPurpose,
  verifyEmailOtpDigest,
} from "../domain/email-otp";
import {
  clearCustomerSessionCookie,
  createCustomerSessionCookie,
  customerSessionLifetimeSeconds,
  digestCustomerSessionToken,
  generateCustomerSessionToken,
  readCustomerSessionToken,
} from "../domain/customer-session";
import {
  createD1CustomerIdentityRepository,
  OtpChallengeRequestRejected,
} from "../infrastructure/d1-customer-identity-repository";

export type CustomerIdentityErrorCode =
  "COOLDOWN" | "INVALID_EMAIL" | "INVALID_OTP" | "RATE_LIMITED";

export class CustomerIdentityError extends Error {
  constructor(
    message: string,
    readonly code: CustomerIdentityErrorCode,
  ) {
    super(message);
  }
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function requestIp(
  request: Request,
  environment: ApplicationBindings["APP_ENV"],
) {
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  if (environment !== "local") return cloudflareIp ?? "unavailable";
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    cloudflareIp ??
    "local-development"
  );
}

async function deliverOtp(input: {
  code: string;
  email: string;
  env: ApplicationBindings;
  purpose: EmailOtpPurpose;
}) {
  if (input.env.EMAIL_DELIVERY_MODE === "stub") {
    console.info(
      JSON.stringify({
        code: input.code,
        purpose: input.purpose,
        to: input.email,
        type: "customer-email-otp-stub",
      }),
    );
    return;
  }

  const apiKey =
    input.env.APP_ENV === "preview"
      ? input.env.PREVIEW_RESEND_API_KEY
      : input.env.PRODUCTION_RESEND_API_KEY;
  if (!apiKey) throw new Error("Resend API key is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: input.env.EMAIL_FROM,
      subject: "Your Hydraulic Supply verification code",
      text: `Your verification code is ${input.code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      to: [input.email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error("Email delivery failed");
}

export function createCustomerIdentityService(
  env: ApplicationBindings,
  options: {
    deliver?: typeof deliverOtp;
    now?: () => Date;
    otp?: () => string;
    repository?: ReturnType<typeof createD1CustomerIdentityRepository>;
  } = {},
) {
  const repository =
    options.repository ?? createD1CustomerIdentityRepository(env.DB);
  const sendOtp = options.deliver ?? deliverOtp;
  const secret = customerIdentitySigningKey(env);
  const now = options.now ?? (() => new Date());
  const otp = options.otp ?? generateSixDigitOtp;

  async function sessionDigestFromRequest(request: Request) {
    const token = readCustomerSessionToken(request);
    return token ? digestCustomerSessionToken(token, secret) : null;
  }

  return {
    async requestOtp(input: {
      email: string;
      purpose: EmailOtpPurpose;
      request: Request;
    }) {
      const email = normalizeCustomerEmail(input.email);
      if (!email) {
        throw new CustomerIdentityError(
          "Enter a valid email address.",
          "INVALID_EMAIL",
        );
      }
      const instant = now();
      const nowIso = instant.toISOString();
      const latest = await repository.latestRequest(email);
      if (
        latest &&
        instant.getTime() - new Date(latest.created_at).getTime() <
          emailOtpResendCooldownSeconds * 1000
      ) {
        throw new CustomerIdentityError(
          "Please wait 60 seconds before requesting another code.",
          "COOLDOWN",
        );
      }

      const ipDigest = await digestCustomerSessionToken(
        requestIp(input.request, env.APP_ENV),
        secret,
      );
      const recent = await repository.countRecentRequests({
        email,
        ipDigest,
        since: new Date(instant.getTime() - 60 * 60 * 1000).toISOString(),
      });
      if (
        recent.email >= emailOtpMaximumRequestsPerEmailHour ||
        recent.ip >= emailOtpMaximumRequestsPerIpHour
      ) {
        throw new CustomerIdentityError(
          "Too many verification requests. Please try again later.",
          "RATE_LIMITED",
        );
      }

      const challengeId = crypto.randomUUID();
      const code = otp();
      const digest = await digestEmailOtp({
        challengeId,
        code,
        email,
        purpose: input.purpose,
        secret,
      });
      try {
        await repository.createChallenge({
          createdAt: nowIso,
          digest,
          email,
          expiresAt: addSeconds(instant, emailOtpLifetimeSeconds),
          id: challengeId,
          ipDigest,
          purpose: input.purpose,
        });
      } catch (error) {
        if (!(error instanceof OtpChallengeRequestRejected)) throw error;
        if (error.reason === "cooldown") {
          throw new CustomerIdentityError(
            "Please wait 60 seconds before requesting another code.",
            "COOLDOWN",
          );
        }
        throw new CustomerIdentityError(
          "Too many verification requests. Please try again later.",
          "RATE_LIMITED",
        );
      }

      try {
        await sendOtp({ code, email, env, purpose: input.purpose });
        await repository.activateDeliveredChallenge({
          deliveredAt: now().toISOString(),
          email,
          id: challengeId,
          purpose: input.purpose,
        });
      } catch (error) {
        await repository.discardUndeliveredChallenge(challengeId);
        throw error;
      }
      return {
        challengeId,
        email,
        localPreviewCode: env.APP_ENV === "local" ? code : null,
      };
    },

    async verifyOtp(input: {
      challengeId: string;
      code: string;
      purpose: EmailOtpPurpose;
      request: Request;
    }) {
      const genericFailure = () =>
        new CustomerIdentityError(
          "That code is invalid or has expired. Request a new code and try again.",
          "INVALID_OTP",
        );
      if (!isSixDigitOtp(input.code) || !input.challengeId)
        throw genericFailure();
      const challenge = await repository.findChallenge(input.challengeId);
      const instant = now();
      if (
        !challenge ||
        challenge.purpose !== input.purpose ||
        challenge.delivery_status !== "delivered" ||
        challenge.consumed_at ||
        challenge.superseded_at ||
        challenge.failed_attempts >= emailOtpMaximumFailedAttempts ||
        new Date(challenge.expires_at).getTime() <= instant.getTime()
      ) {
        throw genericFailure();
      }

      const valid = await verifyEmailOtpDigest({
        challengeId: challenge.id,
        code: input.code,
        digest: challenge.otp_digest,
        email: challenge.email_normalized,
        purpose: challenge.purpose,
        secret,
      });
      if (!valid) {
        await repository.recordFailedAttempt(challenge.id);
        throw genericFailure();
      }

      const existingProfile = await repository.findProfileByEmail(
        challenge.email_normalized,
      );
      const previousDigest = await sessionDigestFromRequest(input.request);
      const token = generateCustomerSessionToken();
      const authenticate =
        input.purpose === "register" || Boolean(existingProfile);
      const completion = await repository.completeVerification({
        authenticate,
        challengeId: challenge.id,
        email: challenge.email_normalized,
        expiresAt: addSeconds(instant, customerSessionLifetimeSeconds),
        previousTokenDigest: previousDigest,
        profileId: existingProfile?.id ?? crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        now: instant.toISOString(),
        tokenDigest: await digestCustomerSessionToken(token, secret),
      });
      if (!completion.consumed || !completion.profile) throw genericFailure();
      return {
        profile: completion.profile,
        setCookie: createCustomerSessionCookie({
          now: instant,
          secure: env.APP_ENV !== "local",
          token,
        }),
      };
    },

    async readSession(request: Request) {
      const digest = await sessionDigestFromRequest(request);
      if (!digest) return null;
      return repository.findProfileBySessionDigest({
        digest,
        now: now().toISOString(),
      });
    },

    async signOut(request: Request) {
      const instant = now();
      const digest = await sessionDigestFromRequest(request);
      if (digest) await repository.revokeSession(digest, instant.toISOString());
      return clearCustomerSessionCookie(env.APP_ENV !== "local");
    },
  };
}
