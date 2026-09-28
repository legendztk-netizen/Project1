# Spec 7 After-sales Operations and Release Handoff

This runbook covers pre-dispatch cancellation, After-sales Cases, Return
Authorizations (RA), receipt and inspection, refund decisions and revisions,
customer-provided refund accounts, and recording external remittances (Spec 7,
issues #102–#111 and subsequent changes). It is an operator handoff, not a
production deployment or evidence that money moved. The website records a
bank or PayPal refund only after staff completes it outside the website; it
does not transfer funds or confirm when the customer's account is credited.
Original PIs and Confirmed Orders are not edited: decisions and account updates
append new records.

## Launch return policy

New PIs freeze the single launch refund terms
`pi-refund-2026-09-27-v2` (public page `/policies/returns`). New Cases record
return policy `return-policy-2026-09-27-v2`. For an "Other problem", the
inspection decision applies seller or customer terms according to the actual
responsibility; the policy version recorded on the Order remains an audit fact,
not a decision branch.

| Rule                              | Value                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Convenience-return request window | Shipment's actual delivery date in `America/New_York` is day 0; open through 23:59 ET on day +14 |
| RA arrival                        | Issuance ET date is day 0; goods must arrive by 23:59 ET on day +30                              |
| Inspection decision target        | 5 US business days after receipt (next business day is day 1; 23:59 ET)                          |
| Refund initiation                 | 10 US business days after approval (or after customer confirms a deduction)                      |
| Convenience restocking fee        | 10% of the discounted merchandise approved for return, cumulative across partial decisions       |
| US Business Calendar              | `us-federal-bank-2025-2035-v1`; dates outside 2025–2035 fail with an explicit error              |

Admin records the Shipment delivery date as the US (ET) delivery date. Seller
error, damage and Nonconforming Product reports are not limited by the 14-day
window and never carry a restocking fee or payment-channel deduction. For an
"Other problem", Admin chooses the responsibility in the inspection decision:
seller terms, or customer terms (10% restocking fee, performed DDP charges not
refunded, documented third-party costs deductible) when inspection shows the
buyer caused it (incorrect selection, installation damage, misuse). The
decision's customer-visible reason must explain it.

## Permissions

The Owner has every after-sales permission. Admin Subaccounts receive none by
default. The Owner grants or removes them in **Admin > 账号权限**
(`/admin/settings/permissions`); every change is audited as
`admin.permissions_changed`. At launch, grant the second staff account both
permissions (ADR-0047). A subaccount can open the page to see its own
permissions but cannot change them.

| Permission           | Allows                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `after_sales.review` | Read/decide cancellations, Cases, RAs, receipts, inspections, revisions, evidence files                                                   |
| `after_sales.refund` | View the due-refund queue and record external remittance; together with `after_sales.review`, read full customer-provided account details |
| Owner only           | Approve an alternative account or payment channel for one exact refund, with a reason                                                     |

## Daily operation

1. **Admin > 取消与售后** lists due refunds (with overdue flags), open Cases and
   cancellation requests. The Order's **取消与售后** page has three child tabs:
   **售后案件**, **退款**, and **订单取消申请**. Each shows its record count and only its
   selected panel; queue links open the relevant tab. Case actions include RA
   issuance, refusal, receipt, inspection, revision and closure. The Case card
   keeps an operation record of each customer-visible decision. **Admin > 通知**
   shows new requests and internal overdue reminders (hourly cron
   `17 * * * *`).
2. **Messages.** All conversation happens in **Admin > 消息管理** (customers:
   **Messages** in the Personal Center): one conversation per Quote, continuing
   through its Order and Cases, with an Order summary and links. Filter by
   未读 / 待回复 or search by Order number, Quote number or email. Label a reply
   with the Case it is about. **内部备注** is Admin-only. Customer email replies
   arrive in the same conversation. Order and Case pages no longer carry
   replies.
3. **Standard cancellation.** A customer request holds the exact Shipment
   quantities; the Shipment cannot become Ready or Shipped while held.
   Decide each requested quantity and give the customer-visible reason for
   the decision (required for approvals and declines). Approved units leave the Shipment
   allocation; declined units release only this request's hold. Enter any
   recoverable logistics from a requote of the remaining work (not a freight
   proration) and any Sales Tax adjustment with its accepted basis. The form
   shows the remaining refundable logistics and tax limits, net of effective
   after-sales refunds and accepted shipping-change credits. An Order charged
   zero for these components has a zero limit; leave those inputs blank or
   enter 0. A documented non-refundable third-party cost makes the refund wait for the
   customer's gross-to-net confirmation; a dispute stays visible until
   resolved. A **交接冲突** flag means carrier handoff was recorded after the
   request (for example by a late handoff report); those units can only be
   declined.
4. **Made-to-order / cut hose.** Customers are sent to Support. After contact,
   record a Support review (**记录客服发起的…取消审核**) with the support
   reference; it holds the physical quantities (cut hose by piece count). The
   decision requires the factory-status dropdown, source, review time and
   Support reference. Choose **已确认未开始生产（软管尚未切割)** only when the factory facts
   support it; the other choices are **已开始生产 / 软管已切割**, **已完成生产** and **尚未核实**.
   Website production records are not required, and their absence never proves
   work has not started. Choose the responsibility: a customer-requested
   cancellation may deduct documented third-party costs; a seller-caused one
   (for example a configuration error on our side) deducts nothing. Cut hose
   can be approved only when the verified dropdown status is **已确认未开始生产（软管尚未切割）**;
   there is no separate pre-cut checkbox. If cutting has started or the status
   remains unknown, set the approved cut-hose quantity to 0. The Cutting &
   Labeling Fee is then reversed for the cancelled pieces (the PI's fee split evenly
   per cut piece, so cancelling every piece reverses all of it). Corrections
   use a new Follow-on Quote, PI, payment and Order.
