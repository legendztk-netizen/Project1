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

Deployment commands are explicit and fail before building while an ID, origin,
Access setting, email setting, or required secret remains unresolved:

```bash
pnpm deploy:preview
pnpm deploy:production
```

The environment contract and replacement procedure are documented in
`docs/operations/environment-configuration.md`.

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
