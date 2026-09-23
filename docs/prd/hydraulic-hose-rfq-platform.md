# Hydraulic Hose RFQ Platform - Top-level PRD

## Purpose

Build an English-language hydraulic hose product and quotation platform for
North American customers. The launch product combines a searchable Standard
Product catalogue with a guided Hose Assembly configurator, then carries a
verified request through quotation, PI acceptance, manually confirmed payment,
offline production coordination, shipment, and after-sales handling.

The website is not a checkout-first ecommerce store. Customers prepare a Quote
List and request a quote; the seller confirms technical and commercial terms
before a PI becomes the payment document.

## First-release Scope Decision (2026-09-23)

Spec 5 is deferred under
[ADR-0051](../adr/0051-defer-factory-workflow-from-first-release.md). The first
release continues selling Standard Products, cut-length hose and configured
Hose Assemblies. Factory coordination, manufacturing, cutting and required
inspection remain offline; Admin records shipment readiness after verifying the
accepted specifications, quantities and actual preparation. Spec 6 consumes
Confirmed Orders from Spec 4B directly, and Spec 7 depends on Spec 4B and Spec 6.

Production packages, per-piece Assembly Numbers and QR labels, Factory Mobile
and Public Assembly Verification are later-release capabilities. Their absence
does not block shipment or after-sales, waive inspection, bypass payment/change/
cancellation holds, or permit invented factory history. This release decision
supersedes older launch scheduling statements in supporting scope documents.

## Customer Problem

Retail and business customers can often identify a hose only by size,
connection, shape, pressure, application, or an existing part. Conventional
catalogues expose many part numbers but do not reliably prevent incompatible
hose, end, ferrule, length-measurement, and clocking combinations. International
ordering adds uncertainty around freight, import terms, payment, lead time, and
whether a custom assembly will be built to the accepted specification.

## Product Outcome

The platform must let a customer:

- find and compare supported Standard Products;
- configure a supported two-end Hose Assembly without inventing unavailable
  component combinations;
- obtain human help when the exact Hose End is unknown;
- submit one verified RFQ containing products and assemblies;
- review and accept a fixed PI and approved specification;
- follow a simple customer-facing Order and Shipment timeline; and
- request eligible cancellation or after-sales review against Order lines and
  delivered Shipment quantities.

Later Spec 5 adds physical-QR Assembly verification without exposing customer
or internal production information.

The seller must be able to review, price, document, and advance the same request
without re-entering the approved product specification in disconnected systems.

## Launch Actors and Surfaces

| Actor                    | Primary surface                         | Responsibility                                                         |
| ------------------------ | --------------------------------------- | ---------------------------------------------------------------------- |
| Individual Customer      | Customer Storefront and Personal Center | Configure products, request quotes, accept a PI, and view Orders       |
| Business Customer        | Customer Storefront and Personal Center | Purchase in an Organization Purchasing Context                         |
| Owner / Admin Subaccount | Admin Backoffice                        | Maintain catalogue data and advance commercial and operating workflows |

Factory staff coordinate externally during the first release. Factory Mobile
and the Public QR Viewer surface are deferred with Spec 5.

Pre-Quote Support Chat helps identify uncertain components. It does not place an
order or replace the website configuration and RFQ flow.

## Global Product Data Model

The product model separates reusable catalogue definitions from immutable
transaction snapshots.

### Catalogue Layer

| Domain object              | Meaning                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog Product Family     | Customer-facing family under which size or connection variants are grouped                                                                                             |
| SKU Variant                | Exact Standard Product that can be quoted and retained on commercial records                                                                                           |
| Hose Series                | Shared construction and standard for related Hose Size Variants                                                                                                        |
| Hose Size Variant          | Exact hose series and inside-diameter combination used by compatibility rules                                                                                          |
| Hose End                   | Exact crimp Hose End SKU, including interface, gender, form, connection size, and hose-tail size                                                                       |
| Ferrule                    | Exact ferrule SKU resolved by compatibility data rather than selected by the customer                                                                                  |
| RFQ-Eligible Combination   | Versioned, curated relationship permitting one Hose Size Variant, Hose End, and Ferrule to enter the guided RFQ configurator without implying production qualification |
| Adapter                    | Standalone transition-fitting SKU using the approved `ADP_...` convention                                                                                              |
| Quick Coupler              | Standalone quick-coupler SKU using the approved `QDC_...` convention                                                                                                   |
| Installed Protection       | Configurator option applied to a finished Hose Assembly                                                                                                                |
| Reference Price            | Non-binding customer estimate and internal quote starting point                                                                                                        |
| Catalog Release            | Versioned publication unit for imported and validated product data                                                                                                     |
| Catalog Publication Status | `Draft`, `Published`, or `Archived` visibility state                                                                                                                   |
| Supply Availability        | `Available for Quote`, `Temporarily Unavailable`, or `Discontinued` new-business state                                                                                 |

