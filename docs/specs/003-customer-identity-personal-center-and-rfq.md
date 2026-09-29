# Spec 3: Customer Identity, Personal Center, and RFQ Submission

> Status: Ready for ticketing. Prerequisites Spec 1 / Issue #2 and Spec 2 /
> Issue #3 are complete.

## Problem Statement

Requiring registration before browsing or configuration would reduce qualified
inquiries, but a submitted RFQ needs a verified customer, destination, purchasing
context, immutable contents, and reliable in-site confirmation. Anonymous and existing
customer Quote Lists must not overwrite one another.

## Solution

Allow anonymous catalogue, configurator, and Quote List use through a signed
Anonymous Quote Session. Use email OTP to create or enter a Customer Profile,
with an optional customer-set password as an additional sign-in method. Merge
the active list, collect the required Individual or Organization Purchasing
Context, revalidate the request, and submit one immutable RFQ visible under
customer-friendly `My Quotes`.

## User Stories

1. As a new customer, I want to browse, configure, and prepare a Quote List without registering, so that I can evaluate the offer before sharing personal information.
2. As an anonymous customer, I want products already added to my Quote List to remain available in the same browser, so that I can return to quote preparation.
3. As a customer, I want to register by verifying my email with a six-digit OTP and then sign in using either email OTP or an optional password, so that I can choose the access method that is most convenient to me.
4. As a returning customer, I want my anonymous and saved Quote Lists merged rather than overwritten, so that neither set of selections is lost.
5. As an Individual Customer, I want to submit with personal and delivery information, so that a company account is not mandatory.
6. As a Business Customer, I want to provide company and primary contact information, so that the RFQ belongs to the correct Organization Purchasing Context.
7. As a customer, I want to enter destination country, postal code, and full Delivery Address, so that freight, tax, DDP/DAP, and lead-time review can use the real destination.
8. As a customer, I want current prices and availability refreshed before submission, so that the RFQ does not silently carry stale catalogue estimates.
9. As a customer below the merchandise minimum, I want a clear blocking message, so that I know what is required before requesting a quote.
10. As a customer, I want the applicable customer-friendly DDP or DAP expectation shown before submission, so that import responsibility is not hidden.
11. As a customer, I want an RFQ number shown after successful submission and retained under `My Quotes`, so that I can find and reference the request on the website.
12. As a verified customer, I want Saved Configurations, My Quotes, Orders, Addresses, and Profile/Company in one Personal Center, so that I can resume and follow business with the seller.
13. As a customer, I want RFQ and PI progress grouped under `My Quotes`, so that I do not need to understand internal foreign-trade record types to find my request.
14. As an administrator, I want every submitted RFQ tied to a verified actor and Purchasing Context, so that later commercial records have accountable ownership.
15. As a guest leaving an unfinished configuration, I want registration to save it under my verified account, so that an email address alone is never treated as a draft owner.

## Implementation Decisions

- Browsing, configuration, and Quote List preparation do not require login.
- An unauthenticated browser receives a signed non-personal cookie mapping to a
  server-side Anonymous Quote Session for up to 30 days. The cookie contains no
  line items, prices, specifications, or personal data.
- An unfinished In-progress Configuration Draft is not stored in the Anonymous
  Quote Session. Only Standard Products or configured assemblies explicitly
  added to the Quote List receive 30-day anonymous persistence.
- The Build a Hose exit warning offers registration only after Spec 3 is
  available. Entering an email creates one 24-hour registration transaction
  containing the exact configuration and version snapshot; it is not a Saved
  Configuration, cannot be retrieved by email alone, and is not retained for 30
  days.
- Registration always verifies the email address with a six-digit OTP before a
  Customer Profile is created or updated. Each OTP is valid for 10 minutes,
  single-use, subject to a 60-second resend cooldown, request rate limits and a
  maximum of five failed verification attempts. Its lifetime is independent
  from the maximum 24-hour registration transaction, and issuing a new OTP does
  not reset the accumulated abuse counter for the applicable risk window.
- After OTP verification, a customer may set a password immediately or later
  from the authenticated account security screen. Returning customers may sign
  in with either email OTP or password. Password creation remains optional and
  passwordless access remains available.
- Password credentials are stored only as salted, adaptive password hashes with
  algorithm and work-factor metadata. Launch includes password change and an
  email-OTP reset path; plaintext or reversibly encrypted passwords are never
  stored or logged.
