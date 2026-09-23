---
status: accepted
date: 2026-09-23
---

# Defer the Factory Workflow from the First Release

The first release sells Standard Products, Length-Based Hose Orders and configured
Hose Assemblies while manufacturing, cutting, required inspection and factory
coordination remain offline. Spec 5 is deferred: Spec 6 consumes Confirmed Orders
from Spec 4B and records explicit Admin shipment readiness; Spec 7 uses Order
lines, Shipment quantities and documented Admin review of actual factory facts.
This reduces launch development while accepting more manual coordination and
less per-piece traceability.

## Consequences

- Production Approval retains its glossary meaning: the customer's approval of
  fixed specifications. Payment, Order creation and shipment readiness do not
  prove that physical production or cutting started or finished.
- Spec 4B's idempotent production initialization records may remain reserved for
  future use. Their pending state is neither a launch work backlog nor a Shipment
  gate. No factory consumer, generated Production Instruction, Assembly Number,
  QR label, Factory Mobile surface or Public Assembly Verification is required
  for first-release fulfillment or after-sales handling.
- Admin verifies the accepted specifications, affected quantities, actual
  preparation and required offline inspection before marking Ready to Ship.
  Record the actor, time and reviewed Shipment version; private notes and
  supporting documents may be attached. This is not a substitute for the actual
  factory inspection and does not generate per-piece Proof Test claims.
- Payment Confirmation Review Hold and quantity-scoped change/cancellation
  holds still block new allocation or dispatch as applicable. Separate holds
  cannot clear each other. Recording an already-completed carrier handoff or
  delivery is not a new production or dispatch release. Late handoff recording
  needs an audited reconciliation path that preserves holds on remaining goods
  and exposes any conflict with a pending request or payment review.
- Spec 7 records the factory information used for exceptional assembly
  cancellation or pre-cut hose cancellation. It never guesses cutting from
  elapsed time or requires an unavailable website Assembly Number to report a
  problem. Existing return, inspection and refund rules continue to apply.
- Shipment allocations and after-sales quantities use immutable Order-line
  identity and the appropriate physical unit. Cut-hose piece counts and
  per-piece lengths remain distinct from pricing footage.
- Later activation of Spec 5 must explicitly select eligible work. It must not
  consume every old pending initialization, manufacture history for fulfilled
  Orders, or invent past labels, scans or inspection evidence.

This decision supersedes first-release scheduling statements in older PRD,
scope and glossary-supporting text that require the Spec 5 website workflow.
It defers the activation described in ADR-0009; it does not delete the future
identifier design or change the meaning of existing domain terms.
