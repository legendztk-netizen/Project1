# Quote Conversation Notifications (#57)

Backend integration boundary: only Admin customer-visible conversation messages
are notification sources. Internal notes, tax evidence, cost basis, snapshots,
attachment keys and bytes are never read into email payloads. Website messages
remain authoritative. Attachment-only messages receive a generic plaintext
notice directing the recipient to My Quotes. Marketing preferences and
subscriptions are neither read nor written.

## Integration API

All entry points and types are exported from `./index.ts`:

```ts
quoteNotificationOutboxStatement(database: D1Database, input: {
  messageId: string;
  requestId: string;
  createdAt: string; // ISO UTC
}): D1PreparedStatement

createQuoteNotifications(input: {
  database: D1Database;
  env: NotificationEnvironment;
  protector: NotificationProtector;
  adapter?: QuoteNotificationAdapter;
  now?: () => number; // epoch milliseconds
})

service.dispatch(queue: NotificationQueue, limit?: number):
  Promise<{ enqueued: number; failed: number }>
service.consume(message: NotificationQueueMessage): Promise<boolean>
service.listAdmin(actor: AdminIdentity | null | undefined,
  options?: { limit?: number; before?: string; filter?: "all" | "unresolved" }):
  Promise<{ rows: NotificationAdminRow[]; nextCursor: string | null }>
service.readLocalCapture(actor: AdminIdentity | null | undefined, notificationId: string):
  Promise<NotificationEmail>
service.resolveReplyToken(token: string, senderEmail: string):
  Promise<{ requestId: string; profileId: string; recipientEmail: string; expiresAt: number } | null>
```

Append the outbox statement **after the message INSERT inside the very same D1
batch**, never as a separate post-commit write. It is a no-op for customer
messages and deduplicates on message ID. The surrounding authenticated
conversation command still owns validation, reservation, attachments and audit.
Message/outbox rollback together. Dispatch only after successful commit and also
from a periodic recovery sweep, so a crash between commit and Queue submission
cannot lose delivery. A useful sweep interval is one minute. Dispatch reads at
most 100 due rows per call; drain additional batches as operationally needed.

Pass the existing `ASYNC_JOBS` binding to `dispatch`. Jobs contain only
`{ type: "quote-conversation-notification", notificationId }`. `consume` accepts
Cloudflare Queue message-shaped objects with `ack` and `retry`; it returns false
without acknowledging jobs it does not recognize, allowing a shared router to
handle other job types. Completion is persisted before acknowledgment. Queue
send failure and redelivery can enqueue duplicates; durable leases and provider
idempotency make those harmless. A periodic sweep recovers missed Queue deliveries
and expired worker leases even when Queue retry limits are exhausted.

`NotificationAdminRow` is a typed, token-free projection: IDs, state, epoch-ms
timestamps, nullable failure code, delivery/dispatch attempt counts, and a numeric
`has_local_capture` flag. Admin list/capture callers must supply the authenticated
Admin identity, never request data. Main's routes must enforce Admin Worker auth
and `Cache-Control: private, no-store`. Capture is available only with local/stub
configuration; the durable plaintext view is decrypted on demand for that route,
  not written to logs. No UI or Worker is installed by this module.

## Recipients and Reply Tokens

The first delivery selects a verified profile that currently passes the shared
`ownedQuoteRequestWhere` guard. A revoked original submitter is not a fallback;
an active organization primary contact is selected instead. Missing eligibility
enters `review`. Recipient profile, normalized email, delivery mode and complete
provider payload are frozen together before the first provider attempt. Every
attempt rechecks that exact profile/address with the shared guard. Revocation or
address change enters `review`; it never retargets a retry or reuses its provider
key for a different payload.

Reply local parts are 32 cryptographically random bytes encoded as 64 lowercase
hex characters, with no quote/profile/message IDs. D1 stores a SHA-256 token hash
and immutable quote/profile/email scope. The only persisted recoverable token is
inside the AES-GCM protected payload, authenticated with the notification ID as
additional data. Neither queue bodies nor Admin lists expose it.

