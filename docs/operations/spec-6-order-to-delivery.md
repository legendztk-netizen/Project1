# Spec 6 Order-to-Delivery Local Handoff

This runbook covers the first-release Order workflow without Spec 5 factory
screens. It is a local acceptance and operational handoff, not a production
deployment or evidence that a carrier or email provider delivered anything.
Original accepted PI and Order documents remain immutable. Operational changes
are recorded separately and must never be inferred from a current catalog item.

## Pre-migration inventory

Run the read-only queries against the intended D1 environment **before**
applying new migrations. Use the configured database name and environment; do
not point the local command at preview or production by accident. Retain the
counts and the list of cases requiring manual review in the release record.

```sh
pnpm exec wrangler d1 execute hydraulic-hose-rfq-local --local --json --command \
  "SELECT (SELECT count(*) FROM confirmed_orders) AS orders_total,
   (SELECT count(*) FROM order_fulfillment_plans) AS plans_total,
   (SELECT count(*) FROM order_shipments) AS shipments_total,
   (SELECT count(*) FROM confirmed_orders o WHERE NOT EXISTS
     (SELECT 1 FROM order_fulfillment_plans p WHERE p.order_id=o.id)) AS orders_without_plan,
   (SELECT count(*) FROM order_fulfillment_plans WHERE status='review') AS plans_needing_review,
   (SELECT count(*) FROM order_shipments s WHERE NOT EXISTS
     (SELECT 1 FROM order_shipment_allocations a WHERE a.shipment_id=s.id)) AS empty_shipments,
   (SELECT count(*) FROM order_shipment_ready_schedules WHERE current_estimate_date IS NULL) AS undated_shipments,
   (SELECT count(*) FROM order_release_guards WHERE held=1) AS payment_held_orders,
   (SELECT count(*) FROM order_quantity_holds WHERE active=1) AS active_quantity_holds,
   (SELECT count(*) FROM order_assembly_production_initializations WHERE status='pending') AS dormant_production_rows;"
```

Local D1 inventory on 2026-09-24: 1 confirmed Order, 1 ready plan sourced
from the accepted together-shipment terms, 1 Shipment, 0 Orders without a
plan, 0 plans needing review, 0 empty Shipments, 1 Shipment without a current
ready-date estimate, 0 payment-held Orders, 0 active quantity holds, and 1
dormant production-initialization row. No Shipment was marked shipped or
delivered. These counts describe only the local database at that time.

An absent plan, review-status plan, empty allocation, missing calendar
evidence, payment hold, or inconsistent accepted terms requires manual review.
Do not fabricate allocations, promises, completed production, dispatch dates,
delivery dates, a customer's acceptance, or retrospective factory packages.
The pending production-initialization row is dormant in this launch; a later
Spec 5 activation must explicitly select eligible work rather than replaying
all historical pending rows.

Apply migrations with `pnpm migrate`, then verify with `pnpm migrate:verify`.
Rerunning migration verification or opening an Order must not create another
Shipment or change an accepted snapshot. Review historical plans in the Admin
Order detail, retain the original PI/Order hashes, and use the versioned review
command for an ambiguous plan.

## Daily operation

1. Use **Admin > Orders** to search, filter and open an Order. The products and
   payment tabs show the accepted commercial record; the Shipments tab shows
   the operational plan. A plan in review or a payment hold is not releasable.
2. Prepare the China business-day calendar, then record or revise each
   Shipment's estimated ready date with a reason. A missing estimate is not a
   promise. Verify factory preparation and all four readiness checks offline
   before marking a Shipment **Ready to Ship**.
3. Record actual carrier handoff with its source and carrier. Add tracking when
   available; tracking is optional and is not itself evidence of handoff.
   Record delivery from carrier/customer evidence. Split Shipments progress
   independently; use the quantity and Shipment-specific records, not the
   aggregate Order badge, for after-sales decisions.
4. For a pre-dispatch address or shipping change, the customer submits a
   request. Admin reviews the affected allocations, destination, service,
   dates, tax responsibility and exact USD adjustment; the customer accepts the
   current immutable confirmation; Admin explicitly applies it. Acceptance is
   not application. A positive adjustment is handled offline and is **not**
   system-verified cleared funds. No additional receipt evidence is required
   for application. A negative adjustment reserves a refund due for Spec 7; it
   is not a claim that money was sent.
5. Reverify readiness after an effective change invalidates an earlier ready
   check. Keep unchanged and already-dispatched Shipments out of the changed
   allocation. Goods handed to the carrier go to Support rather than this
   self-service change flow.

## Recovery and Spec 7 handoff

- On a stale version or conflict, reload the Order and review current holds and
  evidence. Retry the same command ID only for the same payload. Do not
  force-update Order, PI, allocation, event, or notification tables by hand.
- A withdrawn or declined change releases only its own quantity holds. Payment,
  cancellation, and after-sales holds remain independent. Expired proposals
  cannot be newly accepted; a proposal accepted before expiry may still be
  applied later if its terms and affected Shipments remain current.
- Payment review and fund availability use the original system-tracked PI
  funding, authorized credits and pending refund reservation. A lawful
  initiated credit refund reduces the account balance but must not create a
  false original-PI shortfall or a second refund entitlement. Positive offline
  adjustments never become system-confirmed receipts.
- Spec 7 consumes unshipped physical quantities, active holds, per-Shipment
  delivery evidence and immutable cut-hose piece lengths. It implements its
  own cancellation/return/refund decisions; this runbook does not assert that
  those screens or a bank-refund transfer are complete.
- Inspect conversation/outbox status when a notification is delayed. Retry the
  existing durable notification command; do not create a second business
  event. Local `stub` email and test carrier records are substitutes, not
  proof of external delivery.

## Verification boundary

The local test matrix covers original-order creation from both valid PI
acceptance/payment sequences, structured and historical plan initialization,
cut-hose piece counts, split Shipment progression, document privacy, date
revisions, change acceptance/application/refund reservation, payment
correction, scoped cancellation holds and idempotent notification records.
Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm migrate:verify`, `pnpm build`, and `pnpm test:smoke` from the repository
root. Production requires separate environment configuration, migration
inventory, provider checks and launch approval.
