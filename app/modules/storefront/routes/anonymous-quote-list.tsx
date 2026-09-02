import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
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
import { useState } from "react";

import type { Route } from "./+types/anonymous-quote-list";
import { createAnonymousQuoteListService } from "../../quote-list/application/anonymous-quote-list-service";
import type { DashSize } from "../../catalog/domain/dash-size";
import { QuoteListCommandRejected } from "../../quote-list/domain/anonymous-quote-list";
import { discountedMerchandiseSubtotal } from "../../quote-list/domain/quote-list-refresh";
import { evaluateRfqPreparation } from "../../quote-list/domain/rfq-preparation";
import {
  maximumStandardProductQuantity,
  parseStandardProductQuantity,
} from "../../quote-list/domain/anonymous-quote-session";
import { StorefrontHeader } from "../ui/storefront-header";
import { AccountWorkspace } from "../../customer-identity/ui/account-workspace";
import {
  createCustomerAccountService,
  CustomerAccountAccessError,
} from "../../customer-identity/application/customer-account-service";
import { requireTrustedAuthPost } from "../../customer-identity/application/trusted-auth-request";
import type { PurchasingContext } from "../../customer-identity/domain/customer-account";
import type { DeliveryAddress } from "../../customer-identity/domain/customer-account";
import { createIndividualQuoteRequestService } from "../../quote-request/application/individual-quote-request-service";
import { IndividualQuoteRequestRejected } from "../../quote-request/domain/individual-quote-request";
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
  const [result, account] = await Promise.all([
    createAnonymousQuoteListService(env).read(request),
    createCustomerAccountService(env).read(request),
  ]);
  return data(
    {
      addresses: account?.addresses ?? [],
      idempotencyKey: crypto.randomUUID(),
      lines: result.lines,
      purchasingContexts: account?.purchasingContexts ?? [],
    },
    { headers: responseHeaders(result.setCookie) },
  );
}

