# Spec 4A implementation evidence

## Ticket 03 / #51

Local implementation adds `/admin/quotes/:requestId/private` and an authenticated,
quote/actor-scoped download endpoint. Notes and evidence metadata are append-only;
mutations and audit events commit atomically. Upload retries use stable commands.
PDF/PNG/JPEG files are capped at 10 MB with bounded multipart parsing and stored
under private, random R2 keys. Downloads expire after five minutes, verify SHA-256,
and are served as attachments with no-store headers. Customer projections remain
separate and are scanned for seeded private content by integration tests.

- Real isolated local D1/R2 tests: immutable records, audit identity, retry replay,
  cross-quote/actor denial, expiry, byte tampering, and failed-audit rollback.
- Domain and route tests: missing Admin identity, cross-origin rejection, file
  signatures, total-body bounds, and extra file parts.
- Browser: existing local test RFQ `QR-20260903-3CDE213D`, note submission verified;
  desktop and 390px mobile layout inspected. Test note is explicitly labelled.
- `pnpm typecheck` passed. Focused suite: three files, seven tests passed.
- Local schema migrations 0062/0063 advance readiness to 64; no remote deployment.

Standards review identified idempotency and multipart limits; both were corrected.
Spec review identified cache headers and missing failure/projection checks; these
were added. Full Spec 4A checks and end-to-end acceptance remain Ticket 15 / #63.

## Ticket 04 / #53

`/admin/quotes/:requestId/pricing` starts/resumes a separate versioned preparation
draft from the exact RFQ JSON/hash. Final prices are explicit USD cents and manual
discounts use basis points. Length-based lines multiply captured total footage;
other lines preserve their captured sales unit. Optimistic version checks and
stable commands prevent stale overwrites and duplicate pricing audit events.

Legacy catalog Cost Basis is a separately labelled Admin-only context; it is not
asserted to describe a newer item revision and is never copied into draft pricing,
RFQs or pricing audit payloads. Current item-series/image changes cannot mutate
the captured source.

Focused tests: three arithmetic tests and three real local D1 tests pass. Coverage
includes simultaneous start/save, retries, cost projection isolation, and an actual
item-series/image update after source capture. Typecheck passes. Browser verified
100 units x USD 2.50 less 10% = USD 225.00 with the USD 2.26 reference unchanged;
desktop/mobile inspected. Migration0064 advances local readiness to 65.

Review findings corrected: captured sales-unit labelling, honest legacy-cost
provenance, and meaningful private-cost/catalog-change integration coverage.

## Ticket 05 / #52

`/admin/quotes/:requestId/terms` records confirmed delivery address, reviewed
replacements, shipment plan, transport, packing estimate, quantity-sensitive lead
time, Incoterm/named place, explicit tax treatment and separately itemized USD
charges. Freight-review confirmation is required; actual packing data is optional.
Exemption evidence must be a private tax record belonging to the same RFQ.
Original RFQ references remain unchanged; no automatic FX is performed.

Schema migration0065 advances local readiness to66. Eight focused tests cover
domain completeness, DAP and split-plan preservation, optional actual packing,
real D1 persistence, associated/foreign evidence, canonical command replay and
shared price/terms version checks. Browser saved the labelled local test RFQ:
USD225 merchandise plus USD20 freight = USD245; version2 advanced to3.
Desktop and390px mobile layouts inspected without horizontal overflow.

Review fixes: test setup ordering, canonical payload hashing, freight review
confirmation and missing acceptance cases. Separate pricing/terms SQL remains
explicit; common command-table semantics are covered together by integration tests.

## Ticket 06 / #54

`/admin/quotes/:requestId/issue` explicitly issues the first immutable USD offer.
The command checks Admin identity, RFQ hash, preparation version, full prices and
commercial terms, associated tax evidence and advisory factory-review confirmation.
Schema0066 stores numbered revisions with immutable JSON/hash, captured source,
actor and timestamp; unique operation/version constraints and an atomic audit
prevent duplicate first issuance. Customer My Quotes shows Quote Ready and the
owned detail shows explicit prices, discounts, fees and delivery terms without
private evidence or review fields. Length-based offers show piece count, cut
length and the total-footage pricing basis separately.

Ten focused tests passed across three files, including real local D1 distinct
issuance races, same-command replay, a controlled edit between validation and
insert, update/delete denial, post-issue catalogue changes, private projection,
one-query list progress and rendered length-based offer contents. Typecheck and
build passed. Local schema67 is ready. Browser issued revision1 of the labelled
test RFQ at USD245; desktop and390px views inspected without horizontal overflow.

Both review axes identified the missing length pricing basis and concurrency
coverage; corrected. Standards review also identified per-RFQ list queries; the
list now obtains only offer availability in its existing owned-record query.

## Ticket 07 / #55