The launch Excel source is organized as:

1. Hose master data.
2. Crimp Hose Ends.
3. Ferrules.
4. Hose/Hose End/Ferrule compatibility.
5. Adapters.
6. Quick Couplers.
7. Price and packaging data.

Excel is an import and review source, not the live transactional database. A
Catalog Release is validated before publication, and customer-facing queries use
the published D1 records.

### Product Attribute Ownership

The following ownership is part of the project contract. Workbook columns may
be normalized into these objects, but an implementation must not leave the same
meaning on several unrelated records or infer an exact relationship from equal
Dash values.

| Owner                      | Required owned attributes and relationships                                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hose Series                | Stable series code; primary and equivalent standards; shared construction profile and approved public aliases                                                                                                                                                                                                                                 |
| Hose Size Variant          | Exact Hose SKU; Hose Series reference; Hose Dash; nominal ID, ID and OD; working and burst pressure; bend radius; weight; temperature range; construction/material attributes; fluid compatibility; skive requirement; catalogue, RFQ, technical-data, and supply states                                                                      |
| Connection Standard        | Stable exact interface code; customer-facing Interface Family grouping; governing standard; thread-system name; permitted sealing forms; normalized aliases; Dash-display rules                                                                                                                                                               |
| Hose End                   | Exact Hose End SKU; fitting series; Connection Standard reference; gender; swivel/fixed construction; form angle; sealing form; exact thread designation; Connection Dash; Hose Tail Dash; search aliases; Representative Product Image group; optional pressure/dimensional data; catalogue, RFQ, technical-data, and supply states          |
| Ferrule                    | Exact Ferrule SKU; ferrule series; Hose Construction; Hose Tail Dash; skive requirement; material and coating; catalogue, RFQ, technical-data, and supply states                                                                                                                                                                              |
| RFQ-Eligible Combination   | Unique exact tuple of Hose Size Variant, Hose End, and Ferrule; RFQ Eligibility; Qualification Status; Technical Data Status; source and reference-system data; optional production-method, skive, insertion, crimp, pressure, proof, and minimum-OAL data. Missing production data never becomes an inferred Production-Approved Combination |
| Measurement Endpoint Class | Curated classification attached to each Hose End version that states the dimensional endpoint type used for finished-length measurement; it is not inferred at runtime from an image or SKU text                                                                                                                                              |
| Length Measurement Method  | Versioned M01-M07 method; ordered End A and End B endpoint classes/forms; endpoint rules; diagram asset and overlay version; guided/manual status. A published guided pair must resolve exactly one method                                                                                                                                    |
| Clocking Convention        | Versioned applicability rule, End A-to-End B view direction, End B zero reference, clockwise direction, accepted input range, standard tolerance, and M08 renderer version                                                                                                                                                                    |
| Installed Protection       | Exact option identifier; public name and specification; applicable Hose Series/size rules; availability; Representative Product Image or preview treatment; versioned USD base amount, material rate per exact foot, and installation rate per started foot                                                                                   |
| Assembly Estimate Schedule | Versioned Reference Price inputs for hose length, End A, End B, both Ferrules, assembly service rate and pricing basis, and Installed Protection formula inputs; currency and effective Catalog Release                                                                                                                                       |
| Catalog Release            | Immutable versions of all published records, taxonomies, compatibility relationships, measurement mappings, visual registries, and Reference Price inputs used together by a customer decision                                                                                                                                                |

`Interface Family` is a customer navigation grouping, while `Connection
Standard`, `Thread`, `Connection Dash`, and `Hose Tail Dash` retain their exact
technical meanings. For example, NPT and NPTF or BSPP and BSPT may share a
customer grouping only through an explicit mapping; they are not interchangeable
technical values.

The launch Storefront groups connections as `JIC 37 degrees`, `NPT/NPTF`,
`ORFS`, and `BSPP/BSPT`. These groups are navigation aids only. Exact Connection
Standard, thread, sealing form, gender, and geometry remain authoritative, and
the data model never merges NPT with NPTF or BSPP with BSPT.

RFQ Eligibility and production qualification remain independent. A
`Published`, `Eligible`, `Not Tested`, `Pending` relationship may be shown for
quote preparation when allowed by the accepted operating policy, but the
customer surface must not describe it as tested, approved, guaranteed
compatible, or ready for production. PI issuance remains the business gate at
which the seller confirms a Production-Approved Combination or proposes a
reviewed replacement.

### Configured Product Layer

