# Cancellation review dialog usability verification

Date: 2026-09-28

The review dialog now groups quantity, factory verification, financial treatment,
and customer explanation into numbered sections. Controls use consistent sizing,
short labels, contextual help, and a single-column layout on narrow screens.
Internal notes are optional and collapsed by default. A sticky footer displays
approved/requested quantities, the immutable-decision reminder, and a blue save
button with a busy label.

Positive logistics, tax, and third-party amounts require their corresponding
explanations in the browser, matching existing service validation. Seller
responsibility disables third-party deductions and excludes them from form
submission. Switching back to customer responsibility preserves draft values
and restores the evidence requirement. Closing and discarding the dialog resets
its derived summary when reopened.

Verification:

- 13 cancellation UI tests passed, including financial input limits, fee/evidence
  dependencies, responsibility switching, and discard/reopen state.
- TypeScript, targeted lint, formatting, and whitespace checks passed.
- Checked the actual local dialog at desktop and 390 px mobile widths. The
  mobile dialog and scroll body both measured 350 px client and scroll widths,
  with no horizontal overflow. The footer stays visible and the final fields
  remain reachable.
- Verified seller-responsibility controls become disabled in the browser.
  No actual cancellation decision or refund was submitted.
