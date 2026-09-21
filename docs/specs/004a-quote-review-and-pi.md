# Spec 4A: Quote Review, Quote Revision, and PI

> Status: In progress. Tickets through #59 are implemented and pushed. Remaining #60-#63 are authorized for sequential implementation and final acceptance; no per-ticket user approval is required unless a new business decision is needed.

## Problem Statement

A submitted RFQ contains customer requirements and non-binding estimates, but it
does not yet establish technical suitability, final product prices, freight,
tax, import responsibility, lead time, or payment instructions. Editing a
submitted request in place would destroy the record of what the customer asked
for and what the seller offered.

## Solution

Provide an Admin Backoffice review workspace that converts an immutable RFQ into
versioned Quote Revisions and one fixed PI. The PI contains the approved product
specification and commercial terms, is delivered with its Payment Instructions,
and requires explicit, version-scoped customer acceptance before it can support
Order creation.

## User Stories

1. As an administrator, I want a queue of submitted RFQs and their review flags, so that I can prioritize technical and commercial work.
2. As an administrator, I want to review exact Standard Product and Hose Assembly snapshots, so that I quote what the customer actually submitted.
3. As an administrator, I want to set final unit prices and quantity discounts, so that the offer reflects the current commercial decision.
4. As an administrator, I want to confirm packing, freight, trade terms, tax treatment, and lead time, so that the customer sees a complete landed or import-responsibility offer.
5. As an administrator, I want internal notes and evidence separate from customer messages, so that factory and pricing context remains private.
6. As a customer, I want quote-related website and email replies in one conversation, so that commercial clarification is not fragmented.
7. As an administrator, I want a new Quote Revision instead of editing an issued offer, so that every material change remains auditable.
8. As an administrator, I want PI issuance blocked until required seller and commercial data are complete, so that an incomplete payment document is never sent.
9. As a customer, I want the fixed PI PDF and Payment Instructions delivered together, so that I know both what I am accepting and how to pay.
10. As a customer, I want to view or download the exact PI version before acceptance, so that acceptance cannot refer to an unseen replacement document.
11. As a customer, I want explicit acknowledgements for made-to-order products and final specifications, so that cancellation limits are clear before payment.
12. As a customer, I want to enter my legal name and accept the PI, so that the website retains clear acceptance evidence.
13. As an administrator, I want to record an email acceptance when a customer cannot complete the website action, so that a documented exception can use the same PI version.
14. As a customer, I want an acceptance confirmation by email and in My Quotes, so that I can retain evidence of the accepted offer.
15. As an administrator, I want expired and superseded PIs preserved but no longer actionable, so that historical documents cannot accidentally create new business.

## Implementation Decisions

- RFQ, Quote Revision, and PI are separate immutable records. Saved
  Configurations and an unsubmitted Quote List remain editable; submitted or
  issued versions are never edited in place.
- The quote editor starts from the RFQ's captured Reference Prices. Authorized
  Admin users set Quoted Unit Price and may apply Manual Quantity Discount.
  Price and discount changes append Pricing Audit Events.
- Cost Basis is visible only to authorized Admin operations and is never copied
  to customer-facing documents, APIs, exports, or messages.
- Product amounts, discount, freight, insurance, duties/import charges, tax, and
  Cutting and Labeling Fee remain explicit commercial values. PI values are
  taken from the selected Quote Revision and are not recalculated from the live
  catalogue.
- Individual and Business DDP/DAP thresholds follow the submitted Purchasing
  Context. The formal PI states the Incoterm and named place while customer
  surfaces may use simpler import-responsibility wording.
- Before PI issuance, Admin records a Shipment Packing Estimate sufficient for
  freight review. Actual carton count, weight, and dimensions remain optional
  operating data and are not PI gates.
- Sales Tax Treatment is `Collected`, `Exempt`, or `Not Collected`, manually
  confirmed during launch. Exempt treatment requires private supporting
  evidence. The storefront never assumes exemption.
- The PI snapshots seller legal name `Hangzhou Rongyao Trading Co., Ltd.` and the
  configured English Seller Registered Address. PI issuance is blocked until
  that China address is configured. The Plano Return Location is never used as
  the seller's legal address.
- Every issued PI has one selected Payment Channel, `Bank Transfer` or `PayPal`,
  and one required multiline Payment Instructions version. The fixed PI PDF and
  current instructions are provided together, while instructions remain a
  separately versioned panel rather than part of the immutable PDF hash.
- An issued PI is valid for 14 calendar days by default. An authorized Admin may
  set a different explicit validity deadline before issuance. Customer display
  uses ET and Admin display uses the equivalent Beijing Time.
