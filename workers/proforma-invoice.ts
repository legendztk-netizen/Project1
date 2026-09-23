import { redirect } from "react-router";
import { createPiAcceptedAgreementService } from "../app/modules/proforma-invoice/application/pi-accepted-agreement-service";
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
import { createPiPaymentService } from "../app/modules/proforma-invoice/application/pi-payment-service";
import { createConfirmedOrderService } from "../app/modules/proforma-invoice/application/confirmed-order-service";
import { createPiLatePaymentService } from "../app/modules/proforma-invoice/application/pi-late-payment-service";
import { createPiFundResolutionService } from "../app/modules/proforma-invoice/application/pi-fund-resolution-service";
import { createPiPaymentCorrectionService } from "../app/modules/proforma-invoice/application/pi-payment-correction-service";
import { createFollowOnQuoteService } from "../app/modules/proforma-invoice/application/follow-on-quote-service";

export function piPayments(
  env: ApplicationBindings,
  options?: { auditIp?: string },
) {
  return createPiPaymentService(env.DB, options);
}

export function piAcceptedAgreements(
  env: ApplicationBindings,
  options?: { auditIp?: string },
) {
  return createPiAcceptedAgreementService(env.DB, options);
}

export function confirmedOrders(env: ApplicationBindings) {
  return createConfirmedOrderService(env.DB);
}

export function piLatePayments(
  env: ApplicationBindings,
  options?: { auditIp?: string },
) {
  return createPiLatePaymentService(env.DB, options);
}

export function piFundResolutions(
  env: ApplicationBindings,
  options?: { auditIp?: string },
) {
  return createPiFundResolutionService(env.DB, options);
}

export function piPaymentCorrections(
  env: ApplicationBindings,
  options?: { auditIp?: string },
) {
  return createPiPaymentCorrectionService(env.DB, options);
}

export function followOnQuotes(env: ApplicationBindings) {
  return createFollowOnQuoteService(env.DB);
}

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
