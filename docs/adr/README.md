# Architecture Decision Records

ADRs record only cross-cutting decisions that cannot be made sufficiently clear
by the runnable skeleton code. They do not duplicate feature Specs, route lists,
database field inventories, or deployment instructions.

| ADR                                                                 | Decision                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 001                                                                 | TypeScript modular monolith on Cloudflare Workers                    |
| 002                                                                 | Surface and identity isolation                                       |
| 003                                                                 | D1 ownership, snapshots, and domain commands                         |
| 004                                                                 | Private files and idempotent asynchronous work                       |
| [0049](0049-publish-product-revisions-independently.md)             | Independent product revision publication with immutable history      |
| [0050](0050-retain-original-reference-price-currencies.md)          | Original-currency reference prices and manual mixed-currency pricing |
| [0053](0053-add-marketing-home-page-and-move-catalog-to-catalog.md) | Marketing home page at `/`; catalog browsing moves to `/catalog`     |
