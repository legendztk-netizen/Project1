# Spec 8: Product Data Maintenance and Derived Assembly Publication

> Status: Ready. Prerequisites: Spec 1 / Issue #2 and Spec 2 / Issue #3 are complete.

## Problem Statement

The seller can bulk-import the approved 01-07 workbook and publish a versioned
catalogue, but the Admin Backoffice does not yet provide a coherent ongoing
maintenance workflow. Administrators cannot enter or edit one complete product
without rebuilding a workbook, catalogue review and publication are presented
as separate or ambiguously named operations, product images are not managed as
versioned catalogue data, and a base-product change can leave configurator data
stale unless the affected assembly relationships are regenerated before
publication.

## Solution

Provide one Product Data Maintenance area with separate Excel bulk-import and
Manual Catalog Entry paths, both backed by the same product-type validation
contract and the same current Catalog draft. Send every successful submission
to Product Review and Publication, where the system calculates Affected Assembly
Series, requires the administrator to regenerate their Derived Assembly Data,
shows the complete product and assembly impact, and publishes base and derived
data atomically as one Catalog Release. Support one reviewed, reusable,
versioned main image per product and require customer-facing Reference Price
data for every new or changed product that will be published.

## User Stories

1. As a Catalog administrator, I want the former Product Catalog area named Product Review and Publication, so that its review and release responsibility is explicit.
2. As a Catalog administrator, I want the former Data Import area named Product Data Maintenance, so that both bulk import and manual changes have one clear home.
3. As a Catalog administrator, I want the former Configurator Data area named Assembly Parameter Configuration, so that its assembly-specific purpose is clear.
4. As a Catalog administrator, I want to choose Excel Bulk Import or Manual Add/Edit on entering Product Data Maintenance, so that I can use the efficient path for the size of my change.
5. As a Catalog administrator, I want Excel Bulk Import to retain the approved 01-07 contract, so that existing bulk maintenance continues to work.
6. As a Catalog administrator, I want Manual Catalog Entry for one exact SKU, so that a small catalogue change does not require rebuilding a workbook.
7. As a Catalog administrator, I want compatibility relationships for a new or compatibility-relevant changed Hose, Hose End, or Ferrule generated automatically, so that I do not have to choose a template product or enter worksheet 04 combinations manually.
8. As a Catalog administrator, I want a product-type-specific form, so that I see only the fields relevant to Hose, Hose End, Ferrule, Adapter, or Quick Coupler data.
9. As a Catalog administrator, I want one product submission to include its worksheet 07 sales and price data, so that a new product is commercially complete.
10. As a Catalog administrator, I want incomplete manual submissions rejected without creating partial records, so that placeholders cannot leak into catalogue review.
11. As a Catalog administrator, I want manual and Excel submissions validated by the same rules, so that the accepted data does not depend on the entry channel.
12. As a Catalog administrator, I want field- and relationship-specific errors, so that I can correct the failed submission efficiently.
13. As a Catalog administrator, I want every publishable new or changed product to have a Reference Price, so that customers never see a newly released product with a missing price.
14. As a quoting administrator, I want Cost Basis to remain separate and optional for publication, so that internal cost does not become a customer-data prerequisite.
15. As a Catalog administrator, I want every publishable product to resolve one reviewed main image, so that customer product pages are not released without a visual reference.
16. As a Catalog administrator, I want to reuse an approved series or representative image, so that size-only variants do not require duplicate uploads.
17. As a Catalog administrator, I want newly uploaded images normalized automatically without cropping the product, so that storefront media are safe and consistent.
18. As a Catalog administrator, I want image replacements versioned in the Catalog draft, so that changing a shared image does not silently alter the live catalogue.
19. As a Catalog administrator, I want to see every SKU affected by a shared-image replacement, so that I understand the release impact.
20. As a Catalog administrator, I want the system to detect when a base-data change affects assembly derivation, so that I cannot accidentally publish stale configurator data.
21. As a Catalog administrator, I want the system to compute Affected Assembly Series, so that shared components, deleted records, and transitive dependencies are not missed.
22. As a Catalog administrator, I want to review but not shrink the affected-series set, so that performance optimization cannot weaken correctness.
23. As a Catalog administrator, I want to regenerate only affected series, so that routine maintenance does not rebuild unrelated assembly data.
24. As a Catalog administrator, I want the affected-series regeneration followed by catalog-wide consistency validation, so that partial recomputation cannot leave dangling or cross-version references.
25. As a Catalog administrator, I want the system to materialize explicit worksheet 04 relationships from the controlled compatibility keys: matching Hose Tail Dash, Hose Series-to-Ferrule Series, and skive requirement, so that the rule is deterministic and auditable.
26. As a Catalog administrator, I want unlike End A and End B reversals retained as distinct ordered combinations, so that measurement, Clocking, quoting, and production views retain stable end identity.
27. As a Catalog administrator, I want the generated component combination to exclude length, Clocking, and Installed Protection, so that the system does not pre-generate an unbounded set of finished-assembly SKUs.
28. As a customer, I want to select M01-M07 or Not Sure myself, so that no Hose End combination silently chooses my measurement method.
29. As a Catalog administrator, I want Update Assembly Data to run before publication, so that there is no product-only release followed by a second assembly update.
30. As a Catalog administrator, I want the system to calculate and retain the complete product, image, relationship, and derived-combination diff during validation, so that publication remains auditable without a separate preview step.
31. As a Catalog administrator, I want one Validate, Update Assembly Data, and Publish action, so that base products and Derived Assembly Data become active in the same Catalog Release.
32. As a Catalog administrator, I want failed validation or stale publication previews to leave the active Catalog Release unchanged, so that customers never see a partially updated catalogue.
33. As a Catalog administrator, I want my manual entry, regeneration, and publication actions audited, so that consequential catalogue changes remain attributable.
34. As a Catalog administrator, I want to enter, self-review, and publish my own change, so that launch operations do not require a second approver.
35. As a quoting administrator, I want production feasibility checked manually before PI issuance rather than during catalogue publication, so that catalogue maintenance does not create a new production-verification workflow.
36. As a customer, I want an existing saved or quoted configuration revalidated against the current release, so that later catalogue changes do not silently rewrite historical selections.

