# Spec 3 Ticket Review: Customer Identity, Personal Center, and RFQ Submission

## Review Status

- Parent: GitHub Issue #4, Spec 3
- Proposed ticket count: 14
- Publication status: Published to GitHub Issues #35-#48 on 2026-08-29
- Prerequisites: Spec 1 / Issue #2 and Spec 2 / Issue #3 are complete
- Sizing rule: every ticket must fit one fresh agent context and leave a
  demoable or independently verifiable customer behaviour
- Shared testing source: every ticket applies the Testing Decisions in Spec 3;
  ticket-specific checks below narrow that contract without replacing it

## Approved Product Boundaries and Decisions

1. **Customer authentication:** the Storefront exposes distinct `Register`
   and `Sign In` entry points. Registration always verifies email possession
   with a six-digit one-time passcode. After verification, the customer may set
   a password immediately or later; returning customers may sign in with either
   password or email OTP. Password creation remains optional and launch does not
   use magic-link login.
   An OTP is short-lived, single-use, rate-limited and attempt-limited. The
   Build a Hose registration transaction and attached draft have a separate
   maximum 24-hour lifetime; the OTP itself is never valid for 24 hours.
2. **Saved Configuration retention:** Saved Configurations do not expire
   automatically at launch. A verified customer may delete an owned Saved
   Configuration. They never inherit the anonymous 30-day lifetime.
3. **RFQ destination terminology:** Spec 3 requires full address fields during
   RFQ submission, while the domain glossary distinguishes an RFQ-stage
   `Destination Profile` from a final `Delivery Address` confirmed before PI.
   The approved implementation snapshots all supplied destination/address
   fields in the RFQ as its Destination Profile, keeps reusable Personal Center
   address-book entries as Delivery Addresses, and lets Spec 4A confirm the
   final PI Delivery Address. No address data is discarded.
4. **Orders boundary:** Spec 3 delivers an authenticated Orders route and an
   honest empty state only. It does not create or simulate Orders; real Order
   records remain owned by Spec 4B.
5. **My Quotes boundary:** Spec 3 lists submitted RFQs and establishes the
   customer-friendly projection. It does not invent PI data; Spec 4A later adds
   PI states to the same projection.

## Proposed Authentication Security Defaults

- Six decimal digits generated with a cryptographically secure random source.
- Ten-minute validity for each OTP; the separate registration transaction and
  attached configuration may remain for up to 24 hours and may issue a new OTP
  within that window.
- Maximum five failed verification attempts per challenge. Issuing a new OTP
  does not reset the accumulated abuse counter for the account/risk window.
- Sixty-second resend cooldown plus configurable per-email and per-IP request
  limits. Request responses do not reveal whether a Customer Profile exists.
- OTP values are never logged or stored in plaintext and are consumed once.
- Passwords are never stored or logged in plaintext or reversible form. The
  implementation uses a salted adaptive password hash supported and benchmarked
  in the Cloudflare Worker runtime, stores its algorithm/work-factor metadata,
  and supports future rehashing when the policy changes.
- Password login is rate-limited and returns generic failures. Password reset
  requires a fresh email OTP, invalidates the previous password credential and
  revokes other active customer sessions.

## Ticket Summary Table

