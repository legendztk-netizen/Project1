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
import { createRegistrationConfigurationService } from "../app/modules/customer-identity/application/registration-configuration-service";

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

  scheduled(controller, env, ctx) {
    validateRuntimeEnvironment(env);
    ctx.waitUntil(
      createRegistrationConfigurationService(env, {
        now: () => new Date(controller.scheduledTime),
      }).cleanupExpired(),
    );
  },
} satisfies ExportedHandler<ApplicationBindings>;
