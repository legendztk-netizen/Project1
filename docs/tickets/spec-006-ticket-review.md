# Spec 6 Ticket Review: Shipment and Customer Order Progress

Date: 2026-09-23. Revision: 2.

Status: **Approved, published, and locally implemented on `codex/spec6-work`. Release pending.**

## Scope and Sources

- Parent: [Spec 6 #8](https://github.com/legendztk-netizen/Project1/issues/8).
  Its complete body and comments were checked; it had no comments at review time.
- Prerequisite: [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6)
  and its seven implementation tickets are closed. Confirmed Orders, frozen
  lines, payment-correction holds, Admin/customer Order views, private files,
  manual payment verification and durable notifications already exist.
- [Spec 5 #7](https://github.com/legendztk-netizen/Project1/issues/7) is deferred
  from the first release by the user's accepted decision. No ticket below
  depends on a production package, Assembly Number, QR scan or factory task.
- Sources: [Spec 6](../specs/006-shipment-and-customer-order-progress.md),
  [Spec 7](../specs/007-after-sales-returns-and-refunds.md),
  [first-release decision](../adr/0051-defer-factory-workflow-from-first-release.md),
  [top-level PRD](../prd/hydraulic-hose-rfq-platform.md), the canonical domain
  glossary, and the existing decisions on fixed logistics charges, manual
  tracking, calculated customer progress and post-order change confirmations.
- Current Order creation writes idempotent fulfillment and assembly-production
  initialization placeholders. These are not implemented factory workflows.
  Commercial terms currently retain `leadTime` and `splitPlan` as free text;
  detailed allocation and calendar-based scheduling require an explicit model.
- No independent prefactor is needed. Each behavior includes the minimum
  persistence, guarded commands, interface, audit and verification it needs.

## Approved First-release Boundary

The website continues selling Standard Products, Length-Based Hose Orders and
configured Hose Assemblies. Manufacturing, cutting, necessary inspection and
factory coordination remain offline. Admin records readiness from verified
actual facts, while accepted specifications and commercial snapshots remain
fixed. Required inspection is not waived by the absence of an online record.

Customer progress remains Order Confirmed, Ready to Ship, Shipped and Delivered.
Spec 7 consumes the same Order lines, Shipment allocations, quantity holds and
actual delivery facts. Later Spec 5 activation must explicitly select eligible
work and cannot create retrospective labels or inspection evidence.

## Interpretations Included in This Review

These approved interpretations make existing requirements implementable and
are included in the published tickets where applicable.

1. **Schedule timing.** The older wording calculates a date from Confirmed Order
   creation while also requiring that date in an earlier accepted PI. A new PI
   must instead record an explicit schedule basis: either an agreed fixed
   ready date, or a reviewed number of China fulfillment business days after
   Order confirmation. For the relative basis, calculate and freeze the concrete
   date once the Order exists, starting on the next eligible business day, and
   record the applied calendar version. The PI displays the accepted relative
   commitment, not an invented future payment date. For a fixed-date basis,
   preserve the accepted date; a missed date requires recorded review/revision.
2. **Historical commitments.** Retain original lead-time/split text. An Admin may
   map clear accepted evidence into an operational plan with source and audit.
   An ambiguous plan requires review; a materially different split, service or
   destination requires an Order Change Confirmation. A missing historical date
   is not a fabricated promise or proof of delay. An explicitly set current
   estimate is labeled and notified as such, without rewriting old documents.
3. **Order Change Confirmation.** Before Order creation, commercial changes use
   Quote Revision/replacement PI. After Order creation, eligible address or
   shipping changes use an accepted immutable Order Change Confirmation, as the
   current glossary and ADR-0045 require. Additional products, quantity purchases
   or changed assembly specifications still use a separate Follow-on Quote.
4. **Change payments and refunds.** A positive change adjustment is a separate
   USD obligation tied to that exact confirmation, handled offline by Admin.
   After customer acceptance, Admin may manually apply the current proposal
   without entering receipt evidence or attestation. The system must not label
   that adjustment Cleared Funds or spend original Order funding twice. A negative
   adjustment creates a durable refund-due record for Spec 7; it does not claim
   that a refund was sent. Accepted adjustments and later authorized resolutions
   establish an effective Order obligation alongside its unchanged original total.
   Refund-due funds remain reserved until initiation; they are not newly available
   excess. Payment-review recovery and Spec 7 reconcile authorized credits and
   original PI funds without claiming that positive offline funds were verified.
   This supersedes the original extra-funds gate following the user's 2026-09-24
   decision.
5. **Dates and holds.** A promised calendar date remains a date, while audit and
   milestone instants remain UTC with customer ET/Admin Beijing display. Holds
   stop new allocation/release where applicable, not truthful recording of an
   already-completed handoff or delivery. Late handoff requires audited factual
   reconciliation, not permission to dispatch held goods. A change request,
   payment dispute and future cancellation request each own their hold; one
   resolution cannot clear others.

## Shared Acceptance Requirements

- Build complete vertical behavior, including persistence, server authorization,
  guarded commands, UI, audit and focused tests. Do not leave required safety or
  customer-facing behavior for the final integration ticket.
- Read specifications, units, prices, service charges, destination and accepted
  terms from fixed business snapshots, never today's product catalog. Preserve
  original currency references; final commercial adjustments remain reviewed USD
  amounts with no automated FX or silent repricing.
- A Shipment belongs to exactly one Order. Physical product quantity, package
  count and pricing quantity are separate. Preserve cut-hose pieces and each
  piece's length; total footage is not a count of shippable/returnable pieces.
- Enforce quantity conservation and applicable holds in the same transaction as
  allocation, readiness, dispatch and effective change. Use explicit versions and
  idempotent command identities, with actionable conflict feedback.
- Reuse existing Admin access/permissions and Purchasing Context ownership.
  Private factory, payment, cost, inspection and customs evidence never enters a
  public/customer projection by default.
- Admin interfaces use Simplified Chinese; customer interfaces and transactional
  messages use English. Integrate into current Order navigation and filters;
  group operations by Shipment and use focused forms/dialogs with clear saved,
  pending, error and disabled states. Preserve unfinished form values on errors.
- Keep list queries paginated and avoid loading every full snapshot or R2 file
  for a list/count view. Responsive layouts must keep long identifiers, addresses
  and tracking references readable without overlapping controls.
- Persist durable notification intent with each applicable event. Retry without
  duplicate customer notices; distinguish milestone events from later metadata
  edits. Customer-visible history stays accessible when email delivery retries.
- No online factory workflow, generated production document, automatic customs
  invoice, carrier API, customer delivery-confirmation button or money-moving
  payment/refund API is introduced.

## Published Breakdown and Direct Dependencies

| Ticket | GitHub issue                                                   | Title                                                      | Blocked by                | Demonstrable result                                                                                            |
| ------ | -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 01     | [#94](https://github.com/legendztk-netizen/Project1/issues/94) | Plan Shipments from Confirmed Orders                       | None; Spec 4B is complete | Admin allocates an accepted Order into owned, quantity-safe Shipments that customers can view.                 |
| 02     | [#95](https://github.com/legendztk-netizen/Project1/issues/95) | Commit and Revise Ready-to-Ship Dates                      | #94                       | Reviewed schedule terms become reproducible Shipment dates, with calendar maintenance and notified revisions.  |
| 03     | [#96](https://github.com/legendztk-netizen/Project1/issues/96) | Confirm Readiness, Dispatch and Delivery                   | #94                       | Admin completes offline readiness through delivery, and customers see accurate milestones and tracking.        |
| 04     | [#97](https://github.com/legendztk-netizen/Project1/issues/97) | Manage Packing Records and Private Shipment Documents      | #94                       | Admin retains optional packing/evidence and deliberately shares selected logistics files.                      |
| 05     | [#98](https://github.com/legendztk-netizen/Project1/issues/98) | Review and Apply Pre-dispatch Shipping Changes             | #95, #96                  | A held Shipment changes only after reviewed customer acceptance and manual Admin application.                  |
| 06     | [#99](https://github.com/legendztk-netizen/Project1/issues/99) | Verify Launch Migration and the Order-to-Delivery Workflow | #97, #98                  | Legacy/new Orders complete the workflow without Spec 5, with repeatable acceptance and a Spec 7 data contract. |

After 01, tickets 02, 03 and 04 can proceed independently against its stable
Shipment contract. Ticket 05 requires the date-revision and dispatch/handoff
rules, but not optional document management. Ticket 06 covers all predecessors
transitively. Spec 5 is absent from the dependency graph.

## Ticket 01: Plan Shipments from Confirmed Orders

**Parent:** [Spec 6 #8](https://github.com/legendztk-netizen/Project1/issues/8)

**What to build:** An Order's shipment workspace where authorized Admin users
initialize and inspect the accepted shipping plan, allocate exact Order-line
quantities to Shipments and see unresolved planning/hold issues. Customers see
the same permitted plan under their Order, without implying physical dispatch.

**Blocked by:** None; Spec 4B is complete.

**Acceptance criteria:**

- [ ] A new Confirmed Order initializes one idempotent fulfillment plan. Ship
      Together defaults to one Shipment; Split Shipment is used only when supported
      by accepted terms. Both acceptance/payment orderings and retries reach the same
      plan without a separate Create Order or Release Production action.
- [ ] Extend new quote preparation and issued snapshots to capture structured
      shipment groups, line allocations and the agreed per-dispatch terms. Reconcile
      group quantities and charges with the quoted purchase; no new freight charge
      is invented after acceptance. Version/validate drafts without changing prior
      Quote Revisions, PIs, PDFs or Orders.
- [ ] Initialize existing Orders from fixed evidence. Clear Ship Together plans
      can use all eligible lines; unclear historical split prose stays in review.
      An Admin records how an operational mapping matches the accepted agreement.
      Materially different terms cannot use planning as a shortcut around change
      acceptance. Preserve source wording and do not fabricate historical dispatch.
- [ ] Each allocation identifies its Order line, Shipment and physical quantity.
      Mixed Standard Products, assemblies and cut hose retain their proper units and
      lengths. Allocated, shipped and cancelled quantities cannot exceed the original
      purchase or be counted twice; one Shipment cannot combine different Orders.
- [ ] Persist the quantity/hold contract needed by shipping changes and later
      Spec 7 cancellation. Held quantities cannot be newly allocated/released where
      prohibited, and existing allocations remain visibly held. Order-level payment
      holds override otherwise eligible quantities; unrelated quantities continue.
- [ ] Extend the existing Admin Order list/detail with discoverable Shipment
      summaries and grouped plan controls; retain search, filtering and pagination.
      Provide ownership-scoped customer Shipment summaries/details with frozen line
      information, accepted shipping terms and an honest pre-dispatch state.
- [ ] Allocation edits require the current plan version and retain audit history.
      Disable edits after carrier handoff and reject unauthorized/stale commands on
      the server. Do not expose an unimplemented readiness or dispatch button.
- [ ] Test Worker/D1 initialization, rollback and retry, concurrent allocation,
      cross-Order/context access, mixed quantity units, historical split review,
      preserved snapshots and mobile Admin/customer plan navigation. Include a
      contract test proving a quantity hold cannot be bypassed by reallocation.

## Ticket 02: Commit and Revise Ready-to-Ship Dates

**Parent:** [Spec 6 #8](https://github.com/legendztk-netizen/Project1/issues/8)

**What to build:** Sales captures a reproducible ready-date commitment, Admin
maintains the China Fulfillment Calendar and revises affected Shipment estimates
with history, and customers see the applicable date rather than factory stages.

**Blocked by:** 01.

**Acceptance criteria:**

- [ ] Apply the schedule-timing interpretation above. New reviewed terms capture
      a fixed ready date or explicit business-day lead time per planned Shipment.
      Show the same agreed basis on Quote/PI/customer acceptance; separate processing
      from transit time. Preserve the Standard Product ten-business-day default as
      the initial reference, with explicit Sales confirmation for assembly lead time;
      current reference defaults never overwrite an accepted commitment.
- [ ] Maintain a versioned China Fulfillment Calendar with normal workdays,
      holidays, shutdowns and exceptional workdays. Keep it separate from the US
      Business Calendar. Missing supported calendar coverage requires resolution,
      rather than silently treating every weekday as a workday.
- [ ] For a relative commitment, calculate once from Confirmed Order creation,
      starting with the next eligible China business day, and freeze the applied
      calendar and reviewed lead-time evidence. Ship Together uses the longest
      applicable preparation requirement; split groups calculate independently.
      Preserve explicitly accepted fixed dates without shifting them at payment.
- [ ] Later calendar or catalog edits do not recalculate existing commitments.
      Repeated initialization, including either payment/acceptance ordering, retains
      the same date. Date-only promises do not shift a calendar day merely because a
      customer views audit timestamps in ET.
- [ ] Legacy free-text lead time is preserved. Missing/ambiguous commitments are
      visibly unrecorded or under review, not assigned a guessed historical promise.
      Admin can set an explicitly current operational estimate with reason/source;
      notify it as a newly provided estimate, not as an original agreed deadline.
- [ ] Revise Estimated Ready-to-Ship Date records previous/new value, reason,
      actor, time and Shipment version. Show the revised estimate and history; send
      one email and Personal Center event for that Shipment. A date-only revision
      does not replace the PI or change commercial prices or specifications.
- [ ] An overdue estimate generates only an internal reminder. There is no
      automatic customer Delayed status, promise recalculation, countdown or factory
      progress percentage. Already-dispatched Shipments do not accept a new ready
      date in place of their actual ship date.
- [ ] Test holidays, shutdown/exception workdays, unsupported coverage, business
      day counting, both confirmation event orderings, mixed/split plans, fixed and
      relative commitments, ET/Beijing rendering, legacy uncertainty, stale revisions
      and notification retries. Inspect issued document schedule wording as well as UI.

## Ticket 03: Confirm Readiness, Dispatch and Delivery

**Parent:** [Spec 6 #8](https://github.com/legendztk-netizen/Project1/issues/8)

**What to build:** An Admin progresses each Shipment from a reviewed plan through
offline readiness, dispatch and delivery. Customers follow meaningful milestones
and available carrier tracking from their Orders.

**Blocked by:** 01. Date calculation/revision in 02 is not required to record
actual physical readiness, dispatch or delivery against an agreed plan.

**Acceptance criteria:**

- [ ] Mark Ready to Ship requires explicit Admin verification of the accepted
      specifications, affected quantities, offline preparation and required inspection.
      Record the actor, time and reviewed Shipment version. Online production tasks,
      per-piece identifiers, proof photos and actual packing measurements are not
      prerequisites. The event does not imply that Spec 5 was implemented.
- [ ] Recheck Order payment restrictions and all applicable quantity holds in
      readiness/dispatch commands. A stale page cannot release held goods. Customer
      confirmation is not a prerequisite; the readiness email/event explicitly says
      no customer action is needed and tracking follows after dispatch.
- [ ] Mark Shipped requires an eligible Ready to Ship plan, actual ship date and
      carrier name. Persist carrier handoff/dispatch and the exact quantities once;
      reject impossible/future actual dates and duplicate or over-quantity dispatch.
      Missing tracking number, tracking URL or estimated arrival does not block it.
- [ ] Provide an authorized, audited reconciliation path for a carrier handoff
      that already occurred before its website entry. Capture actual versus recorded
      time, carrier/source, reason and exact quantities, preserving current holds on
      remaining goods. Do not falsify prior readiness or treat this as new release
      permission. Conflicts with a pending change, cancellation or payment review
      remain explicit exceptions requiring resolution; the dispatched quantities
      become ineligible for ordinary pre-handoff cancellation/change.
- [ ] Support multiple Package Tracking Records under one Shipment. Show Tracking
      pending until usable tracking exists; activate Track Shipment only for a valid
      recorded/recognized carrier destination. Validate URLs and display entered
      information without claiming live carrier integration.
- [ ] Admin can append/correct tracking details with audit without replaying the
      Shipped milestone notification. Preserve actual dispatch facts; metadata edits
      cannot silently roll the Shipment back or make handed-off quantities editable.
- [ ] Mark Delivered requires actual delivery date and a recorded carrier or
      customer confirmation source. Supporting delivery proof is optional; there is
      no customer self-service Confirm Delivery button. Record real delivery even if
      a later payment dispute now prevents further shipments.
- [ ] Show only Order Confirmed, Ready to Ship, Shipped and Delivered as customer
      progress, plus clear relevant contact/hold guidance. Per-Shipment views remain
      independent; an Order summary cannot imply all goods are shipped or delivered
      when only one batch is. Show completed/total Shipment counts and define the
      projection over outstanding, non-cancelled quantities without marking an
      entirely cancelled obligation Delivered.
- [ ] Readiness, Shipped and Delivered each create one durable customer email and
      Personal Center event per Shipment milestone. Identify the relevant Shipment
      and its products; no Customs Review or factory-progress notices are emitted.
- [ ] Test transitions, actual-date ordering, payment/quantity-hold races, stale
      readiness confirmation after a plan change, repeated/lost-response commands,
      optional/multiple tracking, split-order summaries, late handoff reconciliation
      during a hold, actual delivery during a hold,
      durable notification failure and mobile/keyboard workflows without Spec 5 data.

## Ticket 04: Manage Packing Records and Private Shipment Documents

**Parent:** [Spec 6 #8](https://github.com/legendztk-netizen/Project1/issues/8)

**What to build:** Admin maintains optional actual packing information and
externally prepared Shipment Documents or readiness evidence, and deliberately
shares selected logistics documents through the customer's Order.

**Blocked by:** 01.

**Acceptance criteria:**

- [ ] Provide a Shipment-scoped packing/documents workspace with separate
      Internal and Customer Shared visibility. Reuse private upload/download controls
      with authorization, file validation, lifecycle handling and auditable changes.
- [ ] Allow optional carton quantities, actual dimensions and gross weights with
      explicit units, including groups of identical cartons. Preserve the earlier
      packing estimate; no SKU or accepted commercial snapshot is overwritten.
- [ ] Calculate dimensional weight only with an explicit supplied divisor. Missing
      dimensions/divisor are not invented, and packing totals are not shippable product
      quantities. An uploaded Packing List may stand on its own; structured fields and
      a website-generated Packing List are not mandatory.
- [ ] Keep optional readiness/inspection evidence internal unless individually
      approved for sharing. It does not become a per-piece Assembly Record or automated
      test certification. No upload requirement blocks Ready to Ship or Shipped.
- [ ] Only deliberate Customer Shared authorization enables an ownership-checked
      Order download. Cross-customer URLs, raw R2 keys and public catalog access cannot
      expose private files; removing sharing revokes subsequent authorized access.
- [ ] Uploading a customs file does not assert verified HS classification or
      website-generated customs documentation. Cost records and inspection/factory
      notes remain separate from customer logistics documents and final PI pricing.
- [ ] Actual freight/DDP cost variance never creates an automatic extra charge,
      refund or service downgrade. Changed commercial service follows Ticket 05.
- [ ] Test internal/shared transitions, cross-context access, unsafe/oversized
      uploads, failed/orphan upload recovery, packing unit calculations, absent
      optional data, preserved estimates and usable customer downloads.

## Ticket 05: Review and Apply Pre-dispatch Shipping Changes

**Parent:** [Spec 6 #8](https://github.com/legendztk-netizen/Project1/issues/8)

**What to build:** A customer requests a delivery-address or shipping-plan change
before handoff, Admin reviews its exact effects, and the revised plan takes
effect after the customer accepts the specific Order Change Confirmation and
Admin manually applies it.

**Blocked by:** 02 and 03.

**Acceptance criteria:**

- [ ] Eligible customer Orders expose focused address/shipping change actions.
      Capture affected Shipments/quantities and requested values, atomically applying
      only the relevant hold. Already-handed-off goods direct the customer to Support.
      Profile Address Book edits do not change existing delivery instructions.
- [ ] Review carrier/service, split allocation, ready dates, DDP/DAP responsibility,
      destination tax treatment and USD financial adjustment. Display before/after
      values and reasons. Default fixed logistics charges remain fixed for ordinary
      seller cost variance; new product purchases/specifications require Follow-on Quotes.
- [ ] First-release allocation supports splitting one unshipped Shipment into
      two and reallocating quantities among existing unshipped Shipments. It does
      not merge two Shipments into one. Admin may decline a merge request with
      a required reason; do not erase either Shipment's history.
- [ ] Publish an immutable, versioned Order Change Confirmation linked to the
      original Order and affected Shipments. The customer explicitly accepts the
      exact proposal through an owned view; silence, an email being sent or an Admin
      edit is not acceptance. A revised proposal invalidates stale acceptance.
- [ ] A positive adjustment has its own exact USD obligation in the accepted
      confirmation, but Admin handles any payment offline. Do not require receipt
      evidence or attestation or create a system Cleared Funds record. Never reuse
      the original paid allocation, rewrite its PI total, execute a bank transfer
      or create another Order. Customer acceptance alone does not apply the change.
- [ ] Apply the accepted change atomically on an explicit Admin action only when
      acceptance matches the current proposal, affected quantities remain eligible
      and unrelated release holds permit it. Preserve original PI/Order snapshots;
      an append-only effective change supplies the operational destination/plan.
      Reconfirm readiness if a changed plan invalidates the earlier verification.
- [ ] A negative adjustment records the explicit refund due for Spec 7 and shows
      its pending status without claiming money was sent. Application follows the
      accepted change terms; executing the refund remains the after-sales workflow.
- [ ] Define the shared post-order financial contract: original Order obligation
      plus effective authorized charges/credits/resolutions, original system-tracked
      funding, reserved refund obligations and separately recorded initiation.
      Positive adjustments remain offline and unverified by this system. Update payment
      review, hold recovery and fund-availability projections to use it for existing
      Orders. A legitimate initiated refund must not appear as unpaid original PI
      value; uninitiated reserved refunds cannot be reallocated, refunded twice or
      used to fund another purchase. Keep pre-Order confirmation rules unchanged.
- [ ] Withdrawal before effect restores the prior plan and releases only this
      request's hold with history. Decline, timeout, stale forms or an unaccepted
      proposal do not silently authorize shipment to the old address. Keep received
      extra funds and any refund obligation visible for reviewed resolution.
- [ ] Notify the customer of proposals, decisions and effective changes through
      the existing conversation/event/email mechanisms with durable deduplication.
      Show actionable pending acceptance/hold states in Admin and customer
      Shipment views without exposing private payment or tax evidence.
- [ ] Test submission-versus-dispatch races, overlapping holds, revised/stale
      proposals, zero/positive/negative adjustments, no automatic effect or false
      Cleared Funds claim, original PI payment corrections, versioned date/split changes, duplicate
      commands and immutable original documents through Worker/D1 and browser flows.
      Contract tests include a lawful freight credit/refund followed by payment
      correction/recovery and a later partial cancellation, with no false shortfall
      or duplicate refund entitlement.

## Ticket 06: Verify Launch Migration and the Order-to-Delivery Workflow

**Parent:** [Spec 6 #8](https://github.com/legendztk-netizen/Project1/issues/8)

**What to build:** Repeatable acceptance and an operational handoff demonstrating
that new and historical Orders can be fulfilled without Spec 5 and that Spec 7
can reliably use the resulting quantities, holds and delivery evidence.

**Blocked by:** 04 and 05; all other tickets are covered transitively.

**Acceptance criteria:**

- [ ] Inventory legacy Orders, plan/lead-time evidence, payment holds and dormant
      initialization records before migration. Preserve fixed documents/hashes; flag
      ambiguous cases rather than invent allocations, promises, completed work,
      actual dates or customer acceptance. Reruns neither duplicate Shipments nor
      create retrospective production packages.
- [ ] Exercise standard-only, assembly-only, cut-hose and mixed Orders from both
      valid payment/acceptance event orderings through planning, dates, manual
      readiness, dispatch with/without tracking and recorded delivery, using real
      local Worker/D1 commands and customer/Admin browser flows.
- [ ] Verify independently ready/dispatched/delivered split Shipments, date
      revisions, privacy-controlled documents, optional packing, all change-adjustment
      outcomes and immutable original commercial evidence after catalog updates.
- [ ] Inject allocation/hold/dispatch and change/original-payment races, stale reads,
      transaction failure, lost responses and notification retries. Reconcile
      quantities and original system-tracked funding; no held goods are released, duplicate shipment
      is recorded or milestone email is sent twice.
- [ ] Prove the Spec 7 contract using focused consumer tests: eligible unshipped
      quantity can be held/cancelled without affecting other lines; release of that
      hold cannot clear a payment/change hold; actual delivery is scoped to the
      relevant returned quantity; cut-hose pieces retain their lengths. This does
      not implement or claim completion of Spec 7's return/refund screens.
- [ ] Prove the Spec 7 financial contract with authorized refund-initiation
      consumer fixtures: freight-credit funds are reserved before initiation, an
      initiated authorized refund reconciles with the adjusted obligation during
      payment-review recovery, and later cancellation/supplemental refunds cannot
      reuse previously refunded value. Ordinary unapproved receipt reductions still
      create a real shortage and cannot clear release restrictions.
- [ ] Verify Order list filters/summaries, private ownership, accessible actions,
      mobile layouts, large-list pagination and useful blocked/error states. No
      factory feature, unavailable QR identifier or pending Spec 5 placeholder is
      required by a first-release user flow.
- [ ] Run the repository-required checks, build, migration verification and
      focused end-to-end/security tests; record commands, outcomes and limitations.
      Clearly distinguish test substitutes from actual carrier or email-provider
      delivery. No live carrier integration or production deployment is implied.
- [ ] Document calendar preparation, historical plan review, offline factory
      verification, dispatch/receipt recording, offline positive-adjustment handling and operational
      recovery. Recovery preserves committed events and snapshots; later Spec 5
      activation requires explicit eligible-work selection rather than replaying
      every historical pending production initialization.

## Parent Story Coverage

| Parent user stories                                                             | Primary ticket |
| ------------------------------------------------------------------------------- | -------------- |
| 1-2: accepted together/split plan and quantities                                | 01             |
| 3-4: ready dates and communicated revisions                                     | 02             |
| 5-10, 14: readiness, dispatch, tracking, delivery and independent notifications | 03             |
| 11: private logistics/customs documents                                         | 04             |
| 12-13: pre-dispatch changes and affected-quantity holds                         | 05             |
| Cross-workflow migration, concurrency and Spec 7 handoff                        | 06             |

## Publication Record

The user approved the six-ticket breakdown on 2026-09-23. All six English
GitHub issues above are native sub-issues of [Spec 6 #8](https://github.com/legendztk-netizen/Project1/issues/8),
and their direct blockers are linked through native issue dependencies. Each
contains Parent, What to build, Acceptance criteria, applicable shared
requirements/interpretations and Blocked by references. [Ticket 01 #94](https://github.com/legendztk-netizen/Project1/issues/94)
starts `ready-for-agent`; #95-#99 start `blocked`. Triage labels should advance
with the dependency frontier as implementation tickets close.

Scope/dependency updates to the PRD and Specs 5/6/7 were explicitly authorized
separately from publication. Parent issues remain open. Publishing implementation
tickets does not authorize production deployment or claim implementation is
complete.

## Implementation Verification

Local acceptance on 2026-09-25 used schema version 114 and 114 migrations.
`pnpm test` passed 1103 tests across 161 files (3 tests and 1 file skipped);
`pnpm test:smoke` passed 38 tests across 7 files and included a production
build. Formatting, lint, typechecking and migration verification passed. The
[operational handoff](../operations/spec-6-order-to-delivery.md) records the
local Order inventory, recovery rules and browser-check limitations. This does
not certify remote migration, bank settlement, carrier handoff, external email
delivery or production deployment. Spec 7's cancellation and return screens
remain separate work.
