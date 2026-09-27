import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { XCircle } from "lucide-react";

import { ShipmentActionDialog } from "../../shipment/ui/shipment-action-dialog";
import type { createCancellationService } from "../application/cancellation-service";
import "../../shipment/ui/order-shipping-changes.css";
import "./after-sales.css";

type CustomerCancellations = Awaited<
  ReturnType<ReturnType<typeof createCancellationService>["customerRead"]>
>;

const statusLabel: Record<string, string> = {
  pending_review: "Under review — these quantities are on hold",
  withdrawn: "Withdrawn",
  resolved: "Decision recorded",
};

export const cancellationQuantityField = (
  lineId: string,
  shipmentId: string | null,
) => `cancelQty:${lineId}:${shipmentId ?? ""}`;

export function readCancellationQuantities(form: FormData) {
  const quantities: Array<{
    lineId: string;
    shipmentId: string | null;
    physicalQuantity: number;
  }> = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("cancelQty:")) continue;
    const [, lineId, shipmentId] = key.split(":");
    const physicalQuantity = Number(value);
    if (!String(value).trim() || physicalQuantity === 0) continue;
    quantities.push({
      lineId,
      shipmentId: shipmentId || null,
      physicalQuantity,
    });
  }
  return quantities;
}

export function CustomerCancellationAction({
  cancellations,
  commandId,
  actionData,
}: {
  cancellations: CustomerCancellations;
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
  if (!cancellations.eligible.length) return null;
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
        <XCircle size={17} aria-hidden="true" />
        Request cancellation
      </button>
      {open && (
        <ShipmentActionDialog
          language="en"
          title="Request cancellation"
          description="Choose unshipped standard products to cancel. The selected quantities are held while the seller reviews your request; other items keep moving. Made-to-order products and cut hose need Support review."
          error={
            actionData !== actionAtOpen.current ? actionData?.error : undefined
          }
          onClose={() => setOpen(false)}
          onSubmitted={() => {
            submitted.current = true;
          }}
        >
          <Form method="post" className="shipping-change-form">
            <input type="hidden" name="intent" value="cancellation-submit" />
            <input type="hidden" name="commandId" value={commandId} />
            <fieldset>
              <legend>Quantities to cancel</legend>
              <div className="after-sales-quantity-list">
                {cancellations.eligible.map((item) => (
                  <label
                    key={`${item.lineId}:${item.shipmentId ?? ""}`}
                    className="after-sales-quantity-row"
                  >
                    <span>
                      <strong>{item.displayName}</strong>
                      <small>
                        {item.sku}
                        {item.shipmentName ? ` · ${item.shipmentName}` : ""} ·
                        up to {item.available}
                      </small>
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={item.available}
                      step={1}
                      defaultValue={0}
                      name={cancellationQuantityField(
                        item.lineId,
                        item.shipmentId,
                      )}
                      aria-label={`Quantity of ${item.displayName} to cancel`}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Reason
              <textarea name="reason" required rows={3} maxLength={2000} />
            </label>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
            >
              Submit cancellation request
            </button>
          </Form>
        </ShipmentActionDialog>
      )}
    </>
  );
}

export function CustomerCancellationRequests({
  cancellations,
  commandId,
  busy,
  error,
}: {
  cancellations: CustomerCancellations;
  commandId: string;
  busy: boolean;
  error?: string;
}) {
  if (!cancellations.requests.length) return null;
  return (
    <section className="customer-quote-section shipping-changes">
      <h2>Cancellation requests</h2>
      {error && (
        <p className="shipping-change-error" role="alert">
          {error}
        </p>
      )}
      <div className="shipping-change-history">
        {cancellations.requests.map((request) => (
          <article key={request.id} className="shipping-change-record">
            <div className="shipping-change-record-heading">
              <strong>
                Requested{" "}
                {new Date(request.createdAt).toLocaleDateString("en-US", {
                  timeZone: "America/New_York",
                  dateStyle: "medium",
                })}
              </strong>
              <span>{statusLabel[request.status] ?? request.status}</span>
            </div>
            <ul className="after-sales-line-list">
              {request.lines.map((line) => (
                <li key={`${line.lineId}:${line.shipmentId ?? ""}`}>
                  {line.displayName} × {line.physicalQuantity}
                  {line.shipmentName ? ` · ${line.shipmentName}` : ""}
                </li>
              ))}
            </ul>
            <p>{request.reason}</p>
            {request.status === "pending_review" &&
              request.origin === "customer" && (
                <Form method="post" className="shipping-change-withdraw">
                  <input
                    type="hidden"
                    name="intent"
                    value="cancellation-withdraw"
                  />
                  <input type="hidden" name="requestId" value={request.id} />
                  <input
                    type="hidden"
                    name="expectedVersion"
                    value={request.version}
                  />
                  <input type="hidden" name="commandId" value={commandId} />
                  <button className="button button-secondary" disabled={busy}>
                    Withdraw request
                  </button>
                </Form>
              )}
          </article>
        ))}
      </div>
    </section>
  );
}
