import { data, Link, redirect } from "react-router";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/quote-conversation";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";
import { createQuoteConversationService } from "../../quote-conversation/application/quote-conversation-service";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { QuoteConversationPanel } from "../../quote-conversation/ui/quote-conversation-panel";
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
  const conversation = await createQuoteConversationService(
    env.DB,
    env.PRIVATE_FILES,
    { kind: "admin", identity: adminIdentity },
  ).list(params.requestId, {
    before: new URL(request.url).searchParams.get("before") ?? undefined,
  });
  return data(
    { conversation, commandId: crypto.randomUUID() },
    { headers: headers() },
  );
}
export async function action({ context, params, request }: Route.ActionArgs) {
  const { env, adminIdentity } = requireAdminRequestContext(context);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const file = form.get("file");
  try {
    await createQuoteConversationService(env.DB, env.PRIVATE_FILES, {
      kind: "admin",
      identity: adminIdentity,
    }).send({
      request,
      requestId: params.requestId,
      commandId: String(form.get("commandId") ?? ""),
      body: String(form.get("body") ?? ""),
      attachment: file && typeof file !== "string" && file.size ? file : null,
    });
    context
      .get(cloudflareContext)
      .ctx.waitUntil(dispatchQuoteNotifications(env));
  } catch (error) {
    if (error instanceof Response && error.status === 400)
      return data(
        { error: await error.text() },
        { status: 400, headers: headers() },
      );
    throw error;
  }
  return redirect(`/admin/quotes/${params.requestId}/conversation`);
}
export default function AdminQuoteConversation({
  loaderData,
  params,
  actionData,
}: Route.ComponentProps) {
  const base = `/admin/quotes/${params.requestId}/conversation`;
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="quotes" />
      <main className="admin-main private-review-page">
        <Link
          className="admin-back-link"
          to={`/admin/quotes/${params.requestId}`}
        >
          <ArrowLeft size={17} />
          返回询价
        </Link>
        <h1>客户会话</h1>
        <Link to="/admin/quote-notifications">邮件通知状态</Link>
        <QuoteConversationPanel
          admin
          messages={loaderData.conversation.messages}
          commandId={loaderData.commandId}
          attachmentBase={`${base}/attachments`}
          olderHref={
            loaderData.conversation.nextCursor
              ? `${base}?before=${encodeURIComponent(loaderData.conversation.nextCursor)}`
              : null
          }
          error={actionData?.error}
        />
      </main>
    </div>
  );
}
