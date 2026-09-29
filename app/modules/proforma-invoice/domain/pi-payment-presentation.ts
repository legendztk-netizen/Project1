import type { ProformaInvoiceSnapshot } from "./proforma-invoice";

export function piPaymentTermsText(snapshot: ProformaInvoiceSnapshot) {
  const terms = snapshot.paymentTerms;
  if (terms?.kind === "fixed_et_date")
    return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${terms.dueDateEt}T12:00:00Z`))}, 11:59 PM ET`;
  return terms?.kind === "ten_us_business_days"
    ? "Within 10 US bank business days after PI acceptance (11:59 PM ET on the tenth day)."
    : "Contact Support to confirm the payment deadline.";
}

export function piPaymentChannelLabel(channel: string) {
  return channel === "paypal" ? "PayPal" : "Bank transfer";
}
