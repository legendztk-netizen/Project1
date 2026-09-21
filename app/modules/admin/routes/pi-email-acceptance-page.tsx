import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { ArrowLeft, Check, Eye, Mail } from "lucide-react";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  piEmailAcceptance,
  piEmailPrivateHeaders,
} from "#workers/pi-email-acceptance";
import { piAcceptanceRequestEvidence } from "#workers/pi-acceptance";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type {
  AcceptPiFromEmailInput,
  createPiEmailAcceptanceService,
} from "../../proforma-invoice/application/pi-email-acceptance-service";

export const headers = () => piEmailPrivateHeaders;
export type EmailAcceptancePageData = Awaited<
  ReturnType<ReturnType<typeof createPiEmailAcceptanceService>["adminPage"]>
> & { commandId: string };

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  if (!params.requestId || !params.piId)
    throw new Response("Not found", { status: 404 });
  const query = new URL(request.url).searchParams;
  return data(
    {
      ...(await (
        await piEmailAcceptance(env)
      ).adminPage(adminIdentity, params.requestId, params.piId, {
        sourceMessageId: query.get("source") ?? undefined,
        before: query.get("before") ?? undefined,
      })),
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  if (!params.requestId || !params.piId)
    throw new Response("Not found", { status: 404 });
  const form = await readPrivateReviewForm(request);
  const field = (name: string) =>
    typeof form.get(name) === "string" ? String(form.get(name)) : "";
  const commandId = field("commandId");
  try {
    const lines: unknown = JSON.parse(field("lines"));
    if (
      !Array.isArray(lines) ||
      lines.length > 200 ||
      [...form.values()].some((value) => typeof value !== "string")
    )
      throw new Response("Invalid lines", { status: 400 });
    if (
      lines.some(
        (line) =>
          !line ||
          typeof line.lineId !== "string" ||
          typeof line.version !== "string",
      )
    )
      throw new Response("Invalid lines", { status: 400 });
    const scoped = lines.map(
      (line: { lineId: string; version: string }, index) => ({
        lineIds: [line.lineId],
        version: line.version,
        cancellationVersion: field("cancellationVersion"),
        specificationsConfirmed: field(`specification-${index}`) === "yes",
        cancellationConfirmed: field(`cancellation-${index}`) === "yes",
      }),
    );
    const input: AcceptPiFromEmailInput = {
      requestId: params.requestId,
      piId: params.piId,
      commandId,
      documentVersion: Number(field("documentVersion")),
      snapshotHash: field("snapshotHash"),
      sourceMessageId: field("sourceMessageId"),
      legalName: field("legalName"),
      explicitlyConfirmed: field("explicitlyConfirmed") === "yes",
      acknowledgements: {
        general: {
          version: field("generalVersion"),
          confirmed: field("generalConfirmed") === "yes",
        },
        madeToOrder: scoped,
      },
      review: {
        piReferenceExcerpt: field("piReferenceExcerpt"),
        generalExcerpt: field("generalExcerpt"),
        madeToOrder: scoped.map((line, index) => ({
          lineIds: line.lineIds,
          specificationExcerpt: field(`specificationExcerpt-${index}`),
          cancellationExcerpt: field(`cancellationExcerpt-${index}`),
        })),
      },
    };
    await (
      await piEmailAcceptance(env)
    ).accept(
      adminIdentity,
      request,
      input,
      piAcceptanceRequestEvidence(request),
    );
    return redirect(
      `${new URL(request.url).pathname}?source=${encodeURIComponent(input.sourceMessageId)}`,
      { headers: headers() },
    );
  } catch (error) {
    if (
      error instanceof Response &&
      [401, 403, 404, 405].includes(error.status)
    )
      throw error;
    const status =
      error instanceof Response
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 503;
    return data(
      {
        commandId,
        error:
          status === 409
            ? "PI 版本、权限或邮件证据已变化，请重新核验。"
            : status >= 500
              ? "确认结果暂时无法核实，请保留当前内容并重试。"
              : "请填写法定名称、原文证据，并完成全部版本确认。",
      },
      { status, headers: headers() },
    );
  }
}

export default function PiEmailAcceptancePage({
  loaderData: page,
  actionData,
}: {
  loaderData: EmailAcceptancePageData;
  actionData?: { error: string; commandId: string };
}) {
  const busy = useNavigation().state !== "idle";
  const base = `/admin/quotes/${encodeURIComponent(page.requestId)}/pi`;
  const conditions = page.conditions;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main
        className="admin-main private-review-page"
        style={{ minWidth: 0, overflowWrap: "anywhere" }}
      >
        <Link to={base}>
          <ArrowLeft size={17} /> 返回 PI
        </Link>
        <h1>记录邮件接受 PI</h1>
        {actionData?.error && <p role="alert">{actionData.error}</p>}
        <section className="admin-quote-section">
          <h2>
            {page.documentNumber} · 版本 {page.documentVersion}
          </h2>
          <p>PI ID：{page.piId}</p>
          <p>
            快照 SHA-256：
            <code style={{ overflowWrap: "anywhere" }}>
              {page.snapshotHash}
            </code>
          </p>
          <p>有效期（北京时间）：{formatPiDate(page.validUntil, "admin")}</p>
          <p role="status">
            {page.accepted
              ? "已接受 · 不可重复确认"
              : !page.current
                ? "已被替换 · 不可确认"
                : page.expired
                  ? "已过期 · 不可确认"
                  : "当前 PI · 待确认"}
          </p>
          <a
            className="button button-secondary"
            href={`${base}/${encodeURIComponent(page.piId)}/pdf?disposition=inline`}
            target="_blank"
            rel="noreferrer"
          >
            <Eye size={17} /> 查看固定 PI
          </a>
        </section>
        <section className="admin-quote-section">
          <h2>客户邮件证据</h2>
          <Form method="get" className="commercial-settings-form">
            <label>
              已授权入档的客户邮件
              <select
                name="source"
                required
                defaultValue={page.selected?.id ?? ""}
                key={page.selected?.id ?? "none"}
                style={{ width: "100%", minWidth: 0 }}
              >
                <option value="">选择邮件</option>
                {page.selected &&
                  !page.emails.some(
                    (email) => email.id === page.selected!.id,
                  ) && (
                    <option value={page.selected.id}>
                      {page.selected.sender} ·{" "}
                      {formatPiDate(page.selected.receivedAt, "admin")}
                    </option>
                  )}
                {page.emails.map((email) => (
                  <option key={email.id} value={email.id}>
                    {formatPiDate(email.receivedAt, "admin")} · {email.sender} ·{" "}
                    {email.preview.slice(0, 35)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={busy || (!page.emails.length && !page.selected)}
            >
              <Eye size={17} /> 校验并查看原文
            </button>
          </Form>
          {!page.emails.length && <p>本页暂无具备当前确认权限的客户邮件。</p>}
          {page.nextCursor && (
            <Link to={`?before=${encodeURIComponent(page.nextCursor)}`}>
              更早的邮件
            </Link>
          )}
          {page.sourceError && <p role="alert">{page.sourceError}</p>}
          {page.selected && (
            <>
              <p role="status">
                <Check size={17} /> 私有原文、发件人和内容校验通过
              </p>
              <p>
                发件人：{page.selected.sender} · 收件时间（北京时间）：
                {formatPiDate(page.selected.receivedAt, "admin")}
              </p>
              <p>来源消息：{page.selected.id}</p>
              <pre
                aria-label="经校验的客户邮件原文"
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: 400,
                  overflowY: "auto",
                  fontFamily: "inherit",
                }}
              >
                {page.selected.body}
              </pre>
            </>
          )}
        </section>
        <Form
          method="post"
          className="commercial-settings-form"
          key={`${page.piId}:${page.snapshotHash}:${page.selected?.id ?? "none"}`}
        >
          <input
            type="hidden"
            name="commandId"
            value={actionData?.commandId ?? page.commandId}
          />
          <input
            type="hidden"
            name="documentVersion"
            value={page.documentVersion}
          />
          <input type="hidden" name="snapshotHash" value={page.snapshotHash} />
          <input
            type="hidden"
            name="sourceMessageId"
            value={page.selected?.id ?? ""}
          />
          <input
            type="hidden"
            name="generalVersion"
            value={conditions.generalAcknowledgement.version}
          />
          <input
            type="hidden"
            name="cancellationVersion"
            value={conditions.cancellation.version}
          />
          <input
            type="hidden"
            name="lines"
            value={JSON.stringify(
              conditions.madeToOrderAcknowledgements.map((ack) => ({
                lineId: ack.lineId,
                version: ack.version,
              })),
            )}
          />
          <fieldset
            disabled={busy || !page.canAccept}
            style={{
              border: 0,
              padding: 0,
              minWidth: 0,
              display: "grid",
              gap: 16,
            }}
          >
            <legend>
              <h2>版本确认与原文摘录</h2>
            </legend>
            <label>
              客户法定名称
              <input
                name="legalName"
                required
                maxLength={300}
                autoComplete="organization"
              />
            </label>
            <label>
              准确 PI 编号的邮件原文摘录
              <textarea
                name="piReferenceExcerpt"
                required
                maxLength={4000}
                rows={2}
              />
            </label>
            <p style={{ whiteSpace: "pre-wrap" }}>
              商业确认条款（{conditions.generalAcknowledgement.version}）：
              {conditions.generalAcknowledgement.text}
            </p>
            <label className="quote-confirmation">
              <input
                type="checkbox"
                name="generalConfirmed"
                value="yes"
                required
              />{" "}
              客户已明确接受本版本商业条款
            </label>
            <label>
              商业确认原文摘录
              <textarea
                name="generalExcerpt"
                required
                maxLength={4000}
                rows={2}
              />
            </label>
            {conditions.madeToOrderAcknowledgements.map((ack, index) => (
              <section
                key={ack.lineId}
                className="admin-quote-section"
                style={{ display: "grid", gap: 12 }}
              >
                <h3>
                  定制行{" "}
                  {page.lines.find((line) => line.id === ack.lineId)?.sku ??
                    ack.lineId}
                </h3>
                <p>
                  行 ID：{ack.lineId} · 确认版本：{ack.version}
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>{ack.text}</p>
                <label className="quote-confirmation">
                  <input
                    type="checkbox"
                    name={`specification-${index}`}
                    value="yes"
                    required
                  />{" "}
                  客户已明确确认该行最终规格
                </label>
                <label>
                  规格确认原文摘录
                  <textarea
                    name={`specificationExcerpt-${index}`}
                    required
                    maxLength={4000}
                    rows={2}
                  />
                </label>
                <label className="quote-confirmation">
                  <input
                    type="checkbox"
                    name={`cancellation-${index}`}
                    value="yes"
                    required
                  />{" "}
                  客户已明确接受该行取消限制（{conditions.cancellation.version}
                  ）
                </label>
                <label>
                  取消限制确认原文摘录
                  <textarea
                    name={`cancellationExcerpt-${index}`}
                    required
                    maxLength={4000}
                    rows={2}
                  />
                </label>
              </section>
            ))}
            <details>
              <summary>取消及退款条款</summary>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {conditions.cancellation.text}
              </p>
              <p style={{ whiteSpace: "pre-wrap" }}>{conditions.refund.text}</p>
            </details>
            <label className="quote-confirmation">
              <input
                type="checkbox"
                name="explicitlyConfirmed"
                value="yes"
                required
              />{" "}
              我已核对客户身份、准确 PI
              版本及上述原文证据，确认代表客户记录邮件接受。
            </label>
            <button className="button button-primary" type="submit">
              <Mail size={18} /> {busy ? "正在记录" : "记录客户邮件接受"}
            </button>
          </fieldset>
        </Form>
      </main>
    </div>
  );
}