export async function action({ context, request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  const { env, runtime } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = textValue(form, "intent");
  const service = createAnonymousQuoteListService(env);

  try {
    if (intent === "submit_individual_quote_request") {
      requireTrustedAuthPost({
        environment: runtime.environment,
        request,
        storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
      });
      const result = await createIndividualQuoteRequestService(
        env,
      ).submitIndividual({
        accuracyConfirmed: form.get("accuracyConfirmed") === "yes",
        commercialReviewConfirmed:
          form.get("commercialReviewConfirmed") === "yes",
        idempotencyKey: textValue(form, "idempotencyKey"),
        request,
        selectedLineIds: form
          .getAll("selectedLineId")
          .filter((value): value is string => typeof value === "string"),
      });
      return redirect(
        `/quote-request/${encodeURIComponent(result.id)}/confirmation`,
      );
    }

    if (intent === "select_purchasing_context") {
      requireTrustedAuthPost({
        environment: runtime.environment,
        request,
        storefrontOrigin: env.PUBLIC_STOREFRONT_ORIGIN,
      });
      const result = await createCustomerAccountService(
        env,
      ).selectPurchasingContext({
        contextId: textValue(form, "contextId"),
        request,
      });
      if (!result) {
        return redirect(
          `/sign-in?returnTo=${encodeURIComponent("/quote-list")}`,
        );
      }
      return redirect("/quote-list");
    }

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
    if (error instanceof CustomerAccountAccessError) {
      return data(
        { formError: "The selected purchasing context is not available." },
        { status: 404 },
      );
    }
    if (error instanceof IndividualQuoteRequestRejected) {
      if (error.code === "AUTHENTICATION_REQUIRED") {
        return redirect(
          `/sign-in?returnTo=${encodeURIComponent("/quote-list")}`,
        );
      }
      return data({ formError: error.message }, { status: 422 });
    }
    if (error instanceof QuoteListCommandRejected) {
      return data({ formError: error.message }, { status: 409 });
    }
    throw error;
  }
}

function contextName(context: PurchasingContext) {
  if (context.kind === "individual") return "Individual purchase";
  return context.tradeName || context.legalName || "Organization purchase";
}

function RfqPreparation({
  addresses,
  busy,
  hasBlockedLine,
  idempotencyKey,
  merchandiseSubtotal,
  purchasingContexts,
  selectedLineIds,
  serviceFeeTotal,
}: {
  addresses: DeliveryAddress[];
  busy: boolean;
  hasBlockedLine: boolean;
  idempotencyKey: string;
  merchandiseSubtotal: number;
  purchasingContexts: PurchasingContext[];
  selectedLineIds: string[];
  serviceFeeTotal: number;
}) {
  const selectedContext =
    purchasingContexts.find((context) => context.isSelected) ?? null;
  const selectedAddress =
    addresses.find((address) => address.isSelected) ?? null;
  const evaluation = evaluateRfqPreparation({
    amounts: {
      duties: null,
      freight: null,
      importCharges: null,
      insurance: null,
      merchandise: merchandiseSubtotal,
      serviceFees: serviceFeeTotal,
      tax: null,
    },
    pricingComplete: !hasBlockedLine,
    purchasingContextKind: selectedContext?.kind ?? null,
  });
  const outcome = evaluation.outcome;
  const selectionEmpty = selectedLineIds.length === 0;

  return (
    <section
      className="rfq-preparation"
      aria-labelledby="rfq-preparation-title"
    >
      <span className="eyebrow">Request preparation</span>
      <h2 id="rfq-preparation-title">Ready to request a quote?</h2>

      {purchasingContexts.length ? (
        <div className="rfq-contexts">
          <strong>Purchasing context</strong>
          {purchasingContexts.map((context) => (
            <Form className="rfq-context-option" key={context.id} method="post">
              <input
                name="intent"
                type="hidden"
                value="select_purchasing_context"
              />
              <input name="contextId" type="hidden" value={context.id} />
              <button
                aria-current={context.isSelected ? "true" : undefined}
                disabled={busy || context.isSelected}
                type="submit"
              >
                {context.kind === "organization" ? (
                  <Building2 aria-hidden="true" size={17} />
                ) : (
                  <CheckCircle2 aria-hidden="true" size={17} />
                )}
                <span>
                  <strong>{contextName(context)}</strong>
                  <small>
                    {context.isSelected
                      ? "Currently selected"
                      : "Use this context"}
                  </small>
                </span>
              </button>
            </Form>
          ))}
        </div>
      ) : null}

      <div
        className={`rfq-eligibility rfq-eligibility-${outcome.allowed ? "ready" : "blocked"}`}
        role="status"
      >
        {selectionEmpty ? (
          <>
            <strong>Select products to continue</strong>
            <p>Choose at least one Quote List product for this request.</p>
          </>
        ) : null}
        {!selectionEmpty && outcome.code === "INCOMPLETE_PRICING" ? (
          <>
            <strong>Product review is required first</strong>
            <p>
              One or more products are unavailable, incompatible or missing a
              current reference price. Resolve the highlighted line before
              submission.
            </p>
          </>
        ) : null}
        {!selectionEmpty && outcome.code === "MINIMUM_NOT_MET" ? (
          <>
            <strong>Add more products to request a quote</strong>
            <p>
              The refreshed merchandise subtotal must reach USD 100.00. Fees and
              delivery-related charges do not count toward this minimum.
            </p>
          </>
        ) : null}
        {!selectionEmpty && outcome.code === "PURCHASING_CONTEXT_REQUIRED" ? (
          <>
            {purchasingContexts.length ? (
              <>
                <strong>Select who is purchasing</strong>
                <p>
                  Choose one of the Purchasing Contexts shown above before you
                  request a quote.
                </p>
              </>
            ) : (
              <>
                <strong>Sign in to choose who is purchasing</strong>
                <p>
                  A verified account and a Purchasing Context are required
                  before you can request a quote.
                </p>
                <Link
                  className="button button-secondary"
                  to="/sign-in?returnTo=%2Fquote-list"
                >
                  Sign in
                </Link>
              </>
            )}
          </>
        ) : null}
        {!selectionEmpty && outcome.code === "ORGANIZATION_REQUIRED" ? (
          <>
            <strong>Use an Organization Purchasing Context</strong>
            <p>
              Individual quote requests are limited to USD 4,500.00 in
              merchandise. Select an organization or add one in Profile /
              Company.
            </p>
            <Link
              className="button button-secondary"
              to="/account?view=profile"
            >
              Manage organizations
            </Link>
          </>
        ) : null}
        {!selectionEmpty &&
        (outcome.code === "INDIVIDUAL_DDP" ||
          outcome.code === "ORGANIZATION_DDP") ? (
          <>
            <strong>
              Eligible to request a quote: delivered with import handling (DDP)
            </strong>
            <p>
              We arrange import clearance and include duties and import tax in
              the final quote terms. The exact delivered price is confirmed only
              after review.
            </p>
          </>
        ) : null}
        {!selectionEmpty && outcome.code === "ORGANIZATION_DAP" ? (
          <>
            <strong>
              Eligible to request a quote: customer-managed import clearance
              (DAP)
            </strong>
            <p>
              We arrange delivery to the destination. Your organization, as
              importer, handles import clearance and pays duties and import tax.
            </p>
          </>
        ) : null}
      </div>

      <dl className="rfq-preparation-facts">
        <div>
          <dt>Merchandise subtotal used</dt>
          <dd>USD {evaluation.merchandiseSubtotal.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Freight</dt>
          <dd>Calculated after quote request</dd>
        </div>
      </dl>
      <p className="rfq-preparation-disclaimer">
        This is not checkout. No payment is collected here, and no delivered
        total is shown before review.
      </p>
      {outcome.allowed && outcome.code === "INDIVIDUAL_DDP" ? (
        selectedAddress ? (
          <Form className="quote-request-form" method="post">
            <input
              name="intent"
              type="hidden"
              value="submit_individual_quote_request"
            />
            <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
            {selectedLineIds.map((lineId) => (
              <input
                key={lineId}
                name="selectedLineId"
                type="hidden"
                value={lineId}
              />
            ))}
            <div className="quote-request-destination">
              <strong>Deliver to {selectedAddress.label}</strong>
              <span>{selectedAddress.recipientName}</span>
              <span>
                {selectedAddress.addressLine1}
                {selectedAddress.addressLine2
                  ? `, ${selectedAddress.addressLine2}`
                  : ""}
              </span>
              <span>
                {selectedAddress.city}, {selectedAddress.stateProvince}{" "}
                {selectedAddress.postalCode}, {selectedAddress.countryCode}
              </span>
              <Link to="/account?view=addresses">Change address</Link>
            </div>
            <label className="quote-request-confirmation">
              <input
                disabled={busy}
                name="accuracyConfirmed"
                required
                type="checkbox"
                value="yes"
              />
              <span>
                I confirm the products, quantities and configurations shown are
                correct.
              </span>
            </label>
            <label className="quote-request-confirmation">
              <input
                disabled={busy}
                name="commercialReviewConfirmed"
                required
                type="checkbox"
                value="yes"
              />
              <span>
                I understand this submits a quote request for review. Final
                price, freight and delivery terms will be confirmed later.
              </span>
            </label>
            <button
              className="button button-primary quote-request-submit"
              disabled={busy}
              type="submit"
            >
              <FileText aria-hidden="true" size={18} />
              {busy ? "Submitting..." : "Request Quote"}
            </button>
          </Form>
        ) : (
          <div className="quote-request-address-required" role="status">
            <strong>Add a delivery address to continue</strong>
            <p>
              A complete selected destination is required before this request
              can be submitted.
            </p>
            <Link
              className="button button-secondary"
              to="/account?view=addresses"
            >
              Manage addresses
            </Link>
          </div>
        )
      ) : null}
    </section>
  );
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

function lineReadyForSubmission(
  line: Route.ComponentProps["loaderData"]["lines"][number],
) {
  return line.refresh?.status === "ready" && merchandiseEstimate(line) !== null;
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
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>(() =>
    loaderData.lines.filter(lineReadyForSubmission).map((line) => line.id),
  );
  const availableLineIds = new Set(loaderData.lines.map((line) => line.id));
  const activeSelectedLineIds = selectedLineIds.filter((lineId) =>
    availableLineIds.has(lineId),
  );
  const selectedLineIdSet = new Set(activeSelectedLineIds);
  const selectedLines = loaderData.lines.filter((line) =>
    selectedLineIdSet.has(line.id),
  );
  const referenceTotal = discountedMerchandiseSubtotal(selectedLines);
  const serviceFeeTotal = selectedLines.reduce(
    (total, line) => total + (line.refresh?.current.serviceFeeAmount ?? 0),
    0,
  );
  const hasUnpricedLine = selectedLines.some(
    (line) => merchandiseEstimate(line) == null,
  );
  const hasBlockedLine = selectedLines.some(
    (line) =>
      line.refresh?.status === "blocked" || merchandiseEstimate(line) == null,
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
                  <label className="quote-line-selection">
                    <input
                      aria-label={`Include ${line.displayName} in this quote request`}
                      checked={selectedLineIdSet.has(line.id)}
                      disabled={busy}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelectedLineIds((current) =>
                          checked
                            ? [...new Set([...current, line.id])]
                            : current.filter((lineId) => lineId !== line.id),
                        );
                      }}
                      type="checkbox"
                    />
                    <span>Include in this quote request</span>
                  </label>
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

          <div className="quote-list-sidebar">
            <aside className="quote-summary">
              <span className="eyebrow">Reference only</span>
              <h2>Selected product estimate</h2>
              <strong>USD {referenceTotal.toFixed(2)}</strong>
              <small>
                {selectedLines.length} selected · Estimated merchandise subtotal
              </small>
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
            <RfqPreparation
              addresses={loaderData.addresses}
              busy={busy}
              hasBlockedLine={hasBlockedLine}
              idempotencyKey={loaderData.idempotencyKey}
              merchandiseSubtotal={referenceTotal}
              purchasingContexts={loaderData.purchasingContexts}
              selectedLineIds={activeSelectedLineIds}
              serviceFeeTotal={serviceFeeTotal}
            />
          </div>
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
      <AccountWorkspace activeView="quote-list">{content}</AccountWorkspace>
    );
  }

  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main>{content}</main>
    </div>
  );
}
