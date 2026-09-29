import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { validateEvidence } from "../../quote-review/domain/private-review";
import { parseUsdCents } from "../domain/refund-calculation";
import { createDecisionRevisionService } from "./decision-revision-service";
import {
  createAfterSalesFiles,
  type AfterSalesFileScope,
} from "./after-sales-files";
import { createCancellationService } from "./cancellation-service";
import {
  beijingLocalToIso,
  readCancellationDecisions,
  readCancellationQuantities,
  readFactoryEvidence,
  readInspectionItems,
  readRaLines,
  readReceiptLines,
  readRevisionItems,
} from "./parse-after-sales-forms";
import { createReturnAuthorizationService } from "./return-authorization-service";
import { createReturnInspectionService } from "./return-inspection-service";
import {
  createRefundInitiationService,
  type RefundKind,
} from "./refund-initiation-service";

const intents = new Set([
  "cancellation-resolve",
  "cancellation-open-exceptional",
  "after-sales-file-upload",
  "after-sales-file-share",
  "case-issue-ra",
  "case-decline-return",
  "case-close",
  "return-receive",
  "return-late-review",
  "return-decide",
  "return-revise",
  "refund-destination-add",
  "refund-destination-approve",
  "refund-initiation-record",
]);

function refundTarget(value: string) {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const id = separator > 0 ? value.slice(separator + 1) : "";
  if ((kind !== "after_sales" && kind !== "shipping") || !id)
    throw new Response("请选择退款", { status: 400 });
  return { refundKind: kind as RefundKind, refundId: id };
}

