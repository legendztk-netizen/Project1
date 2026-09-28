# Spec 2 Ticket Review: Hose Assembly Configurator and Quote List

> Superseding correction (2026-08-29): Ticket 12's standalone Email Save was
> removed. Spec 2 retains unfinished work only in the active page session and
> offers Stay or Discard on website navigation. Spec 3 owns the email field as
> part of registration, a maximum 24-hour registration transaction, and creation
> of an account-owned Saved Configuration after verification. No accountless
> email draft is retained for 30 days.

## Review Status

- Parent: GitHub Issue #3, Spec 2
- Proposed ticket count: 13
- Publication status: Not published; awaiting user approval
- Sizing rule: each ticket must fit one fresh agent context and leave a
  demoable or independently verifiable result
- Shared testing source: every ticket applies the Testing Decisions in Spec 2;
  ticket-specific checks below narrow that contract without replacing it
- Authoritative measurement rule: the customer explicitly selects M01-M07 or
  `Not Sure`; no Hose End SKU or endpoint mapping chooses a method automatically

## Delivery Boundaries Requiring Approval

- Legacy endpoint assignments and ordered measurement mappings may remain in
  the published release for historical compatibility, but Spec 2 does not read
  them to choose a customer measurement method.
- `Request a Manual Assembly Quote` in Spec 2 records and explains the manual
  path; verified identity and actual RFQ submission remain owned by Spec 3.
- Spec 2 does not collect an email address or store an accountless unfinished
  configuration. The registration and account-owned save flow belongs to Spec 3.
- The assembly estimate never invents hose cut length or missing prices. If the
  versioned release cannot produce a complete estimate, the customer sees
  `Price confirmed with quote` rather than a guessed number.

## Ticket 01: Start a Page-Session Build a Hose Draft

**Blocked by:** None. Spec 1 / Issue #2 is complete.

**Scope:** Deliver the first usable `Build a Hose` step from the Storefront,
where a guest chooses an exact published Hose Series and Hose Size Variant and
starts one in-page configuration draft without creating a second cart or
persisting unfinished work to the Anonymous Quote Session.

**Acceptance criteria:**

- `Build a Hose` opens a real configurator route from Storefront navigation and
  presents published RFQ-eligible Hose Series and exact size variants from the
  active Catalog Release.
- No Hose or size is preselected; the customer cannot advance until an exact
  currently selectable Hose SKU is chosen.
- The draft records the Catalog Release, exact Hose SKU, series, size, pressure,
  temperature and presentation fields needed by later validation.
- Changing the Hose selection updates the visible specification without
  creating a Quote List line or writing unfinished draft data to D1.
- Empty, unavailable, superseded and direct-URL-invalid states explain what the
  customer can do next rather than rendering a blank configurator.

**Testing requirement:** Apply Spec 2 Testing Decisions; cover the active
release query, blank initial state, exact Hose selection, unavailable data and
absence of Anonymous Quote Session writes.

## Ticket 02: Select a Compatible End A with Guided Search

**Blocked by:** Ticket 01.

**Scope:** Extend the live draft through End A selection using only exact
published RFQ-Eligible Combinations for the chosen Hose, with customer-readable
filters and search instead of a flat SKU list.

**Acceptance criteria:**

- End A candidates come from exact Hose/Hose End/Ferrule compatibility rows for
  the selected Hose SKU; equal Dash values alone never create a candidate.
- Customers can filter by Interface Family, form, gender, swivel/fixed
  construction and Connection size, while exact Connection Standard, thread,
  seal and Dash values remain distinct and visible.
- Search finds supported candidates by SKU, alias, thread and Dash size without
  revealing unsupported Hose Ends from the general catalogue.
- Selecting End A stores its exact Hose End SKU, compatibility ID and derived
  Ferrule SKU; the Ferrule is visible in the technical summary but is not a
  customer-selectable component.
- Candidate and selection states remain usable with zero results, changed
  filters and an invalid deep-linked SKU.

**Testing requirement:** Apply Spec 2 candidate-restriction decisions; cover
exact tuple joins, filters, aliases, no-results behaviour, precise standard
separation and rejection of same-Dash-but-incompatible data.

## Ticket 03: Complete End B and Derive Both Ferrules

**Blocked by:** Ticket 02.

**Scope:** Add the ordered End B step, reuse the compatible finder, and support
copying End A when the same exact Hose End is eligible, producing a complete
Hose/End A/End B/Ferrule A/Ferrule B component set.

**Acceptance criteria:**

- End B is filtered against the selected Hose through its own exact eligible
  compatibility relationship and records a separate compatibility ID and
  derived Ferrule SKU.
- `Same as End A` is offered only when that exact Hose End remains eligible for
  End B and copies the exact SKU rather than approximating by family or Dash.
