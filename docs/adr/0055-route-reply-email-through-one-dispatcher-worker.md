# Route reply email through one dispatcher Worker

Preview and production share the `customhoseco.com` zone, and Cloudflare Email
Routing allows one catch-all rule per zone. Reply addresses carry per-quote
tokens, so they cannot be listed as literal routing rules. The catch-all
therefore points to a small account-wide Email Worker,
`hydraulic-hose-email-dispatcher`, instead of to either application Worker.

The dispatcher reads only the envelope recipient's domain. `reply.customhoseco.com`
goes to production and `reply-preview.customhoseco.com` goes to preview, each
through a service binding to the application Worker's `InboundEmail` named
entrypoint. The original envelope, headers and raw stream pass through
unchanged, so each environment keeps its own DKIM verification, reply-token
checks, D1 receipt and R2 storage (ADR 0017). Named entrypoints are reachable
only through same-account service bindings, which is why the relayed envelope
is trusted like the one Email Routing hands to an `email()` handler.

Any other recipient is rejected at the dispatcher, without touching an
environment's database. A target that cannot answer, including a production
Worker deployed before this entrypoint existed, makes the dispatcher reject with
the same "please resend" reason the application uses, so a reply is never
silently accepted.

A second zone per environment was rejected: it would need another registered
domain and would duplicate DNS and Email Routing setup for no isolation the
service bindings do not already give.
