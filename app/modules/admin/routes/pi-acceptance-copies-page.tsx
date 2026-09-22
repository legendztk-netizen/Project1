import { useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { ArrowLeft, Eye, RefreshCw } from "lucide-react";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import {
  piAcceptanceCopies,
  piEmailPrivateHeaders,
} from "#workers/pi-email-acceptance";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { formatPiDate } from "../../proforma-invoice/domain/proforma-invoice";
import type { createPiAcceptanceCopies } from "../../proforma-invoice/application/pi-acceptance-copies";
import type { NotificationEmail } from "../../quote-notifications";

export const headers = () => piEmailPrivateHeaders;
export type CopiesPageData = {
  page: Awaited<
    ReturnType<ReturnType<typeof createPiAcceptanceCopies>["listAdmin"]>
  >;
  unresolved: boolean;
  local: boolean;
  capture: NotificationEmail | null;
  commandIds: Record<string, string>;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const query = new URL(request.url).searchParams;
  const service = await piAcceptanceCopies(env);
  const unresolved = query.get("filter") !== "all";
  const captureId = query.get("capture");
  const page = await service.listAdmin(adminIdentity, {
    unresolved,
    before: query.get("before") ?? undefined,
  });
  return data(
    {
      page,
      commandIds: Object.fromEntries(
        page.rows.map((row) => [row.id, crypto.randomUUID()]),
      ),
      unresolved,
      local: env.APP_ENV === "local" && env.EMAIL_DELIVERY_MODE === "stub",
      capture: captureId
        ? await service.readLocalCapture(adminIdentity, captureId)
        : null,
    },
    { headers: headers() },
  );
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const id = form.get("acceptanceId");
  const reason = form.get("reason");
  if (
    typeof id !== "string" ||
    typeof reason !== "string" ||
    !["retry", "reconcile"].includes(String(form.get("intent")))
  )
    return data(
      {
        error: "请填写重试原因。",
        acceptanceId: typeof id === "string" ? id : "",
      },
      { status: 400, headers: headers() },
    );
  try {
    const service = await piAcceptanceCopies(env);
    if (form.get("intent") === "reconcile") {
      const outcome = form.get("outcome");
      if (outcome !== "delivered" && outcome !== "confirmed_not_delivered")
        throw new Response("Outcome required", { status: 400 });
      await service.reconcileAdmin(adminIdentity, request, {
        acceptanceId: id,
        reason,
        commandId: String(form.get("commandId") ?? ""),
        generation: Number(form.get("generation")),
        outcome,
        providerId: String(form.get("providerId") ?? ""),
        reference: String(form.get("reference") ?? ""),
        explicitlyConfirmed: form.get("explicitlyConfirmed") === "yes",
      });
    } else await service.retryAdmin(adminIdentity, request, id, reason);
  } catch (error) {
    if (error instanceof Response && [401, 403, 405].includes(error.status))
      throw error;
    const status = error instanceof Response ? error.status : 503;
    return data(
      {
        acceptanceId: id,
        error:
          status === 409
            ? "当前任务不可重试：请先核对投递结果或重试时限，避免重复发送。"
            : status === 400
              ? "请填写有效的重试原因。"
              : "暂时无法安排重试，请稍后再试。",
      },
      { status, headers: headers() },
    );
  }
  return redirect("/admin/pi-acceptance-copies?filter=all", {
    headers: headers(),
  });
}

const failureLabels: Record<string, string> = {
  queue_unavailable: "任务队列暂不可用",
  configuration_unavailable: "邮件配置不可用",
  protected_payload_unavailable: "副本加密内容不可用",
  recipient_no_longer_authorized: "收件人已无询价访问权限",
  acceptance_source_unavailable: "接受记录或固定 PI 不可用",
  acceptance_source_mismatch: "接受记录与固定 PI 不一致",
  delivery_budget_exhausted: "安全重试次数或时限已耗尽",
  delivery_mode_changed: "邮件投递模式已变化",
  transport_uncertain: "投递结果不确定",
  provider_busy: "邮件服务繁忙",
  provider_unavailable: "邮件服务不可用",
  provider_auth: "邮件服务认证失败",
  provider_rejected: "邮件服务拒绝投递",
  idempotency_conflict: "邮件服务幂等记录冲突",
};
export default function PiAcceptanceCopiesPage({
  loaderData,
  actionData,
}: {
  loaderData: CopiesPageData;
  actionData?: { error: string; acceptanceId: string };
}) {
  const busy = useNavigation().state !== "idle";
  const { page, unresolved, local, capture } = loaderData;
  const [searchParams] = useSearchParams();
  const sourceRequestId = searchParams.get("requestId");
  const sourceQuery = sourceRequestId
    ? `&requestId=${encodeURIComponent(sourceRequestId)}`
    : "";
  const filter = unresolved ? "unresolved" : "all";
  const states: Record<string, string> = {
    pending: "待发送",
    sending: "发送中",
    retry: "等待重试",
    sent: local ? "已生成本地测试邮件" : "已发送",
    review: "需要人工核查",
    dead_letter: "发送失败",
  };
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main
        className="admin-main private-review-page"
        style={{ minWidth: 0, overflowWrap: "anywhere" }}
      >
        <Link
          className="button button-secondary"
          to={
            sourceRequestId
              ? `/admin/quotes/${encodeURIComponent(sourceRequestId)}`
              : "/admin/quotes"
          }
        >
          <ArrowLeft size={18} aria-hidden="true" />
          {sourceRequestId ? "返回询价快照" : "返回询价列表"}
        </Link>
        <h1>PI 接受确认副本</h1>
        <nav
          aria-label="副本状态筛选"
          style={{ display: "flex", flexWrap: "wrap", gap: 16 }}
        >
          <Link
            className="button button-primary"
            to={`?filter=unresolved${sourceQuery}`}
            aria-current={unresolved ? "page" : undefined}
          >
            待人工处理
          </Link>
          <Link
            className="button button-primary"
            to={`?filter=all${sourceQuery}`}
            aria-current={!unresolved ? "page" : undefined}
          >
            全部副本
          </Link>
        </nav>
        {capture && (
          <section className="admin-quote-section">
            <Link to={`?filter=${filter}${sourceQuery}`}>
              <ArrowLeft size={17} /> 关闭本地测试邮件
            </Link>
            <h2>本地邮件副本</h2>
            <p>发件人：{capture.from}</p>
            <p>收件人：{capture.to.join(", ")}</p>
            <p>主题：{capture.subject}</p>
            <pre
              aria-label="本地确认副本正文"
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontFamily: "inherit",
              }}
            >
              {capture.text}
            </pre>
          </section>
        )}
        {actionData?.error && <p role="alert">{actionData.error}</p>}
        {!page.rows.length && (
          <p role="status">
            {unresolved ? "暂无需要人工处理的副本。" : "暂无 PI 接受副本。"}
          </p>
        )}
        <div className="quote-conversation-messages">
          {page.rows.map((row) => (
            <article
              key={row.id}
              className="quote-message quote-message-admin"
              style={{ minWidth: 0, padding: 16 }}
            >
              <header style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <h2 style={{ fontSize: 20, margin: 0 }}>
                  {row.document_number} · 版本 {row.document_version}
                </h2>
                <strong>{states[row.state] ?? row.state}</strong>
              </header>
              <p>接受记录：{row.id}</p>
              <p>
                创建时间（北京时间）：
                {formatPiDate(new Date(row.created_at).toISOString(), "admin")}
              </p>
              <p>
                投递尝试：{row.attempts} · 队列尝试：{row.dispatch_attempts}
              </p>
              <p>投递代次：{row.generation}</p>
              {row.failure_code && (
                <p>
                  {failureLabels[row.failure_code] ?? "投递异常，需要人工核查"}{" "}
                  <code>({row.failure_code})</code>
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <Link
                  to={`/admin/quotes/${encodeURIComponent(row.request_id)}/pi/${encodeURIComponent(row.pi_id)}/email-review`}
                >
                  <Eye size={17} /> 查看接受版本
                </Link>
                {local && !!row.has_local_capture && (
                  <Link
                    to={`?filter=${filter}&capture=${encodeURIComponent(row.id)}${sourceQuery}`}
                  >
                    <Eye size={17} /> 查看本地测试邮件
                  </Link>
                )}
              </div>
              {row.canRetry ? (
                <Form method="post" className="commercial-settings-form">
                  <input type="hidden" name="intent" value="retry" />
                  <input type="hidden" name="acceptanceId" value={row.id} />
                  <label>
                    重试原因
                    <input name="reason" required maxLength={2000} />
                  </label>
                  <button className="button button-secondary" disabled={busy}>
                    <RefreshCw size={17} /> 安排重试
                  </button>
                </Form>
              ) : (
                ["review", "dead_letter"].includes(row.state) && (
                  <p role="status">
                    需先核对邮件服务的投递结果，当前不能安全重试。
                  </p>
                )
              )}
              {["review", "dead_letter"].includes(row.state) && (
                <ReconciliationForm
                  acceptanceId={row.id}
                  generation={row.generation}
                  commandId={loaderData.commandIds[row.id]}
                  busy={busy}
                />
              )}
            </article>
          ))}
        </div>
        {page.nextCursor && (
          <Link
            to={`?filter=${filter}&before=${encodeURIComponent(page.nextCursor)}${sourceQuery}`}
          >
            更早的副本
          </Link>
        )}
      </main>
    </div>
  );
}

