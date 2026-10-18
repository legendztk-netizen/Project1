# Record registration and last sign-in IP for a read-only Customer Directory

User decision, 2026-10-18. Extends ADR 0052 with the `customers` module.

Admin Backoffice gets 用户管理, a read-only Customer Directory of verified
Customer Profiles: email, name, phone, Organization Profiles, delivery
addresses, the IP address the customer registered from and the time, method and
IP address of their latest sign-in, plus their RFQs and Orders.

Until now a customer's IP address was stored only as a keyed digest for rate
limiting, which cannot be turned back into the address. The application now
keeps one Customer Access Record per profile with the raw registration IP and
the raw last sign-in IP, each with Cloudflare's estimated country, region and
city. It does not log every visit or page view. Records are kept indefinitely.
The record is written in the same D1 batch that creates the session, and only
if that session row exists; registration fields are written only when the batch
also created the profile. Email-code sign-in and registration, password sign-in
and emailed-code password reset count as sign-ins; rotating sessions after a
signed-in password change does not. Existing profiles get their last sign-in
time from their newest session; their IP addresses are unknown.

Cloudflare's location is read from `request.cf` in the Worker and passed to
routes through the router context, because React Router rebuilds the Request for
data submissions and the rebuilt Request has no `cf`.

The directory has its own module grant, never granted implicitly. RFQ counts and
lists need 询价与 PI access and Order totals and lists need 订单与发货 access, so
a 用户管理 grant never reveals business data its holder could not open in
those modules. The RFQs and Orders shown are the ones the customer sees in the
Personal Center; the directory counts them for a page of profiles with two
indexed queries instead of the Personal Center's per-profile condition, and a
test keeps both in agreement. An Order is history once every Shipment is
delivered or every unit is cancelled. The first version only reads; signing a
customer out, disabling an account and internal notes are left for later.

Consequences:

- IP addresses are personal information under North American privacy laws.
  The Privacy Notice at `/policies/privacy` discloses this collection, and the
  registration and sign-in pages say so where it happens. Privacy requests go
  to `privacy@customhoseco.com`, which needs its own Email Routing rule because
  the zone's catch-all only accepts quote replies.
- Location is an estimate of where the IP address is, not of the customer.

Considered and rejected:

- Logging every visit: more D1 writes and more personal data than the request
  needs.
- Deriving the last sign-in only from `customer_sessions`: sessions keep no IP
  and password changes also create sessions.
- Showing RFQs and Orders to every 用户管理 holder: it would bypass the existing
  module grants.