## Implementation Decisions

- Admin navigation, page headings, and browser titles use Product Data
  Maintenance, Product Review and Publication, and Assembly Parameter
  Configuration consistently.
- Product Data Maintenance exposes exactly two primary paths: Excel Bulk Import
  and Manual Add/Edit. It does not expose a draft-history menu or a third Draft
  Records workflow.
- The system retains a current Catalog draft internally. When manual maintenance
  begins without a suitable pending version, it creates a writable version from
  the active Catalog Release so untouched SKUs and relationships are retained.
  The absence of a draft-history UI never means that manual changes write
  directly to the active release.
- Excel Bulk Import remains the path for complete new series and large changes.
  Manual Add/Edit handles one exact product SKU per successful submission.
- Each product type has a purpose-built manual form driven by the same versioned
  01-07 field contract used for workbook validation. The product form submits
  the applicable product master data, one or more required worksheet 07 sales
  rows, and one main-image reference as one transaction. Worksheet 04
  relationships required by a changed product are generated by the combined
  update-and-publish action rather than a separate manual-entry screen.
- Manual input may remain temporarily in the active browser form, but the server
  stores no incomplete product or relationship. A submission with a missing
  required field, invalid controlled value, duplicate identifier, broken
  reference, malformed number, absent required product price, or absent main
  image fails without mutating the Catalog draft.
- Manual product entry exposes one business status with exactly three values:
  Online, Draft, and Discontinued. Online synchronizes the product and its price
  to Published and makes the product Available for Quote; Draft synchronizes
  both to Draft and keeps the product unavailable; Discontinued synchronizes
  both to Archived and makes the product unavailable. The price-publication and
  Supply Availability fields are not separate manual controls.
- Every new or changed product with a Published Catalog Publication Status
  requires a customer-facing USD Reference Price. Cost Basis remains
  Admin-only and is not a publication prerequisite.
- Assembly-service and Installed Protection amounts are not per-product manual
  inputs or derived catalogue values. The existing shared schedules remain
  versioned reference rules, while customer-specific amounts are calculated
  only after the customer supplies Finished Overall Assembly Length and chooses
  Installed Protection.
- A product must resolve exactly one main image for initial release. An
  administrator may choose an existing reviewed series/representative image or
  upload a new image. Size-only variants may share a representative image, and
  customer surfaces state that exact dimensions come from the specifications.
- Image upload validates actual content rather than only the extension, removes
  unnecessary metadata, preserves the full product without forced cropping, and
  generates normalized storefront and thumbnail derivatives. Source or licence
  notes are optional; actor, timestamp, content hash, and version are automatic.
