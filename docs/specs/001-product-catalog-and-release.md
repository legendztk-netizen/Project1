# Spec 1: Product Catalogue and Catalog Release

## Problem Statement

The seller has an approved 01-07 Excel workbook and product media, but no live,
versioned catalogue from which customers and later commercial workflows can
select exact products. Publishing rows directly would expose incomplete or
inconsistent data, while treating every size as an unrelated page would make
the catalogue difficult to search and maintain.

## Solution

Provide an Admin Backoffice catalogue workflow that imports the workbook into a
validated draft Catalog Release and publishes it atomically. Provide an
English-language Customer Storefront organized by Catalog Product Family with
search, filters, exact SKU Variant selection, Reference Price, Supply
Availability, product media, and a minimum Anonymous Quote List for eligible
Standard Products and Length-Based Hose.

## User Stories

1. As a Catalog administrator, I want to import the approved 01-07 workbook, so that I can initialize the catalogue without re-entering hundreds of SKUs.
2. As a Catalog administrator, I want row- and field-specific validation results, so that I can correct the source instead of discovering bad data after publication.
3. As a Catalog administrator, I want a failed import to leave the active catalogue unchanged, so that customers never see a partially imported release.
4. As a Catalog administrator, I want the system to calculate and retain an import diff during publication validation, so that changes remain auditable without a separate preview step.
5. As an authorized administrator, I want to publish one complete Catalog Release, so that all customer-facing catalogue data changes together.
6. As a Catalog administrator, I want one Online, Draft, or Discontinued product status, so that product, price, and availability states cannot contradict each other.
7. As a quoting administrator, I want to see internal Cost Basis separately from Reference Price, so that I can prepare later quotes without exposing cost to customers.
8. As a customer, I want to navigate by hydraulic hose, Hose Ends, Ferrules, Adapters, and Quick Couplers, so that I can begin with the product class I understand.
9. As a customer, I want to search by SKU, product name, alias, standard, interface, thread, and dash size, so that I can find a known or equivalent product efficiently.
10. As a customer, I want related sizes grouped under one Catalog Product Family page, so that I can compare variants without opening many nearly identical pages.
11. As a customer, I want an exact SKU Variant and its specifications to remain visible after selection, so that I know what will enter my Quote List.
12. As a customer, I want to see a USD Reference Price and clear non-binding estimate language, so that I can judge whether to request a formal quote.
13. As a customer, I want to see `Available for Quote`, `Temporarily Unavailable`, or `Discontinued` rather than invented inventory counts, so that availability claims remain credible.
14. As a hose customer, I want to enter Length per Piece and Number of Pieces, so that cut hose can be requested without pretending every length is a separate SKU.
15. As a customer, I want an eligible Standard Product added to my Quote List without logging in, so that catalogue browsing converts directly into quote preparation.
16. As a Catalog administrator, I want imported product states normalized through the same Online, Draft, or Discontinued mapping, so that a large import cannot create contradictory product and price states.

## Implementation Decisions

- The import source contains the seven approved worksheets: Hose master data,
  Crimp Hose Ends, Ferrules, compatibility, Adapters, Quick Couplers, and price
  and packaging data. The former validation-file worksheet is not supported.
- Workbook column names and requiredness are defined by a versioned import
  contract. Certificate number, HS Code, maximum continuous length, ownership,
  confirmation, drawing-owner, and the expressly removed ferrule dimensions are
  not silently restored as launch requirements.
- Quick Couplers use the approved reduced launch dataset. Missing optional
  competitor-style engineering dimensions do not by themselves make all 57
  SKUs ineligible.
- A Catalog Import is all-or-nothing. Duplicate exact SKUs, broken foreign keys,
  invalid enums, malformed units, and missing required fields block creation of
  a publishable release and produce structured errors.
- Draft imported records are editable without affecting customers. Publication
  creates one immutable Catalog Release identifier and atomically changes the
  active customer release.
- Initial imports, later SKU additions, and complete new product-series imports
  all use the same Admin flow: Data Import creates a draft; Product Catalog is
  where the administrator reviews its change set and triggers one validation,
  Assembly Data update, and atomic publication command. There is no separate
  Catalog Release item in the Admin navigation.
