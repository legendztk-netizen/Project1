import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { LifeBuoy } from "lucide-react";

import { ShipmentActionDialog } from "../../shipment/ui/shipment-action-dialog";
import type { CaseReason, CustomerCases } from "../application/case-service";
import { etDisplayDate } from "../domain/return-policy";
import "../../shipment/ui/order-shipping-changes.css";
import { scopedField } from "../application/parse-after-sales-forms";
import "./after-sales.css";

export const customerCaseReasonLabel: Record<CaseReason, string> = {
  convenience_return:
    "Return an unused item (change of mind or wrong selection)",
  wrong_item: "Wrong item received",
  damaged: "Arrived damaged",
  nonconforming: "Defective or not as specified",
  other: "Other problem",
};

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
  // Offer a convenience return only when some delivered item still qualifies.
  const reasons = (Object.keys(customerCaseReasonLabel) as CaseReason[]).filter(
    (reason) =>
      reason !== "convenience_return" ||
      claimable.some(
        (item) => item.productClass === "standard" && item.convenienceOpen,
      ),
  );
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
              {reasons.map((reason) => (
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
              ))}
              {!reasons.includes("convenience_return") && (
                <small>
                  Returning an unused item isn&apos;t available for these items
                  (made to order, cut to length, or past the 14-day window).
                  Problems can still be reported.
                </small>
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