export function isAfterSalesAdminIntent(intent: string) {
  return intents.has(intent);
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

// Decisions that append a customer-visible Case event and may carry files.
const eventAttachmentLabels: Record<string, string> = {
  "case-issue-ra": "随退货授权（RA）附给客户",
  "case-decline-return": "随不予授权说明附给客户",
  "case-close": "随关闭案件说明附给客户",
  "return-decide": "随检验决定附给客户",
  "return-revise": "随决定修订附给客户",
};
const MAX_EVENT_ATTACHMENTS = 5;

function eventAttachments(form: FormData) {
  return form
    .getAll("attachment")
    .filter((value): value is File => value instanceof File && value.size > 0);
}

/** Stable per-file command id so a retried submission reuses the same file. */
async function attachmentCommandId(commandId: string, index: number) {
  const hex = await piSha256(
    new TextEncoder().encode(`${commandId.toLowerCase()}:attachment:${index}`),
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Runs one Admin after-sales command from the Order page. Returns an
 * actionable Chinese error message for expected failures, or null.
 */
export async function runAfterSalesAdminAction(input: {
  db: D1Database;
  bucket: R2Bucket;
  actor: AdminIdentity;
  orderId: string;
  intent: string;
  form: FormData;
  auditIp: string;
}): Promise<{ error: string; status: number } | null> {
  const { db, actor, orderId, form, intent } = input;
  const options = { auditIp: input.auditIp };
  const commandId = text(form, "commandId");
  try {
    const attachments = eventAttachmentLabels[intent]
      ? eventAttachments(form)
      : [];
    if (attachments.length > MAX_EVENT_ATTACHMENTS)
      throw new Response(`最多附 ${MAX_EVENT_ATTACHMENTS} 个文件`, {
        status: 400,
      });
    // Reject a bad file before the decision is recorded.
    for (const file of attachments) await validateEvidence(file);
    switch (intent) {
      case "cancellation-resolve":
        await createCancellationService(db, options).adminResolve(actor, {
          orderId,
          requestId: text(form, "requestId"),
          expectedVersion: Number(form.get("expectedVersion")),
          commandId,
          decisions: readCancellationDecisions(form),
          customerReason: text(form, "customerReason"),
          internalNote: text(form, "internalNote"),
          logisticsCents: parseUsdCents(form.get("logisticsUsd"), "物流费用"),
          logisticsNote: text(form, "logisticsNote"),
          taxCents: parseUsdCents(form.get("taxUsd"), "销售税"),
          taxNote: text(form, "taxNote"),
          thirdPartyCostCents: parseUsdCents(
            form.get("thirdPartyUsd"),
            "第三方费用",
          ),
          thirdPartyCostEvidence: text(form, "thirdPartyEvidence"),
          factoryEvidence: readFactoryEvidence(form),
          responsibility:
            form.get("responsibility") === "seller" ? "seller" : "customer",
        });
        break;
      case "cancellation-open-exceptional":
        await createCancellationService(db, options).adminOpenExceptional(
          actor,
          {
            orderId,
            reason: text(form, "reason"),
            supportReference: text(form, "supportReference"),
            quantities: readCancellationQuantities(form),
            commandId,
          },
        );
        break;
      case "after-sales-file-upload": {
        const file = form.get("file");
        if (!(file instanceof File))
          throw new Response("请选择文件", { status: 400 });
        await createAfterSalesFiles(db, input.bucket).adminUpload(actor, {
          orderId,
          scopeKind: text(form, "scopeKind") as AfterSalesFileScope,
          scopeId: text(form, "scopeId"),
          file,
          commandId,
        });
        break;
      }
      case "after-sales-file-share":
        await createAfterSalesFiles(db, input.bucket).adminShare(actor, {
          orderId,
          fileId: text(form, "fileId"),
          reason: text(form, "shareReason"),
        });
        break;
      case "case-issue-ra":
        await createReturnAuthorizationService(db, options).adminIssue(actor, {
          orderId,
          caseId: text(form, "caseId"),
          expectedVersion: Number(form.get("expectedVersion")),
          locationId: text(form, "locationId"),
          instructions: text(form, "instructions"),
          lines: readRaLines(form),
          previousRaId: text(form, "previousRaId") || null,
          reviewNote: text(form, "reviewNote"),
          commandId,
        });
        break;
      case "case-decline-return":
        await createReturnAuthorizationService(db, options).adminDeclineReturn(
          actor,
          {
            orderId,
            caseId: text(form, "caseId"),
            expectedVersion: Number(form.get("expectedVersion")),
            reason: text(form, "reason"),
            commandId,
          },
        );
        break;
      case "case-close":
        await createReturnAuthorizationService(db, options).adminCloseCase(
          actor,
          {
            orderId,
            caseId: text(form, "caseId"),
            expectedVersion: Number(form.get("expectedVersion")),
            reason: text(form, "reason"),
            commandId,
          },
        );
        break;
      case "return-receive":
        await createReturnInspectionService(db, options).adminRecordReceipt(
          actor,
          {
            orderId,
            raId: text(form, "raId"),
            receivedAt: beijingLocalToIso(text(form, "receivedAt")),
            source: text(form, "source"),
            packageReference: text(form, "packageReference"),
            excessNote: text(form, "excessNote"),
            lines: readReceiptLines(form),
            commandId,
          },
        );
        break;
      case "return-late-review":
        await createReturnInspectionService(db, options).adminReviewLateArrival(
          actor,
          {
            orderId,
            receiptId: text(form, "receiptId"),
            note: text(form, "note"),
            commandId,
          },
        );
        break;
      case "return-decide":
        await createReturnInspectionService(db, options).adminDecide(actor, {
          orderId,
          receiptId: text(form, "receiptId"),
          responsibility: text(form, "responsibility") as "customer" | "seller",
          remedy: text(form, "remedy") as "replacement" | "refund",
          items: readInspectionItems(form),
          customerReason: text(form, "customerReason"),
          internalNote: text(form, "internalNote"),
          logisticsCents: parseUsdCents(form.get("logisticsUsd"), "物流费用"),
          logisticsNote: text(form, "logisticsNote"),
          sellerLogisticsCents: parseUsdCents(
            form.get("sellerLogisticsUsd"),
            "卖方物流费用",
          ),
          sellerLogisticsNote: text(form, "sellerLogisticsNote"),
          taxCents: parseUsdCents(form.get("taxUsd"), "销售税"),
          taxNote: text(form, "taxNote"),
          thirdPartyCostCents: parseUsdCents(
            form.get("thirdPartyUsd"),
            "第三方费用",
          ),
          thirdPartyCostEvidence: text(form, "thirdPartyEvidence"),
          replacement:
            form.get("remedy") === "replacement"
              ? {
                  scope: text(form, "replacementScope"),
                  costs: text(form, "replacementCosts"),
                  fulfillmentEvidence: text(form, "replacementEvidence"),
                }
              : undefined,
          commandId,
        });
        break;
      case "return-revise":
        await createDecisionRevisionService(db, options).adminRevise(actor, {
          orderId,
          decisionId: text(form, "decisionId"),
          expectedRevision: Number(form.get("expectedRevision")),
          items: readRevisionItems(form),
          customerReason: text(form, "customerReason"),
          commandId,
        });
        break;
      case "refund-destination-add":
        await createRefundInitiationService(db, options).adminAddDestination(
          actor,
          {
            orderId,
            channel: text(form, "channel") as "bank_transfer" | "paypal",
            kind: text(form, "kind") as "original_channel" | "alternative",
            label: text(form, "label"),
            holderName: text(form, "holderName"),
            institution: text(form, "institution"),
            accountLast4: text(form, "accountLast4"),
            samePurchasingContext: form.get("samePurchasingContext") === "on",
            verificationEvidence: text(form, "verificationEvidence"),
            commandId,
          },
        );
        break;
      case "refund-destination-approve":
        await createRefundInitiationService(
          db,
          options,
        ).ownerApproveDestination(actor, {
          orderId,
          destinationId: text(form, "destinationId"),
          ...refundTarget(text(form, "refund")),
          reason: text(form, "reason"),
          commandId,
        });
        break;
      case "refund-initiation-record":
        await createRefundInitiationService(db, options).adminRecordInitiation(
          actor,
          {
            orderId,
            ...refundTarget(text(form, "refund")),
            destinationId: text(form, "destinationId"),
            accountVerified: form.get("accountVerified") === "on",
            complete: form.get("complete") === "true",
            amountCents: parseUsdCents(form.get("amountUsd"), "退款金额"),
            initiatedDateEt: text(form, "initiatedDateEt"),
            externalReference: text(form, "externalReference"),
            commandId,
          },
        );
        break;
      default:
        throw new Response("Invalid operation", { status: 400 });
    }
    if (attachments.length) {
      const caseId = text(form, "caseId");
      const files = createAfterSalesFiles(db, input.bucket);
      for (const [index, file] of attachments.entries())
        await files.adminAttachToEvent(actor, {
          orderId,
          caseId,
          eventId: `case-event:${commandId}`,
          file,
          commandId: await attachmentCommandId(commandId, index),
          label: eventAttachmentLabels[intent],
        });
    }
  } catch (error) {
    if (
      !(error instanceof Response) ||
      ![400, 403, 404, 409].includes(error.status)
    )
      throw error;
    const detail = await error.text();
    return {
      status: error.status,
      error:
        error.status === 403
          ? `当前账号没有该操作权限。${detail}`
          : error.status === 409
            ? `记录或状态已变化，请刷新后核对。${detail}`
            : `请检查填写内容：${detail}`,
    };
  }
  return null;
}
