# ADR 004: Private Files and Idempotent Asynchronous Work

- Status: Accepted
- Date: 2026-08-21

## Context

The platform stores product media, customer drawings, PIs, production evidence,
labels, shipping documents, and return evidence. It also sends transactional
email and performs retryable parsing and document work. Direct public object
URLs and duplicate queue effects would violate the product's privacy and record
rules.

## Decision

- Cloudflare R2 stores binary files privately. D1 stores object keys, ownership,
  type, version, checksum where required, and visibility metadata.
- Upload and download pass through an authorized Worker operation or a narrowly
  scoped, short-lived upload/download authorization.
- Public product media and Public Assembly Verification expose controlled
  projections rather than revealing the private bucket structure.
- Cloudflare Queues handles retryable email, inbound-message processing,
  attachment processing, and document-generation work.
- Every queued job carries a stable idempotency key. Consumers record completion
  before acknowledging a job so at-least-once delivery cannot send duplicate
  customer messages or create duplicate authoritative documents.
- Repeated failures enter a dead-letter queue and become visible for Admin
  review. A retry never bypasses the source domain command or invents a new
  business transition.

## Consequences

### PI PDF delivery implementation (2026-09-21)

For PI PDF generation, the application dead-letter queue is the durable D1
`proforma_invoice_pdf_jobs` failed-job set, not a second Cloudflare Queue binding.
After five attempts the job leaves automatic dispatch and remains visible on its
Admin PI page. Only an authorized, audited retry returns that same immutable
command to pending. Scheduled recovery handles dropped deliveries and expired
leases. The Queue message is acknowledged only after the durable transition.
Operational monitoring must query this failed-job set; broker DLQ metrics alone
do not report these application failures. No claim of a configured production
broker DLQ is made. Other asynchronous job types retain their own recovery rules.

- File metadata and domain authorization are required even when R2 already holds
  the bytes.
- Generated documents use immutable source snapshots and versioned templates.
- Queue consumers and external email calls need explicit deduplication tests.
