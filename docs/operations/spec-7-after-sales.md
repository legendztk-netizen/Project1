# Spec 7 After-sales Operations and Release Handoff

This runbook covers pre-dispatch cancellation, After-sales Cases, Return
Authorizations (RA), receipt and inspection, refund initiation and decision
revisions (Spec 7, issues #102–#111). It is a local acceptance and operator
handoff, not a production deployment or evidence that money moved. The website
records refunds initiated outside it; it never executes a bank or PayPal
transfer. Original PIs and Confirmed Orders are never edited: every step
appends its own record.

## Launch return policy

There is one launch policy (`pi-refund-2026-09-27-v1` in new PIs, public page
`/policies/returns`). No pre-launch Orders exist, so no earlier policy version
is mapped.

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
window and never carry a restocking fee or payment-channel deduction.

## Permissions

The Owner has every after-sales permission. Admin Subaccounts receive none by
default; grant them explicitly (there is no UI yet):

```sh
pnpm exec wrangler d1 execute hydraulic-hose-rfq-local --local --command \
  "INSERT INTO admin_identity_permissions(admin_id,permission,granted_by,granted_at)
   VALUES ('<subaccount id>','after_sales.review','<owner id>',CURRENT_TIMESTAMP)"
```

| Permission           | Allows                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| `after_sales.review` | Read/decide cancellations, Cases, RAs, receipts, inspections, revisions, evidence files |
| `after_sales.refund` | Verify refund destinations, view the due-refund queue, record external initiation       |
| Owner only           | Approve an alternative refund destination for one exact refund                          |

## Daily operation

1. **Admin > 取消与售后** lists due refunds (with overdue flags), open Cases and
   cancellation requests. Work each item from the Order's **取消与售后** tab:
   each Case is one card with its actions as buttons (签发退货授权（RA）,
   不予授权, 关闭案件, 记录收货, 检验并决定退款, 修订检验决定); each opens a
   dialog, and the Case keeps an operation record of every customer-visible
   decision. **Admin > 通知** shows new requests and internal overdue reminders
   (hourly cron `17 * * * *`).
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
   proration) and any Sales Tax adjustment with its accepted basis. A
   documented non-refundable third-party cost makes the refund wait for the
   customer's gross-to-net confirmation; a dispute stays visible until
   resolved. A **交接冲突** flag means carrier handoff was recorded after the
   request (for example by a late handoff report); those units can only be
   declined.
4. **Made-to-order / cut hose.** Customers are sent to Support. After contact,
   record a Support review (**记录客服发起的…取消审核**) with the support
   reference; it holds the physical quantities (cut hose by piece count). The
   decision requires actual factory status, source and review time; website
   production records are not required and their absence never proves work
   has not started. Cut hose can be approved only with documented pre-cut
   facts; the Cutting & Labeling Fee is then reversed in full. Corrections use
   a new Follow-on Quote, PI, payment and Order.
5. **Cases.** Delivered quantities open one Case per report. The customer sees
   it under **Returns and problem reports** in the Order with the next step,
   return instructions, refund amount and status, and the operation record.
   Discuss it in 消息管理 (**客户对话** on the Case card opens it).
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
   cannot be authorized twice.
8. **Receipt reconciliation.** Record the actual arrival time (Beijing time
   in the form), the evidence source and each package. A receipt entered later
   keeps its actual arrival time and its recording time. Arrival after the RA
   deadline is marked late and cannot be inspected until a late-arrival review
   is recorded; never backdate a receipt. Unauthorized or excess goods are
   noted on the receipt and not counted.
9. **Inspection and decision.** Record interfaces/threads, sealing surfaces,
   finish, packaging/accessories, installation evidence and fluid exposure for
   every received unit. Every decision, including a full approval, needs a
   customer-visible reason. Inspection photos are Internal until explicitly shared with a
   reason. Seller-caused replacements record scope, costs and fulfilment
   evidence and create no payout.
