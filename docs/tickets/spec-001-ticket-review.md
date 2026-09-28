# Spec 1 Ticket Review: Product Catalogue and Catalog Release

## Review Status

- Parent: GitHub Issue #2, Spec 1
- Proposed ticket count: 12
- Publication status: Not published; awaiting user approval
- Sizing rule: each ticket must fit one fresh agent context and leave a
  demoable or independently verifiable result
- Shared testing source: every ticket applies the Testing Decisions in Spec 1;
  ticket-specific checks below narrow that contract without replacing it

## Ticket 01: Run the Cloudflare Web Application Skeleton

**Blocked by:** None.

**Scope:** Establish the runnable React Router v8 and TypeScript modular-monolith
application on Cloudflare Workers. Expose a public Storefront shell, an Admin
Backoffice shell, and a machine-readable health endpoint from one deployable
Worker, using explicit placeholder configuration for external identifiers and
secrets.

**Acceptance criteria:**

- A fresh checkout has documented install, local-development, typecheck, test,
  and production-build commands.
- Public, Admin, and health routes render through the same Worker without route
  leakage or blank placeholder pages.
- Runtime bindings are typed and all account IDs, domains, and secrets use
  named placeholder configuration rather than embedded real values.
- Module boundaries for Storefront, Admin Backoffice, catalog domain, and shared
  infrastructure are visible without introducing microservices.

**Testing requirement:** Apply Spec 1 Testing Decisions; add a local Worker
smoke test proving the public shell, Admin shell boundary, health response, and
production build all run.

## Ticket 02: Isolate Local, Preview, and Production Environments

**Blocked by:** Ticket 01.

**Scope:** Make the skeleton environment-aware so local, preview, and production
use separate Cloudflare bindings and configuration, with no accidental shared
D1, R2, Queue, host, or secret names.

**Acceptance criteria:**

- Local, preview, and production configuration names every required D1, R2,
  Queue, Access, email, and public-origin binding, using explicit placeholders
  where real values are not yet available.
- Startup validation fails with an actionable message when a required binding
  is missing in the selected environment.
- Local development uses local resources or sanctioned stubs and cannot target
  production through a default command.
- The environment contract is documented once and consumed by both application
  code and deployment automation.

**Testing requirement:** Apply Spec 1 Testing Decisions; add configuration
contract tests for all three environments and prove production identifiers are
not selected by local or preview commands.

## Ticket 03: Prove Versioned D1 Migrations End to End

**Blocked by:** Tickets 01 and 02.

**Scope:** Add the first versioned D1 migration and a narrow catalog-release
repository path so schema creation, migration status, and one persisted release
record work locally and are promotable through preview and production.

**Acceptance criteria:**

- Versioned forward migrations create the initial Catalog Release, Catalog
  Import, audit, and migration metadata needed by later tickets.
- Reapplying migrations is safe, and a failed migration stops deployment rather
  than leaving the application marked healthy.
- An Admin-facing diagnostic can create and read a non-published test Catalog
  Release through the domain/repository boundary; no public route can mutate it.
- Migration promotion commands target the selected environment explicitly and
  never infer production from the current shell.

**Testing requirement:** Apply Spec 1 Testing Decisions; run migrations against
a fresh local D1 database, rerun them, exercise the persisted diagnostic, and
verify a deliberately broken migration fails closed.

## Ticket 04: Protect Admin and Complete the Production Deployment Chain

**Blocked by:** Tickets 01, 02, and 03.

**Scope:** Enforce Cloudflare Access at the Admin boundary and deliver CI/CD that
checks a change, promotes D1 migrations, deploys the Worker, and smoke-tests the
production health path. Real account values remain deployment placeholders
until supplied.

**Acceptance criteria:**

- Public requests cannot enter Admin routes; a valid Access identity maps to an
  application Owner or Sub-account identity.
- Local development has an explicit development-only identity mechanism that
  cannot activate in preview or production.
- Pull requests run format/lint, typecheck, tests, migration verification, and a
  production build.
- The controlled production workflow applies production migrations, deploys the
  Worker, and smoke-tests health in order; it stops on any failed stage.
- Required Cloudflare credentials and resource IDs are named placeholders and
  no secret is committed.

**Testing requirement:** Apply Spec 1 Testing Decisions; cover missing, invalid,
and valid Access identities and execute the deployment workflow in validation
or dry-run mode until real Cloudflare credentials are supplied.

## Ticket 05: Import Worksheets 01-04 into a Validated Draft Release

**Blocked by:** Tickets 03 and 04.

**Scope:** Let an authorized Admin upload the real product workbook and obtain a
persisted draft release containing normalized Hose Series, Hose Size Variants,
Hose Ends, Ferrules, and exact RFQ-Eligible Combinations with structured
validation results.

**Fixture:** Use the supplied finished workbook
`outputs/catalog-workbook-2026-08-19/hose-product-data-collection-template-length-ordering.xlsx`
or a representative 01-04 subset mechanically derived from it. An agent must
not invent worksheet names, columns, enums, or example relationships.

