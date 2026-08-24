# Hydraulic Hose RFQ Platform

React Router v8 and TypeScript application running as one Cloudflare Worker.
The initial skeleton exposes three deliberately separate surfaces:

- `/` - Customer Storefront catalog workspace
- `/admin` - Admin Backoffice shell
- `/admin/catalog/import` - authorized seven-worksheet catalog import and review
- `/admin/catalog/review` - authorized draft product review and bulk Supply Availability changes
- `/admin/catalog/releases` - authorized release comparison, revalidation, and atomic publication
- `/health` - machine-readable Worker health response

## Prerequisites

- Node.js 24 or newer
- pnpm 11

## Local development

```bash
pnpm install
pnpm migrate
pnpm dev
```

Open `http://localhost:5173`. Local runtime values come from `wrangler.jsonc`;
they are non-secret development values. `pnpm migrate` always targets the local
D1 database; `pnpm dev` also reapplies pending local migrations before startup.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm test:d1
pnpm test:smoke
pnpm build
pnpm check
pnpm deploy:validate:production
```

`test:smoke` builds the application, starts Vite's workerd-backed Cloudflare
preview, and verifies the Storefront, Admin, persisted Catalog Release
diagnostic, full 01-07 workbook import, draft-only bulk Supply Availability
commands, atomic Catalog Release publication, audit output, active-release
isolation, and health routes through HTTP. `test:d1` uses persistent local D1
instances rather than a database mock.

## Environment commands

```bash
pnpm dev
pnpm build
pnpm build:preview
pnpm build:production
```

The unqualified `dev` and `build` commands always select the top-level local
Wrangler environment, even when the parent shell already contains a
`CLOUDFLARE_ENV` value. Preview and production builds set `CLOUDFLARE_ENV`
explicitly before Vite resolves and flattens the selected Cloudflare environment.

Validation commands build the selected Worker and run Wrangler in dry-run mode;
they do not require real Cloudflare resources:

```bash
pnpm deploy:validate:preview
pnpm deploy:validate:production
```

Future live deployment commands are explicit, require
`ALLOW_CLOUDFLARE_DEPLOYMENT=confirmed`, and fail before building while an ID,
origin, Access setting, email setting, or required secret remains unresolved:

```bash
pnpm deploy:preview
pnpm deploy:production
```

The environment contract and replacement procedure are documented in
`docs/operations/environment-configuration.md`.

## D1 migrations

```bash
pnpm migrate
pnpm migrate:verify
pnpm migrate:preview
pnpm migrate:production
```

Only `pnpm migrate` has a default, and that default is always local. Preview and
production promotion require their explicit commands and configured D1 IDs.
Deployment runs the selected migration before building or deploying the Worker;
an unsuccessful migration stops the command chain. The full operational contract
is in `docs/operations/d1-migrations.md`.

## Deployment secrets

Keep these values in the shell or CI secret store and never commit them:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `PREVIEW_SESSION_SIGNING_KEY`
- `PREVIEW_RESEND_API_KEY`
- `PRODUCTION_SESSION_SIGNING_KEY`
- `PRODUCTION_RESEND_API_KEY`

## Current route boundary

Ticket 01 provides application-level separation only. `/`, `/admin`, and
`/health` are separate routes served by one public Worker; Storefront and Admin
use different route modules and render different surface markers. The smoke test
proves successful responses and verifies that those markers do not cross the
route boundary.

The Worker protects `/admin` before React Router executes. Local development
uses an explicit Owner stub; preview and production require a cryptographically
valid Cloudflare Access assertion whose email maps to an active D1 Owner or
Subaccount. The deployed Admin origin, Access values, and D1 resource IDs remain
placeholders and are not called until launch. Ticket 04 also proves the ordered
deployment chain through fresh local D1 execution, local Worker health smoke,
and Wrangler dry-run, completing the architecture baseline without a real
production deployment.

## Module boundaries

- `app/modules/storefront` owns public customer routes and UI.
- `app/modules/admin` owns Admin Backoffice routes and UI.
- `app/modules/catalog` owns catalog domain vocabulary and behavior.
- `app/modules/shared` contains cross-surface UI with no business ownership.
- `workers` owns the Cloudflare request boundary, health endpoint, and runtime
  context passed into React Router.
