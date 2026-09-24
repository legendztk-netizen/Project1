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
import { recoverStaleShipmentUploads } from "../app/modules/shipment/application/shipment-documents-service";
import {
  consumeQuoteNotifications,
  dispatchQuoteNotifications,
} from "./quote-notifications";
import {
  dispatchInboundEmail,
  quoteInboundEmail,
  receiveQuoteEmailEvent,
} from "./quote-inbound-email";
import { createInboundEmailVerifier } from "./inbound-email-verifier";
import { piPdfJobs } from "./proforma-invoice";
import {
  consumePiAcceptanceCopy,
  dispatchPiAcceptanceCopies,
} from "./pi-email-acceptance";

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

    if (
      adminIdentity &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (url.pathname.startsWith("/admin/catalog/") ||
        url.pathname === "/admin/diagnostics/catalog-release") &&
      ![
        "/admin/catalog/requests",
        "/admin/catalog/bulk-import",
        "/admin/catalog/cutover",
        "/admin/catalog/assemblies",
        "/admin/catalog/items",
        "/admin/catalog/products",
        "/admin/catalog/commercial",
      ].includes(url.pathname)
    ) {
      const state = await env.DB.prepare(
        "SELECT mode FROM catalog_item_publication_state WHERE singleton = 1",
      ).first<{ mode: string }>();
      if (state?.mode === "items")
        return new Response("条目发布已启用，请使用条目维护入口", {
          status: 409,
        });
    }

    if (
      adminIdentity?.catalogPermission === "view" &&
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      url.pathname.startsWith("/admin/catalog/")
    )
      return new Response("需要产品编辑权限", { status: 403 });
    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareContext, { adminIdentity, env, runtime, ctx });

    return requestHandler(request, routerContext);
  },

  async email(message, env) {
    validateRuntimeEnvironment(env);
    await receiveQuoteEmailEvent(message, env, createInboundEmailVerifier());
  },

  scheduled(controller, env, ctx) {
    validateRuntimeEnvironment(env);
    ctx.waitUntil(dispatchQuoteNotifications(env));
    ctx.waitUntil(dispatchInboundEmail(env));
    ctx.waitUntil(piPdfJobs(env).dispatch());
    ctx.waitUntil(dispatchPiAcceptanceCopies(env));
    if (controller.cron === "17 * * * *") {
      ctx.waitUntil(
        createRegistrationConfigurationService(env, {
          now: () => new Date(controller.scheduledTime),
        }).cleanupExpired(),
      );
      ctx.waitUntil(
        recoverStaleShipmentUploads(
          env.DB,
          env.PRIVATE_FILES,
          new Date(controller.scheduledTime - 60 * 60 * 1000).toISOString(),
          new Date(
            controller.scheduledTime - 24 * 60 * 60 * 1000,
          ).toISOString(),
        ),
      );
    }
  },
  async queue(batch, env) {
    validateRuntimeEnvironment(env);
    await consumeQuoteNotifications(batch, env, async (message) => {
      if (await consumePiAcceptanceCopy(message, env)) return true;
      if (await piPdfJobs(env).consume(message.body)) {
        message.ack();
        return true;
      }
      return (await quoteInboundEmail(env)).consume(message);
    });
  },
} satisfies ExportedHandler<ApplicationBindings>;
