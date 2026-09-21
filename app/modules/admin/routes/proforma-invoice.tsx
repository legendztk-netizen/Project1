import { useState } from "react";
import type { IssueProformaInvoiceCommand } from "../../proforma-invoice/application/proforma-invoice-service";
import { PiValidationError } from "../../proforma-invoice/domain/proforma-invoice";
import {
  Form,
  Link,
  data,
  redirect,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { ArrowLeft, Download, Eye, Send } from "lucide-react";
import {
  proformaInvoices,
  piPdfJobs,
  piPrivateHeaders,
  piRouteId,
  type PiReadiness,
} from "#workers/proforma-invoice";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import {
  paymentChannel,
  sellerIdentityReadyForPi,
} from "../../seller-settings/domain/seller-commercial-settings";
import {
  formatPiDate,
  piUtcInstant,
} from "../../proforma-invoice/domain/proforma-invoice";

export const headers = piPrivateHeaders;
export async function loader({ context, params }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const requestId = piRouteId(params.requestId);
  const readiness = await proformaInvoices(env).readiness(
    adminIdentity,
    requestId,
  );
  return data(
    { requestId, readiness, commandId: crypto.randomUUID() },
    { headers: headers() },
  );
}

export function beijingDeadline(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Invalid Beijing deadline");
  piUtcInstant(`${value}:00.000Z`);
  return new Date(
    new Date(`${value}:00.000Z`).getTime() - 8 * 60 * 60 * 1000,
  ).toISOString();
}

export async function action({ context, params, request }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const requestId = piRouteId(params.requestId);
  let input: IssueProformaInvoiceCommand;
  const form = await readPrivateReviewForm(request);
  const field = (name: string) =>
    typeof form.get(name) === "string" ? String(form.get(name)) : "";
  if (field("intent") === "retry-pdf") {
    await proformaInvoices(env).retryPdf(
      adminIdentity,
      requestId,
      field("commandId"),
    );
    await piPdfJobs(env)
      .dispatch()
      .catch(() => undefined);
    return redirect(`/admin/quotes/${encodeURIComponent(requestId)}/pi`, {
      headers: headers(),
    });
  }
  try {
    if (field("intent") !== "issue")
      throw new Response("Invalid operation", { status: 400 });
    const selection: unknown = JSON.parse(field("paymentSelection"));
    if (
      !selection ||
      typeof selection !== "object" ||
      !("id" in selection) ||
      !("version" in selection) ||
      !("channel" in selection) ||
      typeof selection.id !== "string" ||
      !selection.id.trim() ||
      typeof selection.version !== "number" ||
      !Number.isSafeInteger(selection.version) ||
      selection.version < 1 ||
      typeof selection.channel !== "string"
    )
      throw new Error("Invalid payment selection");
    const validUntil = field("validUntilBeijing");
    input = {
      requestId,
      commandId: field("commandId"),
      quoteRevisionId: field("quoteRevisionId"),
      quoteRevisionHash: field("quoteRevisionHash"),
      sellerIdentityId: field("sellerIdentityId"),
      sellerVersion: Number(field("sellerVersion")),
      paymentChannel: paymentChannel(selection.channel),
      paymentInstructionId: selection.id,
      paymentInstructionVersion: selection.version,
      ...(validUntil ? { validUntil: beijingDeadline(validUntil) } : {}),
    };
  } catch (error) {
    if (error instanceof Response && error.status !== 400) throw error;
    return data(
      { error: "请核对付款选择与有效期格式。", commandId: undefined },
      { status: 400, headers: headers() },
    );
  }
  try {
    await proformaInvoices(env).reserve(adminIdentity, input);
    // The durable job survives a dispatch outage; scheduled recovery retries it.
    await piPdfJobs(env)
      .dispatch()
      .catch(() => undefined);
  } catch (error) {
    if (
      error instanceof Response &&
      error.status < 500 &&
      ![400, 409].includes(error.status)
    )
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
            ? "报价或所选版本已变化，请刷新后重新审核。"
            : status === 503
              ? "签发服务暂时不可用，结果尚未确认。请稍后重试。"
              : "签发未完成：请核对报价商业条款、技术确认、卖方地址、付款版本与有效期。",
        commandId: status === 503 ? input.commandId : undefined,
      },
      { status, headers: headers() },
    );
  }
  return redirect(`/admin/quotes/${encodeURIComponent(requestId)}/pi`, {
    headers: headers(),
  });
}

