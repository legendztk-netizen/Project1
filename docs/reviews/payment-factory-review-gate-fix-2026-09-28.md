# Payment factory-review gate correction

Date: 2026-09-28

## Finding

PI-3B822FFC5E3CC853F8860CF3 contained an ordinary length-based hose line with
no quoted specification overrides. Its USD 150 payment was fully recorded, its
accepted agreement was current, and its deadline had not passed. Quote issuance
correctly did not require factory review. Payment confirmation incorrectly
required factory confirmation for every made-to-order PI line, then returned the
generic `Payment changed; reload and review` conflict when its conditional insert
produced no confirmation.

## Correction

A shared transactional SQL predicate now mirrors the quote domain rule: factory
review is required for quoted specification overrides or a configured assembly
whose review outcome is not ready. Made-to-order classification alone does not
require review. Recorded factory confirmation satisfies the gate.

The predicate is applied to normal payment confirmation, Order creation, late
payment review and confirmation, and fund-allocation confirmation. The payment
read model and UI expose a specific factory-review blocker, and the normal
confirmation service returns an explicit error when factory review is required.
Amount, acceptance, agreement, deadline, dispute, and version checks remain intact.

## Verification

- Proforma Invoice D1 and payment-workspace suites: 42 tests passed.
- New regression cases confirm ordinary cut-hose payments and create exactly
  one Order for both acceptance-first and payment-first sequences.
- SQL/domain parity cases cover ordinary cut hose, specification overrides,
  ready and unresolved assemblies, missing outcomes, and confirmed review.
- UI regression verifies a specific disabled-action reason for pending review.
- TypeScript, targeted lint, local build, and whitespace checks passed.
- The affected live Admin payment page loaded successfully. No real payment
  confirmation, financial record mutation, or Order creation was performed by
  the agent on that PI. No production deployment was performed.