| Ticket | GitHub | Title                                                     | Main deliverable                                                                                            | Blocked by    |
| ------ | ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| 01     | #35    | Register and Sign In with Email OTP                       | Six-digit OTP registration/login, Customer Profile session and sign-out                                     | None          |
| 02     | #36    | Set and Use an Optional Password                          | Password setup, password login, authenticated change and email-OTP reset                                    | #35           |
| 03     | #37    | Refresh the Quote List Before Submission                  | Refresh all line kinds, estimates, availability, compatibility and threshold subtotal                       | None          |
| 04     | #38    | Register to Save an Unfinished Hose Configuration         | Carry one exact page draft in a 24-hour registration transaction and convert it only after OTP verification | #35           |
| 05     | #39    | Enter the Personal Center and Manage the Customer Profile | Authenticated Personal Center shell, profile editing and honest module boundaries                           | #35           |
| 06     | #40    | Merge the Anonymous and Account Quote Lists               | Transactional, idempotent merge without overwriting either list                                             | #35           |
| 07     | #41    | Maintain Addresses and Purchasing Contexts                | Delivery Address book plus Individual/Organization Purchasing Context ownership                             | #39           |
| 08     | #42    | Save and Resume Account-Owned Configurations              | Save, list, resume, revalidate and delete registered-customer configurations                                | #38, #39      |
| 09     | #43    | Explain RFQ Eligibility and Import Responsibility         | USD 100 minimum and customer-friendly Individual/Business DDP/DAP routing                                   | #37, #41      |
| 10     | #44    | Submit an Immutable Individual RFQ                        | Atomic Individual RFQ snapshot, number, confirmation page and idempotency                                   | #40, #43      |
| 11     | #45    | Submit an Immutable Business RFQ                          | Organization-owned RFQ with acting contact and DDP/DAP snapshot                                             | #44           |
| 12     | #46    | Send One Idempotent RFQ Confirmation Email (Cancelled)    | Cancelled: RFQ success is confirmed only on the website                                                     | #45           |
| 13     | #47    | Follow RFQs under My Quotes                               | Customer-owned RFQ list/detail and extension boundary for future PI states                                  | #45           |
| 14     | #48    | Harden and Verify the Anonymous-to-RFQ Seam               | Full browser, ownership, security, accessibility and real-local-D1 verification                             | #36, #42, #47 |

## Ticket 01: Register and Sign In with Email OTP

**Blocked by:** None.

**Scope:** Deliver the verified-email identity foundation through distinct
Register and Sign In entry points. Both paths use a six-digit email OTP to
create or enter a Customer Profile session without requiring a password.

**Acceptance criteria:**

- Storefront and Personal Center expose customer-readable Register and Sign In
  entry points; both accept an email address without requiring a password.
- The server generates a cryptographically random six-digit OTP, stores only a
  one-way digest, and applies a ten-minute expiry, single-use consumption,
  sixty-second resend cooldown, request rate limits and a maximum of five
  failed attempts. The OTP is never valid for 24 hours.
- Register creates a Customer Profile only after successful verification;
  Sign In authenticates an existing profile by OTP without disclosing account
  existence through request or failure responses.
- Successful verification creates or updates one Customer Profile, rotates the
  authenticated session, and redirects only to a validated same-site return
  path.
- Expired, replayed, malformed, superseded and attempt-locked OTPs fail safely without
  creating an authenticated session.
- Customer sessions are isolated from Admin Access, use secure cookie settings
  appropriate to each environment, and support explicit sign-out.
- Local development uses a visible mail-delivery stub; production-facing
  configuration remains named placeholders and contains no real secret.

**Testing requirement:** Apply Spec 3 identity and security decisions; cover
Register and Sign In, OTP generation/verification, profile creation/update,
resend and attempt limits, replay, expiry, account-enumeration resistance,
open-redirect rejection, session rotation and sign-out through Worker-backed
routes.

## Ticket 02: Set and Use an Optional Password

**Blocked by:** Ticket 01.

**Scope:** Extend the verified Customer Profile with an optional password
credential so a customer may set a password after OTP registration, use it for
later sign-in, change it while authenticated, or reset it through a fresh email
OTP without losing OTP access.

**Acceptance criteria:**

- Successful OTP registration offers `Set a password` and `Skip for now`;
  skipping completes registration and leaves email OTP sign-in fully usable.
- A verified customer without a password can add one from an authenticated
  account-security route, and a customer with a password can change it after
  current-password verification or a fresh OTP reauthentication.
- Sign In offers customer-readable `Password` and `Email code` methods. Generic
  request and failure responses do not disclose whether the account exists or
  has a password.
- `Forgot password` verifies a fresh email OTP before replacing the credential,
  consumes the reset authorization once and revokes the customer's other active
  sessions. OTP sign-in remains available.