- Successful verification creates or updates a Customer Profile and atomically
  converts any attached registration transaction into an account-owned Saved
  Configuration. Expired or abandoned registration transactions and their
  configuration payloads are deleted.
- Verification associates the current anonymous session to the profile. When a
  profile already has an unsubmitted Quote List, Quote List Merge combines exact
  Standard Product and configured-assembly matches using their defined merge
  keys and keeps materially different lines separate.
- Each RFQ snapshots one Individual or Organization Purchasing Context. Launch
  supports one Primary Company Contact while retaining a future-compatible
  organization-member model.
- The submission form collects complete destination/address fields needed for
  freight and tax review, plus company fields only when the Business Customer
  path is selected. The submitted RFQ snapshots these fields as its Destination
  Profile. Personal Center address-book entries remain reusable Delivery
  Addresses, and Spec 4A confirms the final PI Delivery Address without
  discarding the RFQ snapshot.
- Opening the Quote List and attempting submission refresh current Reference
  Prices, Cutting and Labeling Fee rates, discounts, availability, compatibility,
  and the discounted Merchandise Subtotal. Former and current estimates are
  visible when a retained estimate changed.
- Submission Threshold Revalidation uses merchandise only. Freight, tax, duties,
  import charges, insurance, and service fees do not help reach the $100 minimum.
- Individual DDP submission is allowed from $100 through $4,500. Above $4,500,
  the customer must use a Business Purchasing Context. Business DDP applies
  through $3,000 and Business DAP above $3,000.
- The storefront uses customer-friendly import-responsibility language and does
  not present a checkout or collect payment.
- Customers select the Quote List lines included in each RFQ. Submission
  thresholds, estimates, availability and configured-assembly validation apply
  only to the selected lines; an unselected blocked line does not block the
  request.
- Submission validates identity, ownership, complete address, threshold,
  current supply availability, configured-assembly validity, and required
  acknowledgements in one server operation. A successful operation creates one
  immutable RFQ, clears only its selected lines, and leaves every unselected
  line in the Quote List.
- The confirmation page displays the RFQ number and the committed request is
  immediately visible under `My Quotes`. Successful RFQ submission does not
  enqueue or send an RFQ confirmation email.
- Personal Center uses `My Quotes` for the RFQ/PI lifecycle and `Orders` only for
  payment-confirmed formal Orders. It does not list every physical Assembly
  Record.
- Saved Configurations are non-binding and distinct from Quote List lines and
  submitted RFQs. They do not expire automatically at launch, never inherit the
  Anonymous Quote Session's 30-day lifetime, and may be deleted by their
  verified owner.

## Testing Decisions

- The primary seam is one browser-to-Worker flow: an anonymous user prepares a
  Quote List, verifies email, merges any existing profile list, supplies a valid
  Purchasing Context and destination, and receives one immutable RFQ number.
- Tests inspect customer-visible list contents, refreshed estimates, validation
  errors, resulting RFQ snapshot, confirmation, and Personal Center projection;
  they do not assert session-library internals.
- Security coverage includes forged/tampered anonymous cookies, expired login
  codes, cross-customer RFQ access, organization ownership, CSRF, and repeated
  submit idempotency.
- Authentication coverage includes OTP registration/login, optional password
  setup, password login, authenticated change, email-OTP reset, rate limiting,
  session rotation/revocation, account-enumeration resistance, adaptive hash
  metadata and absence of plaintext credentials in storage or logs.
- Threshold tests cover Individual and Business boundaries, DDP/DAP routing, and
  exclusion of freight and tax from the $100 minimum.
- Merge tests cover identical and different Standard Product, cut-hose, and
  configured-assembly lines without overwriting either list.

## Out of Scope

- Mandatory password accounts, social login, or multi-contact organization
  administration at launch.
- Website payment or customer-uploaded remittance screenshots.
- A public share link for an anonymous Quote List.
- Customer-visible internal RFQ, customs, factory, or payment-review terminology.
- Quote pricing, PI issuance, and order creation.

## Further Notes

This Spec depends on Specs 1 and 2. Its submitted RFQ is the input to Spec 4A.

- Project PRD: https://github.com/legendztk-netizen/Project1/issues/1
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/4
- Blocked by: https://github.com/legendztk-netizen/Project1/issues/2 and https://github.com/legendztk-netizen/Project1/issues/3
