# Catalog admin page performance

Measured on the existing local development server at `127.0.0.1:5175`, using
the same catalog database before and after the change. These are HTTP
time-to-first-byte measurements from sequential `curl` requests, not production
latency guarantees or complete browser load times. Initial compilation requests
are excluded from the samples below.

| Page                      | Before, seconds (3 samples)  | After, seconds (5 samples)                       | Median before → after |
| ------------------------- | ---------------------------- | ------------------------------------------------ | --------------------- |
| `/admin/catalog/requests` | 2.082402, 2.102805, 2.136885 | 0.068503, 0.033803, 0.031739, 0.031273, 0.074564 | 2.103 → 0.034         |
| `/admin/catalog/products` | 2.149198, 2.129249, 2.144693 | 0.110034, 0.090529, 0.096146, 0.089181, 0.095519 | 2.145 → 0.096         |

## Cause and change

The shared product read joined several runtime views against a five-category
UNION. SQLite flattened the UNION and repeated materialization of the runtime
views for each category. The local runtime SKU view contains 113,035 rows;
the product management query returns only 645 SKU rows. A per-query materialized
CTE prevents the repeated join work. The old and new SQL returned identical rows
against the local data.

The review loader previously fetched all managed products merely to derive
series filter options, even with no review detail open. It now uses a smaller
series projection and reads full products only when a series detail needs the
affected-SKU list. Independent loader reads execute concurrently. No persistent
cache, background synchronization, schema migration, or product data changes
are involved.

## Validation

- Both pages returned HTTP 200; extracted visible text matched their pre-change
  responses exactly. Browser navigation also showed both pages successfully.
- Product management, review UI and D1 integration suites: 19 tests passed.
- New coverage compares series options with the full product projection,
  including draft creation and deletion, and verifies the review loader avoids
  full pricing reads while retaining affected SKUs in series details.
- The existing test browser emitted connection-refused messages for image URLs
  on `localhost:3000`; all assertions passed. The live app checks used port 5175.
