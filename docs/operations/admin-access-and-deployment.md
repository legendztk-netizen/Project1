# Admin Access and Deployment Validation

## Admin boundary

The Worker protects `/admin` and every `/admin/*` path before React Router runs.
Storefront and `/health` requests do not enter this authentication branch.

Local development uses the explicit `local-stub` mode and maps to the fixed
development-only `owner@local.invalid` Owner identity. Runtime validation
rejects `local-stub` in preview and production. Outside local development, the
Worker first requires the configured Admin origin, then requires
`Cf-Access-Jwt-Assertion`, validates its signature against the configured
Cloudflare Access certificates, and verifies issuer, audience, expiration, and
subject. The normalized email must map to an active D1 Admin Identity. That
record supplies the stable application ID, Owner/Subaccount type, and
subaccount-management permission used by application authorization and audit.
Admin Identity emails are stored lowercase; D1 rejects mixed-case records so
Access normalization and account uniqueness cannot diverge.

Missing assertions return HTTP 401. Invalid assertions, incomplete claims,
wrong-host requests, and identities absent or disabled in D1 return HTTP 403.
The validated identity is passed
through the Worker request context and is used as the audit actor for Admin
mutations.

All Access team domains, audience tags, Admin origins, and deployed D1 resource
IDs remain named placeholders until launch. Ticket 04 does not create or call a
real Cloudflare Access application or seed a remote Admin Identity.

## Validation pipeline

`pnpm deploy:validate:production` runs these stages in order:

1. validate the production configuration shape;
2. apply and verify every migration against an isolated, disposable local D1;
3. build the production Worker and run `wrangler deploy --dry-run`;
4. start the locally built Worker and verify the real `/health` response through
   the Worker HTTP smoke suite.

The runner stops at the first failed stage. Tests inject a migration-stage
failure and prove that deployment and health are not entered.

`pnpm deploy:production` is the future live entry point. It cannot run unless
`ALLOW_CLOUDFLARE_DEPLOYMENT=confirmed` is set, all placeholders are replaced,
and all required secrets are present. No Ticket 04 verification invokes this
command. Preview has equivalent validation and live commands.

## GitHub Actions

`quality.yml` runs the formatting check, lint, typecheck, tests, local migration
verification, production build, and production deployment validation for pull
requests. `deployment-validation.yml` is a manually triggered dry-run of the
four-stage production chain. Neither workflow receives Cloudflare credentials
or deploys remote resources.

Real Access, production D1/R2/Queue resources, DNS, secrets, and live deployment
are deferred until all Spec 1 tickets pass locally and launch is explicitly
approved.