A Hose Assembly is a configured product rather than a pre-enumerated SKU. Its
approved specification contains, at minimum:

- selected Hose Size Variant;
- ordered End A and End B Hose End SKUs;
- system-resolved End A and End B Ferrule SKUs;
- Finished Overall Assembly Length, original unit, tolerance, and versioned
  Length Measurement Method;
- Clocking and tolerance when both ends require it;
- Installed Protection;
- Application Requirements;
- quantity; and
- compatibility, catalogue, diagram, and price versions used at the relevant
  decision point.

The configured record also owns the ordered End A/End B roles, validation state,
and all customer-entered values needed to reproduce review behaviour:

| Configured value           | Required representation                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component identity         | Hose Size Variant SKU; ordered End A and End B Hose End SKUs; resolved End A and End B Ferrule SKUs; source Catalog Release and exact compatibility IDs                                                             |
| Finished length            | Original value and Specified Length Unit; exact canonical millimetre value; Length Measurement Method ID and version; diagram/overlay version; tolerance value and tolerance-schedule version; reconfirmation state |
| Clocking                   | `Not Applicable`, `Specified`, or `Not Sure`; target whole degrees when specified; Clocking Tolerance; Clocking Convention version; M08 renderer version                                                            |
| Protection and application | Installed Protection option/version; fluid medium; maximum system working pressure; minimum and maximum operating temperature; technical-review flags                                                               |
| Quote preparation          | Quantity; versioned Estimated Assembly Price; estimate-schedule version; Retained Invalid Selections and current validation issues                                                                                  |

The Live Assembly Preview is explanatory. The approved text specification,
measurement method, accepted PI and Confirmed Order snapshot remain authoritative.
A future Production Package must derive from that fixed evidence.

Measurement Endpoint Class uses a versioned registry and an ordered versioned
mapping to M01-M07. Initial endpoint assignments may be supplied in parallel
with Spec 1. A missing or ambiguous mapping always becomes `Manual Quote Only`;
the application never guesses. Clocking offers presets plus any whole-number
angle from `000` through `359`; `Not Sure` and tighter-than-standard tolerance
requests require manual review.

Standard Export Packaging is mandatory for every order. Installed Protection
is a separate assembly option and includes `No additional installed
protection` unless a Hose or Application Requirement explicitly requires a
protection product. Assembly service fees and Installed Protection prices are
versioned, Admin-maintained Reference Price inputs. Let `F` be exact finished
length in feet after converting inches by `12` or millimetres by `304.8` without
early rounding. Assembly service is `USD 0.50 * ceil(F)`. Nylon Protective
Sleeving is `USD 8.00 + USD 1.35 * F + USD 1.00 * ceil(F)`, and Plastic Spiral
Guard is `USD 8.00 + USD 1.00 * F + USD 1.00 * ceil(F)`. Customer-facing amounts
are rounded to two decimal places only after formula evaluation.

### Guest Configuration and Login Boundary

This launch rule is fixed:

- Spec 1 owns the minimum Anonymous Quote List for Standard Products and
  Length-Based Hose. A guest may browse, configure a Hose Assembly, add those
  products to the Quote List, edit it, and remain below the RFQ minimum without
  signing in. Spec 2 reuses this infrastructure and only adds configured
  assembly lines; it does not create another anonymous-cart implementation.
- A guest's unfinished In-progress Configuration Draft exists only in the
  active page session. Leaving through website navigation warns that the draft
  will be lost and offers staying or discarding. Spec 3 adds a registration
  entry to this warning; entering an email begins Passwordless Access rather
  than a standalone email-save feature. Browser refresh, tab close, crash, or
  device change has only a best-effort native warning and no promised recovery.
- The browser receives a signed, non-personal cookie and the server stores the
  Anonymous Quote Session for 30 days from last activity. Identical lines merge
  quantity by stable line identity. `Add Assembly to Quote` is the boundary at
  which a valid configured assembly becomes one of those server-side lines.
- Verified customer access is mandatory to save an unfinished configuration,
  submit an RFQ, or enter Personal Center. The registration attempt may hold the
  exact configuration in one non-recoverable transaction for at most 24 hours.
  Successful verification atomically creates or updates the Customer Profile
  and converts that transaction into an account-owned Saved Configuration.
  Expired or abandoned attempts are deleted; an email address alone never owns
  a 30-day configuration draft. Starting verification does not submit an RFQ.
- After verification, an Anonymous Quote Session is merged into the Customer
  Profile rather than replacing an existing Quote List.

### Commercial and Fulfilment Layer

