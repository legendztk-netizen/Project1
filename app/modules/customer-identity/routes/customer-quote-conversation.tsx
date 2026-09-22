import { data, Link, redirect } from "react-router";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/customer-quote-conversation";
import { cloudflareContext } from "#workers/context";
import { customerConversationContext } from "../infrastructure/customer-conversation-context";
import { AccountWorkspace } from "../ui/account-workspace";
import { CustomerQuoteNavigation } from "../ui/customer-quote-navigation";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import { QuoteConversationPanel } from "../../quote-conversation/ui/quote-conversation-panel";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const service = await customerConversationContext(env, request);
  const conversation = await service.list(params.requestId, {
    before: new URL(request.url).searchParams.get("before") ?? undefined,
  });
  return data(
    { conversation, commandId: crypto.randomUUID() },
    { headers: headers() },
  );
}
export async function action({ context, params, request }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const service = await customerConversationContext(env, request);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const file = form.get("file");
  try {
    await service.send({
      request,
      requestId: params.requestId,
      commandId: String(form.get("commandId") ?? ""),
      body: String(form.get("body") ?? ""),
      attachment: file && typeof file !== "string" && file.size ? file : null,
    });
  } catch (error) {
    if (error instanceof Response && error.status === 400)
      return data(
        { error: await error.text() },
        { status: 400, headers: headers() },
      );
    throw error;
  }
  return redirect(`/account/quotes/${params.requestId}/conversation`);
}
export default function CustomerQuoteConversation({
  loaderData,
  params,
  actionData,
}: Route.ComponentProps) {
  const base = `/account/quotes/${params.requestId}/conversation`;
  return (
    <AccountWorkspace activeView="my-quotes">
      <main className="customer-quote-detail account-detail-content">
        <Link
          className="customer-quote-back-link"
          to={`/account/quotes/${params.requestId}`}
        >
          <ArrowLeft size={17} />
          Back to quote
        </Link>
        <h1>Quote conversation</h1>
        <CustomerQuoteNavigation requestId={params.requestId} />
        <QuoteConversationPanel
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
    </AccountWorkspace>
  );
}
