import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, useNavigation } from "react-router";
import { LifeBuoy } from "lucide-react";

import { ShipmentActionDialog } from "../../shipment/ui/shipment-action-dialog";
import type { CaseReason, CustomerCases } from "../application/case-service";
import { etDisplayDate } from "../domain/return-policy";
import "../../shipment/ui/order-shipping-changes.css";
import { readScopedFields, scopedField } from "./scoped-fields";
import "./after-sales.css";

export const customerCaseReasonLabel: Record<CaseReason, string> = {
  convenience_return:
    "Return an unused item (change of mind or wrong selection)",
  wrong_item: "Wrong item received",
  damaged: "Arrived damaged",
  nonconforming: "Defective or not as specified",
  other: "Other problem",
};

export function readCaseLines(form: FormData) {
  const lines: Array<{
    lineId: string;
    shipmentId: string;
    physicalQuantity: number;
  }> = [];
  for (const { lineId, shipmentId, value } of readScopedFields(
    form,
    "caseQty",
  )) {
    const physicalQuantity = Number(value);
    if (!value.trim() || physicalQuantity === 0 || !shipmentId) continue;
    lines.push({ lineId, shipmentId, physicalQuantity });
  }
  return lines;
}

export function CustomerCaseAction({
  cases,
  commandId,
  actionData,
}: {
  cases: CustomerCases;
  commandId: string;
  actionData?: { error?: string };
}) {
  const [open, setOpen] = useState(false);
  const actionAtOpen = useRef(actionData);
  const submitted = useRef(false);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  useEffect(() => {
    if (navigation.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (!actionData?.error) setOpen(false);
  }, [navigation.state, actionData]);
  const claimable = cases.claimable.filter((item) => item.available > 0);
  if (!claimable.length) return null;
  return (
    <>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => {
          actionAtOpen.current = actionData;
          setOpen(true);
        }}
      >
        <LifeBuoy size={17} aria-hidden="true" />
        Request Return or Report a Problem
      </button>
      {open && (
        <ShipmentActionDialog
          language="en"
          title="Request Return or Report a Problem"
          description="Tell us which delivered items are affected. This opens a case for review; it does not authorize a return or approve a refund. Please don't send anything back until we issue a Return Authorization."
          error={
            actionData !== actionAtOpen.current ? actionData?.error : undefined
          }
          onClose={() => setOpen(false)}
          onSubmitted={() => {
            submitted.current = true;
          }}
        >
          <Form
            method="post"
            encType="multipart/form-data"
            className="shipping-change-form"
          >
            <input type="hidden" name="intent" value="case-open" />
            <input type="hidden" name="commandId" value={commandId} />
            <fieldset>
              <legend>Reason</legend>
              {(Object.keys(customerCaseReasonLabel) as CaseReason[]).map(
                (reason) => (
                  <label key={reason} className="shipping-change-choice">
                    <input
                      type="radio"
                      name="reason"
                      value={reason}
                      required
                      defaultChecked={reason === "nonconforming"}
                    />
                    {customerCaseReasonLabel[reason]}
                  </label>
                ),
              )}
            </fieldset>
            <fieldset>
              <legend>Delivered items</legend>
              <div className="after-sales-quantity-list">
                {claimable.map((item) => (
                  <label
                    key={`${item.lineId}:${item.shipmentId}`}
                    className="after-sales-quantity-row"
                  >
                    <span>
                      <strong>{item.displayName}</strong>
                      <small>
                        {item.sku} · {item.shipmentName} · delivered{" "}
                        {item.deliveredDateEt
                          ? etDisplayDate(item.deliveredDateEt)
                          : "—"}{" "}
                        · up to {item.available}
                        {item.pieceLengthFt !== null
                          ? ` pieces of ${item.pieceLengthFt} ft`
                          : ""}
                      </small>
                      <small>
                        {item.productClass !== "standard"
                          ? "Made to order: problems can be reported; convenience return is not available."
                          : item.convenienceOpen && item.convenienceCutoffDateEt
                            ? `Convenience return open until 11:59 PM ET on ${etDisplayDate(item.convenienceCutoffDateEt)}.`
                            : "Convenience return window closed; problems can still be reported."}
                      </small>
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={item.available}
                      step={1}
                      defaultValue={0}
                      name={scopedField(
                        "caseQty",
                        item.lineId,
                        item.shipmentId,
                      )}
                      aria-label={`Quantity of ${item.displayName} affected`}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Describe the issue
              <textarea name="description" required rows={4} maxLength={5000} />
            </label>
            <label>
              Photo or document (optional, PDF / PNG / JPEG, up to 10 MB)
              <input
                type="file"
                name="file"
                accept="application/pdf,image/png,image/jpeg"
              />
            </label>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
            >
              Submit
            </button>
          </Form>
        </ShipmentActionDialog>
      )}
    </>
  );
}

export function CustomerCases({
  cases,
  orderId,
  commandId,
  busy,
  error,
  renderCaseDetails,
}: {
  cases: CustomerCases;
  orderId: string;
  commandId: string;
  busy: boolean;
  error?: string;
  renderCaseDetails?: (item: CustomerCases["cases"][number]) => ReactNode;
}) {
  if (!cases.cases.length && !cases.undeliveredShipments.length) return null;
  return (
    <section className="customer-quote-section shipping-changes">
      <h2>Returns and problem reports</h2>
      {cases.undeliveredShipments.length > 0 && (
        <p>
          {cases.undeliveredShipments.join(", ")} shipped but delivery
          isn&apos;t recorded yet. For a problem with those items, message
          Support.
        </p>
      )}
      {error && (
        <p className="shipping-change-error" role="alert">
          {error}
        </p>
      )}
      <div className="shipping-change-history">
        {cases.cases.map((item) => (
          <article key={item.id} className="shipping-change-record">
            <div className="shipping-change-record-heading">
              <strong>
                Case {item.caseNumber} ·{" "}
                {customerCaseReasonLabel[item.reason as CaseReason]}
              </strong>
              <span>{item.status === "open" ? "Open" : "Closed"}</span>
            </div>
            <ul className="after-sales-line-list">
              {item.lines.map((line) => (
                <li key={`${line.lineId}:${line.shipmentId}`}>
                  {line.displayName} × {line.physicalQuantity} ·{" "}
                  {line.shipmentName} · delivered{" "}
                  {etDisplayDate(line.deliveredDateEt)}
                </li>
              ))}
            </ul>
            <p>{item.description}</p>
            {renderCaseDetails?.(item)}
            {item.files.length > 0 && (
              <ul className="after-sales-line-list">
                {item.files.map((file) => (
                  <li key={file.id}>
                    <a
                      href={`/account/orders/${encodeURIComponent(orderId)}/after-sales/files/${encodeURIComponent(file.id)}`}
                    >
                      {file.filename}
                    </a>
                    {file.visibility === "shared" ? " (shared by seller)" : ""}
                  </li>
                ))}
              </ul>
            )}
            <ol className="after-sales-thread">
              {item.messages.map((message) => (
                <li key={message.id}>
                  <strong>
                    {message.authorRole === "customer" ? "You" : "Seller"}
                  </strong>{" "}
                  <small>
                    {new Date(message.createdAt).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}{" "}
                    ET
                  </small>
                  <p>{message.body}</p>
                </li>
              ))}
            </ol>
            <Form
              method="post"
              encType="multipart/form-data"
              className="shipping-change-withdraw"
            >
              <input type="hidden" name="intent" value="case-reply" />
              <input type="hidden" name="caseId" value={item.id} />
              <input type="hidden" name="commandId" value={commandId} />
              <label>
                Reply in this case
                <textarea name="body" required rows={2} maxLength={5000} />
              </label>
              <label>
                Attach a photo or document (optional)
                <input
                  type="file"
                  name="file"
                  accept="application/pdf,image/png,image/jpeg"
                />
              </label>
              <button className="button button-secondary" disabled={busy}>
                Send reply
              </button>
            </Form>
          </article>
        ))}
      </div>
    </section>
  );
}
