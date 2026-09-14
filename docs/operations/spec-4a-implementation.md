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
