# Spec 7 Ticket Review: Cancellation, Return Inspection, and Refund

Review date: 2026-09-27. Status: **Approved, published as GitHub issues #102–#111 and implemented on branch `claude/spec7-after-sales` (one commit per ticket). Operator guide and local verification: [Spec 7 after-sales runbook](../operations/spec-7-after-sales.md).**

## Sources and Verified Facts

- Read the complete body and comments of [Spec 7 #9](https://github.com/legendztk-netizen/Project1/issues/9); there were no comments at review time. GitHub is the configured issue tracker.
- Spec 4B #6, Spec 6 #8, and Spec 6 tickets #94–#99 are closed. [PR #101](https://github.com/legendztk-netizen/Project1/pull/101) was merged on 2026-09-25. At review time, local main was its merge commit, `ddb6821`. The blocked label and status text on #9 are stale and do not establish an unmet code prerequisite. This workflow does not modify the parent issue.
- Checked the [domain glossary](../../CONTEXT.md), [local specification](../specs/007-after-sales-returns-and-refunds.md), ADR-0024, 0035, 0043, 0046 and 0051, and the [Spec 6 handoff contract](../operations/spec-6-order-to-delivery.md). Spec 5 remains deferred; factory workflows, Assembly Numbers and QR records are not prerequisites.
- The current PI terms generator, [pi-policy.ts](../../app/modules/proforma-invoice/domain/pi-policy.ts), freezes the 30-day, no-restocking-fee terms of `pi-refund-2026-09-14-v1` into issued PIs. The [existing return policy](../policies/returns.md) says the same. Current product pages and #9 instead specify 14 days and a 10% restocking fee. This is an actual code/documentation conflict, not merely a wording difference.
- Existing capabilities include Shipment-scoped quantities and holds, actual handoff and delivery records, Order Change Confirmation refund reservations and financial guards, multiple maintained Return Locations, the PI US Business Calendar, private files, Quote Conversation, notifications and audit. No complete cancellation/after-sales business module was found during this review.
- The initial workspace contained many pre-existing untracked materials, with no uncommitted changes to tracked files. This work only adds the review record and individual ticket drafts.

## User Clarifications and Implementation Interpretations

1. **One launch return policy — user-directed scope change.** The user states that the service has not launched and has no real Orders. On that basis, switch directly to the 14-day, 10% policy in #9. Do not implement a legacy `v1` policy branch, preserve the old commercial agreement, map historical policy versions, or add an unknown-historical-policy manual-review workflow. Update development fixtures to the launch terms as needed. This is user-provided business context, not a claim that production data was independently audited. New PIs still snapshot the agreed launch terms, and subsequent cancellation/after-sales actions preserve those issued PI and Order records; this normal transaction immutability does not require dual-policy compatibility.
2. **Explicit 14-day boundary.** The user considers the proposed boundary reasonable and notes that #9 does not specify it. Record it explicitly as this review's implementation clarification: the actual Shipment delivery date in `America/New_York` is day 0; a convenience-return request is allowed through 23:59 ET on day +14. For example, delivery on Sep 1 gives a Sep 15 cutoff. Test immediately before, at and after the cutoff using the same existing deadline precision as the PI calendar. Do not describe this algorithm as a quotation from the original Spec. The separate RA arrival boundary remains the proposed issuance-date day 0 / day +30 at 23:59 ET rule. The 5/10-US-business-day deadlines reuse the glossary convention: triggering date day 0, next eligible business day day 1, and 23:59 ET on the final counted day, with a frozen calendar version. Insufficient business-calendar coverage is an explicit error requiring resolution, never a silent fallback to the China Fulfillment Calendar; it does not create a historical-policy review workflow.
3. **Refund-destination permissions.** Issue #9 explicitly requires Owner approval for an alternative account, while the glossary currently permits an Owner or authorized Admin Subaccount. Apply the more specific Owner-only requirement in #9 and align the glossary wording. Ordinary refunds continue to use individual permissions rather than inferred fixed Sales/Operations roles.
4. **Separate money from physical quantity.** Returned quantities belong to original Order lines and their applicable Shipments. Cut hose uses physical piece counts and each piece's length; financial calculations use the original discounted USD transaction snapshots. Total footage cannot replace piece counts, and current SKU classification or price cannot replace the frozen purchase facts used for eligibility.
5. **Count each refund entitlement once.** Extend Spec 6's effective-obligation contract when cancellation first creates an authorized credit/reservation; inspection approval reuses that contract. Shipping-change refunds, cancellations, returns, excess-fund allocations and supplemental refunds share entitlement limits and actual-funds constraints. Positive shipping adjustments remain offline and cannot be treated as system-verified funds.
6. **Separate late factual recording from authorization.** Actual handoff or receipt may be recorded later, retaining the actual time, recording time, source and any conflict. Late recording cannot bypass a hold or arrival deadline. Inspect partial receipts by quantity; unreceived quantities cannot receive physical-return refund approval. RA expiration ends only the authorization, preserves the original Case, and requires renewed review before reauthorization.
7. **Replacements and disagreements.** Record the approved scope, seller-funded costs and fulfillment evidence for a seller-responsible replacement in the original Case. Do not mark a refund as executed or fabricate new Order/factory records. Changes to the customer's original configuration still require a new Follow-on Quote. Disagreements continue in the original Case Conversation without a separate appeal system.

## Shared Acceptance Requirements

- Each ticket delivers demonstrable end-to-end behavior, including the minimum migration, domain commands, server authorization, UI, audit, notifications where applicable, and focused verification. Financial guards, permissions and necessary UI belong in the owning ticket rather than the final acceptance ticket.
- Admin interfaces use Simplified Chinese; customer interfaces and emails use English. Reuse current Order navigation, paginated lists, actionable errors, concurrency-conflict feedback and responsive layouts. Preserve form values after failures.
- Authorize by Purchasing Context. Validate scope for every upload, download, share, list and related object. Private R2 evidence defaults to Internal; only explicitly shared files become customer-visible. No Return Location is disclosed before RA issuance.
- State transitions require current versions, idempotent command identities and atomic D1 guards. Persist audit and durable notification intent in the same transaction. Repeated Queue delivery cannot create duplicate customer events.
- Preserve original PI, Order and product history; do not fabricate unknown historical facts. New permissions are not implicitly granted to every subaccount. Internal quotation details, product costs, payment evidence and factory notes must remain outside customer projections.
- Use integer USD cents and cumulative limits by component. Define and test proportional allocation and remainder rules so repeated partial processing cannot cumulatively over-refund or over-deduct. Review tax separately using accepted tax facts rather than deriving tax law.
- Each ticket includes the necessary domain, route, D1 and interaction verification. Final acceptance runs formatting, lint, type checks, the full test suite, migration verification and build/smoke checks, recording actual results. Production deployment is not a default step in this scope.

## Breakdown and Direct Dependencies

| Ticket | Title | Blocked by | Demonstrable result |
| --- | --- | --- | --- |
| 01 | Align the Single Launch Return Policy | None | Product disclosures, PI terms, customer documents and development fixtures use one 14-day, 10% policy. |
| 02 | Request and Withdraw Quantity-scoped Cancellation | None | Submission immediately holds the exact unshipped quantities; withdrawal releases only its own hold. |
| 03 | Resolve Cancellation and Reserve the Authorized Refund | 02 | Immutable decisions, accurate remaining fulfillment, transparent amounts and shared refund reservations. |
| 04 | Review Exceptional Assembly and Pre-cut Hose Cancellation | 03 | Support-initiated review uses actual factory facts without changing the original configuration. |
| 05 | Open an After-sales Case and Continue Its Conversation | 01 | Shipment-specific delivery and 14-day-window validation with traceable reports, attachments and replies in the same Case. |
| 06 | Issue a Private Return Authorization with Frozen Instructions | 05 | A maintained address is selected and disclosed only to the authorized customer, with a 30-day arrival deadline and renewed-review path. |
| 07 | Receive, Inspect and Approve Returned Quantities | 03, 06 | Actual received quantities drive inspection, financial calculations, reservations, decision notices and overdue reminders. |
| 08 | Record External Refund Initiation and Reconcile Funds | 07 | Cancellation, return and Spec 6 refunds share verified channels, deadlines, limits and records; dependency on 03 is inherited through 07. |
| 09 | Append Decision Revisions and Supplemental Refunds | 08 | Case revisions preserve history, initiated refunds remain unchanged, and additional amounts receive separate authorization. |
| 10 | Verify Migrations and the Complete After-sales Workflow | 04, 09 | Complete acceptance evidence for mixed products, split deliveries, concurrent financial operations and the single launch policy. |

Proposed single-agent execution order: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10.
This sequence does not add blocking edges: 01 and 02 can start independently, 05 can start after 01, and 07 reuses the financial contract introduced by 03.
No separate horizontal refactoring ticket is currently needed; small changes required for reuse belong in the first ticket that needs the behavior.

## Published Tickets and Local Sources

The approved local ticket sources remain in the [ticket directory](../../.scratch/spec-007-after-sales/issues/). The published GitHub issues include the shared acceptance requirements and real blocker references. Native blocking relationships and mutually exclusive triage labels were read back and verified; parent #9 was not modified.

- Ticket 01: [Spec 7 Ticket 01: Align the Single Launch Return Policy](https://github.com/legendztk-netizen/Project1/issues/102)
- Ticket 02: [Spec 7 Ticket 02: Request and Withdraw Quantity-scoped Cancellation](https://github.com/legendztk-netizen/Project1/issues/103)
- Ticket 03: [Spec 7 Ticket 03: Resolve Cancellation and Reserve the Authorized Refund](https://github.com/legendztk-netizen/Project1/issues/104)
- Ticket 04: [Spec 7 Ticket 04: Review Exceptional Assembly and Pre-cut Hose Cancellation](https://github.com/legendztk-netizen/Project1/issues/105)
- Ticket 05: [Spec 7 Ticket 05: Open an After-sales Case and Continue Its Conversation](https://github.com/legendztk-netizen/Project1/issues/106)
- Ticket 06: [Spec 7 Ticket 06: Issue a Private Return Authorization with Frozen Instructions](https://github.com/legendztk-netizen/Project1/issues/107)
- Ticket 07: [Spec 7 Ticket 07: Receive, Inspect and Approve Returned Quantities](https://github.com/legendztk-netizen/Project1/issues/108)
- Ticket 08: [Spec 7 Ticket 08: Record External Refund Initiation and Reconcile Funds](https://github.com/legendztk-netizen/Project1/issues/109)
- Ticket 09: [Spec 7 Ticket 09: Append Decision Revisions and Supplemental Refunds](https://github.com/legendztk-netizen/Project1/issues/110)
- Ticket 10: [Spec 7 Ticket 10: Verify Migrations and the Complete After-sales Workflow](https://github.com/legendztk-netizen/Project1/issues/111)

## Self-review Findings

- All 15 user stories in #9 are covered: 1–2 → 02; 3 → 03; 4 → 04; 5–6 and 11 → 05; 7 → 06; 8–10 and 12 → 07; 13–14 → 08; 15 → 09.
- Financial guards apply when a refund entitlement is first created. Ticket 08's initiation records are not a later repair for earlier excessive approvals.
- The 14/30-calendar-day and 5/10-US-business-day requirements belong to their business tickets, not only the final testing ticket.
- Multiple Return Locations and immutable address snapshots, purchased SKUs subsequently hidden from the catalog, cut-hose physical piece counts, private inspection evidence, seller-responsible costs and Spec 6 refund integration all have explicit acceptance criteria.
- The user removed legacy-policy compatibility from scope and accepted the 14-day boundary as reasonable. Tickets 01, 05, 07 and 10 now use a single launch policy with an explicit ET cutoff. No historical-policy fallback or dual-version test matrix remains. The user subsequently approved publication of the revised breakdown. The latest user instruction is to stop at publication with blocking relationships established.
- This review checked source material, code and ticket structure only. This ticket review is not implementation acceptance, and Spec 7 is not claimed to be implemented.