- Passwords are stored only as unique-salted adaptive hashes with algorithm and
  work-factor metadata using a Worker-compatible implementation. Plaintext,
  reversible password storage and authentication-secret logging are forbidden.
- Password input is not silently truncated; policy and compromised/common-value
  screening are replaceable without rewriting Customer Profiles or stored RFQs.
- Password login, change and reset are rate-limited and CSRF-protected; changing
  credentials never changes Customer Profile, Quote List or RFQ ownership.

**Testing requirement:** Apply Spec 3 identity and security decisions; cover
set-now, skip, add-later, password and OTP login, authenticated change, forgot
password, OTP reset, session revocation, hash metadata, no-secret logging,
generic failures, throttling, CSRF and continued OTP access.

## Ticket 03: Refresh the Quote List Before Submission

**Blocked by:** None.

**Scope:** Turn the current Quote List into a reliable pre-submission view by
refreshing every retained line against current catalogue, compatibility,
availability and versioned estimate inputs without silently changing the
customer's requested product or configuration.

**Acceptance criteria:**

- Opening the Quote List refreshes Standard Product, Length-Based Hose and
  configured-assembly Reference Prices from the active Catalog Release.
- Cutting and Labeling Fee rates, protection and assembly-service estimates,
  discounts, Supply Availability and configured-assembly validity are
  re-evaluated from current versioned data.
- Changed estimates show the former and current amounts; unavailable or invalid
  lines remain visible with actionable blocking reasons and are not removed or
  substituted.
- The refreshed discounted Merchandise Subtotal excludes freight, tax, duties,
  import charges, insurance, Cutting and Labeling Fee and other service fees
  from submission-threshold calculations.
- Refreshing an unsubmitted list never rewrites a submitted RFQ or any later
  commercial record.

**Testing requirement:** Apply Spec 3 refresh decisions; cover all three line
kinds, changed and missing prices, changed fees, invalid compatibility,
availability conflicts, subtotal exclusions and no historical mutation.

## Ticket 04: Register to Save an Unfinished Hose Configuration

**Blocked by:** Ticket 01.

**Scope:** Extend the existing Build a Hose exit warning with registration so a
guest may attach exactly one unfinished page-session draft to a 24-hour
registration transaction and receive it as an account-owned Saved Configuration
only after successful email verification.

**Acceptance criteria:**

- A non-empty guest draft leaving through website navigation offers Stay,
  Discard, or Register to Save; browser refresh and tab close retain only the
  existing best-effort native warning.
- Register to Save collects an email, starts the Register OTP flow and creates
  one transaction containing the
  exact configuration and catalogue/reference versions, but does not create a
  Saved Configuration or make the payload retrievable by email alone.
- Verifying the OTP transaction atomically creates or updates the Customer Profile
  and converts the attached payload into one account-owned Saved Configuration.
- Expired, abandoned, consumed and superseded transactions cannot be converted;
  expired payloads are deleted and never receive anonymous 30-day retention.
- Repeated verification or delivery creates at most one Saved Configuration.

**Testing requirement:** Apply Spec 3 draft-ownership decisions; cover all exit
choices, exact snapshot fidelity, successful conversion, expiry, replay,
cleanup and the absence of accountless email draft recovery.

## Ticket 05: Enter the Personal Center and Manage the Customer Profile

**Blocked by:** Ticket 01.

**Scope:** Deliver the first authenticated Personal Center slice with Overview,
Profile / Company navigation, verified identity display and honest placeholder
states for capabilities owned by later tickets or specs.

**Acceptance criteria:**

- Authenticated customers can open Personal Center; unauthenticated visitors
  are sent through Passwordless Access and returned safely afterward.
- Navigation contains Overview, Saved Configurations, My Quotes, Orders,
  Addresses and Profile / Company with responsive and keyboard-accessible
  behaviour.
- Overview and Profile show the verified email and editable customer name/contact
  fields without conflating the Customer Profile with a Purchasing Context.
- Orders shows a clear empty state and does not expose or fabricate unpaid RFQs,
  PIs or physical Assembly Records.
