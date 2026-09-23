// These predicates apply only to the exact accepted PI and the reviewed quote head.
export const retainedAgreementSql = (pi: string) =>
  `EXISTS(SELECT 1 FROM retained_pi_agreements retained WHERE retained.pi_id=${pi}.id)`;

export const unspecifiedPaymentDeadlineSql = (pi: string) =>
  `EXISTS(SELECT 1 FROM retained_pi_agreements retained WHERE retained.pi_id=${pi}.id AND retained.no_payment_deadline=1)`;

export const effectiveQuoteAgreementSql = (pi: string) =>
  `(${pi}.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=${pi}.request_id ORDER BY revision_number DESC LIMIT 1) OR ${retainedAgreementSql(pi)})`;
