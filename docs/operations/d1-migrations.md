# D1 Migrations

## Ownership

`app/modules/catalog/infrastructure/database-schema.ts` is the Drizzle schema
for the catalog. `drizzle.config.ts` generated its initial forward SQL and
snapshots. Cross-module migrations added since the initial catalog rollout,
including quote, PI, order and shipment tables, are reviewed forward-only SQL
files in `migrations/`; they are not represented by a single Drizzle schema or
snapshot. `config/database-schema-contract.json` names the exact migrations
and application schema version required by the current Worker. New migrations
must update that contract and include a real-D1 apply/verify test.

Wrangler applies the SQL and records each successful filename once in
`d1_migrations`. The initial migration creates:

- `application_schema_state`
- `catalog_imports`
- `catalog_releases`
- `admin_audit_events`

## Commands

| Command                   | Target              | Remote access                        |
| ------------------------- | ------------------- | ------------------------------------ |
| `pnpm migrate`            | local D1            | prohibited                           |
| `pnpm migrate:verify`     | local D1            | prohibited                           |
| `pnpm migrate:preview`    | named preview D1    | explicit `--env preview --remote`    |
| `pnpm migrate:production` | named production D1 | explicit `--env production --remote` |

The local script deletes any inherited `CLOUDFLARE_ENV` before invoking
Wrangler. Preview and production have no shared or inferred command. Their
placeholder database IDs must be replaced before a remote migration can run.

`deploy:preview` and `deploy:production` run environment validation, migration,
build, and deployment with shell `&&` ordering. A nonzero migration exit stops
before the new Worker is deployed.

Shipment migrations `0092` and `0093` must be applied together before deploying
the Spec 6 Worker. Migration `0092` backfills only unambiguous legacy Ship
Together orders, leaving held quantities and historical split prose under
review. Migration `0093` protects allocation deletion; an Admin correction uses
the versioned plan command and an audit record. An order created by an older
Worker after the migration but before deployment is initialized idempotently on
its first authorized Order read. This catch-up does not bypass payment or
quantity holds.

Shipment documents require migrations `0097` through `0100` before the Worker
serves packing or file routes. Migration `0097` stores versioned packing records
and private R2 file metadata; `0098` records orphan-object cleanup; `0099`
stores one Shipment-level dimensional divisor and prevents packing edits after
dispatch; `0100` permits periodic orphan rechecks. The hourly Worker schedule
retires upload reservations older than one hour and rechecks cleaned failed
uploads for 24 hours, so a late R2 write remains discoverable without starving
newer reservations. Failed R2 deletions remain retryable. No private file
becomes customer-visible without an explicit audited sharing command.

## Fail-Closed Health

`/health` queries the bound D1 database on every request. HTTP 200 requires:

1. the singleton `application_schema_state` version to equal the Worker schema
   contract; and
2. every required filename to exist in `d1_migrations`.

Missing tables, inaccessible metadata, a version mismatch, or an unapplied
migration returns HTTP 503 with `status: blocked`. Database exceptions and SQL
text are not returned.

## Verification

`pnpm test:d1` creates isolated persistent D1 instances through Wrangler. It:

1. applies the real migration to a fresh D1;
2. applies it again to the same database;
3. inspects `d1_migrations` and SQLite schema rows;
4. adds an intentionally invalid migration referencing a nonexistent table;
5. proves the invalid filename is not recorded and the following deployment
   stage is not entered; and
6. starts a real Worker against that D1 and requires `/health` to return 503.

The suite does not substitute an in-memory repository or mocked SQL engine for
these checks. Domain-command unit tests remain separate from the D1 lifecycle
test.