5. **Cases.** Delivered quantities open one Case per report. The customer sees
   it under **After-sales Cases** in the Order with the next step,
   return instructions, refund amount and status, and the operation record.
   Discuss it in 消息管理 (**客户对话** on the Case card opens it). A
   customer's email reply to a Case notification is filed under the same Case.
   Closing a Case releases the units that were never received, so the
   customer can report them again; received units stay with the closed Case.
6. **RA.** Choose a maintained Return Location and write the packing
   instructions; both are frozen in the RA and shown only to the customer in
   that Case. Later location edits do not change issued RAs. Decline a return
   or close a Case with a customer-visible reason. RA, decline, close and
   inspection dialogs accept up to 5 PDF / PNG / JPEG attachments (10 MB in
   total); they are shared with the customer on that operation record.
7. **RA expiry and reauthorization.** An expired RA only closes that
   authorization; the Case stays open and nothing is refunded or declined
   automatically. To reauthorize, issue a new RA, link the expired one and
   record the renewed review. Quantities already received or still authorized
   cannot be authorized twice, and receipts on the expired RA and its
   reauthorization together can never exceed the Case claim.
8. **Receipt reconciliation.** Record the actual arrival time (Beijing time
   in the form), the evidence source and each package. A receipt entered later
   keeps its actual arrival time and its recording time. Arrival after the RA
   deadline is marked late and cannot be inspected until a late-arrival review
   is recorded; never backdate a receipt. Unauthorized or excess goods are
   noted on the receipt and not counted.
9. **Inspection and decision.** Perform the physical inspection offline. The
   six detailed condition fields (interfaces/threads, sealing surfaces, finish,
   packaging/accessories, installation evidence and fluid exposure) and internal
   notes are optional; blank fields do not assert that an item passed inspection.
   Enter approved quantities. A partial or declined decision requires a
   customer-visible reason; a full approval may have an optional explanation.
   A convenience return is always resolved under customer terms; if inspection
   finds a defect, ask the customer to report it
   as a problem so it gets its own seller-terms decision. The buyer-responsible
   path shows the 10% restocking fee, nonrefundable performed DDP charges and
   any additional documented third-party deduction to the customer; a positive
   third-party deduction requires evidence and customer confirmation. Seller
   responsibility cannot deduct these fees. Logistics and tax amounts are
   customer-visible; their notes are internal. Inspection photos remain
   internal until explicitly shared with a reason. Seller-caused replacement
   details are optional and create no payout.
10. **Refund account and remittance.** Once a payable refund is approved, the
    customer sees **Refund account** above the Order. They select a bank or
    PayPal account belonging to the original purchasing person or business.
    **Update refund account** reopens the saved details for editing and appends
    a new account version on submission. Submission changes Admin status to
    **收款账号已提供**; it neither verifies ownership nor moves money. Staff with
    both `after_sales.review` and `after_sales.refund` permissions can read the
    full account, verify it and
    remit outside the website. A channel change or other alternative account
    requires the Owner to use **Owner 批准替代账户** with a reason for this exact
    refund before remittance can be recorded. After the transfer, select the
    refund and account, confirm verification and actual remittance, and enter
    the ET remittance date and external transaction reference under
    **已汇款，退款完成**. That action records the entire remaining balance; partial
    external initiations remain supported by the service but do not use this
    completion action. Spec 6 shipping-change refunds share the same queue.
    A refund flagged **修订待复核，暂停发起** is on hold (see step 11). A Case closes
    automatically only when all of its claimed goods have been received, every
    receipt has a decision, no replacement remains, and every active Case
    refund is fully recorded without a hold. The website does not assert bank
    posting.
