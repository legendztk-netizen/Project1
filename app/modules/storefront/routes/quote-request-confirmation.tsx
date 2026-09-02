import { CheckCircle2, FileText } from "lucide-react";
import { Link, redirect } from "react-router";

import type { Route } from "./+types/quote-request-confirmation";
import { AccountWorkspace } from "../../customer-identity/ui/account-workspace";
import { createIndividualQuoteRequestService } from "../../quote-request/application/individual-quote-request-service";
import "../styles/quote-list.css";
import { cloudflareContext } from "#workers/context";

export function meta() {
  return [{ title: "Quote Request Received | Hydraulic Supply" }];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const result = await createIndividualQuoteRequestService(env).readOwned(
    request,
    params.requestId,
  );
  if (!result.authenticated) {
    const returnTo = new URL(request.url).pathname;
    return redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!result.record) throw new Response("Not found", { status: 404 });
  return { quoteRequest: result.record };
}

export default function QuoteRequestConfirmation({
  loaderData,
}: Route.ComponentProps) {
  const quoteRequest = loaderData.quoteRequest;
  return (
    <AccountWorkspace activeView="my-quotes">
      <main className="quote-request-confirmation-page">
        <section className="quote-request-confirmation-panel">
          <CheckCircle2 aria-hidden="true" size={38} />
          <span className="eyebrow">Quote request received</span>
          <h1>We have your request</h1>
          <p>
            Our team will review product pricing, freight and delivery terms
            before preparing your quote.
          </p>
          <dl>
            <div>
              <dt>Quote request number</dt>
              <dd>{quoteRequest.referenceNumber}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>
                {new Date(quoteRequest.submittedAt).toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt>Merchandise reference</dt>
              <dd>
                USD{" "}
                {quoteRequest.snapshot.amounts.merchandiseSubtotal.toFixed(2)}
              </dd>
            </div>
          </dl>
          <p className="quote-request-confirmation-note">
            <FileText aria-hidden="true" size={18} /> This is a request
            confirmation, not an order or payment receipt.
          </p>
          <div className="quote-request-confirmation-actions">
            <Link
              className="button button-primary"
              to="/account?view=my-quotes"
            >
              View My Quotes
            </Link>
            <Link className="button button-secondary" to="/">
              Continue browsing
            </Link>
          </div>
        </section>
      </main>
    </AccountWorkspace>
  );
}
