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