export default function ProformaInvoice({
  loaderData,
  actionData,
}: {
  loaderData: { requestId: string; readiness: PiReadiness; commandId: string };
  actionData?: { error: string; commandId?: string };
}) {
  const { readiness, requestId, commandId } = loaderData;
  const { seller, quoteRevision, current, payments } = readiness;
  const [selected, setSelected] = useState("");
  const pending = useNavigation().state !== "idle";
  const payment = payments.find(
    (item) =>
      JSON.stringify({
        id: item.id,
        version: item.version,
        channel: item.channel,
      }) === selected,
  );
  const blocked =
    (readiness.pdfJobs ?? []).some((job) => job.state !== "failed") ||
    !quoteRevision ||
    !sellerIdentityReadyForPi(seller) ||
    !readiness.conditionsConfigured ||
    !payment;
  const base = `/admin/quotes/${encodeURIComponent(requestId)}/pi`;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main
        className="admin-main private-review-page"
        style={{ minWidth: 0, overflowWrap: "anywhere" }}
      >
        <Link to={`/admin/quotes/${encodeURIComponent(requestId)}`}>
          <ArrowLeft size={17} />
          返回询价详情
        </Link>
        <h1>形式发票 PI</h1>
        {actionData?.error && <p role="alert">{actionData.error}</p>}
        {(readiness.pdfJobs ?? []).map((job) => (
          <section key={job.commandId} className="admin-quote-section">
            <p role="status">
              {job.state === "failed"
                ? "PDF 生成失败，需要人工处理。"
                : "PDF 正在后台生成，请刷新查看。"}
            </p>
            {job.state === "failed" && (
              <Form method="post">
                <input type="hidden" name="intent" value="retry-pdf" />
                <input type="hidden" name="commandId" value={job.commandId} />
                <button
                  className="button button-secondary"
                  type="submit"
                  disabled={pending}
                >
                  重试 PDF
                </button>
              </Form>
            )}
          </section>
        ))}
        {current ? (
          <section className="admin-quote-section">
            <h2>
              {current.snapshot.documentNumber} · 版本{" "}
              {current.snapshot.documentVersion}
            </h2>
            <p>
              签发时间（北京时间）：
              {formatPiDate(current.snapshot.issuedAt, "admin")}
            </p>
            <p>
              有效期（北京时间）：
              {formatPiDate(current.snapshot.validUntil, "admin")}
            </p>
            <p>
              合计 USD {(current.snapshot.totals.totalCents / 100).toFixed(2)}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <a
                className="button button-secondary"
                href={`${base}/${encodeURIComponent(current.id)}/pdf?disposition=inline`}
                target="_blank"
                rel="noreferrer"
              >
                <Eye size={18} />
                查看 PI
              </a>
              <a
                className="button button-secondary"
                href={`${base}/${encodeURIComponent(current.id)}/pdf`}
              >
                <Download size={18} />
                下载 PDF
              </a>
            </div>
            <h2>当前所选付款渠道说明</h2>
            {current.paymentInstructions ? (
              <>
                <p>
                  {current.paymentInstructions.channel === "paypal"
                    ? "PayPal"
                    : "银行转账"}{" "}
                  · 版本 {current.paymentInstructions.version}
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {current.paymentInstructions.instructions}
                </p>
              </>
            ) : (
              <p role="alert">当前付款说明不可用，请核对商业设置。</p>
            )}
          </section>
        ) : (
          <Form method="post" className="commercial-settings-form">
            <input type="hidden" name="intent" value="issue" />
            <input
              type="hidden"
              name="commandId"
              value={actionData?.commandId ?? commandId}
            />
            <input
              type="hidden"
              name="quoteRevisionId"
              value={quoteRevision?.id ?? ""}
            />
            <input
              type="hidden"
              name="quoteRevisionHash"
              value={quoteRevision?.hash ?? ""}
            />
            <input
              type="hidden"
              name="sellerIdentityId"
              value={seller?.id ?? ""}
            />
            <input
              type="hidden"
              name="sellerVersion"
              value={seller?.version ?? ""}
            />
            <section className="admin-quote-section">
              <h2>签发审核</h2>
              <p>
                当前报价：{quoteRevision ? quoteRevision.id : "缺少正式报价"}
              </p>
              <p>卖方版本：{seller?.version ?? "未配置"}</p>
              <p>{seller?.legalName}</p>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {seller?.registeredAddressEn}
              </p>
              {!sellerIdentityReadyForPi(seller) && (
                <p role="alert">请先配置有效的中国注册英文地址。</p>
              )}
              {!readiness.conditionsConfigured && (
                <p role="alert">取消、退款与确认条款尚未配置。</p>
              )}
            </section>
            <label>
              付款渠道及说明版本
              <select
                name="paymentSelection"
                required
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                style={{ maxWidth: "100%" }}
              >
                <option value="">请选择</option>
                {payments.map((item) => (
                  <option
                    key={item.id}
                    value={JSON.stringify({
                      id: item.id,
                      version: item.version,
                      channel: item.channel,
                    })}
                  >
                    {item.channel === "paypal" ? "PayPal" : "银行转账"} · 版本{" "}
                    {item.version}
                  </option>
                ))}
              </select>
            </label>
            {!payments.length && (
              <p role="alert">无有效付款说明，请先配置商业设置。</p>
            )}
            {payment && (
              <p style={{ whiteSpace: "pre-wrap" }}>{payment.instructions}</p>
            )}
            <label>
              自定义有效期（北京时间；留空为签发后 14 天）
              <input
                type="datetime-local"
                name="validUntilBeijing"
                style={{ maxWidth: "100%" }}
              />
            </label>
            <button
              className="button button-primary"
              disabled={pending || blocked}
            >
              <Send size={18} />
              {pending ? "正在签发" : "签发固定 USD 形式发票"}
            </button>
          </Form>
        )}
      </main>
    </div>
  );
}
