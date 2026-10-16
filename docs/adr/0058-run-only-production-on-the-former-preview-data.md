# Run only production, on the former preview data

User decision, 2026-10-16. Amends ADR 0055.

Cloudflare runs one environment, production, at `customhoseco.com` and
`admin.customhoseco.com`. Changes are tested locally before they are deployed.

Production took over the preview environment's D1 database and private R2
bucket as they were: catalog, prices, assemblies, product photos, seller
identity, payment instructions and the US return location, together with a few
test quotes, a test order and a test PI that will never be produced. Cloudflare
cannot rename a D1 database or an R2 bucket, so the production bindings keep the
names `hydraulic-hose-rfq-preview` and `hydraulic-hose-private-files-preview`.
The production database and bucket created earlier stay empty and unused.

The application knows two environments, `local` and `production`. The `preview`
environment, its `PREVIEW_*` secrets and the `reply-preview.customhoseco.com`
reply route are gone. Item publication can only be enabled locally; the
database production took over already runs in item mode.

Session signing and payload encryption keys are per environment, and encryption
keys are also derived with the environment name. After the switch, sessions
signed as preview are invalid, so everyone signs in again. Payloads sealed as
preview can no longer be decrypted; at the switch these were only notifications
that had already been sent, and no refund bank accounts were stored.

Considered and rejected:

- Copying the preview database and photos into the empty production resources:
  slower, with nothing gained once preview was going away.
- Moving the preview Worker to the production domains: production would run as
  `APP_ENV=preview`, keeping non-production Admin actions available and needing
  every production setting copied into the preview configuration.
