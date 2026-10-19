# Record registration and last sign-in IP for the Customer Directory

User decision, 2026-10-18. The `customers` module itself is recorded as a
follow-up in ADR 0052; the terms are defined in CONTEXT.md (Customer Directory,
Customer Access Record, Privacy Notice).

Until now a customer's IP address was stored only as a keyed digest for rate
limiting, which cannot be turned back into the address. To show where a
customer registered and last signed in, the application now stores the raw IP
address, but only in the Customer Access Record: once at registration and once
for the latest sign-in, never per visit. Records are kept indefinitely. The
record is written in the same D1 batch that creates the session, so a sign-in
that fails records nothing.

Cloudflare's estimated location is read from `request.cf` in the Worker and
passed to routes through the router context, because React Router rebuilds the
Request for data submissions and the rebuilt Request has no `cf`.

The directory's own grant never reveals business data: RFQs need 询价与 PI
access and Orders need 订单与发货 access, as they would in those modules.

Migration 0134 gave existing profiles their newest session as the last sign-in
time, with no IP. A session also comes from a signed-in password change, but
when the migration ran on production on 2026-10-18 no customer had a password,
so every backfilled time is a real sign-in.

Consequences:

- IP addresses are personal information under North American privacy laws; the
  Privacy Notice discloses this collection, and the pages that collect it say
  so.
- Location is an estimate of where the IP address is, not of the customer.

Considered and rejected:

- Logging every visit: more D1 writes and more personal data than the request
  needs.
- Deriving the last sign-in only from `customer_sessions`: sessions keep no IP
  and password changes also create sessions.
