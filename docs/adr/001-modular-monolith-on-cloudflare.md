# ADR 001: TypeScript Modular Monolith on Cloudflare

- Status: Accepted
- Date: 2026-08-21

## Context

The launch team is small, expected traffic is initially modest, and the product
contains strongly related catalogue, quotation, payment, production, shipment,
and after-sales workflows. Independent services would add deployment,
observability, and distributed-consistency work without a current scaling need.
Product pages still need server rendering, while the configurator and Admin
Backoffice need rich React interaction.

## Decision

Use a TypeScript modular monolith built with React Router v8 Framework Mode and
the Cloudflare Vite integration, deployed to Cloudflare Workers. The v8 major is
an intentional architecture choice and is locked to an exact package version in
`package.json` and `pnpm-lock.yaml`. Use a workspace layout with shared domain,
database, validation, UI, and document modules.

The architecture baseline is demonstrated incrementally rather than by Ticket
01 alone:

- Ticket 01 proves the React Router and Worker runtime, public/Admin/machine
  route shells, typed local bindings, and the test harness. It does not provide
  Admin authentication or persistence.
- Ticket 02 proves local, preview, and production configuration separation and
  names the D1, R2, Queue, Access, email, and public-origin bindings.
- Ticket 03 proves Drizzle-managed D1 migrations plus one persisted read path
  and one controlled mutation path.
- Ticket 04 proves Cloudflare Access enforcement and the controlled production
  deployment chain.

Customer and factory route boundaries are added by their owning delivery Specs.
Until Ticket 03, the project is a runnable route shell rather than a full-stack
walking skeleton.

Feature modules may communicate through ordinary in-process interfaces. A new
Worker or service requires a later ADR based on a concrete isolation or scaling
need.

## Consequences

- Deployment and local development remain small enough for the launch team.
- Domain invariants can be shared across every surface without a network API
  between internal modules.
- Module boundaries must still be explicit; modular monolith does not permit UI
  routes to write arbitrary tables directly.
- A separate asynchronous Worker entry may be deployed from the same repository
  when queue or email handlers need an independent lifecycle. This is not a
  separate business service.