10. **Refund initiation.** Verify the destination first: the original receipt
    channel for the same Purchasing Context (record only the last four account
    characters and the verification basis). Initiate the refund outside the
    website, then record the actual amount, ET date, channel and external
    reference. Partial initiations are allowed up to the authorized amount.
    Spec 6 shipping-change refunds appear in the same queue with their original
    reservation date.
11. **Decision corrections.** Append a revision in the same Case; never edit a
    decision. Before any initiation the revised amount replaces the
    uninitiated authorization. After initiation, an increase becomes a
    Supplemental Refund with its own deadline; a reduction is flagged for
    review and leaves recorded payouts untouched (no automatic clawback).

## Recovery

- **Stale version / conflict (409):** reload the Order and review current holds,
  receipts and refunds. Retry with the same command only for the same payload.
  Do not update after-sales tables by hand; they are append-only.
- **Payment review hold or unverified funds:** refund authorization and
  initiation are refused until payment review resolves. Resolve the payment
  record first.
- **Failed or delayed email:** customer-visible status lives on the Order page
  and Case, and the message in Messages; it does not depend on email. Inspect `quote_notification_outbox`
  and retry the existing notification; never create a second business event.
- **External refund evidence:** keep the bank/PayPal confirmation outside the
  website; the external reference recorded here must match it. The website
  does not promise a bank or PayPal posting date.

## Release checklist

1. Run the pre-migration inventory from the Spec 6 runbook, plus:
   `SELECT count(*) FROM admin_notifications; SELECT count(*) FROM
order_shipping_change_refund_reservations;` and record the results.
2. Apply migrations `0115`–`0123` with `pnpm migrate` (or the target
   environment command) and verify with `pnpm migrate:verify` (schema version
   124). `0123` adds Messages read state, Admin internal notes, Case labels
   on messages and decision attachments; existing conversations are kept and
   show as unread once for each Admin. The upgrade keeps Admin notifications and read receipts, keeps Spec 6
   shipping credits counted once and creates no after-sales records.
3. Confirm at least one complete maintained Return Location exists (label,
   multi-line address, phone).
4. Grant `after_sales.review` / `after_sales.refund` to the intended
   subaccounts.
5. Confirm the hourly cron is enabled so overdue inspection and refund
   reminders are recorded.
6. Outstanding external checks (not verifiable locally): real email delivery
   through the provider, production D1 migration inventory, bank/PayPal refund
   procedures and the Return Location's operating readiness.

## Local verification (2026-09-27, updated for Messages)

| Check                                              | Result                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Passed                                                                                                                                                                                                                                                                                                    |
| `pnpm test`                                        | 182 files passed, 1 skipped; 1191 tests passed, 3 skipped                                                                                                                                                                                                                                                 |
| After-sales suite (`test/after-sales-*`)           | 13 files, including the mixed-Order workflow with money/quantity conservation and the Spec 6 → Spec 7 upgrade-migration test                                                                                                                                                                              |
| Messages (`test/message-center-*`)                 | Per-Order conversation with Case labels, owner-only access, per-reader unread state, Admin-only notes, one email per reply, decision attachments limited to their Case                                                                                                                                    |
| `pnpm migrate:verify`                              | Local schema version 124, 124 migrations, ready                                                                                                                                                                                                                                                           |
| `pnpm test:smoke` (includes `pnpm build`)          | 7 files passed, 38 tests passed                                                                                                                                                                                                                                                                           |
| Live pages (copy of local data, port 5186)         | Issued an RA with an attachment, recorded receipt, published an approval (reason required), sent customer and Admin messages and an internal note; customer saw the RA, attachment, refund amount/status and reply but not the note. Customer Messages and Returns tab have no horizontal scroll at 375px |

These are local tests with stub email and test data. They do not establish
production migration readiness, external email delivery, carrier events or
bank/PayPal settlement. The live-page check ran against a copy of the local
database so that no test records were added to the working data.
