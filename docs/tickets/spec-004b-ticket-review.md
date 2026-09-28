# Spec 4B Ticket Review: Manual Payment and Confirmed Order

Date: 2026-09-23. Revision: 3.

Status: **Seven GitHub child issues published on 2026-09-23.** Implementation has not started.

## Scope and Sources

- Parent: [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6). Its full body and comments were reviewed; there were no comments at the time of review.
- Prerequisite: [Spec 4A #5](https://github.com/legendztk-netizen/Project1/issues/5) is closed. Its final acceptance ticket [#63](https://github.com/legendztk-netizen/Project1/issues/63) closed on 2026-09-21.
- Sources: [Spec 4B](../specs/004b-manual-payment-and-confirmed-order.md), [domain glossary](../../CONTEXT.md), [application scope](../product/web-application-scope.md), [4A acceptance](../operations/spec-4a-implementation.md), and ADRs 0005, 0012, 0013, 0042 and 0044.
- Existing PI issuance, website/email acceptance, immutable snapshots, concurrency guards and notification infrastructure can be reused. The code review did not find an independent Payment Due Date, cumulative receipt or Confirmed Order implementation; customer Orders is still an empty-state surface.
- The parent's Blocked text still refers to completed 4A work. Publication added native child relationships but did not edit or close the parent issue.
- Older ADR 0012 ordering language and customer Quote Ready wording in the application scope lag behind the current agreement. Support either payment/acceptance order and do not restore the customer Quote Ready stage. Record the clarification during implementation without silently rewriting historical decisions.

## Why Seven Tickets

The first draft separated several behaviors that share the same transaction or user workflow. This revision consolidates **14 tickets into 7**, without reducing scope.

- Payment terms, cumulative receipts and instruction changes share one payment workspace.
- Both event orderings, atomic Order creation and Order views form one complete confirmation workflow.
- Customer states, Tab counts and notifications ship with the business behavior that changes them, not as a separate integration ticket.
- Allocation and correction remain separate because correction can affect funds already committed to Orders and downstream release holds.
- Each implementation ticket includes persistence, guarded commands, UI, required notifications and focused tests. The final ticket verifies the complete workflow rather than collecting unfinished UI or safety work.
- Acceptance criteria are implementation checklists, not additional tickets or separate approval gates. Reuse existing helpers; no broad prefactor or new framework is required.

## Published Ticket Interpretations

The published tickets use the following interpretations. Review any different business policy before implementing the affected ticket.

1. **PayPal fees.** The Spec requires net settlement equal to Total Due while assigning PayPal fees to the seller. These conflict when fees are deducted during settlement. Bank transfers require net-received verification; for PayPal, credit the externally verified, settled customer payment toward the obligation without treating seller processing fees as customer shortfall. Pending/failed transactions and screenshots do not qualify. No per-transfer fee ledger is introduced. Applies to Tickets 01 and 02.
2. **Legacy PIs without payment terms.** Recover terms only from existing immutable evidence. If the agreement cannot be established, require manual review and a newly issued PI with explicit terms and fresh acceptance where needed. Do not retroactively invent a ten-business-day deadline or mark the customer overdue. Some old test PIs may need reissuance. Applies to Tickets 01 and 07.
3. **Overpayments.** Allocate no more than Total Due to a PI and retain the remainder as Unallocated Excess Funds. Once the PI is fully funded and all other guards pass, allow Order creation without waiting for an excess refund. Refunding or reallocating excess still requires verified customer authorization; it is not a wallet balance. Applies to Tickets 02 and 04.
4. **Production handoff.** Atomically create the Order and initial fulfillment records, plus production initialization records for assembly lines, with frozen inputs and an idempotent downstream handoff. Complete Assembly Production Packages, per-piece identifiers, QR labels and Factory Mobile remain in Spec 5. Shipment allocation and dispatch milestones remain in Spec 6. Initialization does not imply physical production or shipment.

## Shared Acceptance Requirements

- Formal PIs and Orders use USD in version one. Preserve original reference amounts/currencies separately; no FX, cross-currency sums or repricing accepted purchases from today's catalog.
- Amount Received, Cleared Funds, PI acceptance and Confirmed Order are distinct facts. Customers cannot mark themselves paid or release work using screenshots.
- Mutations enforce current Admin authorization, request-origin protection, expected versions and idempotency. Audit each payment mutation and Order decision. Acceptance-triggered Orders link the actual acceptance and originating Admin payment confirmation, not a fictitious Admin action by the customer.
- Customer access follows current individual/Purchasing Context ownership. Private verification accounts, costs, authorization evidence and notes stay private. Payment Instructions deliberately issued to the customer remain customer-visible.
- Use exact minor-unit arithmetic and validated precision. Unknown amounts are not zero. Preserve accepted document, product, specification and approval evidence; catalog edits never rewrite historical purchases.
- Use the US Business Calendar and America/New_York for payment deadlines, UTC storage and Beijing Time in Admin. PI validity governs acceptance; Payment Due Date governs subsequent payment. Neither uses the China Fulfillment Calendar.
- Customer UI stays English and Admin UI stays Simplified Chinese. This document's language change does not change application localization.
- Each workflow updates My Quotes, applicable Tab counts, PI detail and next actions consistently. Do not restore customer Quote Ready, expose internal review codes as labels or show merchandise references as paid amounts.
- Required notifications use durable delivery and matching Personal Center events. Retries do not duplicate business events; stale messages link to the current authorized state. Delivery failures do not roll back committed payment or Orders.
- Show saved results, specific blocking reasons and conflict recovery; preserve recoverable form input. Completion must not depend on another confirmation click or a customer page refresh.
- Every implementation ticket includes focused domain, Worker/D1 and UI tests. Unsupported exception resolution stays blocked until its ticket is complete; intermediate delivery never weakens Order guards.

## Ticket Overview

| Ticket | GitHub                                                         | Title                                        | Blocked by        | End-to-end result                                                                                  |
| ------ | -------------------------------------------------------------- | -------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| 01     | [#87](https://github.com/legendztk-netizen/Project1/issues/87) | Manage PI Payment Terms and Receipts         | None; 4A complete | Payment terms, cumulative receipts and eligible instruction changes, with customer balances.       |
| 02     | [#88](https://github.com/legendztk-netizen/Project1/issues/88) | Confirm Payment and Create One Order         | #87               | Either valid event ordering creates one frozen Order, initialization and usable Order views.       |
| 03     | [#89](https://github.com/legendztk-netizen/Project1/issues/89) | Extend Deadlines and Review Late Payments    | #88               | Later-only extensions and commercial review of late payment without altering accepted documents.   |
| 04     | [#90](https://github.com/legendztk-netizen/Project1/issues/90) | Resolve Historical Receipts and Excess Funds | #89               | Authorized allocation or external refund recording without double-spending or currency conversion. |
| 05     | [#91](https://github.com/legendztk-netizen/Project1/issues/91) | Correct Payment Confirmations Safely         | #90               | Append-only correction, affected Order holds and Owner resolution.                                 |
| 06     | [#92](https://github.com/legendztk-netizen/Project1/issues/92) | Request Additional Purchases from an Order   | #88               | Independent Follow-on Quote lifecycle without changing the original Order.                         |
| 07     | [#93](https://github.com/legendztk-netizen/Project1/issues/93) | Validate Migration and the Complete Workflow | #91, #92          | Repeatable legacy, concurrency, recovery, customer-flow and downstream acceptance evidence.        |

Only direct blockers are listed. After Ticket 02, Tickets 03 and 06 can proceed independently. Ticket 05 follows allocation because corrections must trace funds already applied to another PI or Order.

## Ticket 01: Manage PI Payment Terms and Receipts

**Parent:** [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6)

**What to build:** A payment workspace reached directly from the Admin RFQ snapshot or PI. Admin defines terms, records externally verified cumulative receipts and changes eligible Payment Instructions. Customers see balances, deadlines and current instructions. This ticket does not confirm Cleared Funds or create Orders.

**Blocked by:** None; Spec 4A is complete.

**Acceptance criteria:**

- [ ] New PIs support payment within ten US business days after acceptance or a fixed ET date chosen before issuance. The fixed deadline is 23:59 ET and later than PI validity. Before default-term acceptance, show the relative term, not an invented date.
- [ ] Website and email acceptance freeze the concrete default deadline exactly once, using the acceptance event's ET date as day zero. Skip weekends/configured federal bank holidays and retain a reproducible calendar version. Calendar maintenance preserves frozen deadlines and explicitly handles unsupported coverage rather than silently extrapolating.
- [ ] Newly issued PDFs, instructions and communications agree on payment terms. Display post-acceptance dates separately without changing issued PDFs/hashes. Changing an issued, unaccepted PI's terms requires replacement. Apply the approved legacy rule when evidence is missing.
- [ ] Admin sees PI number, Purchasing Context, USD Total Due, acceptance, received amount, balance and Beijing Time deadline. Customers see authorized public amounts and the same deadline in ET, distinct from PI validity.
- [ ] Update Amount Received stores one verified cumulative settled amount, currency and actual channel, with previous/new values, actor and UTC time. Preview the change; downward corrections require a reason. No mandatory per-transfer or fee ledger.
- [ ] Apply the approved bank/PayPal rule. Reject invalid, negative and overprecision values. Keep wrong-currency funds in original-currency review, never in USD totals; show excess separately instead of a negative balance. Even full cumulative receipt is not Cleared Funds.
- [ ] Historical, expired, superseded and overdue receipts remain traceable and restricted. Receipt entry never authorizes acceptance, creates Orders or releases production.
- [ ] Allow a current PI's single Payment Channel/instructions to change only before any receipt has ever been recorded and when Total Due/currency are unchanged. Correcting to zero does not erase that history. Recheck eligibility atomically against concurrent receipt entry.
- [ ] Version old/new instructions and channels without changing the PI, acceptance or deadline. Preserve safe multiline text/links, not arbitrary HTML or inferred account fields. Send one update email and matching Personal Center event. Verified payment under old instructions can be marked Paid via Superseded Instructions without demanding payment again.
- [ ] Test both acceptance paths, calendar coverage, holidays, year/DST/deadline boundaries, fixed-date validation, ownership, edit/instruction/receipt races, save persistence and notification retries.

## Ticket 02: Confirm Payment and Create One Order

**Parent:** [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6)

**What to build:** Complete the core manual-payment-to-Order workflow in both event orders. Whichever valid event completes full payment, PI acceptance and required approvals atomically creates one Confirmed Order, immediately discoverable by Admin and customer.

**Blocked by:** 01.

**Acceptance criteria:**

- [ ] Mark Payment Confirmed requires explicit external verification in a seller-controlled account and a confirmation dialog showing PI, customer, currency, Total Due, approved amount and whether an Order will result. Server guards determine the outcome.
- [ ] Require current PI/current Quote association, valid exact-version acceptance, all required specification approvals, fully allocated approved USD funds, valid payment-deadline conditions and no release hold. A valid acceptance does not disappear when the original acceptance window later ends.
- [ ] For acceptance-first, atomically commit payment confirmation, unique Order, frozen lines, appropriate fulfillment/production initialization, audit and durable notification intent. Do not leave a partial business result after failure or create assembly tasks for standard-only Orders.
- [ ] For payment-first on a current unexpired PI, retain Funds Received - Acceptance Pending and send an acceptance reminder without creating an Order. Website or authorized email acceptance then completes Order creation atomically, without another Admin action, preserving existing PDF-view and exact-specification acceptance requirements.
- [ ] If the unaccepted PI expires or is superseded after receipt, retain funds under review; do not reactivate it. Wrong currency, shortfall, missing evidence, overdue payment and version conflicts explain their blockers and cannot use unfinished exception paths.
- [ ] Concurrent final events, same/different-key retries and lost responses create only one Order and initialization set. Never reuse funds or let a replacement PI create another purchase from an RFQ that already produced an Order; additional purchases require Follow-on Quotes.
- [ ] Freeze SKU/series revisions, resolved specifications, image versions, units, piece counts/per-piece lengths/pricing quantities, service/protection/assembly rule evidence, final USD prices/charges, source references and accepted delivery terms. No current-catalog historical backfill. Cap PI allocation at Total Due and handle excess under the approved rule.
- [ ] Deliver paginated customer Confirmed Order lists/details and Admin lookup by Order, PI and customer. Show frozen line images/specifications, quantities, prices, totals and delivery information; exclude unpaid quotes and private payment/cost evidence. Initial customer status is Order Confirmed, not manufactured/shipped.
- [ ] Keep My Quotes/PI/Tab progress consistent and link to the same Order. Payment-last sends one Payment Confirmed - Order Created email/event. Payment-first sends the acceptance reminder and later Order Created, without repeating payment confirmation. Preserve existing acceptance evidence/notifications and deduplicate delivery retries.
- [ ] Test both event orders and acceptance sources, missing approvals, exact-version/ownership guards, mixed product types, historical catalog changes, mobile Order views, concurrent final events, rollback and notification failure through domain and Worker/D1/UI coverage.

## Ticket 03: Extend Deadlines and Review Late Payments

**Parent:** [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6)

**What to build:** Admin handles overdue accepted PIs through separate later-only extensions and commercial approval of late payment. Customers see accurate deadlines and next actions without changes to accepted documents.

**Blocked by:** 02, which provides the Cleared Funds fact used by overdue detection and guarded Order creation.

**Acceptance criteria:**

- [ ] An accepted PI without full Cleared Funds after Payment Due Date enters Payment Review Required without cancellation. Reads and writes enforce the same boundary without depending on a scheduler; raw cumulative amounts or customer transfer dates cannot bypass it.
- [ ] Extend Payment Deadline accepts only a later ET date for a current accepted PI. Reject unchanged/earlier dates, unaccepted PIs and stale versions; preview Beijing Time. Append old/new deadlines, actor and time without changing the PI or acceptance.
- [ ] A future extension clears overdue status and restores the applicable Payment Pending state, but does not confirm funds, clear unrelated reviews, create an Order or release work. Send one email and matching Personal Center event per extension with durable retry.
- [ ] Late funds remain under review. Approval requires explicit review of pricing, availability, freight, trade terms and lead time, with a recorded decision, reason, actor and time.
- [ ] If the same current accepted terms remain fulfillable, approval rechecks every normal guard and atomically creates the unique Order. Do not reprice accepted snapshots from today's catalog.
- [ ] Changed terms require a Quote Revision, replacement PI, fresh acceptance and authorized funds allocation. Link the existing replacement flow; keep release blocked until allocation is supported. Never reactivate expired/superseded PIs.
- [ ] Update customer payment progress without exposing private review details. Test repeated extensions/approvals, DST/deadline boundaries, correction/version races, insufficient funds and the distinction between extension and late-payment approval.

## Ticket 04: Resolve Historical Receipts and Excess Funds

**Parent:** [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6)

**What to build:** One Admin resolution workflow for receipts tied to expired/superseded PIs and Unallocated Excess Funds. Verified customer authorization supports allocation to a valid PI or recording an externally completed refund, without reviving old documents or creating a wallet.

**Blocked by:** 03, including the replacement path identified during late-payment review.

**Acceptance criteria:**

- [ ] Show original PI, receipt currency/amount, allocations, available/excess funds, resolutions, current PI and blockers. Unresolved funds remain discoverable after filtering/replacement; wrong-currency receipts retain their original currency.
- [ ] Historical PIs never become current through payment. Reuse reissue/replacement after commercial review; changed terms require a new Quote Revision. Replacement acceptance and approvals must be fresh, not inherited.
- [ ] Retain verified customer authorization, source/target PI, amount/currency, actor, time and reference for each allocation. Allow only the same Purchasing Context and currency, with protected authorization evidence.
- [ ] Source availability, target funding, allocation audit and any resulting Order decision update consistently in one transaction. Do not allocate already-committed funds or exceed the target shortfall. Allocation and acceptance in either order use the same final-condition rule.
- [ ] Excess stays separate from Order value and is not Store Credit. Under the approved decision, a fully funded PI may create its Order while excess awaits authorized resolution.
- [ ] Written authorization permits allocation to another valid same-context/same-currency PI or an external refund. Record completed external refunds with amount, original channel, reference, actor, authorization and time. A refund request is not completion; no provider APIs, automatic refund decisions or fee engine.
- [ ] Allocation/refund races, duplicates, source corrections, replacement changes and over-allocation cannot double-spend funds. Posted resolutions cannot be silently deleted or erase an external event.
- [ ] Show customers accurate applicable balances and acceptance/contact actions, not internal bookkeeping codes. Test conservation of amounts, authorization, both allocation/acceptance orders, immutable history and concurrent resolution.

## Ticket 05: Correct Payment Confirmations Safely

**Parent:** [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6)

**What to build:** Admin corrects mistaken Cleared Funds confirmations without deleting history. Restore the appropriate pre-Order state or retain affected Orders on Payment Confirmation Review Hold until Owner resolves the discrepancy.

**Blocked by:** 04, because corrections must trace funds already allocated to another PI/Order or recorded as refunded.

**Acceptance criteria:**

- [ ] Correct Payment Confirmation references the original event, requires a reason and impact preview, and appends actor, time and result. Never overwrite/delete the original confirmation.
- [ ] Without an Order, derive payment state from remaining valid amounts, acceptance and approvals. Do not erase acceptance, assume all funds are zero or restore an invalid PI.
- [ ] With an Order, atomically preserve its frozen commercial result and initialization while applying Review Hold. Trace affected target PIs/Orders through allocations and prevent further use of disputed funds, not just adjustment of the source PI.
- [ ] The hold is an enforced downstream production-release/dispatch constraint, not only a badge. It cannot undo physical work, delete an Order or rewrite an external refund as unperformed.
- [ ] Only Owner resolves the discrepancy and releases the hold after recording review results and rechecking valid funding/consistency; no unreasoned toggle or ordinary Admin bypass.
- [ ] Recovery reuses the existing Order and initialization without repricing, changing specifications or duplicating work. Confirmation/correction/acceptance/recovery races remain idempotent and auditable.
- [ ] Held Orders stay visible with a suitable customer contact/progress message, without private evidence. Test pre/post-Order correction, reallocated funds, downstream holds and Owner-only recovery.

## Ticket 06: Request Additional Purchases from an Order

**Parent:** [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6)

**What to build:** Customer or authorized Admin starts a Follow-on Quote from a Confirmed Order. Additional purchases follow their own RFQ, PI, acceptance, payment and Order without changing the original purchase.

**Blocked by:** 02. This workflow can proceed independently of the payment-exception branch.

**Acceptance criteria:**

- [ ] Provide a Follow-on Quote entry on Order detail, linking a new draft to the source Order. Explicitly choose products/quantities/configurations before normal RFQ submission; do not submit automatically.
- [ ] Reuse current product/configuration validation. Copying historical products guarantees neither current availability nor old final prices. Preserve the customer's existing Quote List rather than overwriting it.
- [ ] New RFQ, Quote, PI, acceptance, payment and Order have independent identities and authorization. Do not reuse old payment confirmation, approvals or command IDs.
- [ ] Original products, totals, quantities and delivery commitments remain unchanged. A non-binding Combined Shipping Request does not merge Orders, pause the original purchase or promise coordinated dispatch; operational consolidation remains downstream.
- [ ] Reject cross-customer source links, deduplicate repeated draft creation and preserve the source Order on failure. Test both customer/Admin entry points and navigation through the existing RFQ workflow.

## Ticket 07: Validate Migration and the Complete Workflow

**Parent:** [Spec 4B #6](https://github.com/legendztk-netizen/Project1/issues/6)

**What to build:** Run isolated end-to-end and legacy-readiness acceptance, with repeatable evidence and an operational handoff. Do not defer unfinished workflow UI or safety requirements to this ticket.

**Blocked by:** 05 and 06; all earlier tickets are covered transitively.

**Acceptance criteria:**

- [ ] Inventory legacy PI, Quote, acceptance, payment-term and product-evidence completeness before migration. Apply the approved compatibility rule, preserve documents/hashes and list review cases; do not fabricate deadlines, batch-confirm funds or silently generate old-record Orders.
- [ ] Exercise Worker/D1 commands, browser flows and notification jobs for acceptance-first and payment-first website/email scenarios. Each produces exactly one Order and appropriate initialization, without a separate creation/release action.
- [ ] Cover partial receipts, channel/fee rules, superseded instructions, wrong currency, expiry/replacement, late payment, extensions, excess, allocation, external refunds, correction, Owner recovery and Follow-on Quotes, including rejected paths.
- [ ] Inject concurrent final events, transaction failures, response loss, notification failures and reordered delivery. No duplicate Order, allocation, refund resolution, initialization or orphan production records. Reconcile source funds with allocations, available amounts and recorded returns; unresolved discrepancies remain visible.
- [ ] Verify customer list/Tab/detail consistency, amounts, Order links, mobile layouts, authorization and historical images/specifications after catalog changes. Do not restore customer Quote Ready or expose internal review evidence.
- [ ] Verify durable idempotent initialization and hold contracts for Specs 5/6 with standard, length-based, assembly and mixed Orders. Test consumers demonstrate the contract, not completed factory/shipping workflows.
- [ ] Run full project checks and focused browser/Worker acceptance with recorded commands, results and limitations. Identify test substitutes; do not claim real bank integration or provider delivery without evidence.
- [ ] Document deployment/migration checks and recovery that can stop payment mutations while preserving committed Orders/audit. Do not recover by deleting records or automatically deploy to production.

## Coverage from the First Draft

| Previous draft                                                  | Revised location                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| 01 Terms; 02 Cumulative receipts; 05 Channel changes            | Ticket 01                                                  |
| 03 Payment-last Order; 04 Acceptance-last Order; 11 Order views | Ticket 02                                                  |
| 06 Deadline extensions; 07 Late-payment review                  | Ticket 03                                                  |
| 08 Historical funds; 09 Excess funds                            | Ticket 04                                                  |
| 10 Confirmation correction                                      | Ticket 05                                                  |
| 12 Follow-on Quote                                              | Ticket 06                                                  |
| 13 Customer states and notifications                            | Shared requirements and workflow criteria in Tickets 01-06 |
| 14 Migration and complete acceptance                            | Ticket 07                                                  |

## Publication Record

1. Published one English GitHub Issue per ticket with Parent, What to build, Acceptance criteria, Shared requirements, applicable clarifications and Blocked by.
2. All seven issues are native sub-issues of Spec 4B #6. GitHub native dependency edges match the direct blockers in the table. The parent body and state were not edited.
3. Only Ticket 01 / #87 is `ready-for-agent`; Tickets 02-07 / #88-#93 carry `blocked` until their predecessors close. Update labels as the execution frontier advances.
4. Publishing tickets does not mean the Spec is implemented, deployed or closed.
