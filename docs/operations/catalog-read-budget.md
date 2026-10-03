# Catalog and configurator read costs

## What changed

Public catalog reads use two cache tiers. The isolate cache is followed by the
Cloudflare Cache API with a one-hour retention. The cache key includes the
configured storefront origin, DTO format version, active release/version, item
publication mode/generation and cutting/labeling fee versions/rates. Every request
reads the current token from D1 first. Category reads can reuse a cached complete
catalog. Only public DTOs enter the cache; HTML, identity, sessions and quote
responses do not.

Catalog list loaders send one representative, variant count and minimum price per
family. Searching retains variant-level matching. Direct SKU reads restrict subtype
and series queries and keep a bounded 128-entry isolate cache. Cache writes use
`waitUntil`; failed writes or reads do not block browsing. A token change while
loading prevents the result being stored under the earlier edge key. Bump the
`v1` namespace in `public-catalog-edge-cache.ts` when changing the serialized DTO or
its meaning.

Build a Hose reuses the page's compatible candidates between both ends and on
backtracking. They are keyed by hose and release, lost on page reload, and are
presentation data only: a product changing while the user configures is checked
again when adding or submitting. Exact assembly checks restrict generated JSON
endpoints to the selected ordered parts before pairing. The same validation is
used in preparation and the transaction; guards are not removed to save reads.

## Measurements and limitations

A local workerd/D1 copy of the saved preview item-mode generation-1 cutover
rehearsal was measured before and after. The example uses `601R1_004`, straight
`BSPP_F_SW_06_06` on both ends, 30 inches, quantity 1, no installed protection,
measurement Not Sure, and creates a new anonymous quote list. Counts are D1
`meta.rows_read` / `meta.rows_written`, not returned-row counts. There were no
live preview quote writes.

| Operation on the same saved snapshot                               | Before (rows read) | After (rows read) |
| ------------------------------------------------------------------ | -----------------: | ----------------: |
| Add one assembly to a new anonymous Quote List                     |             89,678 |             8,394 |
| Exact ordered-pair availability check                              |              2,650 |               906 |
| Direct adapter SKU lookup                                          |              1,149 |               205 |
| Uncached full catalog repository read                              |             29,493 |            29,493 |
| Catalog summaries, simulated new isolate with populated edge cache |                  — |                 4 |

The add operation writes 9 rows in both versions. Family payload JSON decreases
from 1,153,149 to 107,574 bytes on this snapshot, before HTTP compression and
excluding the page shell. The cold summary fill reads 29,505 rows because it also
checks freshness before and after filling. The cross-isolate measurements clear
the isolate map and use an in-memory implementation of Cache API match/put with
real local D1; they prove repository reuse, not actual Cloudflare edge retention.

The committed integration suites also use independent synthetic catalogs,
including 200 additional hose SKUs, and compare availability through generated,
manual, excluded, pending and discontinued states. Run:

```sh
pnpm exec vitest run test/public-catalog-cache-d1.integration.test.ts test/catalog-read-cost-d1.integration.test.ts test/configurator-compatible-ends-d1.integration.test.ts test/quote-submission-performance-d1.integration.test.ts test/build-a-hose-view.test.tsx
QUOTE_SUBMIT_BENCHMARK=1 pnpm exec vitest run test/quote-submission-performance-d1.integration.test.ts
```

A fresh isolate hitting the edge cache reads only the freshness token (under 50
rows in the synthetic test). That is not a measured production hit ratio. A new
publication, another data center, expiration or eviction can still cause the full
catalog cold read (previous live audit: approximately 30,158 rows for 644 SKUs).
Family summaries reduce transfer and parsing; they do not themselves eliminate a
cache miss's D1 scan. Candidate discovery still performs one query sequence per
new hose/page; reusing End A for End B removes the duplicate, not the first read.
Workers requests remain billable even on a cache hit.

The [Cloudflare Cache API documentation](https://developers.cloudflare.com/workers/runtime-apis/cache/)
describes its data-center-local behavior. Do not convert an optimistic cache-hit
count into a guaranteed number of daily configurations.

## Admin idle-read reductions

RFQ submission creates an Admin notification through the `admin_notifications_rfq_submitted`
trigger. Its link opens the corresponding request detail. The queue now reloads
on navigation, filtering/pagination or explicit refresh, without a 30-second timer
or focus/visibility revalidation. An idle visible queue therefore avoids about
120 scheduled **loader reloads per hour**; this is not a count of D1 queries or rows.
The filter header includes the refresh button, a server-generated last-load time,
busy feedback and a single-flight guard.

Admin navigation keeps its 30-second visible-page unread check and navigation
refresh, since there is no push channel. Focus/visibility bursts within one second
share a check, including when the first request has already completed. Notification
listing now uses two repository queries instead of three: page rows and a combined
total/unread aggregate. The real D1 integration test checks the query count and the
existing per-admin permission, read-state and pagination cases. This does not claim
a one-third reduction in all Admin rows read; row cost depends on the data.

PI PDF status checks remain active while a job is generating and the page is
visible. Hidden tabs cancel the timer and resume checks on return. Completed or
failed jobs do not poll. The overview already uses manual refresh, and queue/message
pagination was already bounded. Exact dashboard/badge counts can still grow with
history. Authentication, permission checks and command-time validation remain live;
private responses are not put in the public catalog cache.

Focused verification:

```sh
pnpm exec vitest run test/admin-quote-pagination-ui.test.tsx test/admin-navigation.test.tsx test/admin-notifications-d1.integration.test.ts test/admin-notifications-ui.test.tsx test/admin-quote-pagination-d1.integration.test.ts test/proforma-invoice-route-ui.test.tsx test/admin-pi-refresh.test.tsx
```

## Verify after an authorized preview deployment

Filter Worker logs on `event = catalog_d1_usage`. Events have an area, method,
response status, query count, D1 rows read/written and repository cache counters
(`memory`, `edge`, `miss`). Cache counters describe repository lookups, not HTTP
requests; nested summary and item misses can both count. Covered routes include
catalog pages/product APIs, Build a Hose/configurator APIs and quote-list requests.
These are application reads through prepare/all/first/run/batch; scheduled jobs,
other routes, SQL failures without metadata and other Workers are outside this
measurement. Logs capture reads awaited before the response, not detached work.

Compare a fresh catalog request, a repeat request, a category and family request,
a direct SKU request, End A then End B, adding one assembly and submitting an RFQ.
Compare row totals and latency by area and cache tier; establish a real hit ratio
before estimating daily traffic capacity. Verify a price/publication change
invalidates the public result and stale quote commands are still rejected.
