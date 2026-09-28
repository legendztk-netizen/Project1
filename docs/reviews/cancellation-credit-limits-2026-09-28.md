# Cancellation credit limit verification

Date: 2026-09-28

The reported Order has zero original freight, insurance, import charges, and
Sales Tax, with no existing refund or shipping-change credits. Its positive
logistics refund submission was correctly rejected by the database ceiling.
The UI exposed neither that ceiling nor a useful explanation, instead showing
a generic stale-state message and raw SQLite trigger text.

Admin cancellation decisions now show remaining logistics and tax refund limits
and constrain the numeric inputs. The service checks the same remaining amounts
before writing: original charges minus effective refund authorizations and
accepted shipping-change credits. Exceeding either ceiling returns a localized
400 input error with the remaining USD limit. Transactional database guards
remain in place; their logistics/tax errors are translated after rollback too.

Verification:

- Resolution integration suite: 9 tests passed, including zero original charges,
  rollback on invalid amounts, correction and retry, and previously used credits.
- Exceptional cancellation integration suite: 5 tests passed.
- Cancellation UI suite: 6 tests passed, including displayed limits and range
  validation for zero and positive remaining amounts.
- TypeScript, targeted lint, local build, and whitespace checks passed.
- The real Order's decision dialog visibly shows USD 0.00 for both limits.
  No decision was submitted and no customer financial record was changed.
