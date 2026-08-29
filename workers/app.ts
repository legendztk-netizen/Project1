import { RouterContextProvider, createRequestHandler } from "react-router";

import { cloudflareContext } from "./context";
import {
  AdminAccessDenied,
  adminAccessDeniedResponse,
  authorizeAdminRequest,
  isAdminPath,
} from "./admin-access";
import {
  type ApplicationBindings,
  validateRuntimeEnvironment,
} from "./environment";
import { createHealthResponse } from "./health";
import type { PendingConfigurationEmailMessage } from "../app/modules/configurator/application/pending-configuration-save-service";
import { createD1PendingConfigurationRepository } from "../app/modules/configurator/infrastructure/d1-pending-configuration-repository";
import { deliverPendingConfigurationVerification } from "../app/modules/configurator/infrastructure/pending-configuration-email";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const runtime = validateRuntimeEnvironment(env);
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return createHealthResponse(env);
    }

    let adminIdentity;
    if (isAdminPath(url.pathname)) {
      try {
        adminIdentity = await authorizeAdminRequest(request, env);
      } catch (error) {
        if (error instanceof AdminAccessDenied)
          return adminAccessDeniedResponse(error);
        throw error;
      }
    }

    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareContext, { adminIdentity, env, runtime, ctx });

    return requestHandler(request, routerContext);
  },

  async queue(batch, env) {
    const repository = createD1PendingConfigurationRepository(env.DB);
    for (const message of batch.messages) {
      const payload = message.body as PendingConfigurationEmailMessage;
      if (payload?.type !== "pending_configuration_verification") {
        message.ack();
        continue;
      }
      const effect = await repository.findEmailEffect(payload.effectId);
      if (!effect || effect.status === "sent") {
        message.ack();
        continue;
      }
      const now = new Date().toISOString();
      const claimed = await repository.claimEmailDelivery(
        payload.effectId,
        now,
      );
      if (!claimed) {
        message.retry();
        continue;
      }
      try {
        await deliverPendingConfigurationVerification(env, payload);
        await repository.markEmailEffectSent(payload.effectId, now);
        message.ack();
      } catch {
        await repository.releaseEmailDelivery(payload.effectId, now);
        message.retry();
      }
    }
  },

  async scheduled(_controller, env, ctx) {
    const repository = createD1PendingConfigurationRepository(env.DB);
    ctx.waitUntil(repository.deleteExpired(new Date().toISOString()));
  },
} satisfies ExportedHandler<ApplicationBindings>;
