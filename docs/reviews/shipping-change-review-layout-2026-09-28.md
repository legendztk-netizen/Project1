# Shipping-change review layout verification

Date: 2026-09-28

Change requests are now displayed as cards with a status badge, customer-request
summary, and readable shipment names instead of internal shipment identifiers.
Approval/proposal and rejection entry points are visible blue and gray icon
buttons. Both open guarded dialogs instead of inline disclosure forms. Proposal
copy makes clear that customer acceptance and subsequent Admin activation are
still required. Form commands and server-side workflow are unchanged.

Dialog fields use consistent spacing and input sizing. Discarding and reopening
a proposal resets the draft split-shipment toggle to the current proposal's
value. Private action dialogs expose an optional open callback for this reset.

Verification:

- 15 UI tests passed across shipping-review actions and cancellation dialogs,
  covering modal entry without submission, required rejection reasons, correct
  command intents, and discarded split-draft reset.
- TypeScript, targeted lint, and whitespace checks passed.
- Visually checked the actual Order card and opened both dialogs. No live
  proposal, rejection, or customer notification was submitted.