**Acceptance criteria:**

- The Admin upload and preview show worksheet, row, field, stable SKU, severity,
  and message for every validation result.
- The import normalizes exact engineering fields and preserves Connection Dash,
  Hose Tail Dash, exact Connection Standard, thread, seal, gender, and form as
  separate values.
- Exact Hose/End/Ferrule tuples are unique; equal Dash values never infer a
  relationship; `Eligible + Not Tested + Pending` is not labelled production
  approved.
- Every imported SKU starts `Temporarily Unavailable`.
- A blocking error creates no publishable draft and leaves any active release
  unchanged; a valid import persists a reviewable draft summary.

**Testing requirement:** Apply Spec 1 contract-test decisions against the real
fixture/subset, including duplicate SKU, broken foreign key, invalid enum,
malformed unit, exact tuple uniqueness, and all-or-nothing failure cases.

## Ticket 06: Complete the Real Workbook Import for Worksheets 05-07

**Blocked by:** Ticket 05.

**Scope:** Extend the same draft import and preview through Adapters, the reduced
Quick Coupler dataset, and USD Reference Price and optional packaging data, so
one real 01-07 workbook produces one coherent draft release.

**Fixture:** Use the same supplied finished workbook as Ticket 05 or a 05-07
subset mechanically derived from it. No agent-created workbook schema is
accepted.

**Acceptance criteria:**

- Adapter and Quick Coupler SKU conventions and exact role, standard, Body
  Dash, port, and Port Dash values survive import.
- The 57 Quick Couplers are not rejected for the optional engineering fields
  that the approved launch schema deliberately leaves unresolved.
- Worksheet 07 imports public USD Reference Price separately from Admin-only
  Cost Basis and accepts the approved optional packaging fields as optional.
- Cross-sheet price references resolve to exact SKUs and duplicate or orphaned
  price rows block the draft.
- The Admin preview summarizes all seven worksheets as one release candidate.

**Testing requirement:** Apply Spec 1 contract and authorization decisions with
the real fixture/subset, including reduced Quick Coupler requiredness, optional
packaging, orphan prices, USD values, and customer denial of Cost Basis.

## Ticket 07: Review Draft Products and Change Supply Availability in Bulk

**Blocked by:** Tickets 04, 05, and 06.

**Scope:** Give Admin users a usable draft-catalog review surface and bulk
Supply Availability commands before publication.

**Acceptance criteria:**

- Admin can filter the draft by worksheet category and Hose Series, search exact
  SKUs, and multi-select arbitrary visible or searched rows.
- Admin can bulk set `Available for Quote`, `Temporarily Unavailable`, or
  `Discontinued` by worksheet category, Hose Series, or explicit selection.
- Before applying, the UI shows the target state and affected count and asks for
  confirmation; one audit event records the command and affected SKUs retain
  their resulting values.
- Bulk edits affect only the draft release and never mutate the active customer
  release.
- Unauthorized users cannot view Cost Basis or execute bulk changes.

**Testing requirement:** Apply Spec 1 authorization and externally visible
testing decisions; cover each bulk-selection mode, zero matches, mixed prior
states, confirmation cancellation, audit output, and active-release isolation.

## Ticket 08: Publish One Atomic Catalog Release

**Blocked by:** Tickets 05, 06, and 07.

**Scope:** Revalidate and atomically activate one complete draft Catalog Release
while preserving the previous active release and immutable history.

**Acceptance criteria:**

- An authorized Admin sees additions, changes, deactivations, warnings, and
  blockers before confirming publication.
- Publication reruns release validation and switches the active release in one
  transaction; failed validation or activation leaves the prior release active.
- A release may publish products that remain `Temporarily Unavailable`; that
  state controls Add to Quote rather than page existence.
- Published data is immutable. A later correction creates another release and
  historical identifiers remain resolvable.
- Publication creates an audit event containing actor, release IDs, counts, and
  request correlation without leaking secrets or Cost Basis publicly.

**Testing requirement:** Apply Spec 1 release-activation decisions; prove atomic
success, rollback on failure, concurrent publish protection, immutable history,
and public reads switching from the old release to the new release.

## Ticket 09: Browse and Search the Published Storefront Catalogue

**Blocked by:** Ticket 08.

**Scope:** Deliver the customer-facing catalogue across Hydraulic Hose, Hose
Ends, Ferrules, Adapters, and Quick Couplers, with family pages, exact variant
selection, product media, Reference Price, and credible availability.

**Acceptance criteria:**

- Customers can navigate the five product classes and search by SKU, name,
  alias, standard, interface, thread, and Dash fields supported by the release.
- Related sizes share one canonical Catalog Product Family page and exact SKU
  links reopen the correct selected Variant.
- Storefront Interface Family groups are JIC 37 degrees, NPT/NPTF, ORFS, and
  BSPP/BSPT while exact standard, thread, and seal remain visible and distinct.
- Product pages show public specifications, approved media, USD Reference Price
  with non-binding language, Supply Availability, processing estimate, and
  return/made-to-order disclosure without exposing Cost Basis.
