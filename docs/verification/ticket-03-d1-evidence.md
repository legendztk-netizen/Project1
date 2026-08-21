# Ticket 03 D1 Verification Evidence

- Execution date: 2026-08-21
- Wrangler: 4.125.0
- Drizzle ORM: 0.45.2
- Drizzle Kit: 0.31.10

## Persistent Local D1

The same local D1 database received `pnpm migrate` twice. The first invocation
executed 11 migration commands and recorded
`0000_initial_catalog_release.sql`. The second returned `No migrations to
apply`. Verification returned schema version 1 and exactly one applied
migration.

An isolated integration database then received the valid migration followed by
`9999_intentionally_broken.sql`, which inserts into a nonexistent table. The
migration command exited nonzero, the broken filename was absent from
`d1_migrations`, and a deployment-stage sentinel chained after the migration
was not executed. The Worker health endpoint returned HTTP 503 with the broken
filename listed in `missingMigrations`.

## Remote Cloudflare D1

OAuth-authenticated Wrangler created one disposable WNAM D1 database. The first
remote migration applied successfully; the second returned `No migrations to
apply`. A direct remote query returned one `d1_migrations` row and application
schema version 1.

The same remote database then received the intentionally broken migration.
Cloudflare returned `SQLITE_ERROR` and exit code 1. A follow-up query confirmed
that the broken filename was not recorded and no nonexistent table was created.
A Worker using that remote D1 binding returned HTTP 503 with `status: blocked`
and the missing migration name. The disposable database was deleted after the
verification. No preview or production database was used.
