import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { MapPin, Truck } from "lucide-react";
import { ShipmentActionDialog } from "./shipment-action-dialog";
import type { ProformaInvoiceSnapshot } from "../../proforma-invoice/domain/proforma-invoice";
import type { createOrderShippingChangeService } from "../application/order-shipping-change-service";
import "./order-shipping-changes.css";
import "./shipment-documents.css";

type Change = Awaited<
  ReturnType<
    ReturnType<typeof createOrderShippingChangeService>["customerRead"]
  >
>[number];
type Destination = ProformaInvoiceSnapshot["destination"];

const statusLabel: Record<string, string> = {
  pending_review: "Waiting for seller review",
  proposed: "Your acceptance needed",
  accepted: "Accepted; waiting for seller to apply",
  effective: "Change effective",
  withdrawn: "Withdrawn",
  declined: "Declined",
};
const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}USD ${(Math.abs(cents) / 100).toFixed(2)}`;

type ChangeKind = "delivery_address" | "shipping_plan";
type OrderShipment = {
  id: string;
  displayName: string;
  status: string;
  version: number;
  held: boolean;
};

const kindCopy: Record<
  ChangeKind,
  { button: string; title: string; description: string }
> = {
  delivery_address: {
    button: "Change delivery address",
    title: "Request a delivery address change",
    description:
      "The seller reviews your request and sends a change confirmation for you to accept. Your saved address book is not changed.",
  },
  shipping_plan: {
    button: "Change shipping plan",
    title: "Request a shipping plan change",
    description:
      "Describe the split, service or timing you need. The seller reviews any cost or date effect and sends a change confirmation for you to accept.",
  },
};

function eligibleShipments(shipments: OrderShipment[]) {
  return shipments.filter(
    (shipment) =>
      ["planned", "ready_to_ship"].includes(shipment.status) && !shipment.held,
  );
}

export function CustomerShippingChangeActions({
  shipments,
  destination,
  commandId,
  actionData,
}: {
  shipments: OrderShipment[];
  destination: Destination;
  commandId: string;
  actionData?: { error?: string };
}) {
  const [kind, setKind] = useState<ChangeKind | null>(null);
  const actionAtOpen = useRef(actionData);
  const submitted = useRef(false);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  useEffect(() => {
    if (navigation.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (!actionData?.error) setKind(null);
  }, [navigation.state, actionData]);
  const eligible = eligibleShipments(shipments);
  if (!eligible.length) return null;
  return (
    <div className="customer-order-actions">
      {(["delivery_address", "shipping_plan"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="button button-secondary"
          onClick={() => {
            actionAtOpen.current = actionData;
            setKind(option);
          }}
        >
          {option === "delivery_address" ? (
            <MapPin size={17} aria-hidden="true" />
          ) : (
            <Truck size={17} aria-hidden="true" />
          )}
          {kindCopy[option].button}
        </button>
      ))}
      {kind && (
        <ShipmentActionDialog
          key={kind}
          language="en"
          title={kindCopy[kind].title}
          description={kindCopy[kind].description}
          error={
            actionData !== actionAtOpen.current ? actionData?.error : undefined
          }
          onClose={() => setKind(null)}
          onSubmitted={() => {
            submitted.current = true;
          }}
        >
          <Form method="post" className="shipping-change-form">
            <input type="hidden" name="intent" value="shipping-change-submit" />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="commandId" value={commandId} />
            <fieldset>
              <legend>Affected shipments</legend>
              {eligible.map((shipment) => (
                <label key={shipment.id} className="shipping-change-choice">
                  <input
                    type="checkbox"
                    name="shipmentId"
                    value={shipment.id}
                    defaultChecked={eligible.length === 1}
                  />
                  <span>{shipment.displayName}</span>
                  <input
                    type="hidden"
                    name={`shipmentVersion:${shipment.id}`}
                    value={shipment.version}
                  />
                </label>
              ))}
            </fieldset>
            {kind === "delivery_address" && (
              <div className="shipping-change-fields">
                <label>
                  Recipient
                  <input
                    name="recipientName"
                    required
                    defaultValue={destination.recipientName}
                  />
                </label>
                <label>
                  Address line 1
                  <input
                    name="addressLine1"
                    required
                    defaultValue={destination.addressLine1}
                  />
                </label>
                <label>
                  Address line 2
                  <input
                    name="addressLine2"
                    defaultValue={destination.addressLine2 ?? ""}
                  />
                </label>
                <label>
                  City
                  <input name="city" required defaultValue={destination.city} />
                </label>
                <label>
                  State / Province
                  <input
                    name="stateProvince"
                    required
                    defaultValue={destination.stateProvince}
                  />
                </label>
                <label>
                  Postal code
                  <input
                    name="postalCode"
                    required
                    defaultValue={destination.postalCode}
                  />
                </label>
                <label>
                  Country code
                  <input
                    name="countryCode"
                    required
                    maxLength={2}
                    defaultValue={destination.countryCode}
                  />
                </label>
                <label>
                  Phone
                  <input
                    name="recipientPhone"
                    defaultValue={destination.recipientPhone ?? ""}
                  />
                </label>
                <label>
                  Email
                  <input
                    name="recipientEmail"
                    type="email"
                    defaultValue={destination.recipientEmail ?? ""}
                  />
                </label>
              </div>
            )}
            <label>
              What needs to change?
              <textarea name="note" required rows={3} />
            </label>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
            >
              Submit change request
            </button>
          </Form>
        </ShipmentActionDialog>
      )}
    </div>
  );
}

export function CustomerOrderShippingChanges({
  changes,
  shipments,
  commandId,
  busy,
  error,
}: {
  changes: Change[];
  shipments: OrderShipment[];
  commandId: string;
  busy: boolean;
  error?: string;
}) {
  if (!changes.length) return null;
  const shipmentName = (id: string) =>
    shipments.find((shipment) => shipment.id === id)?.displayName ?? id;
  return (
    <section className="customer-quote-section shipping-changes">
      <h2>Change requests</h2>
      {error && (
        <p className="shipping-change-error" role="alert">
          {error}
        </p>
      )}
      <div className="shipping-change-history">
        {changes.map((change) => {
          const current = change.proposals.find(
            (proposal) => proposal.id === change.currentProposalId,
          );
          const expired =
            current && Date.parse(current.expiresAt) <= Date.now();
          return (
            <article key={change.id} className="shipping-change-record">
              <div className="shipping-change-record-heading">
                <strong>
                  {change.kind === "delivery_address"
                    ? "Delivery address"
                    : "Shipping plan"}
                </strong>
                <span>{statusLabel[change.status] ?? change.status}</span>
              </div>
              <p>{change.requested.note}</p>
              <p>
                Affected:{" "}
                {change.shipments
                  .map((shipment) => shipmentName(shipment.shipmentId))
                  .join(", ")}
              </p>
              {current && (
                <div className="shipping-change-proposal">
                  <h4>Order Change Confirmation · Version {current.version}</h4>
                  <p>{current.reason}</p>
                  <p>
                    Adjustment: {money(current.adjustmentCents)} · Expires{" "}
                    {new Date(current.expiresAt).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}{" "}
                    ET
                  </p>
                  {current.after.shipments.map((shipment) => {
                    const before = current.before.shipments.find(
                      (item) => item.shipmentId === shipment.shipmentId,
                    );
                    const terms = (item: typeof shipment) => (
                      <dl className="shipping-change-summary">
                        <div>
                          <dt>Destination</dt>
                          <dd>
                            {item.destination.recipientName} ·{" "}
                            {item.destination.addressLine1},{" "}
                            {item.destination.city},{" "}
                            {item.destination.stateProvince}{" "}
                            {item.destination.postalCode},{" "}
                            {item.destination.countryCode}
                          </dd>
                        </div>
                        <div>
                          <dt>Service</dt>
                          <dd>
                            {item.carrierName || "Carrier pending"} ·{" "}
                            {item.serviceName || item.transportMethod}
                          </dd>
                        </div>
                        <div>
                          <dt>Terms</dt>
                          <dd>
                            {item.incoterm} · {item.namedPlace} ·{" "}
                            {item.destinationTaxTreatment}
                          </dd>
                        </div>
                        <div>
                          <dt>Estimated ready date</dt>
                          <dd>{item.readyDate ?? "Not recorded"}</dd>
                        </div>
                        <div>
                          <dt>Quantities</dt>
                          <dd>
                            {item.allocations
                              .map(
                                (allocation) =>
                                  `${allocation.lineId}: ${allocation.physicalQuantity}`,
                              )
                              .join(" · ")}
                          </dd>
                        </div>
                      </dl>
                    );
                    return (
                      <section
                        key={shipment.shipmentId}
                        className="shipping-change-comparison-section"
                      >
                        <h5>{shipmentName(shipment.shipmentId)}</h5>
                        <div className="shipping-change-comparison">
                          <div>
                            <strong>Current</strong>
                            {before && terms(before)}
                          </div>
                          <div>
                            <strong>Proposed</strong>
                            {terms(shipment)}
                          </div>
                        </div>
                      </section>
                    );
                  })}
                  {current.adjustmentCents > 0 && (
                    <p>
                      The seller handles any additional payment offline.
                      Accepting this change does not confirm payment.
                    </p>
                  )}
                  {change.status === "proposed" && expired && (
                    <p role="status">
                      This confirmation has expired. Ask the seller for a
                      revised version.
                    </p>
                  )}
                  {change.status === "proposed" && !expired && (
                    <Form method="post" className="shipping-change-accept">
                      <input
                        type="hidden"
                        name="intent"
                        value="shipping-change-accept"
                      />
                      <input type="hidden" name="requestId" value={change.id} />
                      <input
                        type="hidden"
                        name="proposalId"
                        value={current.id}
                      />
                      <input
                        type="hidden"
                        name="proposalHash"
                        value={current.proposalHash}
                      />
                      <input
                        type="hidden"
                        name="expectedVersion"
                        value={change.version}
                      />
                      <input type="hidden" name="commandId" value={commandId} />
                      <label className="shipping-change-choice">
                        <input type="checkbox" name="acceptTerms" required />I
                        accept this exact change version and its adjusted terms.
                      </label>
                      <button className="button button-primary" disabled={busy}>
                        Accept change
                      </button>
                    </Form>
                  )}
                  {change.status === "effective" && current.refundDueCents && (
                    <p>
                      {current.refundInitiatedCents > 0 &&
                        `Refund initiated: ${money(current.refundInitiatedCents)}. `}
                      {current.refundDueCents > current.refundInitiatedCents
                        ? `Refund pending: ${money(current.refundDueCents - current.refundInitiatedCents)}.`
                        : "No refund amount remains pending."}
                    </p>
                  )}
                </div>
              )}
              {["pending_review", "proposed", "accepted"].includes(
                change.status,
              ) && (
                <Form method="post" className="shipping-change-withdraw">
                  <input
                    type="hidden"
                    name="intent"
                    value="shipping-change-withdraw"
                  />
                  <input type="hidden" name="requestId" value={change.id} />
                  <input
                    type="hidden"
                    name="expectedVersion"
                    value={change.version}
                  />
                  <input type="hidden" name="commandId" value={commandId} />
                  <label>
                    Reason for withdrawal
                    <input name="reason" required />
                  </label>
                  <button className="button button-secondary" disabled={busy}>
                    Withdraw request
                  </button>
                </Form>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