- A shared image is immutable after publication. Replacement creates a new
  draft image version, reports all affected products, and becomes active only
  with the Catalog Release. Historical releases and business snapshots continue
  to resolve the retained prior version.
- Draft differences that can affect assembly derivation mark the applicable
  Hose Series stale. Impact analysis compares before and after states and walks
  transitive dependencies, including deleted series, replaced SKUs, shared Hose
  Ends or Ferrules, compatibility changes, and shared derivation rules.
- The system owns the Affected Assembly Series set. The administrator can review
  it but cannot remove a computed series. Shared-rule changes may legitimately
  make every Hose Series affected.
- Update Assembly Data is available in Product Review and Publication whenever
  affected series are stale. It regenerates only those series, removes obsolete
  derived records for their prior state, and then validates catalogue-wide
  referential and release-version consistency.
- The administrator does not select a template Hose End. During the combined
  update-and-publish action, the system traverses only products whose
  compatibility keys or lifecycle changed in the current draft. A valid tuple
  requires Hose End `Hose Tail Dash = Hose Dash`, Ferrule Series = Hose Series,
  Ferrule `Hose Tail Dash = Hose Dash`, and equal skive requirement. All three
  products must be Online, RFQ Eligible, and Available for Quote. The resulting
  exact Hose + Hose End + Ferrule tuples are materialized as worksheet 04
  relationships with system-rule provenance.
- When a relevant key or lifecycle changes, obsolete relationships involving
  that changed product are removed from the draft before valid tuples are
  rebuilt. Unrelated historical products and series are not traversed or
  rewritten. The operation is idempotent and audit logged.
- Derived Assembly Data is computed only from the resulting explicit, valid
  RFQ-Eligible combinations. Generation never invents crimp diameters,
  programs, pressure ratings, or production qualification.
- An Assembly Component Combination is an ordered tuple of Hose Size Variant,
  End A Hose End and Ferrule, and End B Hose End and Ferrule. Reversing unlike
  ends creates a distinct tuple. Its storage identifier is internal and opaque;
  tuple identity, not a user-facing encoding format, is the contract.
- Assembly Component Combinations exclude Finished Overall Assembly Length,
  Clocking, Installed Protection, Application Requirements, and customer-priced
  amounts. A completed customer configuration snapshots those later selections;
  each manufactured physical assembly receives its separate Assembly Number.
- M01-M07 Length Measurement Method remains an explicit customer selection,
  with Not Sure available under the existing manual-review behavior. No endpoint
  or component combination automatically assigns a method.
- Selecting a Draft in Product Review and Publication shows only additions,
  changes, and discontinuations relative to Active, plus changed compatibility
  relationships and affected Assembly Series. The complete cloned release
  remains internal and is not rendered as if every inherited product changed.
- Product Review and Publication exposes one Validate, Update Assembly Data,
  and Publish command. Internally it calculates affected series, regenerates
  them, performs catalog-wide validation, calculates and stores the complete
  diff, and atomically publishes once. A product-only publication followed by a
  separate assembly publication is forbidden.
- Publication is blocked by invalid product data, a missing required Reference
  Price or main image, invalid compatibility references, stale affected-series
  data, failed regeneration, catalog-wide consistency errors, or a changed
  draft/active generation after preview. Warnings never substitute for these
  hard checks.
- Publication atomically activates base product data, sales/price data, media
  versions, explicit compatibility data, and Derived Assembly Data under one
  immutable Catalog Release. Failure leaves the current active release and
  customer surfaces unchanged.
- One authorized Catalog administrator may perform entry, self-review,
  regeneration, and publication. Spec 8 adds no second-person approval state and
  does not weaken existing Cost Basis confidentiality or Admin authentication.
- Catalog maintenance and publication do not create or require a new production
  verification status. Before PI issuance, the existing Admin operating process
  still confirms that the selected Hose, Hose Ends, Ferrules, and crimp plan are
  manufacturable; Spec 8 adds no automated certification or redundant approval
  workflow.
- Published SKU identity is immutable. Corrections that change identity create
  a replacement SKU and archive or make the prior SKU unavailable; historical
  Catalog Releases, RFQs, PIs, Orders, and assembly records are never rewritten
  or physically deleted.
- Successful manual maintenance, failed validation, image replacement,
  affected-series calculation, assembly-data regeneration, and Catalog Release
  publication produce appropriate append-only Admin Audit Events without
  storing secrets or full binary media.

