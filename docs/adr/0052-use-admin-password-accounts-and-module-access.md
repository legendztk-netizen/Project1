# Admin username/password accounts and module access

User decision, 2026-09-29. Supersedes the local automatic Owner assumption and
extends ADR 0047 with module access levels. The Owner username is `admin`;
subaccounts require only username, password and name. No email invitation or
email field is presented. Existing identity email columns remain compatibility
storage for historical identity references, not a new login requirement.

The local environment uses password login. The configured deployed Access mode
is retained until an explicit environment migration. Password mode also requires
the configured admin origin outside local development. Production deployment
and external Access policy changes are not part of this implementation.

Each business module is denied by default, read-only, or writable. The Worker
checks every admin page/resource request and every mutation before dispatch.
Owner-only account management and existing Owner-only business approvals remain
restricted to Owner. UI visibility is advisory and never replaces authorization.
After-sales work requires at least read access to orders because its forms live
on order details. The shared order action checks the submitted intent against
the order or after-sales grant independently before performing a mutation.

Credentials use the existing PBKDF2-SHA256 implementation with random salt and
600,000 iterations. Random session tokens are stored only as SHA256 digests,
expire after eight hours, and are delivered in HttpOnly, SameSite=Strict cookies
(Secure on HTTPS). Login attempts are limited by username and IP. Resets,
permission changes, disable and deletion invalidate existing sessions. All
account mutations are audited without passwords or credential hashes. Owner
may change their own password by verifying the current password; success
revokes all Owner sessions and requires a new login.

Deletion clears credentials and grants and tombstones the identity. Existing
business/audit references retain their actor; usernames cannot be reused.
Bootstrap credentials are never committed to source or migrations. The requested
Owner credential is initialized only in the current local database.

Follow-up decision, 2026-09-29: Assembly parameter configuration is a separate
module (`configurator`); catalog grants do not imply that grant, and existing
subaccounts receive no configuration grant automatically. Notification queries,
counts, lookup and personal read-state changes require the relevant source
module grants. Read-only notification access allows only opening authorized
notifications and updating one's own read state. Successful password verification
releases its own reserved login attempts; it never clears other requests'
shared-IP failures, and concurrent failures remain limited atomically.