- PI PDF generation snapshots the exact Quote Revision, product and assembly
  specifications, commercial terms, deadlines, cancellation/refund conditions,
  seller identity, document version, and hash.
- The customer must successfully `View PI` or `Download PI` for the current
  version before acceptance. There is no countdown, forced scroll, minimum view
  duration, or claim that file opening proves reading comprehension.
- Acceptance requires legal name, general commercial acknowledgement, and
  line-specific made-to-order specification acknowledgements where applicable.
  One acknowledgement may visibly cover multiple identified made-to-order lines.
- Website acceptance stores verified identity, Purchasing Context, PI version
  and hash, legal name, acknowledgement versions, UTC timestamp, and request
  evidence. Admin `Mark PI Accepted` for email acceptance records source, actor,
  same PI version, and audit evidence.
- A PI Acceptance copy is sent asynchronously and appears under My Quotes.
- A material change to products, quantities, specification, destination, or
  commercial terms creates a Quote Revision and replacement PI. Earlier
  versions, conversation, documents, and acceptance remain historical.
- Each My Quote has one customer-visible Quote Conversation. Inbound email uses
  an unguessable reply token and authorized sender checks. Unknown tokens or
  unauthorized senders enter quarantine rather than being attached.
- Internal Quote Notes and selected private R2 attachments are never included in
  customer conversation projections unless an authorized user explicitly sends
  a permitted customer message or file.
- Technical Review Required is advisory. The operator confirms unresolved
  matters with the factory through the launch operating process before issuing
  the PI; there is no redundant website production-approval gate before PI.

## Testing Decisions

- The primary seam is the Admin-and-customer flow from one submitted RFQ through
  commercial review, PI issuance, document delivery, customer viewing, and valid
  version-scoped acceptance.
- Tests assert the visible quote values, immutable revision history, fixed PI
  bytes/hash, required acknowledgements, acceptance evidence, and My Quotes
  status rather than template internals.
- Guard tests cover incomplete seller address, missing Payment Instructions,
  missing tax treatment, invalid deadlines, stale RFQ versions, unavailable
  products, and attempts to accept expired or superseded PIs.
- Pricing tests prove live catalogue changes do not alter an RFQ, Quote Revision,
  or PI and that Cost Basis never crosses the customer boundary.
- Conversation tests cover authorized email replies, idempotent provider
  delivery, unknown-token quarantine, and separation of Internal Quote Notes.
- PDF tests use semantic extraction plus rendered-page checks for required
  content and stable pagination; they do not compare implementation-specific
  object ordering.

## Out of Scope

- Bank or PayPal settlement verification and Order creation.
- Automated tax calculation, customs classification, or freight-provider API.
- Multi-level pricing approval or factory approval roles.
- Editing an issued PI in place.
- Automatic acceptance inferred from email opens, PDF viewing, or payment.

## Further Notes

## Downstream Data Contract (confirmed 2026-09-14)

- Spec 11 supersedes whole-catalog publication for new maintenance. Read current products through the item-aware repository; preserve legacy Catalog Release resolution for old snapshots.
- Freeze the actual SKU and inherited series revisions, resolved attributes, sales unit, quantity/length basis, image versions, source amounts and currencies, assembly generation and applicable service/protection rule versions, or equivalent complete immutable evidence. Never resolve historical business records solely from today's SKU.
- Unsubmitted configurations and Quote Lists revalidate current availability and assembly readiness. Catalog changes do not rewrite submitted RFQs, issued Quotes/PIs, Orders or production records.
- Formal Quote Revisions and PIs use USD in version one. Preserve original reference amounts/currencies separately. Admin explicitly enters final USD prices and commercial charges; no automatic conversion, exchange-rate service, cross-currency sum or relabeling of source amounts as USD.
- Non-USD or mixed reference amounts require manual commercial confirmation of final USD pricing and applicable import terms before formal issuance. Incomplete review blocks issuance, not submission of a valid manual RFQ.
- Product publication's last-successful-write rule does not apply to Quote Preparation Drafts: retain explicit concurrency/version checks.
- Public catalog media and private review evidence have separate authorization. Cost Basis, tax evidence and internal notes remain private.

Acceptance coverage: old and item-revision RFQs; inherited series/image changes after submission; mixed-currency references with explicit USD pricing; stale quote edits; fixed PI bytes and private-data exclusion.

This Spec consumes the RFQ from Spec 3. Its accepted/current PI and separately
versioned Payment Instructions are the input to Spec 4B.

- Project PRD: https://github.com/legendztk-netizen/Project1/issues/1
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/5
- Blocked by: https://github.com/legendztk-netizen/Project1/issues/4
