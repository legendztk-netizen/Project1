import type { CustomerQuoteProjection } from "../../quote-request/domain/quote-request";
import { customerQuoteProjection } from "../../quote-request/domain/quote-request";
import { ownedQuoteRequestWhere } from "../../quote-request/infrastructure/d1-quote-request-repository";

interface ProgressRow {
  request_id: string;
  order_id: string | null;
  held: number | null;
  accepted_at: string | null;
  confirmed_at: string | null;
  amount_received_cents: number | null;
  total_due_cents: number | null;
  due_at: string | null;
  receipt_history_known: number | null;
}

export async function customerPaymentProgress(
  db: D1Database,
  profileId: string,
  quotes: CustomerQuoteProjection[],
  now = new Date(),
): Promise<CustomerQuoteProjection[]> {
  if (quotes.length === 0) return quotes;
  const ids = quotes.map((quote) => quote.id);
  const rows = (
    await db
      .prepare(
        `SELECT request.id AS request_id, o.id AS order_id,guard.held,
       a.accepted_at, c.confirmed_at, pay.amount_received_cents,
       pay.total_due_cents, pay.due_at, pay.receipt_history_known
     FROM customer_quote_requests request
     LEFT JOIN proforma_invoice_heads head ON head.request_id=request.id
     LEFT JOIN pi_payment_accounts pay ON pay.pi_id=head.pi_id
     LEFT JOIN pi_acceptances a ON a.pi_id=head.pi_id
     LEFT JOIN pi_payment_confirmations c ON c.pi_id=head.pi_id
     LEFT JOIN confirmed_orders o ON o.request_id=request.id
     LEFT JOIN order_release_guards guard ON guard.order_id=o.id
     ${ownedQuoteRequestWhere} AND request.id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(profileId, profileId, profileId, ...ids)
      .all<ProgressRow>()
  ).results;
  const byRequest = new Map(rows.map((row) => [row.request_id, row]));
  return quotes.map((quote) => {
    const row = byRequest.get(quote.id);
    if (!row) return quote;
    const next =
      row.order_id && row.held === 1
        ? "PAYMENT_REVIEW_HOLD"
        : row.order_id
          ? "ORDER_CREATED"
          : row.confirmed_at && !row.accepted_at
            ? "PAYMENT_CONFIRMED"
            : row.accepted_at &&
                row.due_at &&
                Date.parse(row.due_at) < now.getTime()
              ? "PAYMENT_REVIEW_REQUIRED"
              : row.accepted_at
                ? "PAYMENT_PENDING"
                : undefined;
    return next
      ? { ...customerQuoteProjection(quote, next), orderId: row.order_id }
      : quote;
  });
}
