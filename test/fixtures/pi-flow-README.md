# #63 Isolated Worker Acceptance Fixture

All three HTTP phases, including catalog-after-PI changes and async queries,
passed in 76.60 seconds against main's existing local build. The catalog fixture
supersedes the prior release before publication, preserving the single-published
release constraint. This focused result is not final release sign-off.

This is a test harness, not #63 sign-off. A submitted RFQ, two local customer
profiles and the reusable single-SKU catalog baseline are seeded. Pricing drafts, quote revisions, PI intents,
PDFs, viewing evidence, acceptance and delivery copies are produced by the real
built Worker. Authentication uses the ordinary email OTP routes and local stub.

## Run After Main Reports Build Ready

From the repository root, with Node 24 and pnpm on PATH:

```sh
pnpm exec vitest run --config vitest.smoke.config.ts test/smoke/proforma-invoice-flow.test.ts
```

Do not use `pnpm test:smoke` here: it rebuilds and runs the broad suite. Do not
rebuild while either this test or the browser fixture is using the assets.
The harness intentionally does not build the application itself.

To test only issuance against #59, use the same command with
`-t 'issues through real HTTP'`. That is partial coverage, not acceptance.

## Desktop / Mobile Browser Walkthrough

```sh
node test/fixtures/pi-flow-server.ts --test-data
```

To start with an actual issued PDF, leaving customer viewing and acceptance for
the browser:

```sh
node test/fixtures/pi-flow-server.ts --test-data-issued
```

This calls the same exported `issueTestPi(server)` used by the smoke test:
private note, pricing, commercial terms, quote issuance, PI reservation, and
Queue rendering all use HTTP. It prints the PI URL, acceptance URL and OTP
sign-in return URL only after the PDF is persisted. It creates no customer
session or viewing/acceptance evidence. Failure stops and cleans up the server.

The process prints the newly allocated loopback origin and fixture URLs. It
keeps running until Ctrl-C, which stops its child Worker and removes its state.
The exported `startPiFlowServer()` returns `origin`, `directory`, `request`,
`post`, asynchronous `query`, `login`, `source`, and asynchronous `stop()` for automation.
Always call `stop()` in a finally block when using the export.
`startPiFlowServer({ signal, startupTimeoutMs, onCleanup })` also accepts a
startup abort signal and an early cleanup registration callback. Its default
120-second startup deadline includes asynchronous migrations, platform setup
and readiness; late platform initialization is disposed rather than returned.
Unix subprocesses use dedicated process groups. Cleanup escalates the entire
group to SIGKILL if needed, waits for termination, and only then removes state.
`test/fixtures/pi-flow-process.test.ts` exercises forced descendant cleanup,
early-aborted setup and late-resource disposal after a startup deadline. Queries
use asynchronous, tracked subprocess groups with a 60-second deadline; the
timeout test verifies a stubborn query tree is killed without blocking timers.
All four cleanup tests passed. This file is included by the normal Vitest
`test/**/*.test.{ts,tsx}` glob, not the smoke config.

- Admin: `/admin/quotes/TEST-63-RFQ`, using the local owner stub.
- Customer: `/sign-in?returnTo=%2Faccount%3Fview%3Dmy-quotes`.
- Buyer email: `buyer@pi-flow.example.test`.
- Wrong-owner email: `other@pi-flow.example.test`.
- Use the normal email-code form; the local preview displays the OTP.
- My Quotes is `/account?view=my-quotes`, not `/account/quotes`.
- Start review, save USD 15.00 per item with 10% discount, complete terms,
  issue the quote, then select the test bank-transfer instructions to issue PI.
- View/download the exact PI, reload acceptance status, enter `TEST Buyer`,
  confirm general and made-to-order acknowledgements, and accept.

Queue control is explicit, not automatic. Replace ORIGIN below with the printed
loopback origin. The scheduler collects and awaits all `waitUntil` work before
returning; the Queue endpoint passes captured bodies to the real Worker queue
handler. A pending acceptance copy before the scheduler is expected.

```sh
curl -fsS -X POST -H 'Origin: ORIGIN' 'ORIGIN/__test/pi/scheduled'
curl -fsS -X POST -H 'Origin: ORIGIN' 'ORIGIN/__test/pi/queue'
curl -fsS -X POST -H 'Origin: ORIGIN' 'ORIGIN/__test/pi/queue?replay=1'
```

