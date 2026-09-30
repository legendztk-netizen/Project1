# Limit PBKDF2 iterations to the Cloudflare Workers maximum

User-visible incident, 2026-09-30: after switching preview to username/password
admin login, every login attempt returned HTTP 500. Worker logs showed
`NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
supported (requested 600000)`. The deployed Workers runtime rejects PBKDF2
requests above 100,000 iterations; local workerd does not, so local tests and
the local smoke suite passed. Customer password credentials were affected the
same way.

Password hashing keeps PBKDF2-HMAC-SHA-256 but uses 100,000 iterations
(`customerPasswordWorkFactor`), the highest value the deployed runtime accepts.
This is below the 600,000 commonly recommended for PBKDF2-SHA256, so strong
unique passwords, the existing per-account and per-IP login limits, and
independent monitoring remain the primary defenses. Moving to a stronger
memory-hard KDF that the Workers runtime supports is a separate decision.

A stored credential whose work factor the runtime cannot evaluate is treated as
a non-match instead of an error. Credentials created with the old value (only
local development data) must be reset; the Owner script
`scripts/set-admin-owner-password.mjs` re-creates the Owner hash.
