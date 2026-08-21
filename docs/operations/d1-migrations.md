# D1 Migrations

## Ownership

`app/modules/catalog/infrastructure/database-schema.ts` is the Drizzle schema.
`drizzle.config.ts` generates forward SQL and Drizzle snapshots under
`migrations/`. `config/database-schema-contract.json` names the exact migrations
and application schema version required by the current Worker.

Wrangler applies the SQL and records each successful filename once in
`d1_migrations`. The initial migration creates:

- `application_schema_state`
- `catalog_imports`
- `catalog_releases`
- `admin_audit_events`

## Commands

| Command | Target | Remote access |
| --- | --- | --- |
| `pnpm migrate` | local D1 | prohibited |
| `pnpm migrate:verify` | local D1 | prohibited |
| `pnpm migrate:preview` | named preview D1 | explicit `--env preview --remote` |
| `pnpm migrate:production` | named production D1 | explicit `--env production --remote` |

The local script deletes any inherited `CLOUDFLARE_ENV` before invoking
Wrangler. Preview and production have no shared or inferred command. Their
placeholder database IDs must be replaced before a remote migration can run.

`deploy:preview` and `deploy:production` run environment validation, migration,
build, and deployment with shell `&&` ordering. A nonzero migration exit stops
before the new Worker is deployed.

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
