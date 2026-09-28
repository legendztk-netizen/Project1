# Cancellation factory-status verification

Date: 2026-09-28

The reported failure was caused by the separate pre-cut confirmation being
unchecked. It was incorrectly returned as a 409 stale-record error.

At the user's request, the review form now uses a required factory-status
selection: confirmed not started (hose uncut), in production / hose cut,
production completed, or unverified. The separate checkbox is removed. The
form parser records the selected label and derives the pre-cut fact from that
selection. Blank and arbitrary status values are rejected; submitting the old
checkbox cannot override the selected status.

Cut-hose approval still requires a confirmed uncut state for every approved
quantity. Other states permit declining the request. An incompatible approval
returns a localized 400 input error rather than asking the operator to reload.
The stored factory record, source, review time, and database protections remain
in place. No schema migration is required.

Verification:

- Cancellation UI and exceptional-cancellation integration suites: 17 tests
  passed, including dropdown parsing, invalid status values, approval without
  the old checkbox, rejected approvals, and a successful decline.
- TypeScript, targeted lint, and whitespace checks passed.
- Opened the actual local Order review dialog and verified the dropdown and
  removal of the checkbox. No real cancellation or refund was submitted.