- End A and End B remain ordered roles in the draft even when their SKUs match.
- The customer sees both selected end specifications and can return to either
  step without the system silently substituting another variant.
- Completing both ends exposes the later measurement, orientation, protection
  and application stages without auto-selecting any of them.

**Testing requirement:** Apply Spec 2 compatibility decisions; cover different
ends, identical ends, unavailable copy, ordered identities, derived Ferrules and
no measurement-method inference.

## Ticket 04: Specify Measurement Method and Finished Length

**Blocked by:** Ticket 03.

**Scope:** Let the customer consult the public guide, explicitly choose M01-M07
or `Not Sure`, and enter Finished Overall Assembly Length with reproducible unit,
conversion, tolerance and review data.

**Acceptance criteria:**

- The step links to the public Measurement Guide and presents all current
  M01-M07 methods plus `Not Sure`; no Hose End SKU or legacy mapping preselects
  or removes a method.
- Finished Length remains unavailable until both ends exist and a method or
  `Not Sure` has been explicitly selected.
- Imperial input accepts 1/8-inch increments, metric accepts 1-mm increments,
  and the draft stores the original value/unit plus an exact canonical
  millimetre value.
- The customer sees the applicable SAE J517 tolerance and the draft snapshots
  the tolerance schedule, method record and diagram/overlay versions.
- Positive guided lengths through 50 ft are accepted with Length Feasibility
  Review Required; finer, longer, tighter-tolerance and single-end requests are
  directed to the manual path.
- `Not Sure` remains eligible to reach Quote List review with Manual Technical
  Review Required. It is stored as an explicit `not_sure` measurement state
  with no selected Measurement Method ID; the system must not assign a default,
  most common, geometrically inferred or otherwise "best" M-code or diagram.

**Testing requirement:** Apply Spec 2 measurement decisions; cover every
explicit method, `Not Sure`, boundary increments, exact conversion, tolerance
bands, 50-ft limit and zero/negative input.

## Ticket 05: Configure Conditional Double-Elbow Clocking

**Blocked by:** Ticket 03.

**Scope:** Add orientation only for two angled Hose Ends, using the shared M08
clockwise end-view convention and a dynamic customer-controlled preview.

**Acceptance criteria:**

- Clocking is omitted for zero or one angled Hose End and required only when
  both selected Hose Ends are angled.
- The step explains view End A toward End B, End B at 6 o'clock as `000`, and
  clockwise measurement using the same wording as the public guide.
- No angle is preselected; the customer can choose presets, enter any whole
  degree `000-359`, or select `Not Sure`.
- M08 responds to the entered value, labels itself `Not to scale`, and provides
  a deterministic text alternative for the selected orientation.
- The draft stores Clocking state, target angle when specified, standard
  `+/- 3 degrees` tolerance, convention version and renderer version; `Not Sure`
  requires manual review.

**Testing requirement:** Apply Spec 2 Clocking decisions; cover applicability,
presets, boundaries, invalid values, absence of an implicit `000`, `Not Sure`
and deterministic M08 output.

## Ticket 06: Select Protection and Optionally Screen Operating Conditions

**Blocked by:** Ticket 03.

**Scope:** Complete the installed-protection path with optional
operating-condition screening while keeping mandatory export packaging separate
from the optional installed product.

**Acceptance criteria:**

- The customer chooses among current published Installed Protection options;
  `No additional installed protection` remains available unless a matching Hose
  or Application rule requires protection.
- Standard Export Packaging is shown as included and is never represented as an
  Installed Protection choice.
- Operating Conditions are collapsed by default and clearly marked `Optional`.
  The customer can save Installed Protection without providing them.
- When the optional section is used, it captures fluid medium, maximum system
  working pressure and minimum/maximum operating temperature with one canonical
  value per field; partially completed input cannot be saved as supplied data.
- Stated values are compared against current Hose and component limits without
  being described as automated suitability certification.
- Out-of-range values route to the manual path; `Other` and `Not Sure` remain
  quotable with Technical Review Required.
- Installed Protection pricing supports a versioned base amount, material rate
  per exact foot, and installation rate per started foot. It does not reduce the
  source length to whole feet before calculating the material amount.
- The versioned assembly-service schedule charges `USD 0.50 * ceil(F)`, where
  `F` is the exact finished length in feet. Nylon Protective Sleeving charges
  `USD 8.00 + USD 1.35 * F + USD 1.00 * ceil(F)`; Plastic Spiral Guard charges
  `USD 8.00 + USD 1.00 * F + USD 1.00 * ceil(F)`.
- Inch and millimetre inputs produce the same result after exact conversion to
  feet, and final displayed amounts are rounded to two decimal places only after
  formula evaluation.
- Missing protection or service price inputs do not block configuration and are
  not replaced by guessed values.

