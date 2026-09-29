# ADR 002: Surface and Identity Isolation

- Status: Accepted
- Date: 2026-08-21

## Context

The platform has public customers, verified customers, administrators, factory
workers, public Assembly QR viewers, and provider webhooks. Their permissions
and acceptable interface complexity differ substantially.

## Decision

Use distinct hostnames or route boundaries for Customer Storefront and Personal
Center, Admin Backoffice, Factory Mobile, Public Assembly Verification, and
provider webhooks.

- Customers use Passwordless Access backed by verified email and application
  sessions.
- Admin Backoffice is protected by hostname-scoped Cloudflare Access. The Worker
  validates the Access JWT and maps it to an active D1 Admin Identity before
  checking Admin Permissions.
- Factory workers use time-limited Factory Batch Access issued for the minimal
  Factory Mobile workflow and are never Admin Backoffice users.
- Public Assembly Verification uses an unguessable Assembly label token and
  returns only the approved public projection.
- Provider webhooks use provider-specific signature verification and do not
  inherit any human session.

Authentication middleware identifies the actor. Domain commands independently
authorize the requested action; route visibility alone is never authorization.

## Consequences

- One codebase may serve several surfaces without sharing their trust model.
- Customer, factory, and public QR APIs must never serialize internal cost,
  customer identity, private evidence, or Admin Audit fields.
- The skeleton code must prove one denied cross-surface access case.
