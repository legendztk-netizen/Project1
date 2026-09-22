# Quote List Display Cache

Quote List GETs reuse server-side validation and estimate results for unchanged
lines. This is a display optimization, not an RFQ authorization or pricing source
of truth. `readForSubmission` always performs fresh validation and pricing.

## Validity

- The session is authenticated/validated before reading any cached result.
- Each entry belongs to one quote line, scoped through its owning session.
- A SHA-256 hash of the stored line detects quantity/configuration changes.
- `quote_list_display_revision` invalidates results when catalog or rule data
  changes. Existing catalog cutover epoch triggers cover publication, product
  revisions and configurator registries. Migration 0080 adds coverage for fees,
  discounts, media and managed assembly state/relations.
- The revision is checked again after reading/calculating. Concurrent changes
  discard cache hits and use fresh results. Writes also require the same revision.
- Original line snapshots are never overwritten. Cached `refreshedAt` retains
  the actual calculation time. Removing a line cascades to its cache entry.

## Maintenance

Increment `formatVersion` in `d1-quote-list-display-cache.ts` whenever a deployment
changes the meaning of validation or estimate results. When introducing a new
mutable input, add its revision invalidation trigger and a regression test.
Invalidation is deliberately conservative: catalog draft/import changes may also
invalidate results even when they do not change a public product.

Warm reads use a fixed number of queries, but serialization, transfer and browser
rendering still grow with line count. Cold reads and invalidated lines still incur
normal calculation work, plus cache persistence. No constant page-load guarantee
is implied.

## Verification

`pnpm exec vitest run test/quote-list-display-cache-d1.integration.test.ts`
uses isolated real D1 migrations and validates reuse, edits, ownership, expiration,
malformed entries, concurrent publication, fee changes, component discontinuation,
and the uncached RFQ submission path. Set `QUOTE_CACHE_BENCHMARK=1` to print cold
and warm service-read timings. These timings exclude browser/network rendering.

## RFQ Submission

Submission reads only the selected, account-owned lines. It performs fresh
validation and pricing, sharing SKU and discount lookups within that submission
only. The same freshly read product supplies its submitted specification snapshot.
The final D1 transaction still checks catalog generation, selected-line state,
component eligibility, current global registry versions, fees, account and address
state before atomically storing the RFQ and removing its selected lines.

Idempotency lookup precedes product validation, so retries return the already
stored RFQ without revalidating products left in the list. Unselected lines never
participate in submission validation. More distinct selected SKUs/configurations,
snapshot serialization and transaction work can still increase submission time.

`QUOTE_SUBMIT_BENCHMARK=1 pnpm exec vitest run test/quote-submission-performance-d1.integration.test.ts`
uses an isolated D1 database to measure complete service submissions and retries.
It covers selected-only clearing, fresh assembly validation, duplicate requests,
and concurrent quantity/global-rule changes. Timings exclude HTTP and rendering.
