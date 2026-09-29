# Launch Hose Assortment

## Core Hose Series

- 601R1 / EN 853 1SN / SAE 100 R1AT
- 601R2 / EN 853 2SN / SAE 100 R2AT
- EN1SC / EN 857 1SC
- EN2SC / EN 857 2SC
- EN4SP / EN 856 4SP
- EN4SH / EN 856 4SH

## Packaged Hose Rules

- Hose Size Variants through 1 inch may be sold as Packaged Hose.
- Sizes through 1/2 inch use 50-foot and 100-foot package lengths.
- Sizes from 5/8 inch through 1 inch use 25-foot and 50-foot package lengths.
- Sizes above 1 inch remain visible in the catalogue as Large-bore Hose and are
  available only through a made-to-order RFQ.
- Any customer-specified length is Cut-Length Hose and follows Production
  Approval and made-to-order cancellation rules.

## Hose SKU Convention

- A Hose Size Variant SKU uses the Hose Series, an underscore, and a
  three-digit sequence number.
- Sequence numbers restart at 001 within each Hose Series.
- Examples include 601R2_001, 601R2_002, and EN2SC_001.
- Package length is not part of the Hose Size Variant SKU; a Packaged Hose uses
  a separate Sales SKU linked to the base Hose Size Variant SKU.

## Expected Packaged Hose SKU Count

| Hose Series | Packaged Hose SKUs |
| ----------- | -----------------: |
| 601R1       |                 18 |
| 601R2       |                 18 |
| EN1SC       |                 14 |
| EN2SC       |                 14 |
| EN4SP       |                 12 |
| EN4SH       |                  6 |
| **Total**   |             **82** |

## Hose Assembly Size Scope

- The launch Hose Assembly configurator and Standard Product hose ends support
  dash -4, -6, -8, -10, -12, and -16 (1/4, 3/8, 1/2, 5/8, 3/4, and 1 inch).
- Packaged Hose may still be sold in dash -3, -5, and -14 where the Core Hose
  Series includes those sizes.
- Hose Assemblies using dash -3, -5, or -14 require manual engineering review
  and remain Quote-only Products rather than configurator selections.

## Hose End Interface Scope

- The launch Hose Assembly configurator supports the JIC 37-degree, NPT/NPTF,
  ORFS, and BSPP/BSPT interface families.
- Metric DIN, SAE flange, banjo, Japanese-standard, and other hose end
  interfaces remain visible where catalogue data is available but require a
  manual RFQ and compatibility review.
- Inclusion of an interface family does not imply that every gender, sealing
  form, angle, or thread-size combination is a Standard Product.

## Standard Hose End Forms

| Interface     | Launch Standard Forms                                                |
| ------------- | -------------------------------------------------------------------- |
| JIC 37-degree | Female swivel straight, 45-degree, and 90-degree; male straight      |
| ORFS          | Female swivel straight, 45-degree, and 90-degree; male straight      |
| BSPP          | Female swivel straight, 45-degree, and 90-degree; male straight      |
| NPT/NPTF      | Fixed male straight, 45-degree, and 90-degree; fixed female straight |
| BSPT          | Fixed male straight                                                  |

Other genders, angles, and special constructions are Manually Reviewed
Assemblies and require an RFQ.

## Configurator Compatibility Rule

- The connection thread size is not required to match the hose dash size.
- A hose end may be selected when the exact hose-end SKU, Core Hose Series,
  Hose Size Variant, and ferrule relationship is recorded as an RFQ-Eligible
  Combination in the compatibility table.
- An RFQ-Eligible Combination may be based on market-reference data and permits
  RFQ submission only; it is not a production promise or a validated pressure
  claim.
- The configurator must not infer compatibility from matching dash sizes,
  thread sizes, or visually similar components.
- Before a PI is issued, the seller must confirm that the requested combination
  is a Production-Approved Combination or offer a reviewed substitute.
- Any combination without an RFQ-Eligible record becomes a Manually Reviewed
  Assembly.

## Configured Assembly Reference Price

- The configurator displays a non-binding Reference Price for each configured
  Hose Assembly under the customer-facing label `Estimated Price`.
- The customer sees one Reference Price for the finished Hose Assembly, not a
  price breakdown for its hose, hose ends, ferrules, assembly operations, or
  mandatory processing.