Invoke the scheduler before draining initial PI jobs or acceptance copies so
persisted outbox work is dispatched first. These controls exist only in the generated test entry
point, require local bindings and a test marker, and accept loopback hosts only.
Mutation controls also require the same Origin header.
The automatic issuance helper and non-replay smoke drains invoke the scheduler
first as a durable-outbox barrier. All test-wrapper events await their collected
`waitUntil` tasks, including subsequently registered tasks, before responding;
there are no sleep-based dispatch assumptions. Completed replay remains a
separate Queue call and is not evidence of failure/retry recovery.

## Isolation and Evidence

Every invocation makes a new OS temporary directory, explicit test Wrangler
configuration, D1 ID, private R2 bucket, and empty `.dev.vars`. All migrations
are applied twice to the isolated D1 before seeding. Subprocesses inherit only
basic OS paths, not deployment credentials. No shared `.wrangler` persistence
or seller/payment configuration is read or changed.

The application hardcodes its seller legal name. The harness does not weaken
that invariant: only its isolated registered address and payment instructions
are configured with explicit TEST values. There is no bank account or external
email delivery. The Queue transport is an in-memory stub; handlers, durable
outboxes, D1, private R2 and PDF rendering are real.

The ordered HTTP scenarios cover first issuance and acceptance, then a rejected
seller freight-estimate increase against accepted totals. A distinct customer
transport change creates another immutable Quote Revision and a queued
replacement PI; the test checks old-version rejection, unchanged historical
Quote Revision JSON/hash rows and PDF/acceptance evidence, renewed viewing/acknowledgements and a second single
acceptance copy. The replacement form builds its command in client-side React
state, so the HTTP harness obtains its exact review tokens with read-only D1
queries; the mutation itself still runs through the real lifecycle route.
An identical acceptance replay can return the original historical receipt;
it must not accept the replacement or make the superseded PI current. Changed
historical acceptance attempts and new viewing evidence are rejected.

The automated test validates PDF signature, stored hash, byte size and page
count and writes `TEST-original-pi.pdf` inside the temporary directory. It does
not claim semantic text extraction, rendered-page inspection, accessibility,
responsive layout or browser interaction evidence. Browser runs can retain
downloads/screenshots before stopping; automated teardown deletes its files.

## Executable Evidence Map

This HTTP fixture populates a private internal note and the issued PI's private
R2 key, and tests those concrete values against customer surfaces. It does not
populate Cost Basis, tax evidence, conversation attachments, superseded payment
instructions or an unused payment channel. Their absence here is **not** privacy
coverage. It also tests completed Queue replay, not controlled failure,
dead-letter exhaustion or recovery. The suites below supply separate evidence;
mapping them does not mean they were rerun with this harness or that their
service/loader tests are browser or complete Worker-route evidence.

