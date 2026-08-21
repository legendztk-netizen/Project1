# Hydraulic Hose RFQ Platform

React Router v8 and TypeScript application running as one Cloudflare Worker.
The initial skeleton exposes three deliberately separate surfaces:

- `/` - Customer Storefront catalog workspace
- `/admin` - Admin Backoffice shell
- `/health` - machine-readable Worker health response

## Prerequisites

- Node.js 24 or newer
- pnpm 11

## Local development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Local runtime values come from `wrangler.jsonc`;
they are non-secret development values.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm test:smoke
pnpm build
pnpm check
```

`test:smoke` builds the application, starts Vite's workerd-backed Cloudflare
preview, and verifies the Storefront, Admin, and health routes through HTTP.

The production Worker name is passed explicitly at deployment time:

```bash
CLOUDFLARE_WORKER_NAME=replace-with-production-worker-name pnpm deploy:production
```

This command still requires the Cloudflare account and token placeholders below
to be supplied by the shell or CI secret store.

## Production placeholders

Copy `.env.example` to a shell-managed environment or CI secret store before a
real deployment. Replace these named placeholders outside source control:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_WORKER_NAME`
- `PUBLIC_STOREFRONT_HOSTNAME`
- `ADMIN_HOSTNAME`

The placeholder names are fixed here; their real preview and production values,
Access settings, and environment-specific bindings are intentionally deferred
to Spec 1 Ticket 02. Do not place credentials or real host names in
`wrangler.jsonc`, and do not commit `.env` files.

## Current route boundary

Ticket 01 provides application-level separation only. `/`, `/admin`, and
`/health` are separate routes served by one public Worker; Storefront and Admin
use different route modules and render different surface markers. The smoke test
proves successful responses and verifies that those markers do not cross the
route boundary.

`/admin` is not authenticated or access-controlled yet. Anyone who can reach
the Worker can currently open the Admin shell. Cloudflare Access enforcement,
identity mapping, and the protected deployment boundary belong to Ticket 04.
The completed Ticket 01 is therefore a runnable route shell, not proof of the
full architecture baseline or a React Router-to-D1 walking skeleton.

## Module boundaries

- `app/modules/storefront` owns public customer routes and UI.
- `app/modules/admin` owns Admin Backoffice routes and UI.
- `app/modules/catalog` owns catalog domain vocabulary and behavior.
- `app/modules/shared` contains cross-surface UI with no business ownership.
- `workers` owns the Cloudflare request boundary, health endpoint, and runtime
  context passed into React Router.