- One customer cannot access another Customer Profile by changing a route or
  identifier.

**Testing requirement:** Apply Spec 3 Personal Center and access-boundary
decisions; cover authentication return, profile update, navigation, empty
states, responsive access and cross-customer denial.

## Ticket 06: Merge the Anonymous and Account Quote Lists

**Blocked by:** Ticket 01.

**Scope:** On successful verification, associate the current Anonymous Quote
Session with the Customer Profile and merge it into the account-owned Quote
List without overwriting either side.

**Acceptance criteria:**

- Verification with an active Anonymous Quote Session performs one transactional
  Quote List Merge and rotates or retires the anonymous ownership token.
- Exact Standard Product, Length-Based Hose and configured-assembly merge keys
  combine quantities; materially different lines remain separate.
- Merge uses current line identities and preserves customer-entered lengths,
  configurations, quantities and retained estimate context without choosing a
  winner by recency.
- Retrying verification or merge is idempotent and cannot double quantities.
- The merge records actor, source session, destination profile and line results
  for support/audit use without exposing a public Quote List URL.
- A forged or unrelated anonymous cookie cannot attach another browser's list
  to the profile.

**Testing requirement:** Apply Spec 3 merge decisions; cover identical and
different lines of every kind, empty-side cases, retry, tampered cookies and
no-overwrite behaviour.

## Ticket 07: Maintain Addresses and Purchasing Contexts

**Blocked by:** Ticket 05.

**Scope:** Let a verified customer maintain reusable Delivery Addresses and
choose whether a request is made in an Individual or Organization Purchasing
Context, with one Primary Company Contact per organization at launch.

**Acceptance criteria:**

- Addresses supports creating, editing, selecting and deleting complete
  customer-owned Delivery Addresses with country, state/province, city, postal
  code, street fields and recipient/contact data.
- Profile / Company supports an Individual Purchasing Context and creation or
  selection of an Organization Profile with legal company name and required
  company fields.
- The acting Customer Profile remains linked as the launch Primary Company
  Contact; the schema preserves organization membership without exposing
  multi-contact role administration.
- A customer can access only contexts and addresses owned by or available to
  that profile; route identifiers alone grant no access.
- Purchasing Context, Customer Profile and Delivery Address remain separate
  records and can be snapshotted independently by RFQ submission.

**Testing requirement:** Apply Spec 3 ownership decisions; cover individual and
organization paths, complete/incomplete addresses, address CRUD, primary
contact linkage, multi-organization-capable ownership and cross-customer denial.

## Ticket 08: Save and Resume Account-Owned Configurations

**Blocked by:** Tickets 04 and 05.

**Scope:** Deliver Saved Configurations as a verified-account feature, including
the configuration created by registration handoff and an explicit save/resume
path for signed-in customers, without turning a save into a Quote List line or
RFQ.

**Acceptance criteria:**

- A signed-in customer can explicitly save the current Build a Hose draft and
  see registration-converted saves under Personal Center > Saved Configurations.
- Each save snapshots exact customer inputs and version identities needed to
  resume and revalidate the configuration; it has no RFQ number and creates no
  Quote List line.
- Resume opens an isolated current draft and reports stale, unavailable or
  invalid selections without silently replacing them.
- Saving or deleting a configuration affects only the authenticated owner's
  records and cannot be performed through an anonymous email address.
- Saved Configuration retention follows the approved account policy and never
  inherits Anonymous Quote Session expiry.

**Testing requirement:** Apply Spec 3 saved-configuration decisions; cover
explicit save, registration-converted save, resume/revalidation, deletion,
ownership and separation from Quote List and RFQ state.

## Ticket 09: Explain RFQ Eligibility and Import Responsibility

**Blocked by:** Tickets 03 and 07.

**Scope:** Add the customer-facing RFQ preparation step that uses the refreshed
Merchandise Subtotal and selected Purchasing Context to show whether submission
is allowed and explain DDP/DAP responsibility without presenting checkout or
collecting payment.

**Acceptance criteria:**