11. **Decision corrections.** Append a revision in the same Case; never edit a
    decision. Before any initiation the revised amount replaces the
    uninitiated authorization but keeps the original approval date and
    10-business-day deadline; an unchanged revision appends nothing. After
    initiation, an increase becomes a Supplemental Refund with its own
    deadline. A reduction that stays above what was already sent supersedes
    only the unpaid authorizations. A reduction that would claw money back,
    or that touches a partly sent refund, is flagged: recorded payouts stay
    untouched and every unpaid remainder is put on a Refund Hold. Agree the
    amounts with the customer in Messages, then append another revision; any
    revision that is not flagged releases the hold.

## Recovery

- **Stale version / conflict (409):** reload the Order and review current holds,
  receipts, account version and refunds. Retry with the same command only for
  the same payload. Do not update after-sales tables by hand; they retain the
  decision and account history.
- **Validation error (400):** correct the indicated input before retrying. For
  example, a cut-hose approval needs the verified uncut factory status, and a
  positive logistics/tax refund cannot exceed the Order's remaining amount
  originally charged for that component. Refreshing alone does not fix these
  inputs.
- **Alternative account approval:** a customer-provided PayPal account on an
  Order paid by bank transfer, or a bank account on an Order paid by PayPal,
  needs the Owner's approval for each selected refund. The staff checkbox that
  confirms account verification is not this approval.
- **Payment review hold or unverified funds:** refund authorization and
  remittance recording are refused until payment review resolves. Resolve the
  payment record first.
- **Failed or delayed email:** customer-visible status lives on the Order page
  and Case, and the message in Messages; it does not depend on email. Inspect `quote_notification_outbox`
  and retry the existing notification; never create a second business event.
- **External refund evidence:** keep the bank/PayPal transfer confirmation
  outside the website; the external reference and ET date recorded here must
  match it. The website does not promise a bank or PayPal posting date.

## Release checklist

1. Run the pre-migration inventory from the Spec 6 runbook, plus:
   `SELECT count(*) FROM admin_notifications; SELECT count(*) FROM
order_shipping_change_refund_reservations;` and record the results.
2. Apply migrations `0115`–`0128` with `pnpm migrate` (or the target
   environment command), then verify the target with the corresponding
   migration verifier. The current schema contract is version **129** (129
   migrations). `0123` adds Messages read state, Admin internal notes, Case
   labels and decision attachments. `0124` adds Case and cancellation review
   guards and moves earlier Case replies into Messages with their Case labels.
   `0125` adds permission versioning, per-message read records and immutable
   refund commitments; `0126` separates logistics and Sales Tax credits for
   cross-module limits. `0127` stores encrypted, versioned customer refund
   accounts, and `0128` permits PayPal in that store. Existing conversations,
   audit records and prior refund obligations must be retained during upgrade.
3. Confirm at least one complete maintained Return Location exists (label,
   multi-line address, phone).
4. In **账号权限**, grant `after_sales.review` / `after_sales.refund` to the
   intended subaccounts.
5. Confirm the hourly cron is enabled so overdue inspection and refund
   reminders are recorded.
6. Confirm the target Worker's notification encryption secret
   (`PREVIEW_NOTIFICATION_ENCRYPTION_KEY` or
   `PRODUCTION_NOTIFICATION_ENCRYPTION_KEY`) is configured before customers
   submit accounts; the refund-account key is derived from it. Inspect access to full
   account details. Test the same-channel path and a channel change requiring
   Owner approval on nonproduction records. Confirm that the remittance action
   is used only after money has actually been sent.
7. Outstanding external checks (not verifiable locally): real email delivery
   through the provider, production D1 migration inventory, bank/PayPal refund
   procedures and the Return Location's operating readiness.

## Verification record

The original 2026-09-28 Spec 7 acceptance run covered 184 test files (1214
passed tests, 3 skipped), formatting, lint, typecheck and migration verification
on a copy of local data at the then-current schema version 125. Those results
are a historical baseline; they do not verify the later account, PayPal,
permission, credit-limit and UI additions.

Follow-up English verification records cover [customer refund accounts and
completion](../reviews/spec-007-refund-account-verification-2026-09-28.md),
[alternative-account approval feedback](../reviews/refund-account-approval-feedback-2026-09-28.md),
[cancellation credit limits](../reviews/cancellation-credit-limits-2026-09-28.md),
[the cancellation dialog](../reviews/cancellation-dialog-layout-2026-09-28.md),
and [the three Order child tabs](../reviews/order-after-sales-subtabs-2026-09-28.md).
These are local tests with test data and stub email. They do not establish
production migration readiness, external email delivery, carrier events or
bank/PayPal settlement. The final branch check passed formatting, lint,
typecheck, 1,267 tests (3 skipped), a local Worker dry-run, the 38-test smoke
suite, and a production-build dry-run. The schema 129 production migration plan
passed in a temporary local database; it does not inspect production D1.
See the [final review and verification record](../reviews/spec-007-final-handoff-2026-09-28.md)
for the exact scope and limits.
