import type { ApplicationBindings } from "./environment";
import {
  createQuoteInboundEmail,
  type PlatformEmailVerifier,
  type InboundEmailMessage,
} from "../app/modules/quote-inbound-email";
import {
  notificationProtector,
  quoteNotifications,
} from "./quote-notifications";

export async function quoteInboundEmail(
  env: ApplicationBindings,
  verifyPlatformEmail?: PlatformEmailVerifier,
) {
  const notifications = await quoteNotifications(env);
  return createQuoteInboundEmail({
    database: env.DB,
    bucket: env.PRIVATE_FILES,
    env,
    protector: await notificationProtector(env),
    resolveReplyToken: notifications.resolveReplyToken,
    verifyPlatformEmail,
  });
}

export async function receiveQuoteEmail(
  message: InboundEmailMessage,
  env: ApplicationBindings,
  verify: PlatformEmailVerifier,
) {
  const service = await quoteInboundEmail(env, verify);
  const receipt = await service.receive(message);
  await service.dispatch(env.ASYNC_JOBS);
  return receipt;
}

export async function receiveQuoteEmailEvent(
  message: InboundEmailMessage & { setReject(reason: string): void },
  env: ApplicationBindings,
  verify: PlatformEmailVerifier,
) {
  try {
    await receiveQuoteEmail(message, env, verify);
  } catch {
    // Do not silently accept a reply that could not be durably received. A later
    // resend is safe even after an uncertain commit because ingress is idempotent.
    message.setReject(
      "We could not confirm receipt of this reply. Please resend later or use the website quote conversation.",
    );
  }
}

export async function dispatchInboundEmail(env: ApplicationBindings) {
  const service = await quoteInboundEmail(env);
  let enqueued = 0;
  let failed = 0;
  for (let batch = 0; batch < 5; batch++) {
    const result = await service.dispatch(env.ASYNC_JOBS, 100);
    enqueued += result.enqueued;
    failed += result.failed;
    if (result.enqueued + result.failed < 100) break;
  }
  return { enqueued, failed };
}
