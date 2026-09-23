# Spec 4B: Manual Payment and Confirmed Order

> Status: Blocked. Prerequisite: Spec 4A / Issue #5.

## Problem Statement

The website has no bank-account integration and must not treat screenshots or
customer statements as money received. At the same time, payment and PI
acceptance can arrive in either order, partial or late funds must remain
traceable, and repeated administrator actions must never create duplicate
Orders.

## Solution

Provide a manual Payment module in which an authorized administrator records
externally verified amounts and confirms Cleared Funds. Evaluate the current PI,
acceptance, specification approvals, deadline, and full net amount through
guarded domain commands, then create exactly one Confirmed Order atomically when
the final missing condition is satisfied.

## User Stories

1. As an administrator, I want to see the PI customer, currency, Total Due, deadline, acceptance, and received amount together, so that I can verify the correct transaction.
2. As an administrator, I want to record one cumulative partial amount, so that a short payment remains visible without maintaining a full bank ledger.
3. As an administrator, I want to mark payment confirmed only after checking the seller-controlled receiving account, so that screenshots cannot release production.
4. As an administrator, I want a confirmation warning before recording full payment, so that I understand whether the action will create an Order.
5. As a customer, I want the remaining balance and due date shown after a partial payment is recorded, so that I know what is still required.
6. As an administrator, I want funds received before PI acceptance retained without creating an Order, so that the customer can still complete valid acceptance.
7. As a customer, I want valid acceptance after full funds to create the Order without another staff action, so that the workflow does not stall.
8. As an administrator, I want a late, expired, or superseded PI payment placed into review, so that money remains traceable without silently reviving invalid terms.
9. As an administrator, I want to change Payment Channel before any funds are recorded, so that a customer can use a workable payment method without replacing an unchanged PI.
10. As an administrator, I want to extend only to a later Payment Due Date with history, so that a deadline exception does not rewrite the accepted PI.
11. As an administrator, I want to correct an erroneous payment confirmation with a reason, so that the original event remains auditable.
12. As an administrator, I want overpayments and unresolved excess funds visible, so that they cannot disappear into a general paid total.
13. As a customer, I want a formal Order only after payment confirmation, so that Orders do not include unpaid quotes.
14. As a customer needing more products after Order creation, I want a Follow-on Quote rather than a changed Order, so that the accepted transaction remains fixed.
15. As an administrator, I want production initialization tied to Confirmed Order creation, so that no unpaid product is released for manufacture.

## Implementation Decisions

- External receipt is verified in WorldFirst, a seller bank account, or PayPal.
  The website has no settlement API and never treats a remittance screenshot as
  Payment Confirmation.
- The default Payment Due Date is 10 US business days after PI acceptance. An
  Admin may set a fixed ET date before PI issuance under Spec 4A or later extend
  an accepted PI only to a later ET date. Deadline history is append-only.
- An authorized Admin may explicitly retain the customer's exact accepted PI
  after an accidental later quote change. The review is append-only and binds
  the current PI, acceptance, and latest published quote; a subsequent published
  quote requires another review. It never rewrites a PI, PDF, or acceptance.
- For a legacy accepted PI with no captured payment terms, an explicit retention
  review may establish **no payment deadline agreed**, without inventing a date.
  Full net receipt and external settlement verification remain mandatory. This
  exception does not remove deadlines from dated PIs or bypass technical/dispute
  guards. Re-saving identical commercial terms does not create a new draft version.
- `Update Amount Received` stores one cumulative settled amount in the PI
  currency and derives Remaining Balance. Launch does not model each transfer,
  bank fee, or reconciliation entry as a separate ledger row.
- The net amount settled in the seller-controlled account must equal Total Due.
  Payer and intermediary bank charges do not reduce that requirement. Seller
  PayPal fees are internal and never added after acceptance.
- Before any partial or full amount is recorded, an authorized Admin may change
  Payment Channel while Total Due and currency remain unchanged. This versions
  Payment Instructions, notifies the customer, and does not reset acceptance or
  the due date.
- Payment under superseded instructions may still be accepted when Admin verifies
  settlement into a seller-controlled account and records the actual channel.
- `Mark Payment Confirmed` displays PI number, customer, currency, Total Due, and
  whether the operation will immediately create an Order. The command is
  idempotent.
