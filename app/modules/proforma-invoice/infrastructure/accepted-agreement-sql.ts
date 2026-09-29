// These predicates apply only to the exact accepted PI and the reviewed quote head.
export const retainedAgreementSql = (pi: string) =>
  `EXISTS(SELECT 1 FROM retained_pi_agreements retained WHERE retained.pi_id=${pi}.id)`;

export const unspecifiedPaymentDeadlineSql = (pi: string) =>
  `EXISTS(SELECT 1 FROM retained_pi_agreements retained WHERE retained.pi_id=${pi}.id AND retained.no_payment_deadline=1)`;

export const effectiveQuoteAgreementSql = (pi: string) =>
  `(${pi}.quote_revision_id=(SELECT id FROM quote_revisions WHERE request_id=${pi}.request_id ORDER BY revision_number DESC LIMIT 1) OR ${retainedAgreementSql(pi)})`;

/** Mirrors requiresFactoryReview in quote-revision: made-to-order alone is not a review blocker. */
export const factoryReviewSatisfiedSql = (pi: string) =>
  `EXISTS(SELECT 1 FROM quote_revisions factory_quote
    WHERE factory_quote.id=${pi}.quote_revision_id AND factory_quote.request_id=${pi}.request_id
      AND (json_extract(factory_quote.snapshot_json,'$.factoryReviewConfirmed')=1
        OR NOT EXISTS(SELECT 1 FROM json_each(factory_quote.snapshot_json,'$.source.lines') factory_line
          WHERE coalesce(json_array_length(factory_line.value,'$.quotedSpecificationOverrides'),0)>0
            OR (json_extract(factory_line.value,'$.lineKind')='configured_assembly'
              AND coalesce(json_extract(factory_line.value,'$.configuredAssembly.snapshot.review.outcome'),'')!='ready'))))`;
