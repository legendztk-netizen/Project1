# Customer refund account and completion verification

Date: 2026-09-28

## Scope

Approved refunds expose a customer Order-header action and a refund account
dialog offering bank transfer or PayPal. Customer submission changes the Admin refund display to account
provided. Admin records an actual external remittance with its date, reference,
and account confirmation. The transaction closes the associated Case only when
its returns, inspections, and refunds are resolved. Admin terminology is
`退款账号`; the completion action is `已汇款，退款完成`.

Account submission does not perform a transfer or verify bank ownership. The
customer attests ownership and Admin confirms the account before recording the
remittance. Refund completion records money sent, not confirmed bank posting.
PayPal account submission records the account holder and PayPal email. Original
PayPal payments use the original transaction where available. Switching channels
creates an alternative account and requires existing per-refund Owner approval.

## Verified behavior

- Ownership and refund eligibility are checked server-side. Another customer
  cannot submit an account for the Order.
- Full account details and the command fingerprint are encrypted with AES-GCM.
  The bank-account key is derived separately from the environment's existing
  notification encryption secret; audit events contain account metadata only.
- Customer reads return a mask. Review-only Admin identities cannot obtain the
  decrypted details; refund permission is required.
- Updates append immutable versions. Concurrent updates, conflicting command
  retries, stale account selections, and changed remaining amounts are rejected.
- Exact retries are idempotent. Partial remittance and another unpaid refund
  keep the Case open; settling its final refund closes it once.
- Submission is unavailable before refund approval and after settlement.
- Form tests cover account entry, updates, conditional routing requirements,
  ownership confirmation, and the remaining-balance completion form.

## Validation

- D1 account and refund-initiation tests: 2 files, 8 tests passed.
- UI and workflow regression tests: 5 files, 22 tests passed.
- TypeScript, lint, formatting, whitespace checks, and local build passed.
- Local migration applied and verified: schema version 128.
- Live Admin Order page displays the waiting-for-account status and updated
  account terminology. No bank account or remittance was submitted to the
  user's sample Order during verification.

## Verification limits

The inspection browser had no customer session, so the live customer Order
redirected to sign-in. Customer entry and dialog behavior were verified through
component tests, and submission through isolated D1 integration tests. The
browser viewport override did not change the measured 1280-pixel viewport, so
live narrow-screen verification is not claimed. No production deployment was
performed.

## PayPal option follow-up

Customer UI now labels the action `Refund account`. Selecting PayPal requires
only the holder name, PayPal email, and ownership confirmation; bank-specific
inputs are not rendered or validated. Both original payment channels are eligible.
PayPal details use the same encrypted, immutable versioned store and permission
gates as bank details. Read summaries identify the channel without disclosing the
email. Admin displays the provided PayPal account and any required channel
approval, then uses the existing refund completion flow.

- Latest focused verification: 3 files, 15 tests passed (account service,
  refund initiation, and account UI).
- Both original-PayPal and bank-to-PayPal cases pass through refund completion
  and Case closure. Unapproved channel changes are rejected.
- Invalid PayPal email is rejected; exact retries are idempotent; reviewer-only
  and customer reads omit the full email, and stored payloads are encrypted.
- TypeScript and lint passed. Local schema version 129 applied and verified.
- The previously stated live customer-session and viewport limits still apply.

## Customer Update dialog follow-up

The customer requested that Update show the previously submitted information.
This supersedes the earlier mask-only customer-read behavior: while a refund is
payable, the authenticated owning customer receives their saved details through
the private, no-store Order loader. Ownership is checked before decryption.
Other customers are denied; Admin refund permissions and encrypted storage are
unchanged. Settled refunds do not return editable details.

The Update dialog prefills the saved channel, every bank field, or the PayPal
holder and email. Opening captures the displayed account version; a background
Order refresh cannot pair old form values with a newer version. Reopening loads
the latest saved values. Ownership confirmation remains required on submission.

Validation: customer-account D1 tests cover authorized bank/PayPal reads, denial
for another customer, encryption, settlement, versioning and refund completion.
UI tests cover field prefill, editing, country-specific requirements, and version
consistency during revalidation. Live customer-session limitations noted above
still apply.