`/admin/quotes/:requestId/revisions` starts a version-checked preparation from the
current immutable offer. Published preparations cannot be edited directly. Product
replacement/addition resolves the current item-aware catalogue; existing captured
products remain historical. Structured quantity/length edits and reviewed Surface
finish, Marking and Packaging amendments are supported. Product changes reset
commercial review and replacement prices require explicit USD entry.

Issuance requires material differences and a reason, advances the current offer
atomically and retains every previous version. Original RFQ evidence is retained
separately from effective quoted lines. Customer detail derives current/history
from one read and displays owned proposed changes as Not yet issued. Internal
review flags, reference cost objects and arbitrary nested metadata are excluded.
No PI mutation or lifecycle work is included here.

Migration0067 advances local readiness to68. Twenty-four focused tests passed,
including actual local D1 successor races, replay, stale/no-op rejection,
product edits, original evidence retention, ownership, safe nested projections
and consistent current/history reads. Typecheck passed. Browser issued revision2
of the local test RFQ at USD132.50 (50 pieces), while revision1 remains USD245
(100 pieces). Desktop and390px history inspected; no horizontal overflow.
Review corrections covered unissued customer preview, stable line ordering,
restricted named amendments and explicit customer-safe difference projection.
Assembly component amendments now have structured End A/B and ferrule, measurement,
Clocking and protection controls. Explicit all-component current-catalogue review
is required before rebuilding through the existing configurator validator. The
outer product snapshot is synchronized with rebuilt component evidence; unchanged
assemblies retain historical selections. Mixed/non-USD amended reference offers
require the separate final USD/import-term confirmation. Four additional real D1
cases cover protection, unsafe selections, double-elbow135-degree clocking,
original snapshot retention and the hose-replacement boundary. Build passed.

## Ticket 08 / #56

One authenticated customer-visible conversation is shared by all revisions of
an RFQ. Admin and customer detail link to their respective conversation routes;
messages are append-only, plaintext, role/time-labelled and cursor-paginated.
Customer authorization uses current RFQ ownership, including current organization
primary-contact membership. Internal notes and review evidence are not projected.

Optional PDF/PNG/JPEG uploads are structurally validated, extension-normalized,
limited to 10 MiB, and stored privately with checksums. Downloads require the
same quote permission and return no-store, sandboxed attachment responses.
Structural validation is not a claim of malware scanning. Customer sends are
limited to 20 per ten minutes; a conversation has a 100 MiB attachment budget.
Atomic reservations precede uploads. Expired reservations are fenced against
late appends, reconciled on the next authorized send, and replaced by empty R2
tombstones before releasing quota; conditional uploads cannot resurrect bytes.
Committed attachments are never overwritten during reconciliation. Unmappable
pre-fix legacy upload reservations require inventory-based manual reconciliation.

Migrations0068/0069 were applied to local D1 (schema70). Thirty-five focused tests
passed across four files, including actual isolated D1/R2 ownership, concurrent
commands, immutable records, replay normalization, interrupted upload/release,
late writes, retained committed bytes, and route/CSRF boundaries. Typecheck and
build passed. Admin desktop and390px conversation screens were inspected with a
labelled local test message; no horizontal overflow. Both review axes identified
reservation recovery, which was corrected and covered by failure-path tests.
This ticket does not send email; notification delivery belongs to #57.

## Ticket 09 / #57

Admin customer-visible messages now append a notification outbox row in the same
D1 batch. Post-commit dispatch and a separate every-minute recovery sweep feed
the bound Queue consumer. Sweeps are bounded to five batches of100; hourly
registration cleanup remains independent. Source messages survive delivery
failures. Frozen recipient/payload, provider idempotency keys, leases and bounded
retries prevent unsafe resends; uncertain attempts stop within23hours of the
first provider attempt rather than crossing its24hour deduplication window.

The reply address uses32random bytes; only its hash and an authenticated encrypted
payload persist. Current customer/organization authorization is rechecked before
delivery and reply-token resolution. Dedicated preview/production notification
encryption secrets are independent of session-key rotation. They must be retained
with D1 backups; notification-key rotation requires a keyring migration.

`/admin/quote-notifications` provides bounded cursor history and an unresolved
failure filter. Local captures are Admin-only escaped pages and explicitly marked
not sent. Private attachment bytes, keys, internal review notes and costs are not
email content. No marketing subscription changes or real email were made.

Migration0070 was applied to local D1 (schema71). Forty-nine notification,
Worker/route and environment tests passed after review corrections; the connected
conversation transaction also passed its23 real D1/R2 cases. Coverage includes
atomic rollback, Queue retries, ownership revocation, frozen payloads, provider
uncertainty, session-key rotation, multi-batch recovery, and failures older than
50new notifications. Typecheck and build passed. Actual local Admin message
produced one Queue-consumed stub capture; desktop and390px notification views
were inspected without horizontal overflow. Both review axes' findings on
history visibility, recovery cadence and key retention were corrected.
