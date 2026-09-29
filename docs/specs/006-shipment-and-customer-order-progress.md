# Spec 6: Shipment and Customer Order Progress

> Status: Implemented and locally verified on `codex/spec6-work` (#94-#99); release/deployment pending. Prerequisite: Spec 4B / Issue #6 is completed.
> Spec 5 / Issue #7 is deferred and is not a first-release prerequisite.

## First-release Boundary

[ADR-0051](../adr/0051-defer-factory-workflow-from-first-release.md) establishes
offline factory coordination with explicit Admin shipment readiness. This Spec
starts from Confirmed Orders and immutable Order lines; it neither waits for
production initialization nor requires an Assembly Production Package, Assembly
Number, QR label, factory scan or online Proof Test record. Manufacturing and
required inspection still take place offline.

## Problem Statement

International fulfilment may use one or several shipments, and actual freight,
carrier data, and ready dates are often confirmed manually. Customers need a
small, trustworthy progress view, while operations needs enough flexibility to
record DDP/DAP delivery, changes, tracking, and documents without exposing
factory or customs-internal stages.

## Solution

Model one or more Shipments under a Confirmed Order. Snapshot the accepted
ship-together or split plan and ready dates, let authorized administrators
advance explicit shipment milestones and tracking, and project a simple
customer timeline of Order Confirmed, Ready to Ship, Shipped, and Delivered.

## User Stories

1. As a customer, I want to request Ship Together or Split Shipment before PI acceptance, so that the quote can reflect my delivery preference.
2. As an administrator, I want to allocate Order quantities across one or more Shipments, so that fulfilment matches the accepted PI.
3. As a customer, I want a concrete Estimated Ready-to-Ship Date, so that processing time is not mistaken for international delivery time.
4. As an administrator, I want to revise an estimated ready date with history and notification, so that a confirmed delay is communicated without rewriting the PI.
5. As an administrator, I want to mark each Shipment Ready to Ship, so that customer progress changes only after an explicit operating decision.
6. As a customer, I want Ready to Ship to be informational rather than another approval request, so that dispatch is not blocked unnecessarily.
7. As an administrator, I want to record dispatch before a tracking number is available, so that freight-forwarder timing does not block the real status.
8. As a customer, I want every available carrier and tracking record under its Shipment, so that split or multi-package delivery remains understandable.
9. As an administrator, I want to record delivery manually when necessary, so that shipments without carrier webhooks can still be completed.
10. As a customer, I want only meaningful delivery milestones, so that internal factory and customs reviews are not presented as unreliable progress.
11. As an administrator, I want to upload logistics and customs files privately and share selected documents deliberately, so that internal records are not exposed by default.
12. As a customer, I want to request a pre-dispatch address or shipping change, so that operations can review the change without silently altering the accepted Order.
13. As an administrator, I want affected fulfilment held while a requested change is unresolved, so that goods are not dispatched under conflicting instructions.
14. As a customer, I want each split Shipment to notify independently, so that completed goods do not wait for unrelated lines before dispatch information appears.

## Implementation Decisions

- `Ship Together` is the default RFQ preference. `Request Split Shipment` is
  non-binding until represented in the accepted PI. One Confirmed Order may own
  multiple Shipments with explicit line/quantity allocations.
- Allocate by immutable Order line and physical quantity. Preserve cut-hose
  piece counts and per-piece lengths separately from pricing footage. Concurrent
  allocation, cancellation and dispatch cannot over-allocate or reuse quantities.
  Payment Review Hold and quantity-scoped change/cancellation holds remain
  independent enforced restrictions; resolving one never clears the others.
- Existing Orders may contain only free-text lead time or split-plan evidence.
  Preserve that evidence and require explicit review where the accepted plan is
  ambiguous. Do not infer a binding allocation or promised date from today's
  catalog, parse uncertain prose as an agreement, or rewrite an accepted PI.
  First-release ticket review must distinguish pre-Order accepted schedule terms
  from dates that can be calculated only after Confirmed Order creation.
- Standard Products use a default 10-business-day Processing Lead Time.
  Made-to-order Hose Assemblies show a starting estimate but Sales confirms the
  actual quantity-dependent Processing Lead Time before PI issuance.
- Ready-date calculation uses the Admin-maintained China Fulfillment Calendar,
  including Chinese holidays, shutdowns, and exceptional workdays. Payment and
  return deadlines use the separate US Business Calendar.
- The accepted PI's Shipment plan and Estimated Ready-to-Ship Date are snapshotted
  into the Confirmed Order. Factory actions do not recalculate them.
- An overdue date creates an internal reminder only. `Revise Estimated
Ready-to-Ship Date` records prior/current values, affects only the selected
  Shipment, and sends one email plus Personal Center event. A date-only revision
  does not replace the PI.
- Owner/Admin explicitly marks a Shipment `Ready to Ship`; customer-visible
  status never derives from Factory Mobile. The notification says no customer
  action is required and tracking follows after dispatch.
- Readiness confirmation records the actor, UTC time and reviewed Shipment
  version after checking accepted specifications, quantities, offline preparation
  and required inspection. Notes and protected supporting documents are optional.
  Missing Spec 5 records never prevent readiness, and this action does not claim
  to be a per-piece inspection record or automatically mark goods Shipped.
- Marking `Shipped` requires actual ship date and carrier name. Tracking number,
  tracking URL, and estimated delivery date are optional and may be added later
  without another status transition or notification.
- A Shipment may contain multiple Package Tracking Records. `Track Shipment`
  appears only when a usable tracking number or URL exists and opens the recorded
  carrier page; the website does not claim manually entered events are live.
- `Delivered` may be recorded from carrier information or Manual Delivery
  Confirmation with actual delivery date. Customers have no launch `Confirm
Delivery` button.
- Payment or change holds prevent new release, not truthful recording of an
  already-completed handoff or delivery. Late handoff reconciliation records the
  actual and recorded times, source, reason, actor and exact quantities; it does
  not clear holds or approve a new dispatch. Surface conflicts with pending
  requests/reviews and retain holds on remaining goods. Preserve those facts for
  quantity-level Spec 7 cancellation and return eligibility.
- Customer Order Progress consists only of Order Confirmed, Ready to Ship,
  Shipped, and Delivered. There is no Customs Review state or customs-entry/
  release notification. Multi-shipment summary reports completed count.
- DDP and DAP responsibilities come from the accepted PI. Provider-Managed DDP
  Clearance remains an operating arrangement; customers do not configure an
  Importer of Record in the website.
- Shipment Packing Estimate supports quotation. Final Packing Record and actual
  carton count, weight, dimensions, or uploaded Packing List are optional and do
  not block Ready to Ship or Shipped.
- Shipment Documents are private R2 objects by default. Only an explicit
  `Customer Shared` decision exposes a controlled Personal Center download.
- Before carrier handoff, a customer may submit a Delivery Address Change Request
  or Shipping Change Request for an eligible Shipment. Submission holds only
  affected quantities.
- In the first release, Admin may split one unshipped Shipment into two and
  reallocate quantities among existing unshipped Shipments. Merging two
  Shipments into one is out of scope; Admin declines that request with a
  reason. Existing Shipment history must not be erased to simulate a merge.
- Admin rechecks carrier, tax, trade term, and price effects. Approval creates an
  immutable Order Change Confirmation. After the customer explicitly accepts
  the current version, Admin may manually apply it. Additional payment for a
  positive adjustment is handled offline; the website does not require a
  receipt attestation or claim Cleared Funds for that adjustment. Silence and
  an Admin proposal alone never apply the change.
- Accepted financial adjustments form an append-only effective Order obligation
  alongside the unchanged original PI/Order totals. Reserve an approved refund
  until its separately recorded initiation; it is not freely allocatable excess.
  Payment review and Spec 7 refunds must reconcile authorized credits against
  the original system-tracked PI funding without treating offline positive
  adjustments as system-verified funds. A legitimate recorded refund must not
  create a false payment shortfall or permit the same entitlement to be
  refunded twice.
- After carrier handoff, website change actions are disabled and the customer is
  directed to Support. Accepted quantity, destination, split, or service changes
  that alter commercial terms use the established replacement/confirmation
  workflow rather than an in-place Order edit.
- Ready to Ship, Shipped, and Delivered notifications are idempotent per
  Shipment milestone.

## Testing Decisions

- The primary seam starts with a Confirmed Order, creates its accepted Shipment
  plan, advances one Shipment through Ready to Ship, Shipped, tracking update,
  and Delivered, and verifies the customer timeline and notifications.
- Split-shipment coverage proves independent allocation, dates, notifications,
  tracking, and aggregate completion.
- Calendar tests cover China processing dates, revisions, and no automatic delay
  status. Time-zone display is validated in ET for customers and Beijing Time for
  Admin.
- Change-request tests cover holds, customer acceptance, explicit Admin
  application without a false Cleared Funds claim for offline adjustments,
  cancellation before effect, and disabling after carrier handoff.
- Security tests prove Internal Shipment Documents remain inaccessible until
  explicitly shared.
- Queue tests prove repeated milestone messages do not send duplicate customer
  notifications.
- Run the complete workflow without a Spec 5 consumer, production package,
  physical Assembly Number or factory evidence. Verify legacy pending production
  placeholders do not block shipping or cause retrospective production jobs.
- Verify allocation/hold/dispatch races, cut-hose physical units, independently
  delivered split quantities and the downstream Spec 7 eligibility contract.

## Out of Scope

- Paid carrier aggregation, carrier webhooks, live map tracking, or delivery
  prediction.
- Customer-facing Customs Review or factory progress.
- Automatic customs Commercial Invoice generation or automatic HS verification.
- Mandatory actual carton measurements or website-created Packing Lists.
- Customer control over Importer of Record or direct factory dispatch actions.
- Spec 5 production packages, per-piece identifiers/QR labels, Factory Mobile,
  Public Assembly Verification and retrospective factory-history generation.

## Further Notes

## Downstream Data Contract (confirmed 2026-09-14)

- Spec 11 supersedes whole-catalog publication for new maintenance. Read current products through the item-aware repository; preserve legacy Catalog Release resolution for old snapshots.
- Freeze the actual SKU and inherited series revisions, resolved attributes, sales unit, quantity/length basis, image versions, source amounts and currencies, assembly generation and applicable service/protection rule versions, or equivalent complete immutable evidence. Never resolve historical business records solely from today's SKU.
- Unsubmitted configurations and Quote Lists revalidate current availability and assembly readiness. Catalog changes do not rewrite submitted RFQs, issued Quotes/PIs, Orders or production records.
- Formal Quote Revisions and PIs use USD in version one. Preserve original reference amounts/currencies separately. Admin explicitly enters final USD prices and commercial charges; no automatic conversion, exchange-rate service, cross-currency sum or relabeling of source amounts as USD.
- Non-USD or mixed reference amounts require manual commercial confirmation of final USD pricing and applicable import terms before formal issuance. Incomplete review blocks issuance, not submission of a valid manual RFQ.
- Product publication's last-successful-write rule does not apply to Quote Preparation Drafts: retain explicit concurrency/version checks.
- Public catalog media and private review evidence have separate authorization. Cost Basis, tax evidence and internal notes remain private.

Shipment acceptance: allocate quantities from immutable Order lines and use accepted delivery terms. Current series lead-time or packaging edits are reference context only; actual shipment measurements and approved Order Change Confirmations remain separate. Test split shipment quantities and catalog changes without historical mutation.

This Spec depends on completed Spec 4B and consumes Confirmed Orders directly.
First-release readiness is an explicit Admin decision based on offline factory
or stock-preparation facts. Spec 5 is a later optional integration.

- Project PRD: https://github.com/legendztk-netizen/Project1/issues/1
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/8
- Completed prerequisite: https://github.com/legendztk-netizen/Project1/issues/6
- Ticket review: [Spec 6 English review draft](../tickets/spec-006-ticket-review.md)
