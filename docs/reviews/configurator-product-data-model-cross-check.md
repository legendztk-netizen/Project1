# Configurator-to-Product-Model Cross-check

## Scope and Evidence

This review checks all 14 Spec 2 User Stories against the top-level product data
model before Spec 1 is converted to tickets. Evidence inspected:

- the accepted top-level PRD and Specs 1-2;
- `CONTEXT.md`, the detailed web application scope, and configurator ADRs;
- `hose-product-data-collection-template-length-ordering.xlsx` and its supplied
  `.inspect.ndjson` verification record;
- the versioned M01-M08 measurement-diagram manifest and supporting assets.

The workbook contains 61 Hose Size Variants, 200 Hose Ends, 61 Ferrules, and
1,081 exact candidate compatibility rows. The compatibility rows are currently
`Eligible`, `Not Tested`, and `Pending`; this supports quote-path curation, not a
claim of production qualification. A direct import check found 1,081 unique
hose/end/ferrule tuples, no duplicate tuple, and no missing 01/02/03 SKU foreign
reference.

## User Story Cross-check

| Spec 2 story                            | Data needed                                                                                                    | Explicit schema owner after amendment                                      | Workbook/reference evidence                                                                                         | Result                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Select Hose Series and size          | Series, exact Hose SKU, Dash/ID, pressure, temperature, availability                                           | Hose Series; Hose Size Variant; Catalog Release                            | Worksheet 01 contains series, SKU, Dash, dimensions, pressure, temperature, RFQ and technical states                | Covered                                                                                                                               |
| 2. Filter End A and End B               | Interface grouping, exact standard, gender, swivel/fixed, angle/form, sealing form, Connection Dash, tail Dash | Connection Standard; Hose End                                              | Worksheet 02 contains all listed technical fields                                                                   | Covered after adding Connection Standard ownership                                                                                    |
| 3. Search eligible Hose Ends            | SKU, thread, Connection Dash, Hose Tail Dash, aliases, exact eligibility                                       | Hose End; RFQ-Eligible Combination                                         | Worksheet 02 has SKU/thread/Dashes; aliases require curated reference data                                          | Covered; alias source remains an assumption item                                                                                      |
| 4. Copy End A to End B                  | Ordered roles and exact revalidation against the same hose                                                     | Configured Hose Assembly; RFQ-Eligible Combination                         | Exact tuple exists in worksheet 04; roles are runtime data                                                          | Covered after adding ordered component identity                                                                                       |
| 5. Resolve ferrules automatically       | One exact ferrule for each exact hose/end relation                                                             | Ferrule; RFQ-Eligible Combination                                          | Worksheets 03-04 carry exact Ferrule SKU and tuple                                                                  | Covered; no Dash inference permitted                                                                                                  |
| 6. Show the correct length diagram      | Endpoint class per Hose End; ordered pair mapping; method and asset versions                                   | Measurement Endpoint Class; Length Measurement Method; Catalog Release     | Hose End angle/sealing fields exist; M01-M08 assets exist; no complete SKU-to-method mapping exists in the workbook | Schema gap closed; reference mapping must be curated before a pair is guided                                                          |
| 7. Capture Clocking                     | Applicability from both end forms; target/status/tolerance; view, zero and direction convention                | Hose End form; Clocking Convention; Configured Hose Assembly               | Worksheet 02 has angle; ADR 0038 and M08 define convention                                                          | Covered; presets plus any whole degree `000-359`, with `Not Sure` or tighter tolerance routed to manual review                        |
| 8. Select protection and application    | Protection options/prices/applicability; hose pressure, temperature and media; customer requirements           | Installed Protection; Hose Size Variant; Configured Hose Assembly          | Hose limits/media exist in worksheet 01; protection master is outside workbook                                      | Covered; Standard Export Packaging is mandatory and `No additional installed protection` is allowed unless a rule requires protection |
| 9. Render live preview and text summary | End form/visual group, hose/protection visuals, length, Clocking, validation state                             | Hose End; Installed Protection; Configured Hose Assembly; asset registries | Product and measurement asset manifests exist                                                                       | Covered after versioning visual/reference registries                                                                                  |
| 10. Retain invalid downstream values    | Original customer values, derived-value provenance, reconfirmation and validation state                        | Configured Hose Assembly draft                                             | Not catalogue-row data                                                                                              | Covered after adding runtime validation ownership                                                                                     |
| 11. Link problems to steps              | Structured validation issue with field/step owner                                                              | Configured Hose Assembly draft/domain validation result                    | Not catalogue-row data                                                                                              | Covered; implementation shape belongs to Spec 2                                                                                       |
| 12. Add a valid assembly with estimate  | Published/available components and relation; versioned price inputs; quantity                                  | Catalog Release; Assembly Estimate Schedule; Configured Hose Assembly      | Worksheet 07 provides Standard Product retail references; assembly-service and protection inputs are not present    | Covered; versioned Admin inputs are authoritative and initial numbers may be supplied after development starts                        |
| 13. Duplicate and edit                  | Immutable source line, copied draft, exact merge key and version refs                                          | Quote List Line; Configured Hose Assembly draft                            | Defined in glossary/scope, not workbook                                                                             | Covered                                                                                                                               |
| 14. Route unsupported/uncertain work    | Guided/manual/blocked states and technical-review reasons                                                      | RFQ Eligibility; Length Measurement Method mapping; validation result      | Workbook has `Eligible`, `Manual Quote Only`, `Blocked`; technical status is separate                               | Covered                                                                                                                               |

