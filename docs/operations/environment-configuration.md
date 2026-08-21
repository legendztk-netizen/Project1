# Environment Configuration

## Contract

`config/environment-contract.json` is the single machine-readable contract for
local, preview, and production. It names every application variable, Worker,
D1 database, private R2 bucket, asynchronous Queue, Access setting, email
setting, public origin, required secret, and deployed-placeholder rule.

`wrangler.jsonc` implements that contract. `scripts/environment-config.mjs`
compares Wrangler with the contract before every environment build or deploy.
The Worker imports the same contract and rejects incomplete runtime bindings in
`workers/environment.ts`.

| Environment | Default use | Admin auth | Email | Remote deployment |
| --- | --- | --- | --- | --- |
| local | `pnpm dev`, `pnpm build` | local stub | local stub | prohibited |
| preview | explicit preview build/deploy | Cloudflare Access | Resend | blocked until placeholders are replaced |
| production | explicit production build/deploy | Cloudflare Access | Resend | blocked until placeholders are replaced |

Worker, D1, R2, Queue, Storefront origin, and Admin origin values are distinct
for all three environments. The contract test fails if any of those identities
are reused.

## Required Bindings

| Kind | Binding or variable |
| --- | --- |
| D1 | `DB` |
| Private R2 | `PRIVATE_FILES` |
| Queue producer | `ASYNC_JOBS` |
| Public origin | `PUBLIC_STOREFRONT_ORIGIN` |
| Admin origin | `ADMIN_ORIGIN` |
| Access | `ADMIN_AUTH_MODE`, `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, `CLOUDFLARE_ACCESS_AUD` |
| Email | `EMAIL_DELIVERY_MODE`, `EMAIL_FROM`, `EMAIL_REPLY_DOMAIN`, environment-specific Resend secret |
| Session integrity | environment-specific signing secret |

Local D1, R2, and Queue bindings are simulated by workerd. Local authentication
and email delivery use sanctioned stubs, so local development needs no remote
Cloudflare resources and no application secrets. Default development, build,
type generation, and dry-run commands unset any inherited `CLOUDFLARE_ENV`
before invoking Cloudflare tooling.

## Placeholder Replacement

Before preview or production can deploy:

1. Replace that environment's D1 `database_id` in `wrangler.jsonc`.
2. Replace `.invalid` Storefront/Admin origins and email domains in both the
   contract and Wrangler configuration.
3. Replace the Cloudflare Access team domain and audience in both files.
4. Provide `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and that
   environment's `PREVIEW_*` or `PRODUCTION_*` signing and Resend secrets
   through the shell or CI secret store.
5. Run `node scripts/environment-config.mjs validate <environment>`.
6. Run the explicit `pnpm deploy:preview` or `pnpm deploy:production` command.

The deployment gate reports every unresolved field at once. It never prints a
secret value. Preview and production builds may be produced with placeholders
for validation, but those builds are not deployable.

## Startup Failure

Every request validates the selected environment before routing. A missing D1,
R2, Queue, variable, or required deployed secret throws one aggregated error
that names the missing binding. Deployed environments also reject placeholder
domains, placeholder Access values, non-HTTPS origins, local auth mode, and the
email stub.

Cloudflare environment selection happens when Vite starts or builds. Therefore
the preview and production scripts set `CLOUDFLARE_ENV` before `react-router
build`; setting it only at `vite preview` or after the build is intentionally
unsupported.
