# Refund account approval feedback verification

Date: 2026-09-28

The reported cancellation refund was paid originally through bank transfer,
while the customer supplied a PayPal refund account. The account was correctly
classified as alternative and lacked the existing per-refund Owner approval.
The completion dialog nevertheless offered it for submission, and the service
relied on a database trigger whose raw exception became a misleading stale-state
message.

The completion dialog now filters alternative accounts by exact destination,
refund kind, and refund ID. It explains the missing Owner approval and disables
submission if no usable account exists. Switching refunds recalculates eligible
accounts and resets account selection. Original-channel accounts remain usable.

The service performs the same exact approval lookup before constructing writes
and returns an actionable Chinese 400 response. The database approval guard is
unchanged. A checked remittance/account confirmation is not treated as Owner
approval.

Verification:

- Refund initiation and customer refund-account D1 integration suites: 10 tests
  passed, including unapproved rejection, approval followed by successful
  initiation, changed accounts, and customer-provided PayPal accounts.
- Refund-account UI suite: 8 tests passed, including exact refund/account/kind
  matching and switching to a refund without approval.
- TypeScript, targeted lint, and whitespace checks passed.
- Opened the actual Order's completion dialog: the account selector and submit
  button are disabled and the Owner-approval guidance is visible. No live
  approval, refund initiation, or financial record was submitted.
