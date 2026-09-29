import { data, Link } from "react-router";
import type { Route } from "./+types/customer-messages";
import { cloudflareContext } from "#workers/context";
import { customerMessageCenter } from "../infrastructure/customer-conversation-context";
import { AccountWorkspace } from "../ui/account-workspace";
import { MessageInbox } from "../../message-center/ui/message-center";

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const center = await customerMessageCenter(env, request);
  const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
  const inbox = await center.threads(page);
  return data(
    { ...inbox, page: Number.isSafeInteger(page) && page > 0 ? page : 1 },
    { headers: headers() },
  );
}

export default function CustomerMessages({ loaderData }: Route.ComponentProps) {
  const { threads, hasMore, page } = loaderData;
  return (
    <AccountWorkspace activeView="messages">
      <main className="account-detail-content message-center-page">
        <header>
          <h1>Messages</h1>
          <p>
            Conversations with our team about your quotes, orders, returns and
            refunds. To start one, open a quote or order and choose{" "}
            <strong>Message us</strong>.
          </p>
        </header>
        <MessageInbox
          threads={threads}
          language="en"
          threadHref={(requestId) =>
            `/account/messages/${encodeURIComponent(requestId)}`
          }
          empty="No messages yet."
        />
        <nav className="message-center-filters" aria-label="Pages">
          {page > 1 && <Link to={`?page=${page - 1}`}>Newer</Link>}
          {hasMore && <Link to={`?page=${page + 1}`}>Older</Link>}
        </nav>
      </main>
    </AccountWorkspace>
  );
}