- `Temporarily Unavailable` and `Discontinued` products remain viewable but
  cannot start Add to Quote; eligible available variants expose that command.

**Testing requirement:** Apply Spec 1 primary browser seam and authorization
decisions; cover search aliases, canonical family/variant routing, exact
standard separation, media fallbacks, availability states, and absence of Cost
Basis from HTML and customer APIs.

## Ticket 10: Add Standard Products to the Anonymous Quote List

**Blocked by:** Ticket 09.

**Scope:** Deliver the minimum server-side Anonymous Quote List for exact
Standard Products, without login, checkout, RFQ submission, or account creation.

**Acceptance criteria:**

- The first anonymous Quote action creates a signed, non-personal cookie and a
  D1 session expiring 30 days after last activity; product and personal data are
  not stored in the cookie.
- A customer can add, view, change quantity, and remove an exact Standard
  Product line from the Quote List without signing in.
- Re-adding the same stable Standard Product identity merges quantity; different
  SKUs remain separate lines.
- Add and edit commands revalidate Published, Eligible, and `Available for
  Quote` against the active Catalog Release and never silently substitute a SKU.
- Tampered or expired cookies do not expose another session and recover through
  a new anonymous session without a server error.

**Testing requirement:** Apply Spec 1 Quote List and primary browser decisions;
cover signed-cookie rejection, rolling expiry, merge identity, quantity bounds,
availability changes, and a browser flow from published Product Detail to Quote
List output.

## Ticket 11: Add Length-Based Hose to the Anonymous Quote List

**Blocked by:** Ticket 10.

**Scope:** Extend the same Anonymous Quote List with Length-Based Hose inputs and
estimates, reusing rather than branching the session and line infrastructure.

**Acceptance criteria:**

- A Hose Variant page accepts Length per Piece and Number of Pieces, with 25,
  50, and 100 foot shortcuts and no preselected length.
- Valid input stores exact Hose SKU, original length value/unit, normalized
  calculation value, piece count, total footage, applicable Cutting and Labeling
  Fee, and current non-binding estimate.
- Repeated additions merge only when exact SKU and Nominal Cut Length match;
  another length creates another line.
- Invalid, blank, or unsupported length and quantity values produce field-level
  errors and no partial line.
- The line is clearly made to order and remains in the same 30-day anonymous
  session and Quote List UI as Standard Products.

**Testing requirement:** Apply Spec 1 Length-Based Hose decisions; cover blank
initial state, shortcuts, unit normalization, fee calculation, distinct and
matching merge keys, invalid values, and the full browser add/edit/remove flow.

## Ticket 12: Publish Versioned Configurator Reference Registries

**Blocked by:** Ticket 09.

**Scope:** After the core import, publication, and Storefront chain works, add
versioned Catalog Release reference registries for Measurement Endpoint Class,
ordered M01-M07 mappings, Clocking Convention/M08, Installed Protection, and
Assembly Estimate Schedule inputs. This ticket builds the structure, Admin
maintenance, seed validation, and safe fallback; it does not invent the endpoint
assignments or price numbers the business will provide later.

**Acceptance criteria:**

- Admin can maintain versioned registry drafts and publish them with a Catalog
  Release without editing the 01-07 workbook structure.
- An ordered endpoint pair resolves exactly one guided M01-M07 method; missing
  or ambiguous resolution deterministically returns `Manual Quote Only`.
- Clocking data records presets, any whole degree `000-359`, convention/version,
  and the manual-review outcomes for `Not Sure` and tighter tolerance.
- Installed Protection contains `No additional installed protection` unless a
  Hose/Application rule requires protection; mandatory Standard Export
  Packaging remains separate.
- Assembly service and protection Reference Price inputs are versioned and
  Admin-only. Missing initial numeric values are allowed, visible to Admin, and
  never replaced by guessed values.
- Initial endpoint assignments and numeric price inputs may remain incomplete
  without blocking Spec 1's catalogue; affected assembly paths remain Manual
  Quote Only or without an estimate until valid content is later published.

**Testing requirement:** Apply Spec 1 compatibility and reference-data contract
decisions; cover version selection, ordered mappings, ambiguity, safe fallback,
clocking ranges, protection requirements, missing price values, and immutable
published registry history.

## Dependency Graph

```text
01 Application skeleton
 |
 v
02 Environment isolation
 |
 v
03 D1 migrations
 |
 v
04 Admin auth + production deployment
 |
 v
05 Import 01-04
 |
 v
06 Import 05-07
 |
 v
07 Draft review + bulk availability
 |
 v
08 Atomic publication
 |
 v
09 Storefront catalogue
 |\
 | +--------------------> 12 Reference registries
 v
10 Anonymous Standard Product Quote List
 |
 v
11 Length-Based Hose Quote List
```

Tickets 10-11 and Ticket 12 may proceed independently after Ticket 09. Ticket
12 is intentionally outside the core import-to-publication-to-Storefront chain.