| Domain object                          | Data responsibility                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Quote List                             | Editable, non-binding customer selections before RFQ submission                                        |
| RFQ                                    | Immutable submitted request snapshot with customer and destination context                             |
| Quote Revision                         | New immutable commercial/specification version; never an in-place edit of an RFQ or PI                 |
| PI                                     | Fixed customer-accepted quotation and payment document with one Payment Channel                        |
| Payment Confirmation                   | Manual record of externally verified Cleared Funds                                                     |
| Confirmed Order                        | Created only when the current PI, acceptance, required approvals, and payment conditions are satisfied |
| Shipment                               | One fulfilment unit with its own contents, dates, status, and tracking                                 |
| Assembly Production Package (deferred) | Future order-level factory package containing approved assembly work                                   |
| Assembly Number (deferred)             | Future website identifier for one physical produced Hose Assembly                                      |
| Assembly Record (deferred)             | Future per-assembly approved specification and retained production/inspection evidence                 |
| After-sales Case                       | Controlled record for cancellation, return, inspection, refund, or related resolution                  |

Catalogue updates may affect an unsubmitted Quote List after revalidation. They
must never rewrite a submitted RFQ, issued or accepted PI, Confirmed Order,
Assembly Record, Shipment, or historical decision.

## End-to-end Lifecycle

1. Admin imports, validates, and publishes a Catalog Release.
2. Customer browses products or builds an RFQ-Eligible Hose Assembly.
3. Customer prepares a Quote List and verifies an email address to submit an RFQ.
4. Admin reviews technical suitability, price, tax treatment, freight, trade
   term, and lead time, then issues a fixed PI and Payment Instructions.
5. Customer accepts the PI; Admin confirms external receipt of Cleared Funds.
6. The system creates one Confirmed Order when all required conditions are met.
7. Admin coordinates stock preparation or factory work offline using the fixed
   Order specification and retains relevant external records.
8. Admin verifies preparation and required inspection, then explicitly records
   Shipment readiness subject to payment and quantity-level holds.
9. Admin records dispatch, tracking, delivery, and any After-sales Case.

## Architecture Baseline

The architecture baseline has only two forms:

1. Runnable skeleton code that proves the selected runtime, bindings, routing,
   migrations, authentication boundaries, and test harness.
2. Small ADRs that record project-wide decisions that cannot be expressed
   clearly by the skeleton code itself.

There is no separate comprehensive architecture specification. The accepted
baseline is a TypeScript modular monolith using React Router on Cloudflare
Workers, Cloudflare D1, private R2 storage, Cloudflare Queues, Drizzle-managed
schema migrations, Cloudflare Access for Admin Backoffice entry, and shared
domain commands for protected state transitions.

## Delivery Specs

1. [Product Catalogue and Catalog Release](https://github.com/legendztk-netizen/Project1/issues/2).
2. [Hose Assembly Configurator and Quote List](https://github.com/legendztk-netizen/Project1/issues/3).
3. [Customer Identity, Personal Center, and RFQ Submission](https://github.com/legendztk-netizen/Project1/issues/4).
4. [4A - Quote Review, Quote Revision, and PI](https://github.com/legendztk-netizen/Project1/issues/5).
5. [4B - Manual Payment and Confirmed Order](https://github.com/legendztk-netizen/Project1/issues/6).
6. [Production Package, Assembly QR, and Factory Mobile](https://github.com/legendztk-netizen/Project1/issues/7) - deferred from the first release.
7. [Shipment and Customer Order Progress](https://github.com/legendztk-netizen/Project1/issues/8).
8. [After-sales, Return Inspection, and Refund](https://github.com/legendztk-netizen/Project1/issues/9).

Each Delivery Spec owns one highest practical external-behaviour test seam and
is independently convertible into implementation Tickets. User Stories are
complete within that boundary but are not padded to restate field-level rules.

## Launch Boundaries

- No website checkout or automated payment gateway reconciliation.
- No real-time inventory ledger, warehouse-management system, factory MES, or
  automatic customs-document generation.
- No customer-visible internal factory progress.
- No first-release production package/label generation, Factory Mobile or Public
  Assembly Verification. Operational manufacturing and inspection remain required.
- No guided support for a configuration absent from the RFQ-Eligible data.
- No customer-facing multilingual launch interface.
- No microservice decomposition or separate API platform at launch.
- No requirement to add speculative fields or workflows before customer demand
  demonstrates their value.

## Source of Truth

This PRD defines the project-level product and data model. `CONTEXT.md` defines
canonical domain vocabulary. The bounded Specs define externally observable
behaviour, while accepted ADRs define cross-cutting technical decisions. The
detailed product workflow scope remains supporting source material and must not
override a later explicitly accepted Spec or ADR.

Published reference issue: https://github.com/legendztk-netizen/Project1/issues/1