- The Product Catalog publication is one combined workflow. The system compares
  the complete draft with the active
  release, summarizes additions, customer-facing changes, and deactivations,
  validates product and configurator data, and publishes the whole release when
  no blocker remains. The calculated diff is retained for audit, while the
  administrator sees only this Draft's additions, changes, and discontinuations.
- Publication blockers are rendered on the Product Catalog page. A blocked
  draft remains editable and the active customer release remains unchanged.
- Online, Draft, and Discontinued are the only administrator-facing product
  states. They deterministically synchronize Catalog Publication Status, the
  worksheet 07 price status, RFQ eligibility, and Supply Availability. These
  internal fields are not exposed as independent manual controls.
- Customer catalogue data is modelled as Catalog Product Families containing
  exact SKU Variants. A canonical family page is the SEO surface; an exact SKU
  link opens that family page with the variant selected.
- The catalogue supports Hose Series and Hose Size Variants, Hose Ends,
  Ferrules, Adapters, Quick Couplers, their approved category metadata, and the
  relationships required by later Specs.
- The import contract normalizes all seven worksheets into explicit objects
  rather than treating each row as an untyped product blob. Hose Size Variant
  owns the exact Hose SKU and dimensional/performance data; Hose End owns
  Connection Standard, Interface Family mapping, gender, swivel/fixed form,
  angle, sealing form, exact thread, Connection Dash, and Hose Tail Dash;
  Ferrule owns construction, tail Dash, skive, material, and coating. Adapter
  and Quick Coupler records preserve their exact SKU components and interface
  identity. Public USD Reference Price and optional packaging data are stored
  separately from Admin-only Cost Basis.
- Connection Standard is versioned reference data. Customer-facing Interface
  Family is a mapped navigation grouping and never replaces exact NPT/NPTF,
  BSPP/BSPT, JIC 37-degree, ORFS, thread, sealing-form, or standard values.
- Storefront Interface Family groups are `JIC 37 degrees`, `NPT/NPTF`, `ORFS`,
  and `BSPP/BSPT`. The data layer never merges NPT with NPTF or BSPP with BSPT.
- Each RFQ-Eligible Combination has a unique exact Hose Size Variant, Hose End,
  and Ferrule tuple plus independent RFQ Eligibility, Qualification Status,
  Technical Data Status, source, and optional production/reference attributes.
  Equal Dash values never create a relationship. `Eligible + Not Tested +
Pending` permits RFQ preparation only and is not production approval.
- Spec 1 seeds and publishes the Measurement Endpoint Class registry, the
  versioned M01-M07 Length Measurement Method registry and ordered endpoint-pair
  mapping, the Clocking Convention/M08 registry, and Installed Protection
  options as Catalog Release reference data. These records need not become new
  Excel worksheets, but they are validated and versioned with the release.
- Every Hose End that may enter the guided configurator must have one curated
  Measurement Endpoint Class. Every ordered pair of eligible Hose Ends must
  resolve exactly one current M01-M07 method or be marked Manual Quote Only;
  missing or ambiguous mapping blocks that pair from guided publication without
  blocking the component's standalone catalogue page.
- Initial endpoint-class assignments may be supplied in parallel and do not
  block Spec 1's core catalogue release. Until valid registry content is
  published, affected assembly combinations remain `Manual Quote Only`.
- Clocking supports presets plus every whole-number value `000` through `359`.
  `Not Sure` and tighter-than-standard tolerance requests require manual review.
- The Catalog Release also versions the Assembly Estimate Schedule inputs used
  later by Spec 2: hose-length price, both Hose End prices, both Ferrule prices,
  assembly-service amount, and Installed Protection amount. The customer sees
  only the resulting Estimated Assembly Price, not this internal breakdown.
- Assembly service and Installed Protection amounts are Admin-maintained
  versioned Reference Price inputs. Missing initial numeric values do not block
  development and must never be replaced by guessed values.
- RFQ Eligibility, Catalog Publication Status, worksheet 07 price status, and
  Supply Availability remain internal enforcement fields derived from the
  three-state business control. Only an Online product can be newly added to a
  Quote List.
- Historical references are never physically deleted. Products are archived or
  made unavailable so submitted snapshots remain resolvable.
