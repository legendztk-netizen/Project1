import { useEffect, useRef } from "react";
import {
  data,
  Link,
  redirect,
  useRevalidator,
  useRouteLoaderData,
} from "react-router";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/customer-message-thread";
import { cloudflareContext } from "#workers/context";
import { customerMessageCenter } from "../infrastructure/customer-conversation-context";
import { AccountWorkspace } from "../ui/account-workspace";
import {
  readPrivateReviewForm,
  requireReviewMutation,
} from "../../quote-review/domain/private-review";
import {
  ConversationThread,
  ThreadContextCard,
  threadTitle,
} from "../../message-center/ui/message-center";
import { customerCaseReasonLabel } from "../../after-sales/ui/customer-cases";
import type { RootLoaderData } from "../../../root";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const center = await customerMessageCenter(env, request);
  const url = new URL(request.url);
  const thread = await center.thread(
    params.requestId,
    url.searchParams.get("before") ?? undefined,
  );
  return data(
    {
      ...thread,
      caseId: url.searchParams.get("case"),
      paged: url.searchParams.has("before"),
      commandId: crypto.randomUUID(),
    },
    { headers: headers() },
  );
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const center = await customerMessageCenter(env, request);
  requireReviewMutation(request);
  const form = await readPrivateReviewForm(request);
  const file = form.get("file");
  try {
    await center.send({
      request,
      requestId: params.requestId,
      commandId: String(form.get("commandId") ?? ""),
      body: String(form.get("body") ?? ""),
      caseId: String(form.get("caseId") ?? ""),
      attachment: file && typeof file !== "string" && file.size ? file : null,
    });
  } catch (error) {
    if (error instanceof Response && [400, 413, 429].includes(error.status))
      return data(
        { error: await error.text() },
        { status: error.status, headers: headers() },
      );
    throw error;
  }
  return redirect(
    `/account/messages/${encodeURIComponent(params.requestId)}#latest`,
  );
}

export default function CustomerMessageThread({
  loaderData,
  params,
  actionData,
}: Route.ComponentProps) {
  const { messages, context } = loaderData;
  const base = `/account/messages/${encodeURIComponent(params.requestId)}`;
  // Root and page loaders run in parallel, so the header badge was counted
  // before this thread was marked read. Refresh it once per newest message.
  const unread =
    useRouteLoaderData<RootLoaderData>("root")?.customer?.unreadMessages ?? 0;
  const revalidator = useRevalidator();
  const refreshed = useRef<string | null>(null);
  const newest = `${params.requestId}:${messages.messages.at(-1)?.id ?? ""}`;
  useEffect(() => {
    if (!unread || refreshed.current === newest) return;
    refreshed.current = newest;
    void revalidator.revalidate();
  }, [newest, unread, revalidator]);
  return (
    <AccountWorkspace activeView="messages">
      <main className="account-detail-content message-center-page">
        <Link className="customer-quote-back-link" to="/account/messages">
          <ArrowLeft size={17} />
          All messages
        </Link>
        <h1>{threadTitle(context, "en")}</h1>
        <div className="message-thread-layout">
          <ThreadContextCard
            context={context}
            language="en"
            caseReasonLabel={customerCaseReasonLabel}
          />
          <ConversationThread
            messages={messages.messages}
            cases={context.cases}
            commandId={loaderData.commandId}
            attachmentBase={`/account/quotes/${encodeURIComponent(params.requestId)}/conversation/attachments`}
            olderHref={
              messages.nextCursor
                ? `${base}?before=${encodeURIComponent(messages.nextCursor)}`
                : null
            }
            latestHref={loaderData.paged ? base : null}
            language="en"
            initialCaseId={loaderData.caseId}
            error={actionData?.error}
          />
        </div>
      </main>
    </AccountWorkspace>
  );
}
