# Spec 3 Ticket 14 Verification

Date: 2026-09-03 (Asia/Shanghai)

Scope: GitHub Issue #48, tested locally against the real Wrangler D1 database.
No preview or production resources were contacted.

## Browser flows

### Desktop anonymous-to-RFQ

- Viewport: 1440 x 1000.
- Added `ADP_ST_JIC_M_02_NPT_M_02` to an anonymous Quote List.
- Set quantity to 100 and registered `ticket14.browser@example.com` with the
  local six-digit OTP delivery stub.
- Confirmed the anonymous line merged into the verified account.
- Added and selected a complete US delivery address.
- Confirmed both request acknowledgements and submitted the RFQ.
- Confirmation displayed `QR-20260903-3CDE213D` and stated that it was not an
  order or payment receipt.
- `My Quotes` immediately returned the same RFQ with `RFQ Submitted`, DDP and
  the USD 226.00 merchandise reference.

### Mobile anonymous-to-RFQ

- Viewport: 390 x 844.
- Repeated anonymous product preparation, quantity refresh, registration and
  address selection with `ticket14.mobile@example.com`.
- Submitted RFQ `QR-20260903-A8F4BB07` and retrieved its confirmation and
  responsive Account & Lists / My Quotes surfaces.
- No horizontal overlap or clipped primary control was observed on sign-in,
  Personal Center, Quote List or the confirmation page.

### Guest configuration handoff

- Started a guest `601R1_002` configuration and attempted to leave the page.
- The modal retained focus, exposed Stay, Discard and Register to Save, and
  stated that an email address alone does not own a draft.
- Registered `ticket14.saved@example.com` with the local OTP stub.
- The exact hose draft appeared once under account-owned Saved Configurations.
- Resume opened an isolated working copy with the hose and size restored.
- The application exposes no standalone email draft save or recovery route.

All accounts, addresses, drafts and RFQs above are local D1 test records.

## Security matrix

`pnpm test:smoke` passed 20 tests against real local D1 state. The suite
exercises:

- forged and tampered anonymous cookies plus expired session recovery;
- expired, replayed, superseded, malformed and five-attempt-locked OTPs;
- same-origin enforcement for authentication, account and RFQ mutations;
- customer-scoped profile, address, saved configuration and RFQ reads;
- organization membership and Primary Company Contact enforcement;
- repeated RFQ submission idempotency and transaction rollback;
- immutable submitted RFQ update and delete triggers;
- absence of anonymous email draft endpoints.

The expected CSRF, missing-route and forced-D1-rollback errors appear in test
logs because the suite deliberately invokes those failure paths.

## Accessibility

- Browser checks covered native keyboard controls, visible focus, labels,
  status/error announcements and modal focus containment.
- Desktop and mobile layouts were inspected for sign-in, Account & Lists,
  Quote List, RFQ confirmation and My Quotes.
- `test/customer-auth-accessibility.test.tsx` adds focused regression coverage
  for email and OTP labels, autofocus, numeric OTP semantics, alert
  announcements, sign-in method navigation and password recovery reachability.
- Existing component tests cover account navigation keyboard reachability and
  guest configuration modal focus trapping and Escape behavior.

## Commands and results

- `pnpm migrate`: no pending migration; local schema version 40.
- `pnpm migrate:verify`: 40 migrations, readiness `ready`.
- `pnpm test:smoke`: 1 file, 20 tests passed against local D1.
- `pnpm check`: formatting, lint, typecheck, 44 files / 318 tests, local build
  and Wrangler dry-run all passed.
- `pnpm deploy:validate:production`: configuration, fresh migration validation,
  production build, Wrangler production dry-run and health smoke all passed.
  Named placeholder resources were used; the warning for absent production
  secrets is expected in validation mode.

## Secret scan

- `.dev.vars` is absent from the worktree and is not tracked.
- Current worktree and full configuration history were scanned for Resend,
  GitHub, OpenAI, private-key, Cloudflare account-ID and D1-ID credential
  patterns.
- No real secret pattern was found in history or deployment configuration.
- `wrangler.jsonc` contains named `replace-with-*` placeholders and
  `.env.example` contains empty secret declarations only.

Production Resend credentials and real Cloudflare resource IDs remain launch
configuration, not local Ticket 14 inputs.
