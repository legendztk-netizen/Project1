# Use Cloudflare Workers, D1, R2, and Queues

The launch web application is hosted on Cloudflare Workers. D1 stores
relational business and audit data, private R2 stores binary artifacts, and
Queues performs asynchronous and retryable work. Email capabilities remain
behind application adapters so hosting and persistence do not force a specific
outbound email vendor.