**Testing requirement:** Apply Spec 2 operating-condition decisions; cover
omission without blocking, optional-section completion, conditional protection,
packaging separation, range boundaries, canonical unit conversion, out-of-range
routing, unknown inputs, exact-foot material pricing, started-foot installation
pricing and final currency rounding.

## Ticket 07: Retain and Revalidate Downstream Selections

**Blocked by:** Tickets 04, 05, and 06.

**Scope:** Make the completed draft resilient to upstream edits and catalog
changes by preserving customer-entered values while marking exactly what became
invalid, stale or requires reconfirmation.

**Acceptance criteria:**

- Changing Hose, End A or End B never silently clears a downstream customer
  value or substitutes a new component, method, length, angle or protection.
- One deterministic validation result identifies Retained Invalid Selections,
  reconfirmation requirements, technical-review flags and manual-path reasons
  with ownership by configurator step.
- Current Catalog Release, availability, exact compatibility, protection rules
  and reference versions are rechecked whenever relevant upstream data changes.
- Invalid values stay visible with their former input and cannot be mistaken for
  a currently valid selection.
- Restoring a compatible upstream state or explicitly replacing the invalid
  value resolves only the applicable issue and preserves unrelated inputs.

**Testing requirement:** Apply Spec 2 catalog-change and domain-test decisions;
cover each upstream change, retained values, issue ownership, recovery and no
silent deletion or substitution.

## Ticket 08: Render a Live Assembly Preview

**Blocked by:** Tickets 04, 05, and 06.

**Scope:** Provide the technology-forward, code-rendered 2D assembly preview and
concise live specification that reacts to every completed configurator step
without pretending to be a manufacturing drawing.

**Acceptance criteria:**

- The preview visibly distinguishes Hose, End A and End B forms and updates the
  displayed length, protection and conditional Clocking as the draft changes.
- M08 orientation is rendered dynamically rather than using a fixed bitmap;
  every visual state has equivalent deterministic text.
- The preview is explicitly labelled `Not to scale` and never displays or
  calculates hose cut length, crimp settings or production dimensions.
- Stable responsive dimensions prevent controls, labels, loading states and
  long technical values from shifting or overlapping the workflow.
- The adjacent text specification remains the authoritative representation and
  names exact component SKUs, customer inputs and applicable review flags.

**Testing requirement:** Apply Spec 2 preview decisions; assert visible output
and text alternatives for representative straight, angled and double-elbow
assemblies at desktop and mobile widths.

## Ticket 09: Review the Assembly and Explain Manual Paths

**Blocked by:** Tickets 07 and 08.

**Scope:** Deliver the final customer review state with linked corrections,
clear normal/technical/manual outcomes, and appropriate support handoffs without
submitting an RFQ, writing a Quote List line or inventing unknown component
values. The resulting review model is an input consumed by Ticket 10.

**Acceptance criteria:**

- Review displays ordered components, derived Ferrules, measurement method,
  original and converted length, tolerance, Clocking, protection, application,
  quantity and all versioned review flags.
- Every blocking or reconfirmation issue links to its owning step and returning
  to Review preserves the rest of the draft.
- The UI clearly distinguishes ready for Quote List, Technical Review Required,
  Manual Assembly Quote Request and currently blocked states.
- Unsupported precision, length, single-end, out-of-range or uncertain paths
  explain what needs human review and provide support/manual-quote direction;
  Spec 2 does not create a verified RFQ.
- Support Chat remains optional identification help and cannot write a Hose End,
  mark a configuration valid or submit it.
- Ticket 09 has no dependency on configured-line persistence and never invokes
  the Ticket 10 Add-to-Quote command.

**Testing requirement:** Apply Spec 2 warning-state decisions; cover each
outcome, linked corrections, preserved context and absence of RFQ/customer
identity creation.

## Ticket 10: Add a Configured Assembly to the Quote List

**Dependency satisfied:** Ticket 09.

**Scope:** Extend the existing Anonymous Quote List with one configured-assembly
line kind, server-side final validation, reproducible configuration snapshots,
versioned reference estimates and exact merge behaviour. This ticket consumes
the review result delivered by Ticket 09; it is not a prerequisite of Ticket 09.

**Acceptance criteria:**

- `Add Assembly to Quote` sends one domain command that revalidates the active
  release, component availability, exact relationships, reference versions and
  all current draft issues before writing anything.
- A stored line snapshots exact Hose, ordered ends, derived Ferrules,
  compatibility IDs, measurement/length/tolerance, Clocking, protection,
  application, review flags, source release and estimate inputs/versions.
- The existing signed cookie, 30-day Anonymous Quote Session and Quote List are
  reused; no parallel cart, draft cookie or second session is introduced.
- A complete configured estimate uses only versioned current inputs and exposes
  one non-binding USD amount; missing data shows `Price confirmed with quote`
  and never invents cut length or a price.