## Testing Decisions

- The primary seam is one Worker-backed external workflow: an authorized
  administrator manually submits one complete product with worksheet 07 price
  data and a main image, returns to Product Review and Publication, regenerates
  the system-computed Affected Assembly Series, reviews the combined product and
  assembly changes, publishes once, and then a public customer can find the new
  product and use its newly available explicit combination in Build a Hose.
- The primary workflow also proves that a missing required field, price, image,
  compatibility reference, stale derived series, failed regeneration, or stale
  publication preview leaves the active Catalog Release unchanged.
- Excel Bulk Import, editing an existing product, automatic compatibility
  expansion, selecting a reused representative image, uploading a new image,
  and replacing a shared image are variants of the same external seam rather
  than separate architectural test harnesses.
- Contract tests apply identical field, controlled-value, numerical,
  uniqueness, cross-record, Reference Price, and media requirements to Excel and
  manual entry. Tests assert results and errors, not parser or form-helper calls.
- Dependency tests cover direct and transitive affected-series calculation,
  including shared Hose Ends and Ferrules, removed records, replacement SKUs,
  relationship changes, and shared-rule changes. Administrators cannot reduce
  the computed set.
- Regeneration tests prove that only affected series are replaced, obsolete
  derived records are removed, unaffected series retain equivalent data, and a
  catalog-wide check detects dangling or cross-version references.
- Combination tests prove deterministic automatic worksheet 04 expansion from
  the four controlled compatibility keys, changed-product scope, idempotence,
  ordered End A/End B identity, no generated customer
  length/Clocking/protection variants, and no automatically assigned M01-M07
  method.
- Media tests cover real-content validation, non-cropping normalization,
  thumbnail/storefront derivatives, metadata removal, shared representative
  reuse, versioned replacement, affected-product preview, and historical image
  retention.
- Publication tests cover complete diff presentation, one final action,
  optimistic concurrency, audit attribution, idempotent retry, atomic activation,
  and active-release isolation on every rejection path.
- Authorization and projection tests prove that public requests cannot mutate
  drafts, media, or releases; Cost Basis remains absent from customer responses;
  and the same authorized administrator may maintain and publish without a
  second-approver state.
- Existing Build a Hose and Quote List tests remain regression coverage for
  explicit measurement selection, derived Ferrules, current-release
  revalidation, and immutable historical snapshots.

## Out of Scope

- A Draft Records menu, draft-history workspace, or server-persisted incomplete
  manual form.
- Manual entry of a whole series or large batch; those changes use Excel Bulk
  Import.
- A multi-image product gallery, image ordering, drag-and-drop cover selection,
  or mandatory image-licence evidence.
- Pre-generating saleable Hose Assembly SKUs for combinations of length,
  Clocking, Installed Protection, or Application Requirements.
- Compatibility inference from thread, connection name, image, free text, or
  other uncontrolled similarity; crimp engineering, production qualification,
  suitability certification, or a new production-approval role.
- Replacing the customer's explicit M01-M07 or Not Sure selection with an
  endpoint-derived method.
- A new Catalog permission model or two-person approval workflow.
- A new release rollback UI, catalogue export redesign, inventory system,
  supplier portal, or warehouse workflow.
- Rewriting submitted RFQs, Quotes, PIs, Orders, or physical Assembly Records
  after a catalogue change.

## Further Notes

- Spec 8 extends the completed Spec 1 catalogue workflow. Where the two differ,
  Spec 8 governs Product Data Maintenance, required published-product Reference
  Price, versioned main-image maintenance, affected-series regeneration, and the
  combined Product Review and Publication flow.
- Spec 8 clarifies the completed Spec 2 boundary: M01-M07 remains a customer
  choice, and Derived Assembly Data stops at component combinations rather than
  pre-generated finished-assembly SKUs. Existing customer length, Clocking,
  Installed Protection, estimate, and configuration-snapshot behavior remains
  unchanged.
- Spec 8 aligns with Spec 4A rather than replacing it. Catalogue publication has
  no production-verification gate, while the existing pre-PI operating process
  confirms manufacturability without adding a redundant approval status.
- Spec 1 / Issue #2 and Spec 2 / Issue #3 are complete prerequisites. Spec 8 is
  independently implementable and does not depend on completion of Spec 4A.
- Source discussion: the independent change input dated 2026-09-03.
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/64
