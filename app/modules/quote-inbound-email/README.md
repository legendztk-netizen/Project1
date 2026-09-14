# Quote Inbound Email (#58)

## Main Integration

Exports are in `index.ts`:

```ts
createQuoteInboundEmail({
  database, bucket, env, protector,
  resolveReplyToken, verifyPlatformEmail?, now?
})
service.receive(email: InboundEmailMessage)
service.dispatch(queue: InboundQueue, limit?: number)
service.consume(message: InboundQueueMessage): Promise<boolean>
service.listAdmin(actor, query?: { limit?: number; cursor?: string; state?: InboundState }):
  Promise<{ rows: InboundAdminRow[]; nextCursor: string | null }>
quoteInboundAppendStatements(database, command: InboundAppendCommand): D1PreparedStatement[]
```

`receive` is an Email Worker boundary, never a public HTTP handler. It returns
`{ receiptId, state, reason }` after a durable receipt/private raw write. Throwing
means storage/verification did not complete; main must not silently accept it.
Dispatch after receipt and periodically for recovery. Queue bodies contain only
`{ type: 'quote-inbound-email', receiptId }`. Unknown queue types return false
without acknowledgment so main's shared dispatcher can handle them.

The append builder is already called by the service; main need not modify the
existing conversation append method. It builds one transaction containing the
customer email message, validated attachment metadata, audit event, canonical
content-dedup row, completed receipt and reservation release. Never execute its
statements individually. Token validity, current membership/address, receipt
lease and live upload reservation are checked inside this transaction. A failed
or uncertain result is reconciled before any file retirement.

Main owns Worker/Email handlers, Queue scheduling, Admin routes and runtime
verification. Main must widen the existing conversation domain/repository source
union to `website | email` and label Email messages. This module edits none of
those files. Existing quote-scoped downloads protect published attachments.

## Authentication

`verifyPlatformEmail` is an injected trusted dependency, not a request parameter.
Its proof binds the exact raw SHA-256 digest and authenticated normalized sender.
The sender must also match envelope MAIL FROM and the sole MIME From mailbox.
Forwarded/resent mail and other sender addresses do not inherit reply-token
access. Missing or failed proof quarantines; MIME `Authentication-Results`,
`Message-ID`, `Return-Path` and `From` are never themselves authentication.
Local fixture proofs are rejected outside `APP_ENV=local`.

Poincare's main-owned strict DKIM verifier can supply the current proof contract.
The `dmarc-aligned` mechanism tag means the trusted verifier established aligned
sender authentication; it does **not** assert a DMARC DNS policy evaluation.
The production verifier must check signed From, strict domain alignment and the
complete body, without trusting attacker-supplied authentication headers.

Cloudflare's July 2025 requirement concerns SPF-or-DKIM authentication and its
changelog explicitly warns that forwarding may fail within an Email Worker.
The documented Email handler object exposes envelope addresses, MIME headers,
raw bytes and size, not an out-of-band authenticated-sender verdict. Therefore
being delivered to `email()` is not enough to authorize a quote reply. Use the
independent cryptographic verifier, or a verified gateway attestation bound to
the sender and raw digest; otherwise retain fail-closed quarantine.

Primary references:

- https://developers.cloudflare.com/changelog/post/2025-06-30-mail-authentication/
- https://developers.cloudflare.com/email-service/reference/postmaster/
- https://developers.cloudflare.com/email-service/api/route-emails/email-handler/

## MIME, Privacy and Retention

Raw input is streamed with a 15 MiB actual-byte cap even if `rawSize` is false.
PostalMime bounds headers to 64 KiB and nesting to ten; a preflight cap bounds
candidate multipart markers to 128. Message bodies are limited to 10,000
characters. HTML-only input uses bounded `html-to-text`, never HTML rendering or
remote resource loading. Limit violations quarantine rather than silently
truncating a customer's message. Automated messages are quarantined.

The current conversation allows one PDF/PNG/JPEG attachment up to 10 MiB.
Validation reuses the launch extension/MIME/signature/container checks, image
dimension limits and PDF parsing. This is structural validation, not a claim of
antivirus scanning. Multiple files, nested RFC822 files and unsupported content
quarantine the entire email; no file is silently omitted.

Authorized raw MIME is stored only in private R2 under an opaque receipt key.
Its envelope/token is encrypted in D1 with the injected persistent protector and
receipt-specific AAD. Raw bytes can contain a reply token, so main must keep the
bucket private and never log raw mail, recipient addresses, provider error text
or object keys. Unauthorized ingress is recorded without storing raw bytes.
Parser-rejected mail remains private, never a conversation attachment.