| Requirement                                                 | Existing executable evidence                                                                                                                                                                                                                                                                                                                                                                                                                        | Scope / limitation                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Populated Cost Basis privacy                                | `test/quote-preparation-d1.integration.test.ts`: `exposes legacy cost only in authorized Admin projection, preserving item/image source evidence`                                                                                                                                                                                                                                                                                                   | Real D1 cost `987654.32`; authorized loader sees it, customer/draft/audit projections do not.                                                                                                                                                                                    |
| Private tax evidence and owned offers                       | Same file: `requires an associated private exemption record, not another RFQ's evidence`; `issues once under concurrency, freezes exact source and excludes internal review from owned offers`                                                                                                                                                                                                                                                      | Associated evidence ownership and private-safe customer offer/HTML; not this HTTP fixture's seed.                                                                                                                                                                                |
| Populated notes, tax files and conversation attachment keys | `test/quote-conversation-d1.integration.test.ts`: `never projects internal notes, evidence, object keys, author identities or command metadata`; `checks ownership for reads, sends and downloads and permits operational subaccounts`                                                                                                                                                                                                              | Real D1/R2 conversation sends and authorized downloads. The `SECRET_COST` string in the former is not itself proof of populated cost; use the Cost Basis test above.                                                                                                             |
| Historical bank / unused PayPal privacy                     | `test/proforma-invoice-d1-lifecycle.integration.test.ts`: `never exposes historical or unused-channel instructions in history, customer records or serialized HTML`                                                                                                                                                                                                                                                                                 | Distinct bank/PayPal versions, historical customer records and rendered HTML.                                                                                                                                                                                                    |
| PDF failure, bounded attempts and recovery                  | `test/proforma-invoice-d1.integration.test.ts`: `retains failed PDF jobs for manual review after bounded retries`; `recovers uncertain R2/D1 success without deleting live PDF bytes`; `rolls back PI, current pointer and audit together; retries preserve intent identity and issue time`                                                                                                                                                         | Real local persistence with injected renderer/storage/commit faults; the terminal PDF-job state is `failed`, not an asserted Queue DLQ delivery.                                                                                                                                 |
| Acceptance-copy retries / dead-letter / reconciliation      | `test/pi-email-acceptance-61-d1.integration.test.ts`: `queue and payload failures remain reviewable/retryable without rolling back acceptance`; `retries uncertain delivery with identical payload/key, then stops outside the deduplication window`; `keeps permanent delivery failure reviewable and manually retries the same intent`; `retains the ten-attempt cap and requires audited reconciliation before resetting that generation budget` | Controlled dispatch/provider failures, bounded attempts and audited recovery of the durable outbox; not external provider or deployed Queue DLQ evidence.                                                                                                                        |
| Legacy RFQ review                                           | `test/smoke/worker-routes.test.ts`: `reviews immutable RFQ snapshots in the Admin queue`; `test/admin-quote-review.test.ts`: `keeps legacy and malformed snapshots honest instead of inferring clear`                                                                                                                                                                                                                                               | The Worker test visits a version-1 RFQ and verifies honest missing-snapshot presentation. It does not issue or accept a legacy PI.                                                                                                                                               |
| Catalog / inherited series / image changes                  | `test/quote-preparation-d1.integration.test.ts`: the Cost Basis test above changes the actual series and media after RFQ; its `issues once under concurrency...` test changes the catalog after quote issuance. `test/quote-request-product-snapshot.test.ts`: `captures product identity, media and parameters without retaining live references`                                                                                                  | Real item-repository changes preserve captured RFQ/pricing/issued quote; the snapshot unit test checks detached references. The HTTP harness additionally publishes changed live release rows after PI and checks exact PDF/Quote preservation (focused three-phase run passed). |

Run a mapped D1/unit suite explicitly with `pnpm exec vitest run <file>`;
some suites share ordered fixtures, so do not filter individual test names
without checking their setup. The legacy Worker evidence belongs to the broad
smoke suite: reuse main's result, do not rerun it merely for this map.

The HTTP harness now publishes a changed isolated release for the RFQ's actual
SKU after PI issuance (series name, pressure, reference price and image), then
compares the original PDF bytes, PI row and exact Quote Revision JSON/hash.
Catalog setup/publication uses fixture D1 writes, not Admin HTTP catalog edits;
all quote, PI, PDF and acceptance operations still use the built Worker routes.
It does not claim item-publication workflow coverage. Legacy review and detached
snapshot evidence remain mapped above; no extra legacy acceptance flow is claimed.
Actual Queue dead-letter delivery remains outside this harness.

## Integration Contracts / Remaining Scope

- #59: HTTP pricing/terms/issue/PI forms and `worker.queue` PDF dispatch.
- #60: registered `/account/quotes/:requestId/pi/:piId/accept`, exact view
  evidence from customer PDF download, all acknowledgement fields, and accepted
  My Quotes projection.
- #61: acceptance creates one durable copy; `worker.scheduled` dispatches it,
  then `worker.queue` produces one stub capture. Admin email exception route:
  `/admin/quotes/:requestId/pi/:piId/email-acceptance`; review UI ends in
  `/email-review`; copy operations live at `/admin/pi-acceptance-copies` and
  `/admin/pi-acceptance-copies/data`. Email evidence scenarios remain separate.
- #62: `/admin/quotes/:requestId/pi/lifecycle`; replacement reservation must
  dispatch PDF work to `lifecycle.renderReserved`. Replacement requires the
  exact PI/head/acceptance tokens, newly issued quote revision, and immutable
  evidence IDs on the RFQ. Do not manufacture acceptance or supersession rows.
- Main owns browser desktop/mobile walkthrough, broader regressions, rendered
  PDF review, inbound email scenarios, deployment checks and final #63 sign-off.

No commits are made by this harness.
