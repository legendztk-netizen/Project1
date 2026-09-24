# Spec 6 Implementation Checkpoint

Status: in progress. Ticket #94 is in final verification; #95-#99 remain.

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
- Added versioned historical allocation correction, audited before/after groups
  and database protection against direct deletion. Corrections reject holds,
  stale versions and post-handoff shipments.
- Added deployment-gap catch-up and payment-hold-aware migration backfill.
  Unscoped holds reserve only their physical quantity, leaving unaffected
  batches eligible for allocation.
- Kept issued legacy Quote Revisions compatible without inventing structured
  historical split agreements. New Quote Revisions still require exact groups.

## Verification completed

- `pnpm typecheck`: passed.
- `pnpm exec vitest run test/shipment-plan.test.ts`: 3 passed.
- `pnpm exec vitest run test/quote-commercial-terms.test.ts`: passed.
- `pnpm exec vitest run test/quote-preparation-d1.integration.test.ts`: 10 passed.
- `pnpm exec vitest run test/proforma-invoice-d1.integration.test.ts`: 29 passed.
- Targeted migration test covering held and deployment-gap Orders: passed.
- `pnpm migrate` against local D1: passed to schema version 94. No remote D1
  was changed.
- `git diff --check`: passed.
- `pnpm lint` and `pnpm typecheck`: passed after the review fixes.
- Browser check: local Admin Order detail and Shipment tab load at a narrow
  viewport with physical quantities and no overlap.

## Remaining before #94 acceptance

- Run the full test/build/format/health suite after the last changes.
- Complete final two-axis code review and resolve any remaining findings.
- Verify customer navigation using an authorized browser session, or document
  the auth limitation if unavailable; ownership is covered by integration tests.
- Commit and push #94, update its Issue, then implement #95-#99 in dependency
  order with their own verification and reviews.

No Spec 6 GitHub issue has been closed, and no incomplete code has been pushed
to `main`.
