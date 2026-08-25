import {
  AlertCircle,
  ArrowLeft,
  FileText,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Form, Link, data, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/anonymous-quote-list";
import { createAnonymousQuoteListService } from "../../quote-list/application/anonymous-quote-list-service";
import { QuoteListCommandRejected } from "../../quote-list/domain/anonymous-quote-list";
import {
  maximumStandardProductQuantity,
  parseStandardProductQuantity,
} from "../../quote-list/domain/anonymous-quote-session";
import { StorefrontHeader } from "../ui/storefront-header";
import "../styles/quote-list.css";
import { cloudflareContext } from "#workers/context";

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function responseHeaders(setCookie: string | null) {
  const headers = new Headers();
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return headers;
}

export function meta() {
  return [{ title: "Quote List | Hydraulic Supply" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const result = await createAnonymousQuoteListService(env).read(request);
  return data(
    { lines: result.lines },
    { headers: responseHeaders(result.setCookie) },
  );
}

export async function action({ context, request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = textValue(form, "intent");
  const service = createAnonymousQuoteListService(env);

  try {
    if (intent === "add") {
      const quantity = parseStandardProductQuantity(form.get("quantity"));
      if (quantity === null) {
        throw new QuoteListCommandRejected(
          "Quantity must be a whole number from 1 to 9,999.",
          "INVALID_QUANTITY",
        );
      }
      const result = await service.add(
        request,
        textValue(form, "sku"),
        quantity,
      );
      return redirect("/quote-list", {
        headers: responseHeaders(result.setCookie),
      });
    }

    if (intent === "update") {
      const quantity = parseStandardProductQuantity(form.get("quantity"));
      if (quantity === null) {
        throw new QuoteListCommandRejected(
          "Quantity must be a whole number from 1 to 9,999.",
          "INVALID_QUANTITY",
        );
      }
      const result = await service.update(
        request,
        textValue(form, "lineId"),
        quantity,
      );
      return redirect("/quote-list", {
        headers: responseHeaders(result.setCookie),
      });
    }

    if (intent === "remove") {
      const result = await service.remove(request, textValue(form, "lineId"));
      return redirect("/quote-list", {
        headers: responseHeaders(result.setCookie),
      });
    }

    return data({ formError: "Unknown Quote List command." }, { status: 400 });
  } catch (error) {
    if (error instanceof QuoteListCommandRejected) {
      return data({ formError: error.message }, { status: 409 });
    }
    throw error;
  }
}

function lineSubtotal(quantity: number, referenceUnitPrice: number | null) {
  return referenceUnitPrice == null ? null : quantity * referenceUnitPrice;
}

export default function AnonymousQuoteList({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const referenceTotal = loaderData.lines.reduce(
    (total, line) =>
      total + (lineSubtotal(line.quantity, line.referenceUnitPrice) ?? 0),
    0,
  );
  const hasUnpricedLine = loaderData.lines.some(
    (line) => line.referenceUnitPrice == null,
  );

  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="quote-list-page">
        <Link className="product-back-link" to="/">
          <ArrowLeft size={17} /> Continue browsing
        </Link>

        <header className="quote-list-heading">
          <div>
            <span className="eyebrow">Selection workspace</span>
            <h1>Quote List</h1>
            <p>
              Review quantities here. Final price, freight and delivery terms
              are confirmed after you submit a quote request.
            </p>
          </div>
          <span className="quote-line-count">
            {loaderData.lines.length} line
            {loaderData.lines.length === 1 ? "" : "s"}
          </span>
        </header>

        {actionData?.formError ? (
          <p className="quote-list-error" role="alert">
            <AlertCircle size={18} /> {actionData.formError}
          </p>
        ) : null}

        {loaderData.lines.length ? (
          <div className="quote-list-layout">
            <section className="quote-lines" aria-label="Quote List products">
              {loaderData.lines.map((line) => {
                const subtotal = lineSubtotal(
                  line.quantity,
                  line.referenceUnitPrice,
                );
                return (
                  <article className="quote-line" key={line.id}>
                    <div className="quote-line-main">
                      <span className="eyebrow">
                        {line.category.replaceAll("-", " ")}
                      </span>
                      <h2>{line.displayName}</h2>
                      <p>
                        SKU <strong>{line.sku}</strong>
                      </p>
                    </div>
                    <div className="quote-line-price">
                      <span>Reference subtotal</span>
                      <strong>
                        {subtotal == null
                          ? "Price on quote"
                          : `${line.currency} ${subtotal.toFixed(2)}`}
                      </strong>
                      <small>
                        {line.referenceUnitPrice == null
                          ? "No reference unit price"
                          : `${line.currency} ${line.referenceUnitPrice.toFixed(2)} / ${line.salesUnit}`}
                      </small>
                    </div>
                    <div className="quote-line-actions">
                      <Form method="post">
                        <input name="intent" type="hidden" value="update" />
                        <input name="lineId" type="hidden" value={line.id} />
                        <label htmlFor={`quantity-${line.id}`}>Quantity</label>
                        <div>
                          <input
                            defaultValue={line.quantity}
                            disabled={busy}
                            id={`quantity-${line.id}`}
                            max={maximumStandardProductQuantity}
                            min="1"
                            name="quantity"
                            required
                            step="1"
                            type="number"
                          />
                          <button
                            className="button button-secondary"
                            disabled={busy}
                            title="Update quantity"
                            type="submit"
                          >
                            <RefreshCw size={17} /> Update
                          </button>
                        </div>
                      </Form>
                      <Form method="post">
                        <input name="intent" type="hidden" value="remove" />
                        <input name="lineId" type="hidden" value={line.id} />
                        <button
                          aria-label={`Remove ${line.sku}`}
                          className="button quote-remove-command"
                          disabled={busy}
                          title="Remove from Quote List"
                          type="submit"
                        >
                          <Trash2 size={17} /> Remove
                        </button>
                      </Form>
                    </div>
                  </article>
                );
              })}
            </section>

            <aside className="quote-summary">
              <span className="eyebrow">Reference only</span>
              <h2>Product estimate</h2>
              <strong>USD {referenceTotal.toFixed(2)}</strong>
              {hasUnpricedLine ? <p>Plus products priced on quote.</p> : null}
              <p>
                This is not checkout. Taxes, freight and final commercial terms
                are not included in this reference estimate.
              </p>
            </aside>
          </div>
        ) : (
          <section className="quote-list-empty">
            <FileText size={31} />
            <h2>Your Quote List is empty</h2>
            <p>Choose an exact product size, then use Add to Quote.</p>
            <Link className="button button-primary" to="/">
              Browse products
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
