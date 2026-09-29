# ADR 003: D1 Ownership, Snapshots, and Domain Commands

- Status: Accepted
- Date: 2026-08-21

## Context

Catalogue facts can change, but submitted RFQs, issued PIs, accepted
specifications, confirmed payments, Orders, and Assembly Records must retain the
facts and versions used when each decision occurred. Most damaging failures in
this product would come from silent in-place edits or invalid state changes.

## Decision

Cloudflare D1 is the relational system of record and its schema is managed by
versioned Drizzle migrations.

- Each domain module owns writes to its tables and exposes explicit commands.
- Commands validate actor permission, current version, allowed prior state,
  required data, and idempotency before applying a transition.
- Customer and Admin routes never advance RFQ, PI, Payment, Order, Shipment, or
  After-sales state through a generic status update endpoint.
- Mutable catalogue and Quote List data use version or release references.
- RFQ, Quote Revision, PI, Confirmed Order, Production Package, and Assembly
  Record retain immutable snapshots required to reproduce the accepted business
  and product decision.
- Significant Admin mutations append Admin Audit Events. Corrections append a
  new record and preserve the earlier event rather than rewriting history.
- Identifiers exposed outside the module are stable opaque IDs plus the approved
  human-readable business number where required.

## Consequences

- Some product data is intentionally duplicated into transaction snapshots.
- State transitions are tested at the command or Worker request boundary rather
  than by testing UI component internals.
- Schema evolution must preserve historical readers and document rendering.
- Concurrency-sensitive commands require conditional writes, uniqueness
  constraints, and idempotency keys appropriate to D1.
