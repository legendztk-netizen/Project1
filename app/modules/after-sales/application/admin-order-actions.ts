import type { AdminIdentity } from "#workers/admin-access";
import { parseUsdCents } from "../domain/refund-calculation";
import { readCancellationDecisions } from "../ui/admin-cancellations";
import { readFactoryEvidence } from "../ui/admin-exceptional";
import { readCancellationQuantities } from "../ui/customer-cancellations";
import { readRaLines } from "../ui/return-authorizations";
import {
  beijingLocalToIso,
  readInspectionItems,
  readReceiptLines,
} from "../ui/return-inspection";
import {
  createAfterSalesFiles,
  type AfterSalesFileScope,
} from "./after-sales-files";
import { createCancellationService } from "./cancellation-service";
import { createCaseService } from "./case-service";
import { createReturnAuthorizationService } from "./return-authorization-service";
import { createReturnInspectionService } from "./return-inspection-service";

const intents = new Set([
  "cancellation-resolve",
  "cancellation-open-exceptional",
  "after-sales-file-upload",
  "after-sales-file-share",
  "case-admin-reply",
  "case-issue-ra",
  "case-decline-return",
  "case-close",
  "return-receive",
  "return-late-review",
  "return-decide",
]);

export function isAfterSalesAdminIntent(intent: string) {
  return intents.has(intent);
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

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
      case "case-admin-reply":
        await createCaseService(db, options).adminReply(actor, {
          orderId,
          caseId: text(form, "caseId"),
          body: text(form, "body"),
          visibility:
            form.get("visibility") === "internal" ? "internal" : "customer",
          commandId,
        });
        break;
      case "case-issue-ra":
        await createReturnAuthorizationService(db, options).adminIssue(actor, {
          orderId,
          caseId: text(form, "caseId"),
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
          },
        );
        break;
      case "return-decide":
        await createReturnInspectionService(db, options).adminDecide(actor, {
          orderId,
          receiptId: text(form, "receiptId"),
          responsibility:
            form.get("responsibility") === "customer" ? "customer" : "seller",
          remedy:
            form.get("remedy") === "replacement" ? "replacement" : "refund",
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
      default:
        throw new Response("Invalid operation", { status: 400 });
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
          ? "当前账号没有售后审核权限，请联系 Owner 授权。"
          : error.status === 409
            ? `记录或状态已变化，请刷新后核对。${detail}`
            : `请检查填写内容：${detail}`,
    };
  }
  return null;
}