function ReconciliationForm({
  acceptanceId,
  generation,
  commandId,
  busy,
}: {
  acceptanceId: string;
  generation: number;
  commandId: string;
  busy: boolean;
}) {
  const [outcome, setOutcome] = useState("delivered");
  return (
    <details>
      <summary>人工核对邮件服务投递结果</summary>
      <Form method="post" className="commercial-settings-form">
        <input type="hidden" name="intent" value="reconcile" />
        <input type="hidden" name="acceptanceId" value={acceptanceId} />
        <input type="hidden" name="generation" value={generation} />
        <input type="hidden" name="commandId" value={commandId} />
        <fieldset style={{ minWidth: 0 }} disabled={busy}>
          <legend>核对结果 · 代次 {generation}</legend>
          <label className="quote-confirmation">
            <input
              type="radio"
              style={{ width: 18, height: 18, flex: "0 0 18px" }}
              name="outcome"
              value="delivered"
              checked={outcome === "delivered"}
              onChange={(event) => setOutcome(event.target.value)}
            />{" "}
            已送达，停止重发
          </label>
          <label className="quote-confirmation">
            <input
              type="radio"
              style={{ width: 18, height: 18, flex: "0 0 18px" }}
              name="outcome"
              value="confirmed_not_delivered"
              checked={outcome === "confirmed_not_delivered"}
              onChange={(event) => setOutcome(event.target.value)}
            />{" "}
            已确认未送达，建立新投递代次
          </label>
          {outcome === "delivered" && (
            <label>
              邮件服务投递 ID
              <input name="providerId" required maxLength={500} />
            </label>
          )}
          <label>
            邮件服务证据引用（工单或日志编号）
            <input name="reference" required maxLength={2000} />
          </label>
          <label>
            核对依据与原因
            <input name="reason" required maxLength={2000} />
          </label>
          <label className="quote-confirmation">
            <input
              type="checkbox"
              name="explicitlyConfirmed"
              value="yes"
              required
            />{" "}
            我已核对邮件服务记录。未收到客户回复不代表未送达；确认未送达后将使用新幂等键重新发送同一副本。
          </label>
          <button className="button button-secondary" disabled={busy}>
            <RefreshCw size={17} /> 记录核对结果
          </button>
        </fieldset>
      </Form>
    </details>
  );
}