Supplemental migration `0072_quote_inbound_email_recovery.sql` advances schema to 73. Its atomic ingress trigger runs before any raw R2 write. Conservative lifetime
safety ceilings are 10,000 authorized raw receipts / 1 GiB retained raw input
globally and 200 authorized raw receipts / 100 MiB per quote. Only receipts with
`raw_key IS NOT NULL` consume these budgets, including parser-quarantined raw
mail. Metadata-only/unverified receipts have a separate 10,000-row ceiling and
cannot consume authorized raw capacity. Duplicate event insertion consumes no
additional capacity. These are
explicit storage safety ceilings, not business entitlements or rolling quotas.
Capacity exhaustion throws without accepting/storing another message. Historical
rows remain counted even after an R2 lifecycle deletion; deliberate operational
capacity/retention review is required before raising these limits. The global
metadata ceiling bounds unauthorized growth without blocking authorized ingress.

Admin pages contain only bounded typed state/reason/ID/timestamp/size fields,
never bodies, subjects, sender text, tokens or storage keys. Cursor pagination
uses descending `(created_at,id)` ordering with optional state filtering and a
100-row maximum. Main's route must require authenticated Admin identity and
`Cache-Control: private, no-store`.

Main should configure operational retention/lifecycle for the
`quote-inbound-email/raw/` prefix (for example 30 days after investigation needs
are met). No public raw/quarantine download or automatic release-to-conversation
endpoint exists. Deduplication rows must be retained even after raw cleanup.

## Retry and Migration

Provider event IDs come only from the trusted verifier. If the Email API supplies
no stable event ID, a hash of the raw digest/envelope metadata is the event key;
MIME Message-ID is not mislabeled as a provider ID. Scoped Message-ID plus
canonical body/attachment hashes prevents duplicate processing under different
provider events. Reusing an event ID or scoped Message-ID with different content
quarantines without modifying the original. With no MIME Message-ID, identical
canonical content in the same quote/profile is treated as a retry; this may
suppress an intentional identical resend.

Processing uses two-minute fenced leases, durable exponential backoff and at most
ten attempts. Terminal failures are Admin-visible. R2 writes are conditional and
checksum-verified on replay. Upload reservations and keys use #56's `r1-` pattern;
abandonment invalidates the reservation before writing its zero-byte tombstone,
so late puts cannot recreate abandoned bytes. Committed attachments are never
retired. Main's existing expired-reservation recovery remains applicable.

Inbound reservation creation and reuse run in one D1 batch guarded by the
receipt's processing state, exact lease ID, lease expiry (including database
time), and current quote ownership. Inserts retain the existing conversation
quota triggers; reuse requires a live matching reservation without renewing it.
A stale consumer cannot create a reservation after terminal cleanup. If cleanup
wins after reservation authorization, conditional R2 creation cannot overwrite
the retained tombstone. No additional migration is needed for this fencing.

Migration 0072 atomically marks terminal transitions for durable cleanup and
backfills existing terminal receipts. Queue consumers do not acknowledge until
cleanup succeeds. The existing `dispatch()` scheduled path also reconciles due
terminal cleanup, including dispatch exhaustion with no surviving Queue delivery.
Tombstone/release failures retain `cleanup_pending`, increment `cleanup_attempts`,
and retry after 60 seconds without a finite abandonment threshold. Those fields
and `cleanup_next_at` are included in the typed Admin-safe projection. Repeated
cleanup is idempotent and cannot retire committed attachments. Apply 0072 before
deploying this module; do not edit or reapply 0071.

Migration `0071_quote_inbound_email.sql` advances schema to 72. The source-enum
change rebuilds messages in a new migration rather than editing applied 0068.
SQLite's deferred DROP-parent counter is cleared only after an explicit
`pragma_foreign_key_check` assertion succeeds. All operations must remain in the
single Wrangler migration transaction. The isolated Wrangler test seeds and
compares existing #56 messages/attachments and #57 outbox/token/capture rows and
R2 bytes, then checks foreign keys and append-only/immutability triggers. No
shared local database is used by these tests.

Dependencies are main-owned: `postal-mime@2.7.5`, `html-to-text@9.0.5`, and
`@types/html-to-text@9.0.4`. Tests use local fixtures and fake transport/queue
adapters; no real inbound domain, provider account or production credentials.
