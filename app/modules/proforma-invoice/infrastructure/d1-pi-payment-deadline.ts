import type { ProformaInvoiceSnapshot } from "../domain/proforma-invoice";
import { acceptedPaymentDeadline } from "../domain/pi-payment-terms";

export function paymentDeadlineOnAcceptance(
  db: D1Database,
  snapshot: ProformaInvoiceSnapshot,
  input: {
    piId: string;
    acceptanceId: string;
    acceptedAt: string;
    actorId: string;
  },
) {
  if (snapshot.paymentTerms?.kind !== "ten_us_business_days") return [];
  const deadline = acceptedPaymentDeadline(
    snapshot.paymentTerms,
    input.acceptedAt,
  );
  return [
    db
      .prepare(
        `UPDATE pi_payment_accounts SET due_date_et=?,due_at=?,version=version+1,updated_at=?
         WHERE pi_id=? AND term_kind='ten_us_business_days' AND due_at IS NULL
         AND EXISTS(SELECT 1 FROM pi_acceptances a WHERE a.pi_id=? AND a.id=?)`,
      )
      .bind(
        deadline.dueDateEt,
        deadline.dueAt,
        input.acceptedAt,
        input.piId,
        input.piId,
        input.acceptanceId,
      ),
    db
      .prepare(
        `INSERT INTO pi_payment_events(id,command_id,command_hash,pi_id,kind,previous_version,next_version,
         actor_id,occurred_at,payload_json)
         SELECT ?,?,hex(randomblob(32)),pi_id,'deadline_frozen',version-1,version,?,?,?
         FROM pi_payment_accounts WHERE pi_id=? AND changes()=1`,
      )
      .bind(
        `pi-due:${input.acceptanceId}`,
        `pi-due:${input.acceptanceId}`,
        input.actorId,
        input.acceptedAt,
        JSON.stringify(deadline),
        input.piId,
      ),
  ];
}