- Cleared Funds alone do not create an Order. The current PI must be valid and
  accepted, required specification approvals must exist, and full net Total Due
  must be recorded. The same rule applies when acceptance is the final event
  after funds arrived first.
- Satisfying the last condition atomically creates one Confirmed Order and its
  initial fulfilment/production records. There is no separate `Create Order` or
  `Release Production` action.
- Funds received before acceptance produce `Funds Received - Acceptance
Pending`. Expired, superseded, or overdue PI receipts produce a manual review
  state and do not create or release an Order.
- An authorized Admin may approve a late payment only after revalidating current
  terms. Changed terms require a replacement PI and new acceptance. Allocation
  of funds to that PI requires verified customer authorization.
- Excess funds remain an explicit amount with authorization and resolution
  records. Launch has no Store Credit wallet.
- `Correct Payment Confirmation` appends the original event, correcting actor,
  reason, timestamp, and resulting state. Before Order creation it restores the
  implied PI state. After Order creation it places the Order on Payment
  Confirmation Review Hold; it does not delete the Order.
- A Confirmed Order is an immutable commercial result. Additional products,
  quantities, or assemblies create a Follow-on Quote with its own RFQ, PI,
  acceptance, payment, and Order. Coordinated shipping is an operating plan, not
  an Order merge.
- Customer-facing My Quotes presents payment progress in plain language. Orders
  contains only Confirmed Orders.
- Every manual payment mutation and Order-creation decision appends an Admin
  Audit Event.

## Testing Decisions

- The primary seam is the Worker command flow from a current PI and acceptance
  through manual full Payment Confirmation to exactly one Confirmed Order and
  initialized production/fulfilment state.
- A reverse-order scenario records full funds first and proves that later valid
  acceptance creates the same single Order without another payment action.
- Guard tests cover partial amounts, short net settlement, screenshot-only
  evidence, expired/superseded/overdue PIs, wrong currency, missing acceptance,
  repeated commands, and concurrent final-condition requests.
- Correction tests prove immutable history and the difference between pre-Order
  state restoration and post-Order review hold.
- Deadline tests use the US Business Calendar, ET display, Beijing-Time Admin
  projection, later-only extension, and expiration boundaries.
- Customer projection tests ensure internal receiving account details, audit
  notes, and review states are not leaked.

## Out of Scope

- Bank, WorldFirst, PayPal, or accounting-system API integration.
- Customer ability to mark a PI paid or upload remittance screenshots.
- Per-transfer bank reconciliation or general ledger accounting.
- Automatic production completion, shipment, refund decision, or Store Credit.
- Reopening a Confirmed Order to add purchases.

## Further Notes

## Downstream Data Contract (confirmed 2026-09-14)

- Spec 11 supersedes whole-catalog publication for new maintenance. Read current products through the item-aware repository; preserve legacy Catalog Release resolution for old snapshots.
- Freeze the actual SKU and inherited series revisions, resolved attributes, sales unit, quantity/length basis, image versions, source amounts and currencies, assembly generation and applicable service/protection rule versions, or equivalent complete immutable evidence. Never resolve historical business records solely from today's SKU.
- Unsubmitted configurations and Quote Lists revalidate current availability and assembly readiness. Catalog changes do not rewrite submitted RFQs, issued Quotes/PIs, Orders or production records.
- Formal Quote Revisions and PIs use USD in version one. Preserve original reference amounts/currencies separately. Admin explicitly enters final USD prices and commercial charges; no automatic conversion, exchange-rate service, cross-currency sum or relabeling of source amounts as USD.
- Non-USD or mixed reference amounts require manual commercial confirmation of final USD pricing and applicable import terms before formal issuance. Incomplete review blocks issuance, not submission of a valid manual RFQ.
- Product publication's last-successful-write rule does not apply to Quote Preparation Drafts: retain explicit concurrency/version checks.
- Public catalog media and private review evidence have separate authorization. Cost Basis, tax evidence and internal notes remain private.

Payment and Order acceptance: compare settled USD funds with the accepted current USD PI; create exactly one Order from its frozen lines and terms. Do not recalculate against current catalog prices or lifecycle. Wrong-currency receipts require review and cannot satisfy cleared USD funds automatically.

This Spec depends on Spec 4A. Its Confirmed Order is the input to Specs 5 and 6.

- Project PRD: https://github.com/legendztk-netizen/Project1/issues/1
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/6
- Blocked by: https://github.com/legendztk-netizen/Project1/issues/5
