import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  Link,
  Form,
  useNavigation,
} from "react-router";
import { ArrowLeft, Download, Eye, RefreshCw } from "lucide-react";
import type { ReplaceProformaInvoiceCommand } from "../../proforma-invoice/application/pi-lifecycle-service";
import { PiValidationError } from "../../proforma-invoice/domain/proforma-invoice";
import {
  piPrivateHeaders,
  piRouteId,
  proformaInvoices,
  piPdfJobs,
  piLifecycle,
} from "#workers/proforma-invoice";
import { AdminNavigation } from "../ui/admin-navigation";
import { PiReplacementForm } from "../ui/pi-lifecycle-replacement-form";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";

export const headers = piPrivateHeaders;

// Posted tokens always come from the reviewed form, never fresh loader reads.
export async function loader({ context, params }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const requestId = piRouteId(params.requestId);
  const service = piLifecycle(env);
  const replacement = await service.replacementReadiness(
    adminIdentity,
    requestId,
  );
  const issuance = await proformaInvoices(env).readiness(
    adminIdentity,
    requestId,
  );
  const history = await service.adminHistory(adminIdentity, requestId);
  return data(
    {
      requestId,
      replacement,
      issuance,
      history,
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const requestId = piRouteId(params.requestId);
  const form = await readPrivateReviewForm(request);
  if (form.get("intent") === "retry-pdf") {
    const ready = await piLifecycle(env).replacementReadiness(
      adminIdentity,
      requestId,
    );
    const commandId = String(form.get("commandId") ?? "");
    if (
      !ready.pdfJobs.some(
        (job) => job.commandId === commandId && job.state === "failed",
      )
    )
      throw new Response("Replacement job changed", { status: 409 });
    await proformaInvoices(env).retryPdf(adminIdentity, requestId, commandId);
    await piPdfJobs(env)
      .dispatch()
      .catch(() => undefined);
    return data(
      { reserved: { commandId } },
      { status: 202, headers: headers() },
    );
  }
  let command: ReplaceProformaInvoiceCommand;
  try {
    if (
      form.get("intent") !== "replace" ||
      form.get("reviewed") !== "on" ||
      typeof form.get("command") !== "string"
    )
      throw new Error("Explicit replacement command required");
    const value = JSON.parse(String(form.get("command")));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.requestId !== requestId ||
      !value.replacement ||
      typeof value.replacement !== "object" ||
      !value.replacement.expectedPi ||
      !value.replacement.reason
    )
      throw new Error("Invalid replacement target");
    command = value;
  } catch {
    return data(
      { error: "替换审核信息无效，请核对。" },
      { status: 400, headers: headers() },
    );
  }
  try {
    const reserved = await piLifecycle(env).reserveReplacement(
      adminIdentity,
      command,
    );
    await piPdfJobs(env)
      .dispatch()
      .catch(() => undefined);
    return data({ reserved }, { status: 202, headers: headers() });
  } catch (error) {
    if (error instanceof Response && [403, 404].includes(error.status))
      throw error;
    const status =
      error instanceof PiValidationError
        ? 400
        : error instanceof Response && [400, 409].includes(error.status)
          ? error.status
          : 503;
    return data(
      {
        error:
          status === 409
            ? "PI、接受记录或商业版本已变化，或已接受金额受保护，请刷新后重新审核。"
            : status === 400
              ? "替换审核信息无效，请核对。"
              : "替换结果尚未确认，请重试原操作。",
        commandId: status === 503 ? command.commandId : undefined,
        retryCommand: status === 503 ? command : undefined,
      },
      { status, headers: headers() },
    );
  }
}

export type PiLifecyclePageData = Awaited<ReturnType<typeof loader>>["data"];
type PiLifecycleActionData = {
  error?: string;
  retryCommand?: ReplaceProformaInvoiceCommand;
  reserved?: { commandId: string; piId?: string };
};

export default function ProformaInvoiceLifecycle({
  loaderData,
  actionData,
}: {
  loaderData: PiLifecyclePageData;
  actionData?: PiLifecycleActionData;
}) {
  const { requestId, history, replacement } = loaderData;
  const base = `/admin/quotes/${encodeURIComponent(requestId)}`;
  const pending = useNavigation().state !== "idle";
  const retry =
    actionData && "retryCommand" in actionData
      ? actionData.retryCommand
      : undefined;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main
        className="admin-main private-review-page"
        style={{ minWidth: 0, overflowWrap: "anywhere" }}
      >
        <Link to={base}>
          <ArrowLeft size={17} /> 返回询价详情
        </Link>
        <h1>PI 替换与历史</h1>
        {actionData && "error" in actionData && (
          <p role="alert">{actionData.error}</p>
        )}
        {actionData && "reserved" in actionData && (
          <p role="status">替换 PI 的 PDF 已进入生成队列。</p>
        )}
        {(replacement.pdfJobs ?? []).map((job) => (
          <section key={job.commandId} className="admin-quote-section">
            <h2>
              {job.state === "failed"
                ? "替换 PI 的 PDF 生成失败"
                : "替换 PI 的 PDF 正在生成"}
            </h2>
            <p>操作编号： {job.commandId}</p>
            {job.state === "failed" && (
              <Form method="post">
                <input type="hidden" name="intent" value="retry-pdf" />
                <input type="hidden" name="commandId" value={job.commandId} />
                <button className="button button-secondary" disabled={pending}>
                  <RefreshCw size={16} /> 重试 PDF
                </button>
              </Form>
            )}
          </section>
        ))}
        {retry ? (
          <section className="admin-quote-section">
            <h2>替换结果尚未确认</h2>
            <p>操作编号： {retry.commandId}</p>
            <p>报价版本： {retry.quoteRevisionId}</p>
            <Form method="post">
              <input type="hidden" name="intent" value="replace" />
              <input type="hidden" name="reviewed" value="on" />
              <input
                type="hidden"
                name="command"
                value={JSON.stringify(retry)}
              />
              <button className="button button-primary" disabled={pending}>
                <RefreshCw size={16} /> 重试原替换操作
              </button>
            </Form>
          </section>
        ) : (
          <PiReplacementForm key={loaderData.commandId} basis={loaderData} />
        )}
        <section aria-label="PI 历史" className="admin-quote-section">
          <h2>PI 历史</h2>
          {history.map((record) => (
            <article
              key={record.id}
              style={{ paddingBlock: 16, borderBottom: "1px solid #d8dde3" }}
            >
              <h3>
                {record.snapshot.documentNumber} · 版本{" "}
                {record.snapshot.documentVersion}
              </h3>
              <p>
                <strong>
                  {
                    {
                      current: "当前",
                      accepted: "已接受",
                      expired: "已过期",
                      superseded: "已替换",
                    }[record.lifecycle.state]
                  }
                </strong>{" "}
                · USD {(record.snapshot.totals.totalCents / 100).toFixed(2)}
              </p>
              <p>报价版本： {record.quoteRevisionId}</p>
              <p>
                签发时间（北京时间）：{" "}
                {formatPiDate(record.snapshot.issuedAt, "admin")}
              </p>
              <p>
                有效期（北京时间）：{" "}
                {formatPiDate(record.snapshot.validUntil, "admin")}
              </p>
              {record.lifecycle.acceptedAt && (
                <p>
                  接受时间（北京时间）：{" "}
                  {formatPiDate(record.lifecycle.acceptedAt, "admin")}
                </p>
              )}
              {record.lifecycle.supersededAt && (
                <p>
                  替换时间（北京时间）：{" "}
                  {formatPiDate(record.lifecycle.supersededAt, "admin")}
                </p>
              )}
              <p>
                付款渠道：{" "}
                {record.snapshot.paymentSelection.channel === "paypal"
                  ? "PayPal"
                  : "银行转账"}{" "}
                · 版本 {record.snapshot.paymentSelection.instructionVersion}
              </p>
              <details>
                <summary>文档版本校验</summary>
                <p>PI: {record.id}</p>
                <p>快照 SHA-256： {record.snapshotHash}</p>
                <p>PDF SHA-256： {record.pdf.sha256}</p>
              </details>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <a
                  href={`${base}/pi/${encodeURIComponent(record.id)}/pdf?disposition=inline`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Eye size={16} /> 查看 PDF
                </a>
                <a href={`${base}/pi/${encodeURIComponent(record.id)}/pdf`}>
                  <Download size={16} /> 下载 PDF
                </a>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