## Required Schema Invariants

1. A compatibility key is the exact `(hose_size_variant_id, hose_end_id,
ferrule_id)` tuple and is unique within a Catalog Release.
2. End A and End B are ordered roles. The same exact Hose End may be copied only
   after revalidation for the selected Hose Size Variant.
3. Connection Dash and Hose Tail Dash are different fields. Neither one proves
   compatibility and they need not equal each other or the Hose Dash.
4. `Interface Family` is a UI grouping; exact Connection Standard, thread,
   sealing form, and gender remain authoritative technical fields.
5. Every guided Hose End version owns one Measurement Endpoint Class. Every
   guided ordered end pair resolves exactly one M01-M07 method and diagram
   version. Missing or ambiguous resolution sends the pair to manual quotation.
6. Clocking applicability is derived only when both exact Hose End forms are
   angled. The configured record stores status, target when specified,
   tolerance, convention version, and M08 renderer version.
7. RFQ Eligibility is not Qualification Status. The current workbook's
   `Eligible + Not Tested + Pending` records may drive quote preparation only.
8. Reference prices, compatibility, measurement methods, diagrams, and component
   identities are snapshotted at the relevant RFQ/Quote/PI boundary; later
   Catalog Releases do not rewrite submitted history.

## Guest Rule Locked in the PRD

- Catalogue browsing, Hose Assembly configuration, and Quote List preparation
  are available without login.
- An unfinished guest configuration is active-page-only and is not recoverable
  after leaving unless email verification succeeds before exit.
- A valid line becomes server-side anonymous data only after `Add Assembly to
Quote`; the signed-cookie Anonymous Quote Session lasts up to 30 days.
- Verified email is required to save an unfinished configuration across
  sessions/devices, submit an RFQ, or access Personal Center.

## Approved Outcomes and Parallel Data Work

- Storefront groups JIC 37 degrees, NPT/NPTF, ORFS, and BSPP/BSPT while exact
  standards, threads, and sealing forms remain distinct in data.
- Clocking accepts presets and every whole degree `000-359`; `Not Sure` or a
  tighter tolerance requires manual review.
- Measurement Endpoint Class uses a versioned registry and ordered M01-M07
  mapping. Unmapped or ambiguous combinations are `Manual Quote Only`. Initial
  endpoint assignments may be supplied in parallel and do not block Spec 1.
- Standard Export Packaging is mandatory. Installed Protection permits `No
additional installed protection` unless a Hose/Application rule requires it.
- Assembly service and Installed Protection prices are versioned Admin inputs;
  their initial values may be supplied later and do not block development.