- The RFQ records the selected component SKUs and the internal price breakdown
  for review, while the customer-facing configuration summary shows component
  identities without component-level prices.
- The estimate includes the selected hose length, End A, End B, two ferrules,
  assembly service, and any selected installed protection.
- Freight, duties, import taxes, and other order-level fees are excluded.
- The configured Reference Price contributes to the RFQ Merchandise Subtotal
  used to enforce the $100 minimum.
- The binding product and logistics price is the PI Price after technical and
  commercial review.

## RFQ Minimum Interaction

- A customer may configure assemblies, add products to the Quote List, and
  save a configuration below the $100 Merchandise Subtotal minimum.
- The Quote List continuously shows its current Merchandise Subtotal and the
  additional product value required to reach $100.
- A basket below $100 cannot be submitted as an RFQ and does not receive an RFQ
  number or enter the sales review queue.
- Freight, duties, import taxes, and other fees do not contribute to the $100
  minimum.
- Relevant Standard Products may be suggested to help the customer reach the
  minimum without changing the saved assembly specification.

## Customer Access and Email Verification

- A customer may use the complete configurator without creating an account.
- Saving a configuration requires an email address; the system sends a secure
  access link and configuration number for resuming the Saved Configuration.
- Submitting an RFQ requires confirmation that the customer controls the
  supplied email address.
- An unverified submission does not enter the sales review queue; successful
  email confirmation creates a Verified RFQ.
- Successful email verification creates or updates a Customer Profile and
  makes the Personal Center available at launch; a separate registration step
  is not required.
- Customers access the Personal Center through an emailed one-time code or
  secure sign-in link. Setting a password is optional and may be done later.
- The Personal Center includes Saved Configurations, RFQs, PIs, order progress,
  Assembly Records, Reorder RFQs, addresses, and individual or company profile
  information associated with the verified email identity.
- When submitting an RFQ, the customer selects an individual or organization
  Purchasing Context. Individual records belong to the Customer Profile;
  business records belong to the Organization Profile and retain the submitting
  Customer Profile as the acting contact.
- One verified email may use both an individual and an available organization
  Purchasing Context.
- At launch, each Organization Profile has one Primary Company Contact. The
  data model retains an organization-member relationship for future company
  invitations and roles, but multi-user company access is not exposed at
  launch.
- Browsing the catalogue, using the configurator, and building a Quote List do
  not require authentication.

## Angled-End Clocking

- Relative angular orientation is required when both assembly ends use
  45-degree or 90-degree hose ends.
- The configurator offers preset angles and also accepts any whole-number angle
  from 000 through 359.
- The configurator and PI must show the orientation visually and use one
  documented End A-to-End B viewing convention.
- `Not Sure` and tighter-than-standard tolerance requests require manual review.
- Production Approval cannot be recorded until required clocking is confirmed.

## Finished Assembly Length

- Customers specify Finished Overall Assembly Length, including both hose ends;
  they do not specify raw hose cut length.
- The configurator must show measurement points appropriate to the selected
  hose-end constructions, and the approved PI must repeat the dimension and
  diagram.
- Inches are the default display unit, millimetres are optional, and the system
  stores one normalized metric value.
- Standard assembly-length tolerances follow the SAE J517 values published by
  Gates: up to 12 inches, plus or minus 0.125 inch; over 12 through 18 inches,
  plus or minus 0.1875 inch; over 18 through 36 inches, plus or minus 0.25 inch;
  and over 36 inches, 1 percent rounded to the nearest 0.125 inch.
- A tighter requested tolerance requires manual review.

## Configurable Length Range

- Customers may enter feet, whole inches, and eighth-inch fractions, or switch
  to millimetres.
- Standard length increments are 0.125 inch (3.175 mm).
- Each Verified Component Combination must have a factory-approved minimum
  Finished Overall Assembly Length calculated from its hose ends, insertion
  dimensions, and minimum hose segment.
- Configured lengths may not exceed 50 feet.
- A requested length below the approved combination minimum, above 50 feet, or
  using a non-standard increment requires manual review.

## Protection and Export Packaging

- Every Hose Assembly receives Standard Export Packaging suitable for
  China-to-customer transport: protective end caps, an individual bag, secured
  coiling, external abrasion protection, and an appropriate shipping carton.
