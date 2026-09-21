import { redirect } from "react-router";
import type { ApplicationBindings } from "./environment";
import { createCustomerIdentityService } from "../app/modules/customer-identity/application/customer-identity-service";
import {
  createProformaInvoiceService,
  type ProformaInvoiceServiceOptions,
} from "../app/modules/proforma-invoice/application/proforma-invoice-service";
import { conditionsForQuote } from "../app/modules/proforma-invoice/domain/pi-policy";
import { createPiPdfRenderer } from "./pi-fonts";
import { createPiPdfJobs } from "../app/modules/proforma-invoice/application/pi-pdf-jobs";
import { createPiLifecycleService } from "../app/modules/proforma-invoice/application/pi-lifecycle-service";

export function piPdfJobs(env: ApplicationBindings) {
  return createPiPdfJobs(env.DB, env.ASYNC_JOBS, async (commandId) => {
    const replacement = await env.DB.prepare(
      `SELECT r.pi_id FROM pi_replacement_intents r
       JOIN proforma_invoice_intents i ON i.id=r.pi_id WHERE i.command_id=?`,
    )
      .bind(commandId)
      .first();
    return replacement
      ? piLifecycle(env).renderReserved(commandId)
      : proformaInvoices(env).renderReserved(commandId);
  });
}

export function piLifecycle(env: ApplicationBindings) {
  return createPiLifecycleService(env.DB, env.PRIVATE_FILES, {
    conditions: conditionsForQuote,
    renderPdf: env.ASSETS
      ? createPiPdfRenderer(env.ASSETS)
      : async () => {
          throw new Response("PI PDF font loader is not configured", {
            status: 503,
            headers: piPrivateHeaders(),
          });
        },
  });
}

export const piPrivateHeaders = () => ({
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

export function proformaInvoices(
  env: ApplicationBindings,
  options: ProformaInvoiceServiceOptions = {},
) {
  return createProformaInvoiceService(env.DB, env.PRIVATE_FILES, {
    conditions: conditionsForQuote,
    // Missing assets must not fall back to a placeholder or Helvetica-only PI.
    renderPdf: env.ASSETS
      ? createPiPdfRenderer(env.ASSETS)
      : async () => {
          throw new Response("PI PDF font loader is not configured", {
            status: 503,
            headers: piPrivateHeaders(),
          });
        },
    ...options,
  });
}

export async function piCustomerProfile(
  env: ApplicationBindings,
  request: Request,
) {
  const profile = await createCustomerIdentityService(env).readSession(request);
  if (!profile)
    throw redirect(
      `/sign-in?returnTo=${encodeURIComponent(new URL(request.url).pathname)}`,
      { headers: piPrivateHeaders() },
    );
  return profile.id;
}

export function piRouteId(value: string | undefined) {
  if (!value?.trim())
    throw new Response("Not found", {
      status: 404,
      headers: piPrivateHeaders(),
    });
  return value;
}

export type PiService = ReturnType<typeof proformaInvoices>;
export type PiRecord = NonNullable<
  Awaited<ReturnType<PiService["customerCurrent"]>>
>;
export type PiReadiness = Awaited<ReturnType<PiService["readiness"]>>;
