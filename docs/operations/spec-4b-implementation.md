# Spec 4B: Manual Payment and Confirmed Order

Status: local implementation acceptance completed. This runbook does not authorize production deployment or attest to real bank settlement.

## Legacy inventory before migration

Take a D1 backup and run these read-only queries against the deployment target before applying migrations 0081-0091. Save the counts and affected PI IDs in the deployment record. Do not infer a payment deadline, receipt amount, or product evidence from a current catalog record.

```sql
SELECT p.id, p.document_number, p.request_id,
  json_extract(p.snapshot_json, '$.paymentTerms.kind') AS payment_term_kind,
  json_extract(p.snapshot_json, '$.totals.totalCents') AS total_cents,
  CASE WHEN json_type(p.snapshot_json, '$.lines') = 'array'
    THEN json_array_length(p.snapshot_json, '$.lines') ELSE NULL END AS line_count,
  (SELECT COUNT(*) FROM pi_acceptances a WHERE a.pi_id = p.id) AS acceptance_count
FROM proforma_invoices p ORDER BY p.issued_at, p.id;
```

After migration, identify review cases:

```sql
SELECT p.id, p.document_number, a.term_kind, a.receipt_history_known,
  a.due_at, a.amount_received_cents,
  (SELECT COUNT(*) FROM pi_original_currency_receipts r WHERE r.pi_id=p.id) AS foreign_receipts
FROM proforma_invoices p JOIN pi_payment_accounts a ON a.pi_id=p.id
WHERE a.term_kind='legacy_review' OR a.receipt_history_known=0
  OR (SELECT COUNT(*) FROM json_each(p.snapshot_json,'$.lines') line
      WHERE json_type(line.value,'$.product') IS NULL)>0
ORDER BY p.issued_at,p.id;
```

Legacy PIs without immutable payment terms initially stay under manual review. A zero in the new account is **unknown historical receipt evidence**, not proof that nothing was paid. Reconcile against seller-controlled bank/PayPal records and reissue a PI with explicit terms and fresh acceptance where the old agreement cannot be established. No migration confirms Cleared Funds or creates Orders for old records.

### Retain an accepted agreement

The Admin payments workspace provides **Use the customer's accepted PI**. An administrator must review the exact accepted document and record a reason. The append-only review binds the PI version/hash, acceptance, payment version, and latest published quote. It does not modify the PI, PDF, acceptance, receipt balance, or order status.

For a verified legacy PI whose immutable snapshot has no payment terms, the approved rule is **no payment deadline agreed**. No date is inferred or inserted. Full net funds, external settlement verification, technical approval, and dispute guards still apply before payment confirmation and order creation. A PI with a known deadline retains that deadline and the existing late-payment review requirements.

A later published quote invalidates the retention review until reviewed again. A superseded PI cannot be restored using this action. Pending replacement work based on the previous head version becomes stale. Identical commercial-term saves preserve the draft version; changed draft terms do not rewrite issued documents.

## Deployment and recovery

1. Pause Admin payment mutations and preserve a backup. Record PI/acceptance counts, latest migration, and the legacy-review inventory above.
2. Apply migrations in order through `0091_retain_accepted_pi_agreement.sql`; verify `application_schema_state.version = 92`, account count matches issued PI count, and unreviewed legacy cases remain blocked from confirmation. Confirm the late-review, transferred-fund, and accepted-agreement review guard triggers exist.
3. Deploy the Worker and perform an authorized test with a newly issued test PI: acceptance-first and payment-first each produce one Order and one initialization per frozen line. Verify customer ownership and notification outbox rows.
4. Re-enable payment mutations only after Admin/customer read paths and the release-gate query are healthy. Monitor failed notification deliveries separately from committed business events.
5. On mismatch, stop new payment mutations and retain the database/backup for investigation. Reconcile by immutable event and command IDs; do not delete a confirmation, Order, allocation, refund, audit record, or acceptance to retry. A correction requires the Review Hold and Owner resolution workflow.

Downstream Spec 5/6 consumers must read `releasable_confirmed_orders`, not `confirmed_orders` alone. Initial fulfillment and assembly rows are idempotent handoff records; they do not mean production or shipping occurred. Assemblies receive production initialization, standard and cut hose lines do not.

## Acceptance evidence and limits

- `pnpm check` passed locally: 146 test files passed, 1 skipped; 1035 tests passed, 3 skipped. It also ran formatting, lint, type checking, build and a Worker dry run. Focused D1 cases cover both event orders, deduplication, source-fund conservation, late review, correction holds, Owner recovery and Follow-on RFQ submission. After adding audit IP capture, 39 focused payment/route tests, lint and type checking passed.
- Worker/D1 tests use local Miniflare storage and synthetic external-verification references. They do not verify a real bank/PayPal settlement, provider refund, or outbound email delivery.
- Browser checks used the live local Admin payment workspace and a separate, temporary `test/fixtures/pi-flow-server.ts --test-data-issued` Worker with isolated D1/R2 and TEST-only seller/payment values. The test buyer signed in through the normal local OTP preview, viewed the new PI PDF, accepted it, and saw the acceptance-only state. The Admin then recorded synthetic USD 58.00 with a TEST verification reference, saw the frozen instruction version in receipt history, confirmed payment, and found one Order by number. The buyer saw that Order, its frozen line price and specification, and an independent Follow-on Quote List draft. No real settlement, refund, payment provider or email delivery was exercised.
- Desktop and 390px mobile browser inspection covered the Admin payment workspace, Admin Order lookup/detail, customer My Quotes, PI payment progress, Orders and Follow-on Quote List. Mobile testing found long Order IDs overflowing the detail page; `.confirmed-order-number` now wraps them. A fresh isolated PI-to-Order flow rechecked both customer and Admin details at 390px: each heading's `scrollWidth` equaled its `clientWidth` (339px customer, 275px Admin), with no document horizontal overflow. The TEST fixture intentionally has no product image, so fallback rendering was verified but not live media. Existing customer data was inspected read-only; it has no Confirmed Order.
- Worker/D1 tests also cover acceptance-first/payment-first, late extension review, repeated allocations, correction holds, rollback, and Follow-on RFQ submission. Their synthetic state is not a substitute for a production bank reconciliation or deployment rehearsal.
- Reordered notification delivery must point to the current authorized PI/Order state. Outbox failure does not roll back a completed payment or Order; replay must not duplicate the underlying business event.