- Standard Export Packaging does not add a permanently installed hose guard.
- Installed Protection allows `No additional installed protection` unless a
  Hose or Application Requirement explicitly requires a guard or sleeve.
- Optional full-length installed protection consists of either a black plastic
  spiral guard or a black textile abrasion sleeve and is priced by length.
- Partial coverage, steel spring guards, fire sleeves, burst-restraint sleeves,
  and special colours or materials require manual review.

## Assembly Identification

- Every Hose Assembly receives a traceability label; an unlabelled assembly is
  not a launch option.
- The standard label includes the storefront brand, unique assembly number,
  Hose Series and size, Finished Overall Assembly Length, assembly maximum
  working pressure, production date and lot, country of origin, and a QR code
  linked to the approved specification, inspection, and delivery record.
- Assembly maximum working pressure is the lowest applicable rating among the
  hose, hose ends, and other pressure-containing components.
- A customer may add an optional equipment reference or hose name of no more
  than 30 characters.
- Scanning the label QR code without authentication shows Public Assembly
  Verification only: brand, Assembly Number, Hose Series and size, Finished
  Overall Assembly Length, reference maximum working pressure, production date,
  record-found status, and completion status for cleaning, Proof Test, and
  inspection.
- Viewing hose-end SKUs, Clocking, equipment reference, inspection photographs,
  detailed records, or the Reorder action requires verified authorized email
  access.
- Customer identity and contact data, PI and payment data, crimp and production
  parameters, supplier data, internal notes, and detailed logistics records are
  never exposed on the public verification page.
- Assembly Numbers and the Assembly Label Pack are generated by the website
  backoffice only after Production Approval and Cleared Funds create a Confirmed
  Order; a Saved Configuration or RFQ does not receive an Assembly Number.
- Each physical Hose Assembly receives its own Assembly Number even when several
  assemblies share an identical approved specification.
- The Assembly Label Pack contains two matching identifiers for each physical
  assembly: a temporary Work-in-Process Tag and a final durable label carrying
  the same Assembly Number and QR code.
- The Work-in-Process Tag remains with the hose or its controlled container
  during cutting, crimping, testing, cleaning, and inspection; the final durable
  label is applied only after those operations pass.
- The China Assembly Facility receives print-ready label files and an identifier
  manifest, then prints and applies the labels without operating a separate QR
  generation system.
- The factory must use the Assembly Number in its production record, inspection
  results, Proof Test record, and finished-product photograph before the public
  verification record is activated.

## Factory Mobile Record Capture

- A batch-specific QR code opens a time-limited Chinese mobile workflow inside
  the WeChat browser; the factory does not complete an inspection spreadsheet.
- Within the authorized batch session, the worker scans the Work-in-Process Tag
  to open the exact assembly record without typing or searching for an Assembly
  Number.
- The form preloads the approved components, Finished Overall Assembly Length,
  Clocking diagram, Proof Test pressure, and configured Proof Test Hold Time.
  It provides separate required uploads for pressure-gauge photographs at the
  beginning and end of the hold period. Both upload controls remain available;
  the page does not display a countdown, disable an upload control, or enforce
  the interval between photographs. Normal completion uses numeric entry,
  large selection controls, and required photographs rather than free text.
- Proof Test Hold Time is controlled by an authorized backoffice setting and
  stored in the Assembly Record. The website uses a global default unless an
  authorized backoffice user applies an order-specific override. The resolved
  value is locked when the production record is issued, is not hardcoded as one
  duration, and cannot be changed by the factory operator during execution.
- Scanning an identifier outside the authorized batch or scanning an already
  completed record produces a blocking warning.
- A printed short code and the batch's remaining-item list provide a controlled
  fallback when a QR code is damaged.
- After inspection and cleaning pass, the factory applies the final durable
  label and uploads a finished-product photograph showing that label.

## Reorder by Assembly Number

- A Saved Configuration number may resume or resubmit an unproduced
  configuration but cannot be represented as a reorderable production record.
- Only an Assembly Number linked to a produced Hose Assembly may initiate a
  Reorder RFQ.
- A Reorder RFQ copies the previously approved specification but still requires
  current technical, commercial, freight, and trade-term review.
- Changing the hose, hose ends, Finished Overall Assembly Length, Clocking, or
  installed protection creates a new configuration rather than a reorder of the
  original specification.
