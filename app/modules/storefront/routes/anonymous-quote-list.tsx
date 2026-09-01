import {
  AlertCircle,
  ArrowLeft,
  Copy,
  FileText,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  Form,
  Link,
  data,
  redirect,
  useNavigation,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/anonymous-quote-list";
import { createAnonymousQuoteListService } from "../../quote-list/application/anonymous-quote-list-service";
import type { DashSize } from "../../catalog/domain/dash-size";
import { QuoteListCommandRejected } from "../../quote-list/domain/anonymous-quote-list";
import { discountedMerchandiseSubtotal } from "../../quote-list/domain/quote-list-refresh";
import {
  maximumStandardProductQuantity,
  parseStandardProductQuantity,
} from "../../quote-list/domain/anonymous-quote-session";
import { StorefrontHeader } from "../ui/storefront-header";
import { AccountWorkspace } from "../../customer-identity/ui/account-workspace";
import type { RootLoaderData } from "../../../root";
import { hoseSizeLabel } from "../domain/variant-label";
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

    if (intent === "update-length-hose") {
      const lineId = textValue(form, "lineId");
      const pieceCount = parseStandardProductQuantity(form.get("pieceCount"));
      if (pieceCount === null) {
        return data(
          {
            lineId,
            pieceCountError: "Pieces must be a whole number from 1 to 9,999.",
          },
          { status: 422 },
        );
      }
      const result = await service.updateLengthBasedHose(
        request,
        lineId,
        pieceCount,
      );
      return redirect("/quote-list", {
        headers: responseHeaders(result.setCookie),
      });
    }

    if (intent === "update-configured-assembly") {
      const quantity = parseStandardProductQuantity(form.get("quantity"));
      if (quantity === null) {
        throw new QuoteListCommandRejected(
          "Quantity must be a whole number from 1 to 9,999.",
          "INVALID_QUANTITY",
        );
      }
      const result = await service.updateConfiguredAssemblyQuantity(
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

function merchandiseEstimate(
  line: Route.ComponentProps["loaderData"]["lines"][number],
) {
  if (line.refresh) {
    return line.refresh.current.discountedMerchandiseAmount;
  }
  if (line.lineKind === "length_based_hose") {
    return line.estimatedMerchandiseAmount;
  }
  if (line.lineKind === "configured_assembly") {
    return line.currentEstimateAmount;
  }
  return lineSubtotal(line.quantity, line.referenceUnitPrice);
}

function configuredHoseSize(
  line: Extract<
    Route.ComponentProps["loaderData"]["lines"][number],
    { lineKind: "configured_assembly" }
  >,
) {
  const hose = line.configuredAssembly.snapshot.configuration.hose;
  const dash =
    hose.dash && /^-\d+$/u.test(hose.dash) ? (hose.dash as DashSize) : null;
  return hoseSizeLabel(hose.nominalIdIn, dash) ?? "Not available";
}

export function QuoteListContent({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const referenceTotal = discountedMerchandiseSubtotal(loaderData.lines);
  const serviceFeeTotal = loaderData.lines.reduce(
    (total, line) => total + (line.refresh?.current.serviceFeeAmount ?? 0),
    0,
  );
  const hasUnpricedLine = loaderData.lines.some(
    (line) => merchandiseEstimate(line) == null,
  );

  return (
    <div className="quote-list-page">
      <Link className="product-back-link" to="/">
        <ArrowLeft size={17} /> Continue browsing
      </Link>

      <header className="quote-list-heading">
        <div>
          <span className="eyebrow">Selection workspace</span>
          <h1>Quote List</h1>
          <p>
            Review quantities here. Final price, freight and delivery terms are
            confirmed after you submit a quote request.
          </p>
        </div>
        <span className="quote-line-count">
          {loaderData.lines.length} line
          {loaderData.lines.length === 1 ? "" : "s"}
        </span>
      </header>

      {actionData && "formError" in actionData ? (
        <p className="quote-list-error" role="alert">
          <AlertCircle size={18} /> {actionData.formError}
        </p>
      ) : null}

      {loaderData.lines.length ? (
        <div className="quote-list-layout">
          <section className="quote-lines" aria-label="Quote List products">
            {loaderData.lines.map((line) => {
              const subtotal = merchandiseEstimate(line);
              const pieceCountError =
                actionData &&
                "lineId" in actionData &&
                actionData.lineId === line.id
                  ? actionData.pieceCountError
                  : null;
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
                    {line.lengthOrder ? (
                      <p className="quote-line-length">
                        <strong>Made to order</strong>
                        <span>
                          {line.lengthOrder.originalLengthValue} ft x{" "}
                          {line.lengthOrder.pieceCount}{" "}
                          {line.lengthOrder.pieceCount === 1
                            ? "piece"
                            : "pieces"}{" "}
                          = {line.lengthOrder.totalFootage} total ft
                        </span>
                      </p>
                    ) : null}
                    {line.lineKind === "configured_assembly" ? (
                      <>
                        <dl className="quote-configured-assembly-specs">
                          <div>
                            <dt>Hose size</dt>
                            <dd>{configuredHoseSize(line)}</dd>
                          </div>
                          <div>
                            <dt>End A</dt>
                            <dd>
                              {line.configuredAssembly.snapshot.configuration
                                .endA?.hoseEnd.displayName ?? "Not available"}
                            </dd>
                          </div>
                          <div>
                            <dt>End B</dt>
                            <dd>
                              {line.configuredAssembly.snapshot.configuration
                                .endB?.hoseEnd.displayName ?? "Not available"}
                            </dd>
                          </div>
                          <div>
                            <dt>Finished length</dt>
                            <dd>
                              {line.configuredAssembly.snapshot.configuration
                                .finishedLength?.originalValue ?? ""}{" "}
                              {line.configuredAssembly.snapshot.configuration
                                .finishedLength?.originalUnit ?? ""}
                            </dd>
                          </div>
                          <div>
                            <dt>Measurement</dt>
                            <dd>
                              {line.configuredAssembly.snapshot.configuration
                                .measurementSelection?.state === "selected"
                                ? `${line.configuredAssembly.snapshot.configuration.measurementSelection.method.code} · ${line.configuredAssembly.snapshot.configuration.measurementSelection.method.displayName}`
                                : "Not Sure · Technical review included"}
                            </dd>
                          </div>
                          <div>
                            <dt>Clocking</dt>
                            <dd>
                              {line.configuredAssembly.snapshot.configuration
                                .clocking?.status === "specified"
                                ? `${line.configuredAssembly.snapshot.configuration.clocking.targetDisplay}° · ±${line.configuredAssembly.snapshot.configuration.clocking.standardToleranceDegrees}°`
                                : line.configuredAssembly.snapshot.configuration
                                      .clocking
                                  ? "Not Sure · Technical review included"
                                  : "Not applicable"}
                            </dd>
                          </div>
                          <div>
                            <dt>Protection</dt>
                            <dd>
                              {line.configuredAssembly.snapshot.configuration
                                .installedProtection?.publicName ??
                                "Not available"}
                            </dd>
                          </div>
                          <div>
                            <dt>Review</dt>
                            <dd>
                              {line.configuredAssembly.snapshot.review
                                .outcome === "technical_review"
                                ? "Technical review included"
                                : "Configuration complete"}
                            </dd>
                          </div>
                        </dl>
                        {line.configuredAssembly.currentIssue ? (
                          <p
                            className="quote-configured-current-issue"
                            role="status"
                          >
                            <AlertCircle aria-hidden="true" size={17} />
                            {line.configuredAssembly.currentIssue}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {line.refresh?.blockingReasons.length ? (
                      <div
                        className="quote-line-refresh-blockers"
                        role="status"
                      >
                        <strong>
                          <AlertCircle aria-hidden="true" size={17} /> Review
                          required
                        </strong>
                        {line.refresh.blockingReasons.map((reason) => (
                          <p key={reason.code}>{reason.message}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="quote-line-price">
                    <span>Current merchandise estimate</span>
                    <strong>
                      {subtotal == null
                        ? line.lineKind === "configured_assembly"
                          ? "Price confirmed with quote"
                          : "Price on quote"
                        : `${line.currency} ${subtotal.toFixed(2)}`}
                    </strong>
                    <small>
                      {line.lineKind === "configured_assembly"
                        ? line.refresh?.current.unitReferencePrice == null
                          ? "Reference inputs are incomplete"
                          : `${line.currency} ${line.refresh.current.unitReferencePrice.toFixed(2)} / assembly`
                        : line.refresh?.current.unitReferencePrice == null
                          ? "No reference unit price"
                          : `${line.currency} ${line.refresh.current.unitReferencePrice.toFixed(2)} / ${line.salesUnit}`}
                    </small>
                    {line.refresh?.current.serviceFeeAmount != null &&
                    line.refresh.current.serviceFeeAmount > 0 ? (
                      <small>
                        {line.lineKind === "length_based_hose"
                          ? "Cutting & Labeling Fee"
                          : "Assembly service fees"}{" "}
                        (excluded from merchandise subtotal): {line.currency}{" "}
                        {line.refresh.current.serviceFeeAmount.toFixed(2)}
                      </small>
                    ) : null}
                    {line.refresh?.changed ? (
                      <div className="quote-line-price-change">
                        <span>Estimate updated</span>
                        <small>
                          Former merchandise: {line.currency}{" "}
                          {line.refresh.former.discountedMerchandiseAmount ==
                          null
                            ? "not available"
                            : line.refresh.former.discountedMerchandiseAmount.toFixed(
                                2,
                              )}
                        </small>
                        <small>
                          Current merchandise: {line.currency}{" "}
                          {line.refresh.current.discountedMerchandiseAmount ==
                          null
                            ? "not available"
                            : line.refresh.current.discountedMerchandiseAmount.toFixed(
                                2,
                              )}
                        </small>
                        {line.refresh.former.serviceFeeAmount !==
                        line.refresh.current.serviceFeeAmount ? (
                          <>
                            <small>
                              Former service fees: {line.currency}{" "}
                              {line.refresh.former.serviceFeeAmount == null
                                ? "not available"
                                : line.refresh.former.serviceFeeAmount.toFixed(
                                    2,
                                  )}
                            </small>
                            <small>
                              Current service fees: {line.currency}{" "}
                              {line.refresh.current.serviceFeeAmount == null
                                ? "not available"
                                : line.refresh.current.serviceFeeAmount.toFixed(
                                    2,
                                  )}
                            </small>
                          </>
                        ) : null}
                        {line.refresh.former.discountPercent !==
                        line.refresh.current.discountPercent ? (
                          <>
                            <small>
                              Former discount:{" "}
                              {line.refresh.former.discountPercent.toFixed(2)}%
                            </small>
                            <small>
                              Current discount:{" "}
                              {line.refresh.current.discountPercent.toFixed(2)}%
                            </small>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="quote-line-actions">
                    {line.lineKind !== "configured_assembly" ? (
                      <Form method="post">
                        <input
                          name="intent"
                          type="hidden"
                          value={
                            line.lineKind === "length_based_hose"
                              ? "update-length-hose"
                              : "update"
                          }
                        />
                        <input name="lineId" type="hidden" value={line.id} />
                        <label htmlFor={`quantity-${line.id}`}>
                          {line.lineKind === "length_based_hose"
                            ? "Number of pieces"
                            : "Quantity"}
                        </label>
                        <div>
                          <input
                            aria-describedby={
                              pieceCountError
                                ? `quantity-error-${line.id}`
                                : undefined
                            }
                            aria-invalid={Boolean(pieceCountError)}
                            defaultValue={
                              line.lengthOrder?.pieceCount ?? line.quantity
                            }
                            disabled={busy}
                            id={`quantity-${line.id}`}
                            max={maximumStandardProductQuantity}
                            min="1"
                            name={
                              line.lineKind === "length_based_hose"
                                ? "pieceCount"
                                : "quantity"
                            }
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
                        {pieceCountError ? (
                          <small
                            className="quote-line-field-error"
                            id={`quantity-error-${line.id}`}
                            role="alert"
                          >
                            {pieceCountError}
                          </small>
                        ) : null}
                      </Form>
                    ) : (
                      <>
                        <Form method="post">
                          <input
                            name="intent"
                            type="hidden"
                            value="update-configured-assembly"
                          />
                          <input name="lineId" type="hidden" value={line.id} />
                          <label htmlFor={`quantity-${line.id}`}>
                            Quantity
                          </label>
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
                        <div className="quote-configured-edit-actions">
                          <Link
                            className="button button-secondary"
                            to={`/build-a-hose?mode=edit&quoteLine=${encodeURIComponent(line.id)}`}
                          >
                            <Pencil aria-hidden="true" size={17} /> Edit
                            Configuration
                          </Link>
                          <Link
                            className="button button-secondary"
                            to={`/build-a-hose?mode=duplicate&quoteLine=${encodeURIComponent(line.id)}`}
                          >
                            <Copy aria-hidden="true" size={17} /> Duplicate and
                            Edit
                          </Link>
                        </div>
                      </>
                    )}
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
            <small>Estimated merchandise subtotal</small>
            {serviceFeeTotal > 0 ? (
              <p>Reference service fees: USD {serviceFeeTotal.toFixed(2)}</p>
            ) : null}
            {hasUnpricedLine ? <p>Plus products priced on quote.</p> : null}
            <p>
              This is not checkout. Service fees, freight, tax, duties, import
              charges and insurance do not count toward the merchandise
              subtotal.
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
    </div>
  );
}

export default function AnonymousQuoteList(props: Route.ComponentProps) {
  const rootData = useRouteLoaderData<RootLoaderData>("root");
  const content = <QuoteListContent {...props} />;

  if (rootData?.customer) {
    return (
      <AccountWorkspace activeSection="quote-list">{content}</AccountWorkspace>
    );
  }

  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main>{content}</main>
    </div>
  );
}