- A refreshed merchandise amount below USD 100 blocks submission and clearly
  directs the customer to add products; excluded charges never satisfy the
  threshold.
- Individual submission is allowed from USD 100 through USD 4,500 and shown as
  the customer-friendly DDP path; above USD 4,500 the customer must choose or
  create an Organization Purchasing Context.
- Business submission is shown as DDP through USD 3,000 and DAP above USD
  3,000, with clear language about which party handles import clearance,
  duties and import tax.
- Exact boundary amounts produce deterministic outcomes, and changing the
  context or refreshed subtotal updates the explanation before confirmation.
- Freight remains `Calculated after quote request`; the screen contains no
  checkout, payment control or false delivered-total claim.

**Testing requirement:** Apply Spec 3 threshold decisions; cover USD 99.99,
100, 3,000, values immediately above 3,000, 4,500 and values above 4,500 for
both contexts, plus every excluded subtotal input.

## Ticket 10: Submit an Immutable Individual RFQ

**Blocked by:** Tickets 06 and 09.

**Scope:** Deliver the first complete `Request Quote` transaction for an
Individual Customer, from current account-owned Quote List and destination
through one immutable numbered RFQ snapshot and customer confirmation page.

**Acceptance criteria:**

- Submission requires an authenticated Customer Profile, selected Individual
  Purchasing Context, complete destination/address data and required
  acknowledgements.
- One server-side domain command refreshes and validates list ownership,
  threshold, Supply Availability, current compatibility, configured-assembly
  validity and acknowledgements before writing the RFQ.
- A successful RFQ snapshots the verified actor, Individual Purchasing Context,
  destination, every exact line and quantity, displayed reference estimates,
  applicable fee inputs/versions, DDP expectation and submission timestamp.
- The RFQ receives a stable human-reference number, is immutable after creation,
  and the confirmation page displays that number without calling it an Order or
  checkout receipt.
- Customers choose which Quote List lines to submit. Validation, threshold and
  snapshots cover only those selected lines; unselected blocked lines do not
  block the RFQ.
- Only selected submitted lines are cleared after commit; unselected lines stay
  in the Quote List, while failed validation writes no RFQ and preserves every
  line with actionable errors.
- A repeated request with the same idempotency key creates one RFQ and returns
  the existing result.

**Testing requirement:** Apply Spec 3 primary seam for the Individual path;
cover successful snapshot, every validation failure, transaction rollback,
immutability, list clearing and repeated-submit idempotency.

## Ticket 11: Submit an Immutable Business RFQ

**Blocked by:** Ticket 10.

**Scope:** Extend the proven RFQ command and form to Organization Purchasing
Contexts so the verified Primary Company Contact can submit an immutable
business-owned RFQ under the correct DDP or DAP route.

**Acceptance criteria:**

- A verified customer may select only an Organization Profile for which that
  profile is an active launch Primary Company Contact.
- Submission snapshots the Organization Purchasing Context and acting Customer
  Profile separately, together with legal company and destination details.
- A refreshed subtotal through USD 3,000 snapshots the DDP expectation; a
  subtotal above USD 3,000 snapshots DAP without imposing the Individual USD
  4,500 ceiling.
- Organization ownership and company/address completeness are validated inside
  the same transactional command used for RFQ creation.
- Failed or unauthorized business submission leaves the Quote List intact and
  creates no partial organization, RFQ or ownership record.

**Testing requirement:** Apply Spec 3 Business path decisions; cover DDP/DAP
boundaries, acting-contact ownership, unauthorized organizations, incomplete
company/address data, immutable snapshots and command reuse.

## Ticket 12: Send One Idempotent RFQ Confirmation Email

**Blocked by:** Ticket 11.

**Status:** Cancelled by product decision. Successful RFQ submission is
confirmed on the website through the confirmation page and `My Quotes`; it does
not enqueue or send an RFQ confirmation email. OTP and later commercial/status
emails are unaffected.

## Ticket 13: Follow RFQs under My Quotes

**Blocked by:** Ticket 11.

