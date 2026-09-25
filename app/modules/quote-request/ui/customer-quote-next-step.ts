import type { CustomerQuoteProjection } from "../domain/quote-request";

export const customerQuoteStepLabels = [
  "Request submitted",
  "PI issued",
  "PI accepted and paid",
  "Order created",
] as const;

// Index of the last completed customer step (0 = request submitted).
export function customerQuoteStep(quote: CustomerQuoteProjection) {
  switch (quote.progress.code) {
    case "ORDER_CREATED":
      return 3;
    case "PAYMENT_CONFIRMED":
      return 2;
    case "PI_ACCEPTED":
    case "PAYMENT_PENDING":
    case "PAYMENT_REVIEW_REQUIRED":
    case "PAYMENT_REVIEW_HOLD":
    case "PI_ISSUED":
    case "PI_EXPIRED":
    case "PI_REPLACEMENT_REQUIRED":
      return 1;
    default:
      return 0;
  }
}

export type CustomerQuoteAction = {
  label: string;
  to: string;
  primary: boolean;
};

export function customerQuoteNextStep(quote: CustomerQuoteProjection): {
  summary: string;
  action: CustomerQuoteAction | null;
} {
  const base = `/account/quotes/${encodeURIComponent(quote.id)}`;
  const pi = { to: `${base}/pi`, primary: true };
  const conversation = {
    label: "Open conversation",
    to: `${base}/conversation`,
    primary: false,
  };
  switch (quote.progress.code) {
    case "ORDER_CREATED":
      return {
        summary: "Your order is confirmed. Track shipments on the order page.",
        action: quote.orderId
          ? {
              label: "View order",
              to: `/account/orders/${encodeURIComponent(quote.orderId)}`,
              primary: true,
            }
          : null,
      };
    case "PAYMENT_CONFIRMED":
      return {
        summary: "Payment confirmed. We're creating your order.",
        action: { ...pi, label: "View PI", primary: false },
      };
    case "PAYMENT_REVIEW_REQUIRED":
    case "PAYMENT_REVIEW_HOLD":
      return {
        summary:
          "We're reviewing your payment. Message us if you have questions.",
        action: conversation,
      };
    case "PI_ACCEPTED":
    case "PAYMENT_PENDING":
      return {
        summary: "Send payment using the instructions on the PI page.",
        action: { ...pi, label: "View payment instructions" },
      };
    case "PI_ISSUED":
      return {
        summary: "Your PI is ready. Review and accept it before it expires.",
        action: { ...pi, label: "Review PI" },
      };
    case "PI_EXPIRED":
      return {
        summary: "This PI has expired. Message us to request an updated PI.",
        action: conversation,
      };
    case "PI_REPLACEMENT_REQUIRED":
      return {
        summary: "We're preparing an updated PI for you.",
        action: { ...pi, label: "View previous PI", primary: false },
      };
    default:
      return {
        summary: quote.currentOffer
          ? "Your formal quote is ready. We'll issue the PI next."
          : "We're preparing your formal quote. Add details in the conversation.",
        action: conversation,
      };
  }
}
