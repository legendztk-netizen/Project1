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
  type EmailOtpAuthorizationScope,
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
  hashCustomerPassword,
  type PasswordScreeningProvider,
  PasswordPolicyError,
  validatedCustomerPassword,
  verifyCustomerPassword,
} from "../domain/customer-password";
import {
  createPasswordAuthorizationCookie,
  generatePasswordAuthorizationToken,
  passwordAuthorizationLifetimeSeconds,
  readPasswordAuthorizationToken,
  type PasswordAuthorizationScope,
} from "../domain/password-authorization";
import {
  createD1CustomerIdentityRepository,
  OtpChallengeRequestRejected,
  type PasswordAttemptKind,
  PasswordAttemptRejected,
} from "../infrastructure/d1-customer-identity-repository";

export type CustomerIdentityErrorCode =
  | "COOLDOWN"
  | "INVALID_AUTHORIZATION"
  | "INVALID_EMAIL"
  | "INVALID_OTP"
  | "INVALID_PASSWORD"
  | "PASSWORD_EXISTS"
  | "PASSWORD_POLICY"
  | "RATE_LIMITED";

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
    passwordScreening?: PasswordScreeningProvider;
    repository?: ReturnType<typeof createD1CustomerIdentityRepository>;
  } = {},
) {
  const repository =
    options.repository ?? createD1CustomerIdentityRepository(env.DB);
  const sendOtp = options.deliver ?? deliverOtp;
  const secret = customerIdentitySigningKey(env);
  const now = options.now ?? (() => new Date());
  const otp = options.otp ?? generateSixDigitOtp;
  const passwordScreening = options.passwordScreening;

  async function sessionDigestFromRequest(request: Request) {
    const token = readCustomerSessionToken(request);
    return token ? digestCustomerSessionToken(token, secret) : null;
  }

  function digestIdentityValue(purpose: string, value: string) {
    return digestCustomerSessionToken(`${purpose}\u0000${value}`, secret);
  }

  async function readSession(request: Request) {
    const digest = await sessionDigestFromRequest(request);
    if (!digest) return null;
    return repository.findProfileBySessionDigest({
      digest,
      now: now().toISOString(),
    });
  }

  async function requestOtp(input: {
    authorizationScope?: EmailOtpAuthorizationScope;
    email: string;
    purpose: EmailOtpPurpose;
    request: Request;
  }) {
    const authorizationScope = input.authorizationScope ?? "session";
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

    const ipDigest = await digestIdentityValue(
      "otp-request-ip",
      requestIp(input.request, env.APP_ENV),
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
      authorizationScope,
      challengeId,
      code,
      email,
      purpose: input.purpose,
      secret,
    });
    try {
      await repository.createChallenge({
        authorizationScope,
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
  }

  function genericOtpFailure() {
    return new CustomerIdentityError(
      "That code is invalid or has expired. Request a new code and try again.",
      "INVALID_OTP",
    );
  }

  async function validatedOtpChallenge(input: {
    authorizationScope: EmailOtpAuthorizationScope;
    challengeId: string;
    code: string;
    purpose: EmailOtpPurpose;
  }) {
    if (!isSixDigitOtp(input.code) || !input.challengeId) {
      throw genericOtpFailure();
    }
    const challenge = await repository.findChallenge(input.challengeId);
    const instant = now();
    if (
      !challenge ||
      challenge.purpose !== input.purpose ||
      challenge.authorization_scope !== input.authorizationScope ||
      challenge.delivery_status !== "delivered" ||
      challenge.consumed_at ||
      challenge.superseded_at ||
      challenge.failed_attempts >= emailOtpMaximumFailedAttempts ||
      new Date(challenge.expires_at).getTime() <= instant.getTime()
    ) {
      throw genericOtpFailure();
    }
    const valid = await verifyEmailOtpDigest({
      authorizationScope: challenge.authorization_scope,
      challengeId: challenge.id,
      code: input.code,
      digest: challenge.otp_digest,
      email: challenge.email_normalized,
      purpose: challenge.purpose,
      secret,
    });
    if (!valid) {
      await repository.recordFailedAttempt(challenge.id);
      throw genericOtpFailure();
    }
    return { challenge, instant };
  }

  function passwordFailure() {
    return new CustomerIdentityError(
      "The email or password is incorrect.",
      "INVALID_PASSWORD",
    );
  }

  async function passwordAttemptDigests(input: {
    attemptKind: PasswordAttemptKind;
    email: string;
    request: Request;
  }) {
    return {
      emailDigest: await digestIdentityValue(
        `${input.attemptKind}-email`,
        input.email,
      ),
      ipDigest: await digestIdentityValue(
        `${input.attemptKind}-ip`,
        requestIp(input.request, env.APP_ENV),
      ),
    };
  }

  async function reservePasswordAttempt(input: {
    attemptKind: PasswordAttemptKind;
    email: string;
    id: string;
    instant: Date;
    request: Request;
  }) {
    const digests = await passwordAttemptDigests(input);
    try {
      await repository.reservePasswordAttempt({
        attemptKind: input.attemptKind,
        createdAt: input.instant.toISOString(),
        id: input.id,
        ...digests,
      });
    } catch (error) {
      if (!(error instanceof PasswordAttemptRejected)) throw error;
      throw new CustomerIdentityError(
        input.attemptKind === "password_login"
          ? "Too many sign-in attempts. Try again later or use an email code."
          : "Too many password changes. Try again later.",
        "RATE_LIMITED",
      );
    }
  }

  async function normalizedNewPassword(password: string) {
    try {
      return await validatedCustomerPassword(password, passwordScreening);
    } catch (error) {
      if (!(error instanceof PasswordPolicyError)) throw error;
      throw new CustomerIdentityError(error.message, "PASSWORD_POLICY");
    }
  }

  const dummyCredential = {
    algorithm: "PBKDF2-HMAC-SHA-256" as const,
    derivedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    hashBytes: 32 as const,
    normalization: "NFC" as const,
    salt: "AAAAAAAAAAAAAAAAAAAAAA",
    workFactor: 600_000,
  };

  return {
    requestOtp,

    async verifyOtp(input: {
      challengeId: string;
      code: string;
      purpose: EmailOtpPurpose;
      request: Request;
    }) {
      const { challenge, instant } = await validatedOtpChallenge({
        authorizationScope: "session",
        challengeId: input.challengeId,
        code: input.code,
        purpose: input.purpose,
      });

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
      if (!completion.consumed || !completion.profile)
        throw genericOtpFailure();
      return {
        newlyRegistered: input.purpose === "register" && !existingProfile,
        profile: completion.profile,
        setCookie: createCustomerSessionCookie({
          now: instant,
          secure: env.APP_ENV !== "local",
          token,
        }),
      };
    },

    readSession,

    async readPasswordStatus(request: Request) {
      const profile = await readSession(request);
      if (!profile) return null;
      const credential = await repository.findPasswordCredentialByProfileId(
        profile.id,
      );
      return { hasPassword: Boolean(credential), profile };
    },

    async setInitialPassword(input: { password: string; request: Request }) {
      const profile = await readSession(input.request);
      if (!profile) {
        throw new CustomerIdentityError(
          "Sign in before changing account security.",
          "INVALID_AUTHORIZATION",
        );
      }
      if (await repository.findPasswordCredentialByProfileId(profile.id)) {
        throw new CustomerIdentityError(
          "This account already has a password.",
          "PASSWORD_EXISTS",
        );
      }
      const password = await normalizedNewPassword(input.password);
      const created = await repository.createPasswordCredential({
        credential: await hashCustomerPassword(password),
        now: now().toISOString(),
        profileId: profile.id,
      });
      if (!created) {
        throw new CustomerIdentityError(
          "This account already has a password.",
          "PASSWORD_EXISTS",
        );
      }
      return profile;
    },

    async signInWithPassword(input: {
      email: string;
      password: string;
      request: Request;
    }) {
      const email = normalizeCustomerEmail(input.email);
      if (!email) throw passwordFailure();
      const attemptId = crypto.randomUUID();
      const instant = now();
      await reservePasswordAttempt({
        attemptKind: "password_login",
        email,
        id: attemptId,
        instant,
        request: input.request,
      });
      const credential = await repository.findPasswordCredentialByEmail(email);
      const valid = await verifyCustomerPassword(
        input.password,
        credential ?? dummyCredential,
      );
      if (!credential || !valid) throw passwordFailure();
      await repository.markPasswordAttemptSucceeded(
        attemptId,
        instant.toISOString(),
      );
      const token = generateCustomerSessionToken();
      await repository.createSessionForProfile({
        expiresAt: addSeconds(instant, customerSessionLifetimeSeconds),
        now: instant.toISOString(),
        previousTokenDigest: await sessionDigestFromRequest(input.request),
        profileId: credential.profileId,
        sessionId: crypto.randomUUID(),
        tokenDigest: await digestCustomerSessionToken(token, secret),
      });
      return {
        setCookie: createCustomerSessionCookie({
          now: instant,
          secure: env.APP_ENV !== "local",
          token,
        }),
      };
    },

    async changePasswordWithCurrent(input: {
      currentPassword: string;
      newPassword: string;
      request: Request;
    }) {
      const profile = await readSession(input.request);
      if (!profile) throw passwordFailure();
      const credential = await repository.findPasswordCredentialByProfileId(
        profile.id,
      );
      if (!credential) throw passwordFailure();
      const attemptId = crypto.randomUUID();
      const instant = now();
      await reservePasswordAttempt({
        attemptKind: "password_change",
        email: profile.email,
        id: attemptId,
        instant,
        request: input.request,
      });
      if (!(await verifyCustomerPassword(input.currentPassword, credential))) {
        throw passwordFailure();
      }
      await repository.markPasswordAttemptSucceeded(
        attemptId,
        instant.toISOString(),
      );
      const password = await normalizedNewPassword(input.newPassword);
      const token = generateCustomerSessionToken();
      const replaced = await repository.replacePasswordAndRotateSessions({
        credential: await hashCustomerPassword(password),
        expiresAt: addSeconds(instant, customerSessionLifetimeSeconds),
        now: instant.toISOString(),
        profileId: profile.id,
        sessionId: crypto.randomUUID(),
        tokenDigest: await digestCustomerSessionToken(token, secret),
      });
      if (!replaced) throw passwordFailure();
      return {
        setCookie: createCustomerSessionCookie({
          now: instant,
          secure: env.APP_ENV !== "local",
          token,
        }),
      };
    },

    async requestPasswordAuthorizationOtp(input: {
      email?: string;
      request: Request;
      scope: PasswordAuthorizationScope;
    }) {
      let email = input.email ?? "";
      if (input.scope === "password_change") {
        const profile = await readSession(input.request);
        if (!profile) {
          throw new CustomerIdentityError(
            "Sign in before changing account security.",
            "INVALID_AUTHORIZATION",
          );
        }
        email = profile.email;
      }
      return requestOtp({
        authorizationScope: input.scope,
        email,
        purpose: "sign_in",
        request: input.request,
      });
    },

    async verifyPasswordAuthorizationOtp(input: {
      challengeId: string;
      code: string;
      request: Request;
      scope: PasswordAuthorizationScope;
    }) {
      const { challenge, instant } = await validatedOtpChallenge({
        authorizationScope: input.scope,
        challengeId: input.challengeId,
        code: input.code,
        purpose: "sign_in",
      });
      const profile = await repository.findProfileByEmail(
        challenge.email_normalized,
      );
      if (!profile) throw genericOtpFailure();
      if (input.scope === "password_change") {
        const session = await readSession(input.request);
        if (!session || session.id !== profile.id) throw genericOtpFailure();
      }
      const token = generatePasswordAuthorizationToken();
      const authorization = await repository.createPasswordAuthorization({
        authorizationId: crypto.randomUUID(),
        challengeId: challenge.id,
        email: challenge.email_normalized,
        expiresAt: addSeconds(instant, passwordAuthorizationLifetimeSeconds),
        now: instant.toISOString(),
        scope: input.scope,
        tokenDigest: await digestIdentityValue("password-authorization", token),
      });
      if (!authorization) throw genericOtpFailure();
      return {
        setCookie: createPasswordAuthorizationCookie({
          now: instant,
          secure: env.APP_ENV !== "local",
          token,
        }),
      };
    },

    async readPasswordAuthorization(request: Request) {
      const token = readPasswordAuthorizationToken(request);
      if (!token) return null;
      return repository.findPasswordAuthorization({
        now: now().toISOString(),
        tokenDigest: await digestIdentityValue("password-authorization", token),
      });
    },

    async replacePasswordWithAuthorization(input: {
      newPassword: string;
      request: Request;
    }) {
      const authorizationToken = readPasswordAuthorizationToken(input.request);
      const authorization = authorizationToken
        ? await repository.findPasswordAuthorization({
            now: now().toISOString(),
            tokenDigest: await digestIdentityValue(
              "password-authorization",
              authorizationToken,
            ),
          })
        : null;
      if (!authorization) {
        throw new CustomerIdentityError(
          "This password link has expired. Request a new email code.",
          "INVALID_AUTHORIZATION",
        );
      }
      const password = await normalizedNewPassword(input.newPassword);
      const instant = now();
      const attemptId = crypto.randomUUID();
      await reservePasswordAttempt({
        attemptKind: authorization.scope,
        email: authorization.email,
        id: attemptId,
        instant,
        request: input.request,
      });
      const token = generateCustomerSessionToken();
      const replaced = await repository.replacePasswordWithAuthorization({
        authorizationId: authorization.id,
        credential: await hashCustomerPassword(password),
        expiresAt: addSeconds(instant, customerSessionLifetimeSeconds),
        now: instant.toISOString(),
        profileId: authorization.profileId,
        sessionId: crypto.randomUUID(),
        tokenDigest: await digestCustomerSessionToken(token, secret),
      });
      if (!replaced) {
        throw new CustomerIdentityError(
          "This password link has expired. Request a new email code.",
          "INVALID_AUTHORIZATION",
        );
      }
      await repository.markPasswordAttemptSucceeded(
        attemptId,
        instant.toISOString(),
      );
      return {
        setCookie: createCustomerSessionCookie({
          now: instant,
          secure: env.APP_ENV !== "local",
          token,
        }),
      };
    },

    async signOut(request: Request) {
      const instant = now();
      const digest = await sessionDigestFromRequest(request);
      if (digest) await repository.revokeSession(digest, instant.toISOString());
      return clearCustomerSessionCookie(env.APP_ENV !== "local");
    },
  };
}
