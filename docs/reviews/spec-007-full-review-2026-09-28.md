# Spec 7, Messages, and after-sales review

Date: 2026-09-28. Review records are in English as requested.

The user confirmed the complete comparison from `main` to HEAD. The pinned command is `git diff ddb68214d3f42e624277d5d68cda5d29911376d1...4ca268aab9a67ef9c00ad93386e17818abeb343c`. Scope includes Spec 7 and the subsequent Messages, after-sales decisions, refund revisions, and Owner-managed permissions changes. Standards and Spec were reviewed independently, following `.agents/skills/code-review/SKILL.md`.

Sources: [originating issue #9](https://github.com/legendztk-netizen/Project1/issues/9), `docs/specs/007-after-sales-returns-and-refunds.md`, `CONTEXT.md`, the applicable ADRs, `docs/tickets/spec-007-ticket-review.md`, and `docs/operations/spec-7-after-sales.md`. Later documented requirements were considered alongside the original issue; their mere absence from the original issue is not treated as scope creep.

## Standards

### S1 — P1: Permission updates omit the mutation-origin guard

Location: `app/modules/admin/routes/admin-permissions.tsx:34–45`.

The new action verifies that the authenticated identity is an Owner, but does not apply `requireReviewMutation`, which rejects non-POST and foreign-Origin requests. A missing command ID is replaced with a UUID, so it does not prevent a forged form submission. The worker validates the destination Admin origin, not the incoming `Origin` header.

An isolated invocation of the actual action, with an authenticated Owner context and a foreign Origin, returned 302 and granted `after_sales.refund` to a subaccount. A browser attack additionally requires the authenticated credentials to accompany the request; deployed cookie/Cloudflare behavior was not tested. This is a confirmed application-boundary omission, not evidence of a deployed compromise.

Basis: the surface/action authorization boundary in ADR 002 and the repository's existing mutation guard. Apply the guard before parsing or mutating permissions, and verify that a foreign-Origin request cannot change grants.

### S2 — P2: Concurrent permission saves combine unintended grants

Location: `app/modules/admin/infrastructure/d1-admin-permissions.ts:77–95`.

The repository reads the previous permission set before its batch, then calculates only the grants and revocations relative to that snapshot. Two concurrent saves starting from an empty set, one requesting review-only and another refund-only, both succeed and leave both permissions. Neither save requested that final state. Each audit event nevertheless records only its submitted set as `after`.

This was reproduced against the actual repository with an isolated SQLite adapter. Basis: ADR 003's current-version/conditional-write requirement and CONTEXT's accurate before-and-after audit record. Guard the replacement with an expected version and reject stale saves; ensure the audit reflects the committed transition.

### S3 — P3: Internal-note audit events omit request provenance

Location: `app/modules/message-center/infrastructure/d1-message-center.ts:338–347`.

The new audit payload contains only `noteId` and `caseId`. It records the actor and affected Quote Conversation, but no IP address or explicit command/request correlation in the event. The note row separately stores its command ID; the affected Quote request ID is not an HTTP request identifier.

Basis: `CONTEXT.md:160–164` requires a request identifier and IP address for significant Admin audit events; ADR 0027 requires request attribution. Carry the request metadata into the service and write it with the note/audit batch. This finding is based on inspection of the complete write path.

## Spec

### F1 — P1: Original shipping charges can be credited twice

Location: `migrations/0116_cancellation_resolutions_and_refund_authorizations.sql:293–300`.

The original-logistics limit subtracts other after-sales logistics authorizations but omits effective Spec 6 shipping-change credits. The preceding total-Order limit includes those credits, but that does not protect an individual component while unused merchandise balance remains.

Isolated migrated-D1 reproduction: an effective 700-cent shipping credit with its reservation, followed by a cancellation authorization refunding the full 4,500 cents of original logistics, succeeds. The combined logistics entitlement is 5,200 cents against 4,500 originally charged. This uses original outbound logistics, not additional seller-funded return/replacement expenses.

Requirement: Spec 7 says refunds must reconcile existing credits “without double-counting the same entitlement” (`docs/specs/007-after-sales-returns-and-refunds.md:132`). Account for effective shipping adjustments in the original-logistics component limit. The reproduction demonstrates over-authorization; it does not claim an external payment was sent.

### F2 — P2: Inspection revisions fail for the same line across split Shipments

Location: `app/modules/after-sales/application/decision-revision-service.ts:450–473`.

`creditsBeyond` emits one credit for each Shipment-level decision line, while the credit table has a unique key on `(authorization_id,line_id)`. The same Order line can legitimately be present in multiple Shipments.

Reproduction: receive one unit of the same line from each of two Shipments in one return receipt; initially decline both, then revise the decision to approve both. The initial workflow succeeds; the revision returns 409 with `UNIQUE constraint failed: after_sales_refund_line_credits.authorization_id, after_sales_refund_line_credits.line_id`.

Requirement: Spec 7 explicitly covers independently delivered split quantities and appended decision revisions (`docs/specs/007-after-sales-returns-and-refunds.md:150–151`). Aggregate credits by Order line while retaining Shipment-level decision detail; reconcile prior credits once per line.

### F3 — P2: Renewed confirmation restarts an existing refund deadline

Location: `app/modules/after-sales/infrastructure/d1-refund-authorizations.ts:153–166`; confirmation at `app/modules/after-sales/application/refund-response-service.ts:75–78`.

A revision requiring customer confirmation of third-party deductions enters `awaiting_customer_confirmation`. Authorization creation then discards the carried commitment; confirmation calculates a fresh deadline from the new response time.

Reproduction: a convenience refund with a documented 100-cent third-party deduction is confirmed on September 24, revised before any initiation, and confirmed again on September 28. The deadline changes from October 8 ET to October 13 ET (`2026-10-09T03:59:00.000Z` to `2026-10-14T03:59:00.000Z`).

Requirement: `CONTEXT.md:939–940` states, “Before any initiation, the revised refund keeps the original approval deadline.” Preserve and reuse that commitment through renewed confirmation.

### F4 — P2: A delayed upload can arrive without an unread indicator

Location: `app/modules/message-center/infrastructure/d1-message-center.ts:23–26` and equivalent unread queries.

Unread detection compares message `created_at` with the reader's timestamp cursor. Message creation time is assigned before attachment upload, so it can precede messages committed and read while that upload is still pending.

An isolated integration reproduction paused the customer's R2 upload, let the administrator send a newer message and read the conversation, then completed the customer upload. The administrator had never seen the customer message, yet the unread-thread count was 0 instead of 1.

Requirement: the Messages unread-count contract (`CONTEXT.md:364–369`). Use committed/observed-message tracking that cannot classify a later insertion as already read. Adding only an ID tie-breaker does not solve this older-timestamp insertion case.

### F5 — P2: Decision forms advertise multiple attachments but reject them

Location: `app/modules/after-sales/ui/admin-action-dialog.tsx:74–79`; action entry at `app/modules/admin/routes/confirmed-order-detail.tsx:233`.

The shared decision field allows multiple files and advertises up to five. However, the Order action first uses `readPrivateReviewForm`, whose existing single-file restriction throws before the after-sales action's five-file validation runs.

An actual multipart request containing two tiny PDF files returned `400 / Only one file is permitted` from `app/modules/quote-review/domain/private-review.ts:35–38`. A valid advertised selection therefore prevents the decision from being submitted.

Requirement: customer-visible decisions with attachments (`CONTEXT.md:998–1002`) and the implemented five-file UI contract. Align the parser with the after-sales action's file count, type, and aggregate size limits, preserving other callers' intended restrictions.

## Verification and limits

- Existing targeted suites passed: message-center D1 integration, message-center routes, after-sales Cases UI (13 tests), and admin notifications D1 integration (3 tests). The notification suite initially hit its 60-second setup timeout during concurrent database probes; its isolated rerun passed all 3 tests.
- Three additional isolated business-flow regression demonstrations failed at the pinned HEAD as described in F1–F3. Evidence and rerun instructions are in `.scratch/spec7-review-20260928/after-sales-spec-reproductions-results.md`; the test source is alongside it.
- The additional delayed-upload regression demonstration failed as described in F4. Its source is `.scratch/spec7-review-20260928/review-message-unread-20260928.test.ts`; copy it back into `test/` to resolve its original relative imports before running it with Vitest.
- The permissions checks used the actual action/repository with an isolated SQLite adapter. The attachment check directly exercised the shared request parser. No live business data or production implementation was modified. Temporary failing tests were moved outside `test/` after the review.
- This is a focused review, not a full-suite, deployed-browser, email-provider, or payment-provider certification. Passing existing tests does not cover the reproduced edge cases. No scope-creep finding is reported, and no heuristic-only code smell is presented as a hard standards violation.

Standards: 3 findings, worst P1 (permission mutation origin guard). Spec: 5 findings, worst P1 (duplicate original-logistics entitlement).