- Changing quantity alone does not change the copied assembly specification.

## Per-Assembly Inspection and Proof Test

- Every Hose Assembly is subject to 100 percent inspection before shipment.
- The Assembly Record must identify the hose, hose ends, and ferrules; record
  insertion-mark inspection, final crimp diameter, Finished Overall Assembly
  Length, required Clocking, visual inspection, cleaning, caps, label, and a
  finished-product photograph.
- Every assembly is liquid proof-tested at twice its maximum working pressure
  for its configured Proof Test Hold Time, with no leakage or pressure drop.
- The proof-test pressure, configured hold time, start and end timestamps,
  pressure-gauge photographs, and result are retained in the Assembly Record.
- Start and end timestamps record when the server receives each photograph;
  they are production records and are not used to enforce the configured hold
  time.
- Each Proof Test attempt records one of three outcomes: `Passed`, `Test Setup
Exception`, or `Assembly Failed`.
- The factory mobile page presents these outcomes as three large Chinese
  buttons: `通过`, `测试设备/适配器异常`, and `胶管总成失败`. Selecting an
  outcome does not require free-text explanation; the website stores the
  corresponding standardized status code.
- Leakage or malfunction at the test bench, test connector, adapter, or other
  test setup is recorded as a Test Setup Exception. The attempt and its
  photographs remain in the Assembly Record, and the same Assembly Number may
  be tested again after the setup is corrected.
- Leakage, pressure loss, or another failure attributable to the hose, crimp,
  hose end, or assembled product is recorded as Assembly Failed and follows the
  permanent failure and replacement rules below.
- A failed Proof Test permanently sets the Assembly Record and Assembly Number
  to `Failed`. The record, photographs, and result cannot be overwritten, the
  Assembly Number cannot be reused or applied to another physical assembly,
  and the assembly cannot be released for shipment.
- A replacement must be produced under a new Assembly Number, linked to the
  Failed Assembly Record, and complete its own inspection and Proof Test before
  release.
- A failed physical assembly is removed from the conforming-product area, its
  hose is cut, and its Work-in-Process Tag and final label are destroyed. The
  batch supervisor confirms disposal once at batch level; no per-assembly
  disposal photograph or free-text report is required.
- The Assembly Facility must have a suitable proof-test bench and recording
  capability before configured Hose Assemblies are offered for sale.

## Component Combination Qualification

- A Production-Approved Combination requires traceable type-qualification
  evidence for the exact Hose Series, size, hose-end family, ferrule, and
  production method.
- Qualification includes the burst pressure, impulse performance, and
  connection integrity required by the applicable SAE or EN standard; the
  minimum burst pressure is normally at least four times assembly working
  pressure where the governing standard requires that design factor.
- Existing factory or third-party reports may be accepted only when they
  identify the same materials and component system.
- Passing a per-assembly Proof Test does not replace type qualification.
- The public website shows applicable standards, maximum working pressure,
  100-percent Proof Test status, and a validated-combination statement. It does
  not publish crimp dimensions, process parameters, supplier formulations, or
  raw qualification reports.
- Redacted compliance evidence may be supplied on request. Third-party
  certification claims may be made only when supported by the corresponding
  third-party report.

## Internal Cleanliness

- After cutting, each hose is projectile-cleaned from both directions to remove
  rubber and metal debris.
- After crimping and Proof Test, the assembly is dried using filtered, oil-free
  compressed air and projectile-cleaned again until no visible contamination
  remains.
- Both ends are capped immediately before individual sealed packaging.
- The public claim is limited to "Cleaned, Dried and Capped."
- A specified ISO 4406 cleanliness class, solvent flush, or media-specific
  cleaning procedure requires manual review, measured verification, and
  separate pricing.

## Loose Crimp Components

- Factory-approved crimp hose ends and ferrules are sold as loose Standard
  Products to Individual Customers and Business Customers.
- Customers select a Hose Series and dash size before the catalogue presents
  compatible hose ends and ferrules.
- Each loose-component page provides the approved customer crimp-data sheet and
  states that professional crimping equipment, inspection, and Proof Test are
  required.
- Public crimp data needed to use a purchased component is distinct from
  confidential type-qualification reports and production records.
- Warranty for loose components covers the purchased component itself and does
  not extend to a Hose Assembly made by the customer.
