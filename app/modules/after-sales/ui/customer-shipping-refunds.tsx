import type { createRefundInitiationService } from "../application/refund-initiation-service";
import { usd } from "../domain/refund-calculation";
import { etDisplayDate } from "../domain/return-policy";
import "./after-sales.css";

type ShippingRefunds = Awaited<
  ReturnType<
    ReturnType<typeof createRefundInitiationService>["customerShippingRefunds"]
  >
>;

/**
 * Spec 6 shipping-change refunds: the approved amount, each recorded
 * initiation (date and channel) and what is still to be initiated.
 */
export function CustomerShippingRefunds({
  refunds,
}: {
  refunds: ShippingRefunds;
}) {
  if (!refunds.length) return null;
  return (
    <section className="customer-quote-section">
      <h2>Shipping change refunds</h2>
      {refunds.map((refund) => (
        <dl className="after-sales-money" key={refund.id}>
          <dt>Refund approved</dt>
          <dd>{usd(refund.refundCents)}</dd>
          {refund.initiations.map((initiation) => (
            <div key={initiation.id} style={{ display: "contents" }}>
              <dt>
                Refund initiated
                {initiation.channel
                  ? ` · ${initiation.channel === "paypal" ? "PayPal" : "Bank transfer"}`
                  : ""}
                {initiation.initiatedDateEt
                  ? ` · ${etDisplayDate(initiation.initiatedDateEt)} ET`
                  : ""}
              </dt>
              <dd>{usd(initiation.amountCents)}</dd>
            </div>
          ))}
          <dt className="after-sales-money-total">Not yet initiated</dt>
          <dd className="after-sales-money-total">
            {usd(refund.remainingCents)}
          </dd>
        </dl>
      ))}
      <p>
        We record refunds sent outside the website. Your bank or PayPal decides
        when the funds post.
      </p>
    </section>
  );
}