**Scope:** Complete the Spec 3 Personal Center projection so customers can find
their submitted RFQs under `My Quotes`, inspect the immutable request and
understand its current customer-friendly progress while later PI and Order
capabilities remain honest placeholders.

**Acceptance criteria:**

- My Quotes lists only RFQs owned by the authenticated Customer Profile through
  its Individual or Organization Purchasing Contexts.
- A My Quote detail shows the RFQ number, submitted contents, destination,
  customer-friendly DDP/DAP expectation and current RFQ-stage progress without
  allowing in-place edits.
- The projection is shaped to accept future PI states from Spec 4A but does not
  fabricate a PI, quoted price, acceptance action or payment state.
- Orders remains empty until a payment-confirmed formal Order exists through
  Spec 4B and never lists RFQs, PIs or individual physical assemblies.
- Direct URLs and identifier changes cannot reveal another customer's RFQ,
  organization or address.

**Testing requirement:** Apply Spec 3 Personal Center projection decisions;
cover individual and organization visibility, immutable detail, empty/future
PI state, honest Orders boundary and cross-customer denial.

## Ticket 14: Harden and Verify the Anonymous-to-RFQ Seam

**Blocked by:** Tickets 02, 08 and 13.

**Scope:** Close the complete Spec 3 browser seam and security boundaries from
anonymous Quote List through Passwordless Access, merge, context selection,
RFQ creation, confirmation and Personal Center, fixing only gaps found by the
end-to-end review.

**Acceptance criteria:**

- One desktop and one mobile browser flow complete anonymous Quote List
  preparation, verification, merge, valid context/address selection, refresh,
  immutable RFQ submission, confirmation and My Quotes retrieval.
- A separate browser flow verifies guest Build a Hose registration handoff and
  account-owned Saved Configuration recovery without creating an anonymous
  email draft.
- Forged/tampered anonymous cookies, expired/replayed/attempt-locked OTPs, CSRF attempts,
  cross-customer access, cross-organization access and repeated RFQ submission
  all fail with the specified safe behaviour.
- Accessibility checks cover keyboard operation, focus, labels, error
  announcements and responsive layouts for sign-in, Personal Center and RFQ
  submission.
- The final surface contains no checkout/payment controls, internal factory or
  customs-review progress, invented PI/Order data or public Quote List links.
- Full project checks, production build, migration verification and deployment
  dry-run pass with no real secrets in tracked files or history.

**Testing requirement:** Execute the complete Spec 3 primary seam and security
matrix against real local D1 state; mocks alone do not satisfy transactional,
ownership or migration evidence.

## Dependency Graph

```text
01 OTP Identity -----------> 02 Optional Password ------------------------------------------+
 |                                                                                          |
 +--------------------------+----> 04 Registration Draft Save ----> 08 Saved Configurations +
                           |                                                          |
                           +----> 05 Personal Center ----> 07 Contexts/Addresses ----+----> 09 Eligibility
                           |                                  |                       |          |
                           +----> 06 Quote List Merge --------+-----------------------+          v
                                                                                         10 Individual RFQ
03 Quote List Refresh ---------------------------------------------------------------> 09 / 10 |
                                                                                                  v
                                                                                         11 Business RFQ
                                                                                                  |
                                                                                                  v
                                                                                         12 Confirmation Email
                                                                                                  |
                                                                                                  v
                                                                                         13 My Quotes

02 Optional Password ----------------------------------------------------------------+
08 Saved Configurations -------------------------------------------------------------+--> 14 Final Seam
13 My Quotes ------------------------------------------------------------------------+
```

Tickets 01 and 03 may start in parallel. After Ticket 01, Tickets 02, 04, 05 and 06
may run in parallel. Ticket 07 follows the Personal Center ownership boundary;
Ticket 08 joins the registration-save and Personal Center branches. Ticket 09
joins refreshed commercial data with owned contexts. Tickets 10-13 are linear
because each extends the same RFQ submission and customer projection seam.
Ticket 14 joins Optional Password, Saved Configurations and My Quotes for final
end-to-end and security verification.
