# Admin Access and Deployment Validation

## Admin boundary

The Worker protects `/admin` and every `/admin/*` path before React Router runs.
Storefront and `/health` requests do not enter this authentication branch.

Local development uses `ADMIN_AUTH_MODE=password`; `/admin/login` is the only
public entry to the admin application (logout is a same-origin POST). There is
no automatic Owner identity. The local Owner account is initialized separately
in D1, with username `admin` and a salted hash; no bootstrap password lives in
source or migration files. Local credentials do not seed any remote database.

Password mode validates an opaque server-side session on every request. The
session cookie is HttpOnly, SameSite=Strict, Secure on HTTPS, and scoped to `/`
so both `/admin` and React Router `/admin.data` requests receive it. Password
resets, permission changes, disabling and deletion revoke sessions. Owner can
change their own password after verifying the current password, which revokes
all their sessions and redirects to login. Subaccount account-management APIs
are forbidden. Module checks protect both HTML and `.data` resource requests;
all unsafe admin requests require the same Origin.

Preview and production use `ADMIN_AUTH_MODE=password` (decision 2026-09-30):
the account and module-permission system (Owner plus Subaccounts with a
username and password) only works in this mode. `/admin/login` is served over
HTTPS on the configured Admin origin and the rate limits, opaque sessions and
Owner-only account management described above apply. The Owner is provisioned
in each remote D1 with `node scripts/set-admin-owner-password.mjs <preview|production>`,
which asks for the password in a hidden prompt (or reads `ADMIN_OWNER_PASSWORD`)
and stores only the salted PBKDF2 hash. Any Cloudflare Access application in
front of the Admin origin is optional extra protection; with it in place the
visitor passes Access first and then signs in with the username and password.

The `cloudflare-access` mode remains supported. In that mode the Worker
requires the configured Admin origin and `Cf-Access-Jwt-Assertion`, validates
signature, issuer, audience, expiration, and subject, then maps email to an
active D1 identity. Its module grants remain enforced, but Subaccount usernames
and passwords are not usable. Switching modes requires configuration review
and independently provisioning an Owner in the target environment. Neither mode
accepts `local-stub` as an authentication bypass.

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
