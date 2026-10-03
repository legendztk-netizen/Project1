# Catalog and Build a Hose read budget

Source: the user's request to combine the catalog and configurator read-cost
optimizations in a new PR after PR #125. Base: `6dbf91a`.

Use the domain language in [CONTEXT.md](../../CONTEXT.md) and preserve
[ADR 0049](../adr/0049-publish-product-revisions-independently.md).

## Acceptance

- Catalog browsing sends family summaries, counts and minimum prices rather than
  every variant. Search still matches exact variants; family detail retains them.
- Public catalog data is reusable across Worker isolates with a freshly checked
  release/version, item generation and cutting/labeling fee token. Price changes
  and publication changes invalidate the cache. Cache failures fall back to D1.
  Quote commands never trust this public cache.
- Direct SKU reads are restricted to their type and series, and subsequent public
  reads can be cached. Arbitrary SKU misses cannot grow memory without a bound.
- Build a Hose reuses the compatible candidate snapshot for the same hose and
  release between End A, End B and backtracking. A new page or another hose/release
  fetches candidates again. Submission still validates current availability.
- Adding, replacing and submitting a configured assembly validates only its exact
  ordered parts before generating pairs. Preserve active publication, item
  generation, availability, pending regeneration, exclusions, registry versions,
  transactional guards, ownership and immutable historical snapshots.
- Record request-scoped D1 row counts and cache tiers for the affected HTTP routes,
  without SQL, bound values, account IDs, SKUs, URL queries or customer data.
- Verify semantic equivalence, invalidation, concurrency and representative read
  budgets in local workerd/D1. Keep local measurements separate from live traffic.

## Boundaries

This PR does not merge or deploy. It does not upgrade Cloudflare or mutate preview
products. Cache API storage is data-center-local, not a global persistent read
model; a cache miss still executes the scoped catalog SQL. Full-catalog cold-read
elimination through a published read model and eliminating all pair generation in
candidate discovery remain separate architectural work. No database migration or
new storage binding is required here.