- Reference Price is public, USD-denominated, and non-binding. Cost Basis is
  returned only to authorized Admin Backoffice operations and never appears in
  customer APIs, documents, exports, or email.
- Standard Products default to an estimated 10-business-day processing time;
  this is not an international delivery promise.
- Length-Based Hose Orders use exact Hose Size Variant SKU, Nominal Cut Length
  in feet, and Number of Pieces. Preset 25, 50, and 100 foot controls are input
  shortcuts and no preset is selected initially.
- Repeated cut-hose additions merge only when SKU and Nominal Cut Length match.
  Total footage, Reference Price estimate, and any configured per-piece Cutting
  and Labeling Fee are recalculated.
- Product media use owned or approved assets and Representative Product Images
  according to the established Hose Series and Hose End visual groups. Media
  never overrides exact textual specifications.
- Standard Export Packaging is mandatory for every order. Installed Protection
  includes `No additional installed protection` unless a Hose or Application
  Requirement explicitly requires protection.
- Product pages state return eligibility without requiring a policy checkbox.
  Made-to-order cut hose is labelled accordingly.

### Anonymous Quote List Boundary

- Spec 1 creates the only Anonymous Quote List infrastructure used by later
  specs.
- The browser receives a signed, tamper-evident anonymous-session cookie. D1
  stores the session and its lines for 30 days from last activity.
- Spec 1 lines support eligible Standard Products and Length-Based Hose.
- Adding the same stable line identity merges quantity. Identity includes the
  exact SKU and every customer option that changes the requested item, including
  entered cut length for Length-Based Hose.
- Spec 2 reuses the same cookie, session, line model, identity rules, and APIs,
  and only adds configured assembly line content.
- Customer email verification, account association, and RFQ submission remain
  owned by Spec 3.

## Testing Decisions

- The primary seam is one external workflow: an authorized administrator imports
  a representative workbook, resolves validation, publishes a Catalog Release,
  and a public customer can search for, open, and add an exact SKU Variant from
  that release.
- Tests assert externally visible rows, errors, release activation, search
  results, selected specifications, availability guards, and Quote List output;
  they do not assert parser helper calls or UI component internals.
- Contract tests cover each worksheet's required fields, cross-sheet references,
  duplicate SKU rejection, all-or-nothing failure, and the reduced Quick Coupler
  schema.
- Contract tests also prove exact compatibility-tuple uniqueness, no Dash-based
  compatibility inference, Connection Standard-to-Interface Family mapping,
  one Measurement Endpoint Class per guided Hose End, and exactly one M01-M07
  method for every guided ordered end pair.
- Authorization tests prove that public requests cannot retrieve Cost Basis or
  mutate a Catalog Release.
- Length-Based Hose tests cover blank initial input, valid piece calculations,
  merge-key behaviour, invalid lengths or quantities, and fee calculation.
- Anonymous Quote List tests cover signed-cookie rejection, 30-day expiry,
  identical-line quantity merge, and distinct Length-Based Hose length keys.
- Supply tests prove imported SKUs default to `Temporarily Unavailable` and
  bulk changes work by worksheet category, Hose Series, and multi-selection.
- The Admin workflow test proves that one Product Catalog confirmation invokes
  full-release comparison and validation, reports blockers in place, and
  atomically activates a valid draft without visiting a release page. The same
  test path covers a workbook containing a newly added product series.
- This is a greenfield codebase, so there is no code-level prior art. The
  workbook, glossary, and published product scope are the behavioural prior art.

## Out of Scope

- Hose Assembly configuration and compatibility selection.
- Customer email verification and RFQ submission.
- Real-time stock counts, purchasing, warehouse management, or supplier portals.
- Automatic competitor price scraping or unattended Reference Price updates.
- Automatic customs classification or customs-document generation.
- A unique product photograph for every size-only SKU difference.

## Further Notes

This is the first executable vertical slice and also proves the skeleton-code
architecture baseline. Later Specs depend on its stable SKU, Catalog Release,
Reference Price, eligibility, and availability contracts.

- Project PRD: https://github.com/legendztk-netizen/Project1/issues/1
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/2
- Dependencies: none
