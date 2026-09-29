# Use Cloudflare Inbound Email and Resend Outbound

Cloudflare Email Routing and an Email Worker receive and parse replies sent to
quote-specific addresses, while Resend sends transactional customer email.
Message metadata is stored in D1, attachments in private R2, and asynchronous
work in Queues. Both directions use application adapters so the underlying
email services can be replaced later.
