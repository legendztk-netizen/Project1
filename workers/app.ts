import { meterD1, catalogRequestArea } from "./d1-read-metrics";
import {
  canAccessAdminPath,
  adminPathModule,
} from "../app/modules/admin/domain/admin-module-access";
import { WorkerEntrypoint } from "cloudflare:workers";
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
import { recordOverdueReadyScheduleReminders } from "../app/modules/shipment/application/shipment-overdue-reminders";
import { recordAfterSalesOverdueReminders } from "../app/modules/after-sales/application/after-sales-reminders";
import {
  consumeQuoteNotifications,
  dispatchQuoteNotifications,
} from "./quote-notifications";
import {
  dispatchInboundEmail,
  quoteInboundEmail,
  receiveQuoteEmailEvent,
  receiveRoutedQuoteEmail,
} from "./quote-inbound-email";
import { createInboundEmailVerifier } from "./inbound-email-verifier";
import type {
  InboundEmailEnvelope,
  InboundEmailReceiver,
} from "./inbound-email-rpc";
import { piPdfJobs } from "./proforma-invoice";
import {
  consumePiAcceptanceCopy,
  dispatchPiAcceptanceCopies,
} from "./pi-email-acceptance";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// Reply email relayed by the account-wide email dispatcher Worker. Named
// entrypoints are reachable only through service bindings, never over HTTP.
export class InboundEmail
  extends WorkerEntrypoint<ApplicationBindings>
  implements InboundEmailReceiver
{
  async receive(
    envelope: InboundEmailEnvelope,
    raw: ReadableStream<Uint8Array>,
  ) {
    validateRuntimeEnvironment(this.env);
    return receiveRoutedQuoteEmail(
      envelope,
      raw,
      this.env,
      createInboundEmailVerifier(),
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const runtime = validateRuntimeEnvironment(env);
    const url = new URL(request.url);
    const area = catalogRequestArea(url.pathname);
    const meter = area ? meterD1(env.DB) : null;
    if (meter) env = { ...env, DB: meter.binding };
    const adminPath = url.pathname.replace(/\.data$/, "");

    if (url.pathname === "/health") {
      return createHealthResponse(env);
    }

    let adminIdentity;
    const authPath = [
      "/admin/login",
      "/admin/login.data",
      "/admin/logout",
      "/admin/logout.data",
    ].includes(url.pathname);
    if (
      isAdminPath(url.pathname) &&
      env.APP_ENV !== "local" &&
      url.origin !== env.ADMIN_ORIGIN
    )
      return new Response("Admin origin required", { status: 403 });
    if (
      isAdminPath(url.pathname) &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.get("Origin") !== url.origin
    )
      return new Response("Invalid origin", { status: 403 });
    if (isAdminPath(url.pathname) && !authPath) {
      try {
        adminIdentity = await authorizeAdminRequest(request, env);
      } catch (error) {
        if (error instanceof AdminAccessDenied) {
          if (
            error.status === 401 &&
            env.ADMIN_AUTH_MODE === "password" &&
            request.method === "GET" &&
            request.headers.get("Accept")?.includes("text/html")
          )
            return new Response(null, {
              status: 302,
              headers: {
                Location: "/admin/login",
                "Cache-Control": "no-store",
              },
            });
          return adminAccessDeniedResponse(error);
        }
        throw error;
      }
    }

    if (
      adminIdentity &&
      !canAccessAdminPath(adminIdentity, url.pathname, request.method)
    )
      return new Response("当前账号没有此模块的访问或操作权限", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });

    if (
      adminIdentity &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (adminPath.startsWith("/admin/catalog/") ||
        adminPath === "/admin/diagnostics/catalog-release") &&
      ![
        "/admin/catalog/requests",
        "/admin/catalog/bulk-import",
        "/admin/catalog/cutover",
        "/admin/catalog/assemblies",
        "/admin/catalog/items",
        "/admin/catalog/products",
        "/admin/catalog/commercial",
        "/admin/catalog/reference-data",
      ].includes(adminPath)
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
      adminPathModule(adminPath) === "catalog"
    )
      return new Response("需要产品编辑权限", { status: 403 });
    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareContext, { adminIdentity, env, runtime, ctx });

    let status = 500;
    try {
      const response = await requestHandler(request, routerContext);
      status = response.status;
      if (isAdminPath(url.pathname))
        response.headers.set("Cache-Control", "no-store");
      return response;
    } finally {
      if (meter)
        console.info(
          JSON.stringify({
            event: "catalog_d1_usage",
            area,
            method: request.method,
            status,
            ...meter.metrics,
          }),
        );
    }
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
        recordOverdueReadyScheduleReminders(
          env.DB,
          new Date(controller.scheduledTime),
        ),
      );
      ctx.waitUntil(
        recordAfterSalesOverdueReminders(
          env.DB,
          new Date(controller.scheduledTime),
        ),
      );
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
