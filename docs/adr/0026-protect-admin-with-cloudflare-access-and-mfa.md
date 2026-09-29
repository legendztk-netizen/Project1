# Protect Admin with Cloudflare Access and MFA

The Admin Backoffice runs on a dedicated hostname protected by Cloudflare
Access and permits only specified Cloudflare account members with MFA. The
application validates the Access JWT, maps the identity to an active D1 admin
record, and applies composable roles. Customer, factory, and webhook entry
points remain outside the human admin policy and use their own authentication.
