# Spec 6 Implementation Checkpoint

Status: in progress. No Spec 6 ticket has been accepted or closed.

Baseline: `62d0373` on `main`. Work branch: `codex/spec6-work`.

## Implemented so far for #94

- Validated physical shipment quantities and per-group charges, including cut
  hose piece counts rather than pricing footage.
- Captured structured groups in new reviewed commercial terms, quote revisions,
  PI snapshots, customer quote projection, PI PDF and material-change comparison.
- Added D1 plan/shipment/allocation/hold tables and idempotent initialization
  during confirmed-order creation; backfilled unambiguous historical together
  orders while leaving historical split prose for review.
- Added authorized Admin/customer plan reads, historical split mapping with
  version and command identity, order-detail plan views and list summaries.

## Verification completed

- `pnpm typecheck`: passed.
- `pnpm exec vitest run test/shipment-plan.test.ts`: 3 passed.
- `pnpm exec vitest run test/quote-commercial-terms.test.ts`: passed.
- `pnpm exec vitest run test/quote-preparation-d1.integration.test.ts`: 10 passed.
- `pnpm exec vitest run test/proforma-invoice-d1.integration.test.ts`: 27 passed.
- `pnpm migrate` against a temporary D1 directory: passed to schema version 93.
- `git diff --check`: passed.
- `pnpm lint`: passed. A direct Prettier check found formatting differences,
  which were corrected and committed.
- `pnpm migrate:verify` against the temporary D1 directory: passed at version 93.

## Pause note

The latest addition to `test/proforma-invoice-d1.integration.test.ts` covers
payment-first acceptance of two accepted split shipment groups. It was written
immediately before the user's pause request and has **not been run yet**.
Run that test and `pnpm typecheck` first when resuming. The checkpoint commits
are local only; no Spec 6 code has been pushed.

## Remaining before #94 acceptance

- Exercise and verify historical split mapping against D1, including retry,
  concurrent/stale writes, payment/quantity holds and ownership.
- Verify new structured split PI through order initialization and check exact
  allocations/charges and rollback on malformed evidence.
- Test migration against populated legacy orders and inspect mobile Admin and
  customer views; resolve any findings.
- Perform standards/spec code review and run the required broader checks.

After #94, implement #95-#99 in their published dependency order. No Spec 6
GitHub issue has been relabeled or closed, and no incomplete code has been
pushed to `main`.
