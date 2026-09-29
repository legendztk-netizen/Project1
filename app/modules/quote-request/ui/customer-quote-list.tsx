import { formatQuoteAmounts } from "../../quote-list/domain/quote-currency-totals";
import { Link } from "react-router";
import { useId, useRef, useState } from "react";

import {
  customerQuoteProgressStages,
  type CustomerQuoteProjection,
  type CustomerQuoteProgressCode,
} from "../domain/quote-request";
import {
  customerQuoteDateTime,
  quoteImportHandling,
  quotePurchasingAs,
} from "./customer-quote-presentation";
import { customerQuoteNextStep } from "./customer-quote-next-step";
import { CustomerQuoteRequestPreview } from "./customer-quote-product-preview";

export function CustomerQuoteList({
  quoteRequests,
}: {
  quoteRequests: CustomerQuoteProjection[];
}) {
  const [selected, setSelected] = useState<CustomerQuoteProgressCode | "all">(
    "all",
  );
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [
    { code: "all" as const, label: "All Quotes" },
    ...customerQuoteProgressStages.filter(
      (stage) =>
        !["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "ORDER_CREATED"].includes(
          stage.code,
        ) || quoteRequests.some((quote) => quote.progress.code === stage.code),
    ),
  ];
  const visibleQuotes =
    selected === "all"
      ? quoteRequests
      : quoteRequests.filter((quote) => quote.progress.code === selected);
  return (
    <section className="account-record-detail customer-quotes-detail">
      <span className="eyebrow">Requests and quotes</span>
      <h1>My Quotes</h1>
      <p className="account-detail-intro">
        Track submitted requests here. A formal quoted price and PI will appear
        only after our team prepares them.
      </p>
      <div
        className="customer-quote-tabs"
        role="tablist"
        aria-label="Quote status"
      >
        {tabs.map((tab, index) => {
          const count =
            tab.code === "all"
              ? quoteRequests.length
              : quoteRequests.filter(
                  (quote) => quote.progress.code === tab.code,
                ).length;
          return (
            <button
              key={tab.code}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              id={`${id}-${tab.code}`}
              type="button"
              role="tab"
              aria-selected={selected === tab.code}
              aria-controls={`${id}-panel`}
              tabIndex={selected === tab.code ? 0 : -1}
              onClick={() => setSelected(tab.code)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + tabs.length) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                setSelected(tabs[next].code);
                buttons.current[next]?.focus();
              }}
            >
              <span className="customer-quote-tab-label" data-label={tab.label}>
                <span>{tab.label}</span>
              </span>
              <span className="customer-quote-tab-count">{count}</span>
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${selected}`}
        tabIndex={0}
      >
        {visibleQuotes.length === 0 ? (
          <div className="account-inline-empty">
            <p>
              {quoteRequests.length === 0
                ? "No submitted quote requests yet."
                : "No quotes in this status."}
            </p>
            {quoteRequests.length === 0 ? (
              <Link className="button button-secondary" to="/">
                Browse products
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="customer-quote-list">
            {visibleQuotes.map((quoteRequest) => {
              const next = customerQuoteNextStep(quoteRequest);
              const lineCount = quoteRequest.snapshot.lines.length;
              const pi = quoteRequest.currentPi;
              return (
                <article key={quoteRequest.id} className="customer-quote-card">
                  <CustomerQuoteRequestPreview
                    lines={quoteRequest.snapshot.lines}
                  />
                  <div className="customer-quote-card-body">
                    <div className="customer-quote-card-top">
                      <h2>{quoteRequest.referenceNumber}</h2>
                      <span className="customer-order-badge">
                        {quoteRequest.progress.label}
                      </span>
                      <div className="customer-quote-card-amount">
                        <span>
                          {pi
                            ? quoteRequest.progress.code ===
                              "PI_REPLACEMENT_REQUIRED"
                              ? "Previous PI total"
                              : quoteRequest.progress.code === "PI_EXPIRED"
                                ? "Expired PI total"
                                : "PI total"
                            : "Submitted merchandise reference"}
                        </span>
                        <strong className="customer-quote-pi-total">
                          {pi
                            ? pi.currency === "USD" &&
                              typeof pi.totalCents === "number" &&
                              Number.isSafeInteger(pi.totalCents) &&
                              pi.totalCents >= 0
                              ? `USD ${(pi.totalCents / 100).toFixed(2)}`
                              : "Not available"
                            : formatQuoteAmounts(quoteRequest.snapshot.amounts)}
                        </strong>
                        {pi && (
                          <span className="customer-quote-submitted-reference">
                            Submitted merchandise reference:{" "}
                            {formatQuoteAmounts(quoteRequest.snapshot.amounts)}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="customer-quote-card-meta">
                      {lineCount} item{lineCount === 1 ? "" : "s"} · Submitted{" "}
                      {customerQuoteDateTime.format(
                        new Date(quoteRequest.submittedAt),
                      )}
                    </p>
                    <p className="customer-quote-card-meta">
                      {quotePurchasingAs(quoteRequest)} ·{" "}
                      {quoteImportHandling(quoteRequest)}
                    </p>
                    <p className="customer-quote-card-next">{next.summary}</p>
                    <div className="customer-quote-card-actions">
                      <Link
                        className="button button-secondary"
                        to={`/account/quotes/${encodeURIComponent(quoteRequest.id)}`}
                      >
                        View details
                      </Link>
                      {quoteRequest.orderId ? (
                        <Link
                          className="button button-secondary"
                          to={`/account/orders/${encodeURIComponent(quoteRequest.orderId)}`}
                        >
                          View order
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
