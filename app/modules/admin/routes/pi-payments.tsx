import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import type { Route } from "./+types/pi-payments";
import PiPaymentsWorkspace from "../ui/pi-payments-workspace";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import {
  piFundResolutions,
  piAcceptedAgreements,
  piLatePayments,
  piPaymentCorrections,
  piPayments,
  piPrivateHeaders,
  piRouteId,
  proformaInvoices,
} from "#workers/proforma-invoice";

export const headers = piPrivateHeaders;
export function meta() {
  return [{ title: "付款与到账 | 管理后台" }];
}
export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const requestId = piRouteId(params.requestId);
  const readiness = await proformaInvoices(env).readiness(
    adminIdentity,
    requestId,
  );
  const piId =
    new URL(request.url).searchParams.get("piId") || readiness.current?.id;
  if (
    !piId ||
    !(await env.DB.prepare(
      "SELECT 1 FROM proforma_invoices WHERE id=? AND request_id=?",
    )
      .bind(piId, requestId)
      .first())
  )
    throw new Response("PI not found", { status: 404 });
  const payment = await piPayments(env).adminRead(adminIdentity, piId);
  const agreement = await piAcceptedAgreements(env).readiness(
    adminIdentity,
    piId,
  );
  const instructionVersions = (
    await env.DB.prepare(
      `SELECT id,channel,version,status FROM seller_payment_instruction_versions
       ORDER BY channel,version DESC`,
    ).all<{ id: string; channel: string; version: number; status: string }>()
  ).results;
  const late = await piLatePayments(env).read(adminIdentity, piId);
  const funds = await piFundResolutions(env).read(adminIdentity, piId);
  const correction = await piPaymentCorrections(env).read(adminIdentity, piId);
  const targetId =
    new URL(request.url).searchParams.get("targetPiId")?.trim() ?? "";
  let target = null;
  let targetError: string | null = null;
  if (targetId) {
    try {
      target = await piFundResolutions(env).read(adminIdentity, targetId);
    } catch (error) {
      if (!(error instanceof Response) || ![400, 404].includes(error.status))
        throw error;
      targetError = "未找到目标 PI，请核对编号后重试。";
    }
  }
  const history = (
    await env.DB.prepare(
      `SELECT id,event_type AS kind,actor_id AS actor,occurred_at AS occurredAt,payload_json AS payload
       FROM admin_audit_events WHERE entity_type='proforma_invoice' AND entity_id=? AND event_type LIKE 'pi.%'
       ORDER BY occurred_at DESC,id DESC LIMIT 100`,
    )
      .bind(piId)
      .all<{
        id: string;
        kind: string;
        actor: string;
        occurredAt: string;
        payload: string;
      }>()
  ).results;
  return data(
    {
      requestId,
      payment,
      agreement,
      instructionVersions,
      late,
      funds,
      correction,
      isOwner: adminIdentity.accountType === "owner",
      target,
      targetId,
      targetError,
      history,
      choices: readiness.payments,
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const requestId = piRouteId(params.requestId);
  const current = await proformaInvoices(env).adminCurrent(
    adminIdentity,
    requestId,
  );
  const piId = new URL(request.url).searchParams.get("piId") || current?.id;
  if (
    !piId ||
    !(await env.DB.prepare(
      "SELECT 1 FROM proforma_invoices WHERE id=? AND request_id=?",
    )
      .bind(piId, requestId)
      .first())
  )
    throw new Response("PI not found", { status: 404 });
  const form = await readPrivateReviewForm(request);
  const field = (key: string) => String(form.get(key) ?? "");
  const auditOptions = {
    auditIp: request.headers.get("cf-connecting-ip") ?? "local",
  };
  try {
    const base = {
      piId,
      commandId: field("commandId"),
      expectedVersion: Number(field("expectedVersion")),
    };
    if (field("intent") === "retain-agreement") {
      await piAcceptedAgreements(env, auditOptions).retain(adminIdentity, {
        ...base,
        expectedHeadVersion: Number(field("expectedHeadVersion")),
        acceptanceId: field("acceptanceId"),
        documentVersion: Number(field("documentVersion")),
        snapshotHash: field("snapshotHash"),
        latestQuoteRevisionId: field("latestQuoteRevisionId"),
        reviewed: field("reviewed") === "on",
        noPaymentDeadline: field("noPaymentDeadline") === "true",
        reason: field("reason"),
      });
      return data(
        {
          message:
            "已确认以客户接受的 PI 为最终协议。原 PI 和接受记录保持不变，付款仍需核实后单独确认。",
        },
        { headers: headers() },
      );
    } else if (field("intent") === "received") {
      await piPayments(env, auditOptions).updateReceived(adminIdentity, {
        ...base,
        amount: field("amount"),
        currency: "USD",
        actualChannel: field("actualChannel") as "bank_transfer" | "paypal",
        verificationReference: field("verificationReference"),
        receivedInstructionId: field("receivedInstructionId"),
        reason: field("reason"),
      });
    } else if (field("intent") === "instructions") {
      const choice = JSON.parse(field("choice")) as {
        id: string;
        version: number;
        channel: "bank_transfer" | "paypal";
      };
      await piPayments(env, auditOptions).changeInstructions(adminIdentity, {
        ...base,
        instructionId: choice.id,
        instructionVersion: choice.version,
        channel: choice.channel,
        reason: field("reason"),
      });
    } else if (field("intent") === "original-currency") {
      await piPayments(env, auditOptions).recordOriginalCurrencyReceipt(
        adminIdentity,
        {
          piId,
          commandId: field("commandId"),
          currency: field("currency"),
          amount: field("amount"),
          actualChannel: field("actualChannel") as "bank_transfer" | "paypal",
          verificationReference: field("verificationReference"),
        },
      );
    } else if (field("intent") === "confirm") {
      await piPayments(env, auditOptions).confirmPayment(adminIdentity, {
        ...base,
        externallyVerified: field("externallyVerified") === "on",
        externalReference: field("externalReference"),
      });
    } else if (field("intent") === "extend") {
      await piLatePayments(env, auditOptions).extend(adminIdentity, {
        ...base,
        newDateEt: field("newDateEt"),
        reason: field("reason"),
      });
    } else if (field("intent") === "late-review") {
      await piLatePayments(env, auditOptions).review(adminIdentity, {
        ...base,
        decision: field("decision") as
          "same_terms_approved" | "replacement_required",
        reason: field("reason"),
        externalReference: field("externalReference"),
        pricingChecked: field("pricingChecked") === "on",
        availabilityChecked: field("availabilityChecked") === "on",
        freightChecked: field("freightChecked") === "on",
        tradeTermsChecked: field("tradeTermsChecked") === "on",
        leadTimeChecked: field("leadTimeChecked") === "on",
      });
    } else if (field("intent") === "allocate") {
      await piFundResolutions(env, auditOptions).allocate(adminIdentity, {
        sourcePiId: piId,
        targetPiId: field("targetPiId"),
        commandId: field("commandId"),
        sourceVersion: Number(field("expectedVersion")),
        targetVersion: Number(field("targetVersion")),
        amount: field("amount"),
        customerAuthorization: field("customerAuthorization"),
        externalReference: field("externalReference"),
      });
    } else if (field("intent") === "refund") {
      await piFundResolutions(env, auditOptions).recordRefund(adminIdentity, {
        piId,
        commandId: field("commandId"),
        expectedVersion: Number(field("expectedVersion")),
        amount: field("amount"),
        customerAuthorization: field("customerAuthorization"),
        externalReference: field("externalReference"),
      });
    } else if (field("intent") === "refund-original") {
      await piFundResolutions(env, auditOptions).refundOriginalCurrency(
        adminIdentity,
        {
          piId,
          receiptId: field("receiptId"),
          commandId: field("commandId"),
          amount: field("amount"),
          customerAuthorization: field("customerAuthorization"),
          externalReference: field("externalReference"),
        },
      );
    } else if (field("intent") === "correct-confirmation") {
      await piPaymentCorrections(env, auditOptions).correct(adminIdentity, {
        piId,
        commandId: field("commandId"),
        expectedVersion: Number(field("expectedVersion")),
        correctedAmount: field("correctedAmount"),
        reason: field("reason"),
      });
    } else if (field("intent") === "resolve-correction") {
      await piPaymentCorrections(env, auditOptions).resolve(adminIdentity, {
        piId,
        commandId: field("commandId"),
        correctionId: field("correctionId"),
        expectedVersion: Number(field("expectedVersion")),
        reason: field("reason"),
        verificationReference: field("verificationReference"),
      });
    } else throw new Response("Invalid operation", { status: 400 });
    const payment = await piPayments(env).adminRead(adminIdentity, piId);
    return data(
      { message: "已保存，并记录付款审计。", payment },
      { headers: headers() },
    );
  } catch (error) {
    if (error instanceof Response && [400, 409].includes(error.status))
      return data(
        { error: await error.text() },
        { status: error.status, headers: headers() },
      );
    throw error;
  }
}

export type PiPaymentsPageData = Awaited<ReturnType<typeof loader>>["data"];

export default function PiPayments({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <PiPaymentsWorkspace loaderData={loaderData} actionData={actionData} />
  );
}