- Exact Configured Assembly Line Merge Key matches increase quantity; any
  material configuration difference creates a separate line.
- Failed revalidation writes no partial line and leaves the in-page draft intact
  with actionable errors.

**Testing requirement:** Apply Spec 2 Quote List seam; cover successful add,
snapshot fidelity, merge/non-merge cases, missing prices, catalog changes,
transactional failure and unchanged Standard Product/Length-Based Hose lines.

## Ticket 11: Duplicate and Edit Configured Assembly Lines

**Blocked by:** Ticket 10.

**Scope:** Make configured assemblies manageable inside the existing Quote List
through explicit edit, duplicate, quantity and remove actions without mutating a
stored line until the customer saves a valid replacement.

**Acceptance criteria:**

- A configured line displays an understandable specification and estimate in
  the same Quote List as Standard Products and Length-Based Hose.
- `Edit Configuration` creates an isolated edit draft; cancel leaves the stored
  line unchanged and `Save Changes` replaces it only after full revalidation.
- `Duplicate and Edit` creates a separate draft and does not add or change a
  line until the customer explicitly saves or adds it.
- Quantity changes use existing bounds and merge rules; removing a configured
  line affects only the selected line.
- A retained line invalidated by a newer catalog stays visible with its issue
  and cannot be silently rewritten to a currently available component.

**Testing requirement:** Apply Spec 2 edit and merge decisions; cover cancel,
save, duplicate, merge collision, stale data, quantity, remove and mixed line
kinds in one anonymous session.

## Ticket 12: Standalone Email Save Removed

**Blocked by:** Ticket 09.

**Scope:** Historical ticket superseded by the 2026-08-29 correction. Remove the
standalone email-save route, persistence, verification effect, and 30-day
accountless draft retention from Spec 2.

**Acceptance criteria:**

- Website navigation offers only Stay or Discard until Spec 3 registration is
  implemented.
- No email field or anonymous draft-save endpoint is exposed by Spec 2.
- Existing installations remove the obsolete pending-draft tables through a
  forward migration without changing Anonymous Quote List persistence.
- Spec 3 owns the 24-hour registration transaction and account-owned Saved
  Configuration created after successful verification.

**Testing requirement:** Cover Stay, Discard, absence of the email field and
obsolete endpoints, removal of obsolete tables, and continued Anonymous Quote
List persistence.

## Ticket 13: Harden Responsive Flow and Unsaved-Draft Exit

**Blocked by:** Tickets 11 and 12.

**Scope:** Finish the configurator for real guest use with desktop/mobile
workflow ergonomics, accessible step navigation, loss warnings and a complete
browser seam from blank draft to managed Quote List line.

**Acceptance criteria:**

- Desktop keeps a stable work area with sticky preview/specification; mobile
  presents one step at a time with fixed Back/Next and an expandable preview.
- Sticky navigation, Chat, validation messages and preview controls never cover
  one another at supported desktop and mobile widths.
- Website navigation from a non-empty unfinished draft warns `Your selected
  configuration will be lost when you leave.` It offers only Stay and Continue
  or Leave and Discard until Spec 3 registration is implemented.
- Stay preserves the exact page draft; Leave and Discard clears only that
  in-page draft.
- Refresh/tab close uses only the browser's best-effort native unsaved-changes
  warning and does not promise anonymous recovery.
- Keyboard, focus, labels, error announcements and back-navigation work across
  the full configurator, and one responsive browser test completes the primary
  Spec 2 flow through Quote List edit/duplicate.

**Testing requirement:** Apply all Spec 2 responsive and primary-seam decisions;
run desktop/mobile browser coverage, accessibility interaction checks, exit
variants and the complete end-to-end workflow.

## Dependency Graph

```text
01 Page-session draft + Hose
 |
 v
02 End A finder
 |
 v
03 End B + Ferrules
 |\
 | +-----------> 05 Clocking ---------+
 |                                      |
 +-------------> 04 Measurement/Length +--> 07 Revalidation --+
 |                                      |                      |
 +-------------> 06 Protection/App ----+--> 08 Live Preview --+
                                                               |
                                                               v
                                                        09 Review/Manual
                                                          |          |
                                                          v          v
                                                   10 Add to Quote  12 Remove email save
                                                          |          |
                                                          v          |
                                                   11 Edit/Duplicate  |
                                                          |          |
                                                          +----+-----+
                                                               |
                                                               v
                                                       13 Responsive/Exit
```

Tickets 04, 05 and 06 may run in parallel after Ticket 03. Tickets 07 and 08
may then run in parallel after those three inputs exist. After Ticket 09,
Tickets 10-11 form the Quote List branch while Ticket 12 independently delivers
the corrected draft boundary. Ticket 13 joins both branches for the complete
Spec 2 browser flow.
