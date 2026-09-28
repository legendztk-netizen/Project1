import { data, Link, redirect } from "react-router";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/message-thread";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { createMessageCenter } from "../../message-center/application/message-center-service";
import {
  ConversationThread,
  ThreadContextCard,
  threadTitle,
} from "../../message-center/ui/message-center";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { adminCaseReasonLabel } from "../../after-sales/ui/admin-cases";
import { cloudflareContext } from "#workers/context";
import { dispatchQuoteNotifications } from "#workers/quote-notifications";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const thread = await createMessageCenter(env.DB, env.PRIVATE_FILES)
    .admin(adminIdentity)
    .thread(params.requestId, url.searchParams.get("before") ?? undefined);
  return data(
    {
      ...thread,
      caseId: url.searchParams.get("case"),
      paged: url.searchParams.has("before"),
      commandId: crypto.randomUUID(),
      noteCommandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const center = createMessageCenter(env.DB, env.PRIVATE_FILES).admin(
    adminIdentity,
  );
  const caseId = String(form.get("caseId") ?? "");
  try {
    if (form.get("intent") === "note")
      await center.addNote({
        request,
        requestId: params.requestId,
        caseId,
        body: String(form.get("body") ?? ""),
        commandId: String(form.get("commandId") ?? ""),
      });
    else {
      const file = form.get("file");
      await center.send({
        request,
        requestId: params.requestId,
        commandId: String(form.get("commandId") ?? ""),
        body: String(form.get("body") ?? ""),
        caseId,
        attachment: file && typeof file !== "string" && file.size ? file : null,
      });
      context
        .get(cloudflareContext)
        .ctx.waitUntil(dispatchQuoteNotifications(env));
    }
  } catch (error) {
    if (error instanceof Response && [400, 413, 429].includes(error.status))
      return data(
        { error: await error.text() },
        { status: error.status, headers: headers() },
      );
    throw error;
  }
  return redirect(
    `/admin/messages/${encodeURIComponent(params.requestId)}#latest`,
  );
}

export default function AdminMessageThread({
  loaderData,
  params,
  actionData,
}: Route.ComponentProps) {
  const { messages, context, notes } = loaderData;
  const base = `/admin/messages/${encodeURIComponent(params.requestId)}`;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="messages" />
      <main className="admin-main message-center-page">
        <Link className="admin-back-link" to="/admin/messages">
          <ArrowLeft size={17} />
          返回消息管理
        </Link>
        <h1>{threadTitle(context, "zh")}</h1>
        <div className="message-thread-layout">
          <ThreadContextCard
            context={context}
            language="zh"
            caseReasonLabel={adminCaseReasonLabel}
          />
          <ConversationThread
            messages={messages.messages}
            notes={loaderData.paged ? [] : notes}
            cases={context.cases}
            commandId={loaderData.commandId}
            noteCommandId={loaderData.noteCommandId}
            attachmentBase={`/admin/quotes/${encodeURIComponent(params.requestId)}/conversation/attachments`}
            olderHref={
              messages.nextCursor
                ? `${base}?before=${encodeURIComponent(messages.nextCursor)}`
                : null
            }
            latestHref={loaderData.paged ? base : null}
            language="zh"
            initialCaseId={loaderData.caseId}
            error={actionData?.error}
          />
        </div>
      </main>
    </div>
  );
}