Tokens expire 90 days after payload preparation, independently of PI validity,
revision or acceptance state. A new Admin message issues a fresh token with a new
90-day lifetime; retries never renew or replace a frozen token. Tokens may be
revoked via `revoked_at`; expired/revoked tokens fail closed. No manual renewal
endpoint is provided here. An unsent frozen payload whose token expired enters
review instead of delivering a dead reply address.

For #58, pass the parsed token and authenticated, normalized envelope sender to
`resolveReplyToken`; null means quarantine, never attach. It verifies token
expiry/revocation, recipient address and current quote ownership. It does NOT
authenticate the inbound provider/webhook, verify SPF/DKIM, parse MIME, deduplicate
inbound deliveries or append a conversation message; #58 owns those operations.
Never log inbound token addresses. Possession of a token alone is insufficient.

## Configuration and Protection

Existing names: `APP_ENV`, `EMAIL_DELIVERY_MODE`, `EMAIL_FROM`,
`EMAIL_REPLY_DOMAIN`, `PREVIEW_RESEND_API_KEY`, `PRODUCTION_RESEND_API_KEY`.
The Worker additionally requires `PREVIEW_NOTIFICATION_ENCRYPTION_KEY` or
`PRODUCTION_NOTIFICATION_ENCRYPTION_KEY`: dedicated persistent random material
of at least 32 characters, retained independently of session-signing keys. These
names are placeholders for deployment secrets; no production values are stored
in the repository. Back up the key with the encrypted data. Changing it requires
a keyring migration, not an ordinary session-secret rotation. Local uses fixed
development-only material and never sends email.
Local requires `stub` and no provider credentials. Preview/production require
`resend`, valid non-placeholder sender/reply configuration, and the corresponding
API key when using the default adapter. Missing configuration enters a durable
review state without a network request. Inject a fake adapter for tests.

`createAesGcmNotificationProtector(key: CryptoKey)` takes a persistent AES-GCM key
with encrypt/decrypt usages. Main owns key derivation and retention outside D1;
never use a fresh per-request key. Losing or rotating that key without retaining
old decrypt capability makes pending payloads unavailable and moves them to
review. `NotificationProtector` is replaceable to support a versioned keyring.
Use distinct derivation context for notifications if deriving from an existing
secret. Local tests generate a key without production credentials.
The Worker uses HKDF with a notification-specific context, and its dedicated
notification key is independent of login-session key rotation. Recovery runs
each minute, with at most five batches of 100 jobs per sweep; configuration
cleanup keeps its separate hourly schedule.

## Delivery Safety and Operations

The default HTTP adapter uses `POST https://api.resend.com/emails`, a 20-second
timeout and a stable `Idempotency-Key: quote-conversation/<messageId>` header.
The entire payload, including From and Reply-To, is identical on retry even if
configuration later changes. A stub/resend mode change enters review.

Resend retains idempotency keys for 24 hours. `first_attempt_at` is durably set
BEFORE invoking the adapter and never reset. Automatic retries stop at 23 hours
from that timestamp, leaving one hour of headroom. A crash/timeout is treated as
possibly accepted; beyond this budget the record enters `review`, not an unsafe
resend. Do not reset timestamps, replace keys, or create replacement outbox rows
to bypass that state. Operators must reconcile with provider records first.

Delivery leases last 120 seconds. Attempts back off 30, 60, 120 seconds etc.,
capped at one hour, with at most ten sends. Retry exhaustion/ambiguous outcomes
enter `review`; explicit permanent provider rejection enters `dead_letter`.
Repeated Queue dispatch failure also terminates durably (`dead_letter` if never
sent, otherwise `review`). These states are the reviewable failure store, not
mutations of the source conversation. There is no automatic replay of terminal
states. Provider error bodies and thrown messages are never persisted or logged.

An ownership change concurrent with an already-started external HTTP call cannot
recall that call; the module revalidates immediately before the attempt. Queue/D1
and Resend cannot participate in one transaction, so safe uncertainty handling is
essential rather than a claim of unlimited exactly-once delivery.

Official references:

- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://resend.com/docs/api-reference/emails/send-email

Migration is currently `0070_quote_notifications.sql` (schema 71), pending main's
numbering coordination with #56. Main owns manifest/runtime/route registration.
The isolated integration test applies actual on-disk migrations through 0070 in a
temporary D1 instance without editing the shared manifest or touching local data.
