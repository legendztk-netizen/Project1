# Spec 7: After-sales, Return Inspection, and Refund

> Status: Implemented locally (tickets #102–#111). See docs/operations/spec-7-after-sales.md for the runbook and verification.
> Spec 5 / Issue #7 is deferred and is not a first-release prerequisite.

## First-release Boundary

Under [ADR-0051](../adr/0051-defer-factory-workflow-from-first-release.md),
after-sales records identify immutable Order lines, the applicable Shipments and
physical quantities. Website-generated Assembly Numbers, QR labels and Factory
Mobile records are not required. Admin records actual factory information and
its source when reviewing an exceptional assembly cancellation or pre-cut hose
cancellation; private photos, documents or external identifiers may support the
decision. Missing website production evidence is not proof that work has not
started, and no production history is fabricated.

The cancellation review uses a required factory-status dropdown instead of a
free-text status and separate pre-cut checkbox. Selecting confirmed not started
(uncut hose) records the pre-cut fact; in production, completed, and unverified
states do not authorize cut-hose cancellation. The selection applies to all
approved cut-hose quantities in that decision. Source and review time remain
part of the internal factory record.

Production Approval remains the customer's recorded approval of fixed
specifications, not a factory-start milestone. Existing cancellation, return,
inspection and refund policies remain in force.

## Problem Statement

Standard Products, cut hose, and custom Hose Assemblies have different
cancellation and return rights. A return request does not prove eligibility or
condition, and the seller cannot approve a physical-product refund before the
authorized goods are received and inspected. The website also cannot move money
automatically.

## Solution

Provide controlled pre-dispatch Cancellation Requests and post-delivery
After-sales Cases. Authorize returns case by case, reveal the selected Return
Location only in an issued RA, require receipt and inspection before merchandise
refund approval, calculate transparent adjustments, and record externally
initiated refunds with immutable decisions and evidence.

## User Stories

1. As a customer, I want to request cancellation of eligible unshipped Standard Product quantities, so that operations can review them before dispatch.
2. As an administrator, I want requested quantities held during cancellation review, so that they are not shipped while the decision is pending.
3. As an administrator, I want to approve or decline cancellation with a clear financial breakdown, so that the original PI and Order remain intact.
4. As a custom-assembly customer, I want to contact Support when I discover a configuration error, so that an administrator can judge the original configuration using actual factory information.
5. As a customer, I want one `Request Return or Report a Problem` action after delivery, so that return and defect issues begin in one understandable place.
6. As a Standard Product customer, I want to request a convenience return within the stated window, so that unused eligible goods can be reviewed.
7. As an administrator, I want to issue an RA with private return instructions and an expiration date, so that unsolicited returns are not encouraged.
8. As an administrator, I want receipt and inspection recorded before approving a physical return refund, so that the decision reflects the actual returned condition.
9. As a customer, I want an approved, partial, or declined decision with an explanation, so that I am not shown an unexplained net amount.
10. As an administrator, I want inspection photographs private by default, so that internal evidence is not automatically disclosed.
11. As a customer, I want seller error and possible Nonconforming Product reports accepted even for made-to-order goods, so that no-convenience-return does not eliminate defect remedies.
12. As a customer, I want convenience-return fees and non-refundable logistics shown explicitly, so that deductions are predictable.
13. As an administrator, I want refund approval and refund initiation tracked separately, so that an approval is not misrepresented as money already sent.
14. As a customer, I want an approved refund initiated within the stated period through an appropriate verified channel, so that resolution has a concrete seller deadline.
15. As an administrator, I want revised decisions and supplemental refunds appended, so that later corrections do not erase earlier records.

## Implementation Decisions

- Eligible unshipped Standard Product quantities expose `Request Cancellation`.
  Submission creates a Cancellation Request and immediately holds only those
  quantities. Already handed-off or Shipped quantities are ineligible.
- Reuse Spec 6's quantity allocation and hold contract. Cancellation approval
  removes the approved quantities from the remaining fulfillment obligation;
  declining or withdrawing a request releases only its own hold. Split-shipment
  delivery and return eligibility use the actual applicable Shipment dates.
  Cut-hose piece counts and per-piece lengths are not pricing-footage quantities.
- Operations approves or declines after checking fulfilment and documented,
  non-refundable third-party costs. No administrative cancellation fee or
  markup is permitted.
- Cancellation Resolution is immutable and records line quantities, reason,
  merchandise, recoverable logistics, tax, permitted costs, and refund amount.
  It does not edit the accepted PI or Confirmed Order.
- Made-to-order Hose Assemblies expose no direct customer specification-change
  or cancellation action after production release. A reported error goes to
  Support; an authorized Admin may cancel the original only after checking actual
  factory status. A corrected assembly always uses a new Follow-on Quote, PI,
  payment, and Order.
- A Length-Based Hose Order is made to order after cutting. Admin may approve a
  support-requested cancellation before cutting after checking actual progress;
  the website does not infer cutting from a timer or payment age.
- Order detail exposes one post-delivery action: `Request Return or Report a
Problem`. The customer selects lines/quantities, reason, description, and
  supporting files. Submission creates an After-sales Case, not an automatic RA.
- An unused eligible Standard Product may request convenience return within 14
  calendar days of the actual delivery date for the applicable Shipment.
- RA authorizes return for inspection and snapshots the Admin-selected maintained
  return address and contact with approved instructions. It is not a public warehouse,
  pickup point, or seller legal address.
- Authorized merchandise must arrive within 30 calendar days after RA issuance.
  Expiration closes the authorization and requires a new support review.
- Physical-product refund approval is blocked until authorized quantity is
  recorded received and Operations completes inspection. This Return Inspection
  Gate also applies to returned seller-error or Nonconforming Product claims.
- Inspection may be completed offline; notes on interfaces, sealing surfaces,
  finish, packaging/accessories, installation evidence, and fluid exposure are
  optional internal records. Decision is
  Approved, Partially Approved, or Declined within 5 US business days after
  receipt. Overdue inspection creates an internal reminder only.
- Partial or declined inspection decisions require a customer-visible reason;
  full inspection approval uses the system-generated result and financial
  breakdown, with an optional additional explanation. Cancellation decisions,
  RA declines and Case closure still require a customer-visible reason.
  Inspection logistics/tax working notes and replacement details are optional;
  the approved products and quantities define replacement scope when no extra
  instructions are entered. Third-party deductions still require evidence and
  customer confirmation. Private R2 evidence remains Internal unless an authorized user
  explicitly shares selected supporting files; files attached to a decision are
  shared with the customer with that decision.
- Customer disagreement continues in Messages, labelled with the Case. An
  Inspection Decision Revision appends old/new decision, reason, actor, and time.
- Customer-choice convenience return deducts 10% of the discounted merchandise
  amount approved for return. The same customer terms apply to an "Other
  problem" that inspection shows the buyer caused; Admin chooses the
  responsibility; the system discloses the deductions. Customer pays return shipping; original performed
  DDP Shipping and Import Charges are not refunded. Applicable Sales Tax is
  adjusted separately.
- Seller error or Nonconforming Product has no restocking fee. Seller-funded
  refund or replacement includes reasonable logistics and the Cutting and
  Labeling Fee where relevant.
- Made-to-order Hose Assemblies and cut-length hose have no convenience-return
  path after production/cutting, but defect, seller error, and nonconformity
  reports remain available.
- The website records but does not execute money movement. After approval, the
  seller initiates refund within 10 US business days and Admin records amount,
  actual receipt channel, initiation date, and external reference.
- Customer status distinguishes `Refund approved` from `Refund initiated` and
  does not promise the bank or PayPal posting date.
- Refunds return through the actual receipt channel where possible to an account
  verified for the same Purchasing Context. An alternative verified account
  requires Owner approval and reason. There is no cash or Store Credit refund.
- For an approved, payable refund, the Order header exposes `Refund account`.
  The customer chooses bank transfer (holder, bank, account and routing details)
  or PayPal (holder and PayPal email),
  and confirms ownership by the same Purchasing Context. Admin shows Account
  Provided and can use the submitted details without asking for them in Messages.
  Full bank and PayPal details are encrypted at rest, omitted from audit/message payloads,
  and visible to Admin identities only with refund permission. The owning customer
  can read their saved details while the refund is payable; the Update dialog
  prefills the selected channel and its saved fields. Order status summaries
  show only the account mask or channel. Edits create an immutable new account
  version; stale Admin forms cannot record remittance to a replaced version.
  A different channel from the actual original payment is an alternative account
  and requires existing per-refund Owner approval. Original PayPal payments
  continue to use the original transaction where available.
- Admin `已汇款，退款完成` records an actual external remittance of the remaining
  amount, date and reference. Once every return and refund for that Case is
  resolved, the same transaction closes the Case and appends its completion
  event. Partial payments, other unpaid refunds, outstanding returns,
  uninspected receipts, replacements and refund holds prevent automatic closure.
  Refund deadlines remain based on the original approval, not account submission.
  Customer interfaces remain English; Admin calls the account `退款账号`.
- Seller-funded refunds do not deduct bank or payment-channel fees. A permitted
  customer-caused refund may deduct only documented non-refundable third-party
  costs, displayed gross-to-net for confirmation, without markup.
- A later increased approval creates a Supplemental Refund rather than editing a
  refund already initiated.
- Consume effective Order Change Confirmations and their refund-due records from
  Spec 6. Reconcile the original paid purchase, accepted charges/credits, other
  authorized resolutions, reserved refunds and recorded refund initiation without
  double-counting the same entitlement. Authorized refunds do not invalidate an
  otherwise fully funded adjusted Order; payment-review recovery evaluates the
  same effective obligation while preserving the original PI and Order totals.
  Positive shipping-change adjustments are handled offline at launch: an
  accepted/effective change is not evidence of system-verified extra funds.

## Testing Decisions

- The primary seam is the customer-and-Admin workflow from delivered eligible
  Standard Product through After-sales Case, RA, recorded return receipt,
  inspection decision, refund approval, and externally recorded initiation.
- Cancellation coverage proves quantity-level holds, unaffected-line progress,
  approval/decline resolution, and no mutation of PI or Order snapshots.
- Return-window tests use per-Shipment actual delivery date, 14-day request
  boundary, 30-day RA arrival deadline, and 5-business-day inspection deadline.
- Guard tests prove no physical-return refund approval before receipt and
  inspection and no convenience return for made-to-order assembly or cut hose.
- Cover manual factory review without Spec 5 data, concurrent cancellation and
  dispatch, independently delivered split quantities, and duplicate claims that
  cannot over-refund the same entitlement. Decision revisions and supplemental
  refunds remain append-only and require their own authorization.
- Calculation tests cover restocking fee, recoverable logistics, tax adjustment,
  seller-funded remedies, permitted third-party costs, and supplemental refunds.
- Authorization tests prove the Return Location and private evidence are hidden
  until the correct case action and that customer access is Purchasing
  Context-scoped.
- Notification tests assert one customer event for decisions and refund
  initiation under repeated queue delivery.

## Out of Scope

- Automatic payment refunds, return-label purchasing, warehouse receiving
  integration, or automated condition assessment.
- Public display of the Return Location or unsolicited returns.
- A separate appeal workflow, cash refunds, or Store Credit.
- Customer modification of a produced configuration or per-piece QR status after
  use in the field.
- Legal determination of return rights beyond the accepted operating policy.

## Further Notes

## Downstream Data Contract (confirmed 2026-09-14)

- Spec 11 supersedes whole-catalog publication for new maintenance. Read current products through the item-aware repository; preserve legacy Catalog Release resolution for old snapshots.
- Freeze the actual SKU and inherited series revisions, resolved attributes, sales unit, quantity/length basis, image versions, source amounts and currencies, assembly generation and applicable service/protection rule versions, or equivalent complete immutable evidence. Never resolve historical business records solely from today's SKU.
- Unsubmitted configurations and Quote Lists revalidate current availability and assembly readiness. Catalog changes do not rewrite submitted RFQs, issued Quotes/PIs, Orders or production records.
- Formal Quote Revisions and PIs use USD in version one. Preserve original reference amounts/currencies separately. Admin explicitly enters final USD prices and commercial charges; no automatic conversion, exchange-rate service, cross-currency sum or relabeling of source amounts as USD.
- Non-USD or mixed reference amounts require manual commercial confirmation of final USD pricing and applicable import terms before formal issuance. Incomplete review blocks issuance, not submission of a valid manual RFQ.
- Product publication's last-successful-write rule does not apply to Quote Preparation Drafts: retain explicit concurrency/version checks.
- Public catalog media and private review evidence have separate authorization. Cost Basis, tax evidence and internal notes remain private.

Return authorization acceptance: Admin selects one of the maintained return locations when issuing an RA. Freeze its address, contact and instructions in the RA; later edits or additional locations do not change an issued RA. Reveal only the selected location to the authorized customer. Refund eligibility and USD calculations use the original Order/payment facts, not current SKU price, status or product classification. Test multiple locations, subsequent edits, hidden historical SKUs and private evidence.

This Spec depends on Specs 4B and 6. It reuses Quote Conversation, private R2
evidence, US Business Calendar, Payment Channel, and Admin Audit contracts.

- Project PRD: https://github.com/legendztk-netizen/Project1/issues/1
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/9
- Blocked by: https://github.com/legendztk-netizen/Project1/issues/6 and https://github.com/legendztk-netizen/Project1/issues/8
