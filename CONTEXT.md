# Hose Commerce

The shared business language for a North American storefront selling hydraulic
hoses, fittings, couplings, and made-to-order hose assemblies.

## Customers

**Retail Customer**:
An end user or small repair business making a planned purchase for its own use
or inventory replenishment without an emergency-delivery expectation.
_Avoid_: Consumer, end user, emergency repair customer

**Individual Customer**:
A Retail Customer submitting an RFQ and purchasing in their own legal name.
_Avoid_: Consumer account, guest

**Business Customer**:
An organization submitting an RFQ and purchasing in its legal business name;
it is not necessarily an approved Wholesale Customer.
_Avoid_: Wholesale Customer, company user

**Wholesale Customer**:
A Business Customer approved to purchase under account-specific commercial
terms.
_Avoid_: B2B user, dealer account

**Customer Profile**:
The website record created or updated after an email address is verified,
linking that verified identity to its Saved Configurations, RFQs, PIs, orders,
addresses, and optional company information. Per-assembly records are reached
through the physical label QR code rather than listed in the Customer Profile.
Creating a Customer Profile does not require the customer to choose a password.
_Avoid_: Mandatory registration, wholesale account, browser session

**Personal Center**:
The verified customer's private website area for viewing and managing Saved
Configurations, My Quotes, Orders, addresses, and individual or company profile
information. It does not contain a My Assemblies list or expose every physical
Assembly Number within an Order.
_Avoid_: Checkout account, public assembly verification, admin portal

**Launch Interface Language**:
The launch language boundary: Customer Storefront, Personal Center, public
Assembly verification, customer transactional email, and customer documents use
English; Factory Mobile uses concise Simplified Chinese; Admin Backoffice uses
Simplified Chinese while preserving literal technical codes and commercial
abbreviations. Product Data Maintenance forms introduced by Spec 9 are the
launch exception: their new headings, field labels, guidance, controlled-value
labels, and validation messages display English and Simplified Chinese together.
Admin navigation and Product Review and Publication controls, guidance, and
validation messages remain Simplified Chinese; the bilingual exception applies
only where an administrator submits or edits product parameters.
The printable factory Production Instruction is bilingual
Simplified Chinese and English, while the final Assembly QR label delivered to
the North American customer uses English and literal standard codes. Launch has
no customer or admin language switcher. In Admin Backoffice, `SKU`, `JIC`,
`NPT`, `RFQ`, and `PI` expose plain-Chinese glossary tooltips on mouse hover and
keyboard focus without replacing the underlying term.
_Avoid_: Translated SKU code, bilingual customer page, English-only factory
instruction, bilingual final product label, runtime language switcher

**Date Display Format**:
The unambiguous date presentation rule. Customer Storefront, Personal Center,
customer email, PI, and other customer documents use an English month name such
as `Aug 19, 2026`. Factory Mobile, Admin Backoffice, and the bilingual Production
Instruction use `YYYY-MM-DD`, such as `2026-08-19`. Numeric month/day forms such
as `08/09/26` are not used. Display formatting does not replace UTC audit
timestamps, stored date values, or an explicit time zone where a deadline has a
time component.
_Avoid_: MM/DD/YY, DD/MM/YY, unlabeled deadline time zone, localized storage
format

**Deadline Time Zone**:
The display and calculation boundary for a deadline with a time component. The
customer-facing PI, Personal Center, and email use IANA zone
`America/New_York` and label the result `ET`, allowing daylight-saving changes
without hardcoding EST or EDT. Admin Backoffice and Factory Mobile display the
same instant in `Asia/Shanghai` as Beijing Time. The canonical instant and audit
events remain UTC. An Admin-entered custom PI validity deadline is entered in
Beijing Time and previewed in customer ET on the generated PI. A custom Payment
Due Date is selected as an ET calendar date, normalized to 11:59 PM ET on that
date, and displayed with its corresponding Beijing Time instant in Admin
Backoffice.
_Avoid_: Fixed EST, fixed EDT, server-local time, unlabeled timestamp, different
deadline instants by interface

**Passwordless Access**:
Authentication through an emailed one-time code or secure sign-in link. A
customer may add a password later, but password creation is not required to
save a configuration, submit an RFQ, or use the Personal Center.
_Avoid_: Guest access, unverified email, mandatory password registration

**Organization Profile**:
The company purchasing identity to which a Business Customer's RFQs, PIs,
orders, addresses, and commercial records belong. The submitting Customer
Profile remains recorded as the contact who performed the action.
_Avoid_: Contact record, wholesale approval, company name text field

**Purchasing Context**:
The Individual Customer or Organization Profile selected as the legal buying
party when an RFQ is submitted. One verified Customer Profile may submit in an
individual context or in an organization context available to that profile.
_Avoid_: Login identity, delivery address, customer type checkbox

**Seller of Record**:
`Hangzhou Rongyao Trading Co., Ltd.`, the launch seller named on Quotes, PIs,
Payment Instructions, Orders, and refund records. Its Seller Registered Address
is an English-formatted China address configured before PI issuance. The US
Return Location is a service address only and does not replace or represent the
Seller of Record.
_Avoid_: Assembly Facility, Return Location, payment beneficiary display name

**Seller Registered Address**:
The Seller of Record's configured China registration address displayed in
commercial documents. It may remain unset during development, but an unset
value blocks formal PI issuance and is never replaced by the US Return Location.
_Avoid_: Return address, Assembly Facility address, inferred company address

**Storefront Brand**:
The customer-facing trade name used in storefront navigation, product pages,
customer email styling, and support presentation. `Rongyao Hydraulics` is a
development placeholder only; production launch requires an approved final
brand, domain, and trademark-conflict review. The Storefront Brand never
replaces the Seller of Record in commercial documents.
_Avoid_: Seller legal name, unreviewed launch brand, payment beneficiary

**Primary Company Contact**:
The single Customer Profile permitted at launch to act for an Organization
Profile in the Personal Center. The data model retains an organization-member
relationship so additional company users and roles can be added later without
changing ownership of existing records.
_Avoid_: Company administrator role system, shared password, billing contact

**Owner Account**:
The single primary Admin Backoffice identity with every application permission,
including creating, resetting passwords, disabling, deleting, and assigning
module permissions to Admin Subaccounts. Username `admin` is reserved for the
primary account. Passwords are stored only as salted hashes.
_Avoid_: Shared login, job title, customer owner, Factory Batch Access

**Admin Subaccount**:
An independently authenticated Admin Backoffice identity whose permissions are
selected individually by the Owner Account in 账号权限. A new Admin Permission is
never granted implicitly; at launch the Owner grants the second staff account
every Admin Permission, which gives it every Owner capability except creating
or managing Admin Subaccounts and Owner-only approvals.
_Avoid_: Shared Owner credentials, fixed staff role, customer subaccount

**Admin Permission**:
One individually assignable Admin Backoffice capability. Permissions are
selected for each Admin Subaccount rather than inferred from a fixed Sales,
Operations, or Catalog role.
_Avoid_: Job title, Owner identity, Factory Batch Access

**Admin Identity**:
An active Owner Account or Admin Subaccount authenticated with a username and
password in password-auth environments, using a revocable server-side session.
Admin Subaccounts have a username, password credential and name; each module
is denied, read-only, or writable as selected by the Owner.
Assembly parameter configuration is authorized separately from product management;
granting product access does not grant configuration access. Notification access
also requires permission to view the source business module. Read-only notification
access permits opening authorized notifications and updating personal read state,
but does not grant business editing permissions. Password resets,
disabling and deletion invalidate existing sessions. Deletion removes login
access and credentials while retaining identity references in business audits.
Existing deployed Cloudflare Access environments retain their configured
authentication until explicitly migrated; application authorization remains
required. Local development no longer automatically assumes Owner identity.
_Avoid_: Customer Profile, shared admin login, unvalidated identity header

**Admin Audit Event**:
An append-only record of a security- or business-significant Admin Backoffice
action, including actor, UTC timestamp, request identifier, IP address, affected
entity, action, and permitted before-and-after field differences. It excludes
passwords, authentication codes, secrets, and sensitive payment credentials.
_Avoid_: Editable activity note, application error log, full secret snapshot

**Factory Batch Access**:
A time-limited, batch-specific authorization opened from a QR code for the
minimal Factory Mobile workflow. It is not an Admin Backoffice account or role.
_Avoid_: Factory administrator, shared admin login, permanent public link

**Factory Link Opened**:
The internal timestamp recorded on the first successful opening of an Assembly
Production Package through its Factory Batch Access link. It replaces a manual
`Mark Sent to Factory` action but proves only that the link opened, not who read
it or that production began. It is not customer-visible and sends no customer
notification.
_Avoid_: Factory acceptance, production start, delivery receipt, customer Order
status

**Production Started**:
The internal Assembly Production Package milestone set when Factory Mobile
receives the first start photograph for any included Hose Assembly. It is a
simple workflow signal, not a verified timestamp for cutting, crimping, or the
factory's actual manufacturing start. It is not customer-visible and sends no
customer notification.
_Avoid_: Factory Link Opened, exact manufacturing start, customer-facing In
Production promise

## Orders

**Merchandise Subtotal**:
The price of all products in an order after discounts, excluding shipping,
duties, import taxes, and other fees.
_Avoid_: Order total, cart total

**Reference Price**:
A public, non-binding product amount with an explicit original currency, used
for comparison and same-currency merchandise subtotals. Configured Hose Assembly
estimates include components, assembly services, and Installed Protection;
mixed-currency estimates require manual pricing rather than automatic conversion.
_Avoid_: Final price, quoted price

**Retail Unit Price**:
The Admin Backoffice field label for an exact SKU's public Reference Price. It
is maintained separately from the inherited Series Commercial Rule and is not a
Factory Unit Price, private Cost Basis, purchasing price, or final quoted price.
_Avoid_: Factory Unit Price, Cost Basis, quoted price

**Reference Price Refresh**:
The pre-submission replacement of a Quote List line's retained Reference Price
with the current published Product Revision value and currency. The customer sees the former and current
estimated amounts, and RFQ submission snapshots the refreshed value without
changing any previously submitted RFQ, PI, or Order.
_Avoid_: PI repricing, silent historical edit, Quoted Unit Price revision

**Submission Threshold Revalidation**:
The final pre-RFQ evaluation of the refreshed discounted Merchandise Subtotal
against the $100 submission minimum and the applicable customer-type DDP or DAP
routing threshold. Freight, tax, import charges, and Cutting and Labeling Fee
are excluded. It uses current Quote List values and never changes a previously
submitted RFQ or issued PI; original-currency amounts that cannot establish the
complete USD subtotal require manual commercial confirmation.
_Avoid_: Grandfathered Quote List, freight-inclusive threshold, historical repricing

**Estimated Assembly Price**:
The customer-facing label for a configured Hose Assembly's Reference Price. It
is an estimated product amount rather than a binding offer or a component-level
price breakdown.
_Avoid_: Starting price, guaranteed price, PI Price

**PI Price**:
The binding product and logistics price offered on an issued Proforma Invoice.
_Avoid_: Reference Price, website price

**Cost Basis**:
The internal per-unit product cost available only to authorized Admin Backoffice
users for quotation and margin review. It is never exposed to customers.
_Avoid_: Reference Price, quoted unit price, supplier invoice attachment

**Quoted Unit Price**:
The customer-facing product unit price confirmed by Sales for one Quote
Revision and used on its PI. It may be initialized from the Reference Price but
does not change when the live catalogue changes.
_Avoid_: Reference Price, Cost Basis, live catalogue price

**Manual Quantity Discount**:
A line-level commercial discount entered by an authorized admin during Quote
Revision review for a specific quantity. It is not generated from a public or
automatic quantity-tier schedule and remains part of pricing audit history.
_Avoid_: Catalog Reference Price, automatic volume tier, hidden price override

**Pricing Audit Event**:
The immutable record of who changed a quoted price or discount, when it changed,
and the previous and new values.
_Avoid_: Approval workflow, customer-visible comment, current price field

**RFQ Basket**:
A temporary, non-binding selection of Standard Products and Hose Assembly
requirements that a customer intends to submit for quotation.
_Avoid_: Cart, shopping cart, order

**Quote List**:
The customer-facing name for the RFQ Basket. Standard Products use `Add to
Quote`, configured assemblies use `Add Assembly to Quote`, and submission uses
`Request Quote`; the backend continues to create an RFQ.
_Avoid_: Shopping cart, checkout, customer-facing RFQ acronym

**Anonymous Quote Session**:
A server-side Quote List associated with a signed, non-personal browser cookie
for up to 30 days. The cookie identifies the session but does not contain line
items, prices, specifications, or customer information.
_Avoid_: Customer Profile, local-storage cart, public share link

**Quote List Merge**:
The audited operation that moves an Anonymous Quote Session into a verified
Customer Profile. Identical Standard Product or configured-assembly lines have
their quantities combined, while materially different configurations remain
separate.
_Avoid_: Replacing the customer's saved list, submitting an RFQ, quote revision

**Configured Assembly Line Merge Key**:
The exact customer-approved configuration values used to combine repeated
additions to an unsubmitted Quote List: Hose Size Variant SKU, ordered End A and
End B Hose End SKUs, original Finished Overall Assembly Length value and unit,
Clocking when applicable, installed protection selection, and Application
Requirements. Quantity and Estimated Price are excluded. A difference in any
included value keeps the assemblies on separate lines.
_Avoid_: Approximate match, converted-length-only match, SKU-only merge, price match

**Saved Configuration**:
A non-binding Hose Assembly specification that can be resumed or shared but
has not been submitted to the sales review queue and has no RFQ number.
_Avoid_: Draft RFQ, saved order, confirmed assembly

**In-progress Configuration Draft**:
The current Build a Hose selections before `Add Assembly to Quote`. For an
unauthenticated customer, the draft exists only in the active browser page
session and is not recoverable after leaving. It becomes a Saved Configuration
only after successful email verification, or an Anonymous Quote Session line
only after `Add Assembly to Quote`.
_Avoid_: Anonymous autosave, Quote List line, Saved Configuration, submitted RFQ

**Quote Line Edit Draft**:
An isolated working copy created when a customer edits an unsubmitted configured
assembly in the Quote List. The stored source line remains unchanged until the
customer explicitly selects `Save Changes`; cancelling or abandoning the edit
discards only the working copy.
_Avoid_: Live mutation, Quote Revision, duplicate Quote List line

**Retained Invalid Selection**:
A customer-entered configurator value that remains visible after an upstream
change makes it incompatible or requires renewed confirmation. The configurator
flags and links to it but does not silently clear or substitute it. It blocks
Add Assembly to Quote and RFQ submission until the customer resolves or
reconfirms it; stale derived compatibility, ferrule, and price results are never
retained as valid.
_Avoid_: Automatic clearing, silent substitution, submittable invalid assembly

**RFQ**:
A numbered request submitted by a customer for product, freight, trade-term,
and delivery pricing; it creates no obligation to sell or purchase.
_Avoid_: Order, quote, checkout

**Verified RFQ**:
An RFQ whose submitter has confirmed control of the supplied email address and
which is eligible to enter the sales review queue.
_Avoid_: Submitted form, unverified inquiry

**My Quote**:
The customer-facing Personal Center view that presents one RFQ and its PI
progress as a single understandable quote journey. It is a projection of the
underlying RFQ and PI records, not a replacement backend object and not an
Order.
_Avoid_: Confirmed Order, backend RFQ status, binding price before PI issuance

**Quote Revision**:
An immutable new version created from a submitted RFQ or issued PI when the
customer or seller changes products, quantities, specifications, destination,
or commercial terms. Earlier versions and their acceptance history remain
available for audit and comparison.
_Avoid_: Editing a submitted RFQ in place, overwritten PI, Saved Configuration

**Superseded PI**:
A previously issued or accepted PI replaced by a newer Quote Revision. It
remains visible in history but cannot be accepted, paid against as the current
offer, or converted into a Confirmed Order.
_Avoid_: Cancelled Order, expired draft, current PI

**Expired PI**:
An issued PI that was not accepted before its stated validity deadline. It
remains visible in history but cannot be accepted or used as the current offer.
_Avoid_: Superseded PI, cancelled order, Accepted PI

**Quote Conversation**:
The authoritative message and attachment history associated with one My Quote.
It continues unchanged through the resulting Order and its After-sales Cases.
Messages sent in Messages and authorized replies to quote-specific
notification emails enter the same conversation and remain visible to the
customer and Admin Backoffice. A message may be labelled with one After-sales
Case of that Order.
_Avoid_: Private salesperson mailbox, order status history, general contact form

**Messages**:
The customer's in-site inbox (Personal Center) and the Admin Backoffice
「消息管理」 listing every Quote Conversation, with a summary of the Quote or
Order, links to it and unread counts. It is the only place for conversation:
Quote, Order and After-sales pages show records and decisions, not replies.
Admin Internal Notes in a conversation are never visible to the customer.
_Avoid_: Order conversation, Case reply thread, notification list

**Pre-Quote Support Chat**:
A third-party live-chat conversation used to help a visitor navigate products,
identify an uncertain hose-end component, or understand configurator choices.
It cannot create, edit, submit, or supplement a Quote. After receiving guidance,
the customer returns to the website, selects the products and specifications,
and completes the normal Quote workflow. Chat messages and attachments are not
authoritative product specifications or Quote Conversation records.
_Avoid_: Ordering channel, product selection on the customer's behalf,
Production Instruction, accepted specification, replacement for My Quotes,
permanent system of record

**Internal Quote Note**:
An Admin Backoffice-only comment or attachment associated with one My Quote,
used for factory confirmations and internal commercial or technical context.
It is never part of the customer-visible Quote Conversation.
_Avoid_: Customer message, PI term, mandatory approval record

**Transactional Notification**:
A required email and corresponding Personal Center event concerning identity
verification, security, an active My Quote, PI, payment, Order, Shipment, or
After-sales Case. It is not controlled by marketing consent. When manual
payment confirmation atomically creates a Confirmed Order, one combined
`Payment Confirmed - Order Created` notification represents both events rather
than sending two messages. When payment is confirmed before PI acceptance, the
customer first receives an acceptance-required notice and receives a separate
Order-created notice only after later acceptance creates the Order.
_Avoid_: Newsletter, promotional campaign, optional product announcement

**Marketing Consent**:
A separate affirmative choice to receive promotional email. It is not granted
by submitting an RFQ, accepting a PI, or creating a Customer Profile and does
not control Transactional Notifications.
_Avoid_: Terms acceptance, customer account, transactional email preference

**Destination Profile**:
The country, state or province, city, postal code, address type, and any
unloading capability supplied with an RFQ for freight estimation.
_Avoid_: Delivery Address, shipping address

**Delivery Address**:
The complete destination confirmed before a Proforma Invoice is issued.
_Avoid_: Destination Profile, billing address

**Proforma Invoice (PI)**:
The seller's commercial offer stating the agreed products, quantities, trade
term, lead time, payment milestones, cancellation scope, and refund conditions.
_Avoid_: Invoice, RFQ confirmation

**Accepted PI**:
A Proforma Invoice whose commercial terms and final product specifications have
been affirmatively accepted by the customer through the normal Personal Center
flow or recorded by an Owner or authorized Admin Subaccount from an email
confirmation. Acceptance does not establish Cleared Funds, create a Confirmed
Order, or release production or shipment.
_Avoid_: Confirmed Order, paid invoice, issued PI

**PI Acceptance Record**:
The immutable evidence linking an Accepted PI to its exact document version and
hash and its acceptance source. A normal website acceptance retains the verified
Customer Profile, acknowledgements, typed name and business title where
applicable, UTC timestamp, IP address, and user agent. A manual email fallback
retains source `Email`, the acting Owner/Admin identity, and UTC timestamp while
automatically linking the current fixed PI version and hash.
_Avoid_: DocuSign envelope, unattributed status edit, editable acceptance record

**Manual Email PI Acceptance**:
The launch fallback in which an Owner or authorized Admin Subaccount marks the
current fixed PI `Accepted` after receiving customer confirmation by email. The
system records source `Email`, actor, timestamp, and the automatically linked PI
version and hash; it does not require email upload, customer signature fields,
or manual hash comparison. Payment Instructions were already issued with the PI;
the action records acceptance and does not release production.
_Avoid_: Cleared Funds, Production Release, unlogged status change

**PI View Evidence**:
The timestamp, fixed PI version, and document hash recorded when the customer
successfully opens or downloads the current PI PDF before acceptance. It is
recorded only after the authorized server response successfully returns the
fixed document, not from a button click alone. It is required once for the
accepted version but does not measure scrolling, reading duration, or
comprehension. A replacement PI requires new PI View Evidence; evidence and
acknowledgement state from a superseded version remain historical and never
carry forward. It is required for the normal Personal Center acceptance path,
not Manual Email PI Acceptance.
_Avoid_: Forced reading timer, scroll tracking, click-only evidence

**Payment Instructions**:
The complete plain-text bank-transfer directions or seller-issued PayPal link
pasted by Owner/Admin for one PI, versioned separately, displayed, and emailed
with that PI and its acceptance entry point. A newly issued PI includes the
instructions current at issuance as a dated payment reference. Current Payment
Instructions in My Quotes govern subsequent payment; an authorized instruction
change does not replace or alter the fixed PI or its Acceptance Record. The
issuance copy remains historical and must not be treated as a live account or
remaining balance. The application preserves
line breaks and safe links but does not parse, infer, or rewrite beneficiary
fields. Payment Instructions do not collect payment on the website and do not
establish PI acceptance or Cleared Funds. The Payment Due Date begins only after
PI acceptance.
_Avoid_: Live account in a historical PDF, checkout, structured beneficiary profile, HTML

**PI Payment Channel**:
The single seller-selected payment method attached to one issued PI: bank
transfer or PayPal. Customer-facing Payment Instructions expose only that
channel. Before any Partial Funds Received or Cleared Funds are recorded, an
authorized channel change may replace the Payment Instructions without replacing
the PI when Total Due and currency are unchanged; the old and new channels,
actor, and timestamp remain in audit history. A change to Total Due or currency
requires a replacement PI. Changing the channel or instructions does not
recalculate or extend the Payment Due Date; any extension is a separate Payment
Deadline Extension.
_Avoid_: Simultaneous payment options, checkout choice, unlogged channel switch

**Payment Due Date**:
The deadline, normally 10 business days after PI acceptance, by which full
Cleared Funds are expected. The default deadline is calculated under the US
Business Calendar. Before acceptance, a PI using the default rule states the
relative payment term rather than an unknowable calendar date; acceptance
calculates and snapshots the concrete deadline. For an authorized fixed-date
override, Owner/Admin selects an ET calendar date before PI issuance; the system
fixes the deadline at 11:59 PM ET on that date and shows the corresponding
Beijing Time instant. The override must be later than the PI validity deadline,
or PI issuance is blocked. The Payment Due Date remains separate from the PI
validity deadline.
_Avoid_: Transfer initiation date, production start date, PI expiry date

**US Business Calendar**:
The ET business-day calendar used to calculate the default Payment Due Date,
Return Inspection Deadline, and Refund Initiation Deadline. A US business day
is Monday through Friday in `America/New_York`, excluding configured US federal
bank holidays. This calendar is maintained separately from the China
Fulfillment Calendar and does not govern production lead time. For every
deadline governed by this calendar, the triggering event's ET date is day 0,
the next eligible US business day is day 1, and the deadline expires at 11:59
PM ET on the final counted business day.
_Avoid_: Calendar days, customer local calendar, China Fulfillment Calendar

**Payment Deadline Extension**:
An audited Owner/Admin action on an Accepted PI that replaces the current
Payment Due Date only with a later ET date. The record preserves the prior and
new deadlines, actor, and timestamp and sends the customer an email and matching
Personal Center notification. It does not shorten the deadline, alter the
accepted PI document, or require a replacement PI. Before PI acceptance, a
payment-term change instead requires a replacement PI. If the PI is already in
Payment Review Required and the new deadline is in the future, the action
returns it to Payment Pending and clears the overdue indicator; it never records
Cleared Funds, creates an Order, or releases production.
_Avoid_: Editable issued PI, shortened deadline, silent date overwrite

**Payment Review Required**:
The status of an Accepted PI whose Payment Due Date has passed without full
Cleared Funds. It pauses order creation for manual commercial review without
automatically cancelling the PI.
_Avoid_: Payment failed, order cancelled, Cleared Funds

**Production Approval**:
The customer's recorded approval of the final specifications for a
made-to-order product. The approved specification becomes immutable and
convenience return is no longer available; any later customer-error cancellation
is an exceptional Admin Backoffice decision rather than a customer self-service
right or an automatic production-stage rule.
_Avoid_: Order confirmation, payment approval, editable specification

**Grouped Made-to-Order Acknowledgement**:
The single PI-acceptance acknowledgement covering every Length-Based Hose Order
and made-to-order Hose Assembly in that fixed PI version. The interface lists
each covered line and its final identifying specifications immediately above
one checkbox; the PI Acceptance Record retains the covered-line snapshot and PI
document hash.
_Avoid_: One checkbox per line, generic undisclosed waiver, product-page acceptance

**Administrative Assembly Cancellation Review**:
A backoffice-only review, initiated after customer-support contact, of whether
an approved Hose Assembly may exceptionally be cancelled. An authorized admin
uses current factory information to approve or decline without a system-defined
cutting, crimping, or completion threshold; approval creates a Cancellation
Resolution and never edits the approved specification.
_Avoid_: Customer cancellation form, specification change, automatic stage rule

**Nonconforming Product**:
A delivered product with a manufacturing defect or a material difference from
the specifications recorded in its Confirmed Order.
_Avoid_: Unwanted product, incorrectly selected product

**Cancellation Request**:
A customer's request to cancel eligible Standard Products before their Shipment
is marked Shipped. It does not change the Confirmed Order or authorize a refund
until Operations approves it after reviewing fulfillment progress and any
documented non-refundable third-party costs.
_Avoid_: Automatic cancellation, chargeback, After-sales Case, Return Authorization

**Cancellation Review Hold**:
A temporary fulfillment hold applied only to the eligible, unshipped Order-line
quantity included in a Cancellation Request. It prevents that quantity from
being assigned or released to a Shipment until Operations approves or declines
the request, without pausing unrelated Order quantities.
_Avoid_: Cancelled quantity, whole-Order hold, refund approval, Shipped quantity

**Cancellation Resolution**:
The immutable Operations decision on a Cancellation Request, recording each
approved or declined Order line and quantity, the resulting merchandise,
logistics, tax, permitted-cost, and refund adjustments, and the remaining
fulfillment obligation. It preserves the original PI and Confirmed Order rather
than replacing or rewriting them.
_Avoid_: Quote Revision, edited PI, automatic refund, Return Authorization

**Delivery Address Change Request**:
A customer's request to replace the delivery address for one or more unshipped
Shipments in a Confirmed Order. It places the affected Shipments on hold but
does not edit the accepted PI or effective Delivery Address until Operations
requotes logistics, trade treatment, and applicable sales tax and the customer
accepts the resulting Order Change Confirmation.
_Avoid_: Profile address edit, silent Shipment edit, carrier redirect

**Order Change Confirmation**:
An immutable post-order record accepted by the customer that authorizes an
approved Delivery Address change and records the old and new address snapshots,
affected Shipments, revised trade and logistics terms, tax treatment, financial
adjustment, and any additional Cleared Funds or refund due.
_Avoid_: Replacement PI, editable Order, Quote Revision, informal message

**Shipping Change Request**:
A customer's request before carrier handoff to change the transport mode,
expedite service, or split a planned Shipment in a Confirmed Order. It holds the
affected Shipment and becomes effective only through an accepted Order Change
Confirmation and any required additional Cleared Funds.
_Avoid_: Direct Shipment edit, carrier redirect, Combined Shipping Request

**Order Change Withdrawal**:
The customer's explicit withdrawal of a pending Delivery Address Change Request
or Shipping Change Request before its Order Change Confirmation takes effect.
It releases the affected Shipment hold and restores the original accepted
delivery plan without erasing the request or withdrawal history.
_Avoid_: Silent expiry, assumed consent, approved Order change

**Confirmed Order**:
A system record created from an Accepted PI after all required specifications
are approved and the full PI Price is Cleared Funds. Whichever valid event
completes the last missing condition, including `Mark Payment Confirmed` or PI
acceptance after payment confirmation, the website creates the Order atomically
and initializes fulfillment without a separate `Create Order` action. Repeating
either request cannot create another Order for the same accepted PI.
_Avoid_: RFQ, issued PI, pending payment

**Follow-on Quote**:
A new Quote initiated from an existing Confirmed Order when the customer wants
additional products, quantities, or specifications. It has its own RFQ, PI,
acceptance, payment, and resulting Order and never edits the originating Order.
_Avoid_: Order amendment, added Order line, replacement PI, reorder without review

**Shipment**:
A fulfillment and dispatch record belonging to one Confirmed Order, with its
own products and quantities, packing documents, freight charge allocation,
trade term, carrier, tracking information, and delivery status. One Order may
have one or several Shipments, and a Shipment may travel alone or within a
Consolidated Dispatch.
_Avoid_: Confirmed Order, package count, production batch

**Consolidated Dispatch**:
An Operations grouping that sends Shipments from two or more Confirmed Orders in
one coordinated carrier dispatch. Each Shipment remains attached to its own
Order with separate commercial history and allocated logistics amounts.
_Avoid_: Merged Order, shared PI, combined payment, edited Shipment ownership

**Combined Shipping Request**:
A customer's non-binding request in a Follow-on Quote to coordinate its future
Shipment with an earlier unshipped Order. It does not pause the earlier Order;
it becomes binding only when Operations confirms feasibility and the customer
accepts the Follow-on PI containing the revised dispatch plan and date.
_Avoid_: Automatic Order hold, merged Order, guaranteed consolidation

**Shipment Packing Estimate**:
A quote-stage estimate for one planned dispatch, recording expected carton
count, gross weight, dimensions or dimensional weight, transport method,
source, and validity period so freight and trade charges can be prepared before
PI issuance. It is scoped to the quoted quantities and is not a permanent
attribute of each product SKU.
_Avoid_: Final Packing Record, SKU net weight, carrier invoice, guaranteed weight

**Final Packing Record**:
The dispatch-stage record of the cartons, actual gross weights, dimensions, and
packing documents prepared for one Shipment. It preserves what was shipped and
does not overwrite the earlier Shipment Packing Estimate or Catalog Master Data.
_Avoid_: Shipment Packing Estimate, product specification, Quote Revision

**Packing Group**:
An optional Final Packing Record row grouping cartons that share the same length,
width, height, and per-carton gross weight. It stores carton quantity once and
allows the website to calculate group and Shipment totals without requiring one
row per identical carton. Packing Groups are not a `Ready to Ship` gate.
_Avoid_: SKU carton master data, one-row-per-carton requirement, packing prerequisite

**Dimensional Weight Divisor**:
An optional Shipment-level value supplied for the selected logistics method and
used with Packing Group carton dimensions to calculate dimensional weight. It
has no hardcoded launch default. When absent, the website may total physical
volume but does not display dimensional weight or derive freight from it.
_Avoid_: Fixed 5000 divisor, fixed 6000 divisor, automatic carrier rate

**Freight Estimate Variance**:
The difference between the logistics charge accepted in a PI and the seller's
final logistics cost when the quoted quantity, Delivery Address, shipment plan,
and transport method have not changed. A positive cost variance is borne by the
seller and is not collected from the customer after PI acceptance.
_Avoid_: Customer-requested change, additional invoice, automatic PI revision

**Fixed Logistics Charge**:
The customer-facing amount accepted in the PI for an identified packing and
transport service. It is a fixed commercial charge rather than a pass-through
reconciliation to the seller's final carrier cost: the seller bears overruns
and retains savings while delivering the promised service.
_Avoid_: Carrier invoice, cost reimbursement, automatic refund, blank freight

**Logistics Service Downgrade**:
A seller-proposed reduction from the logistics service accepted in the PI, such
as a slower transport mode, removal of insurance, or materially longer transit
plan. It requires customer agreement and a Quote Revision with any corresponding
price adjustment; it is not treated as ordinary Freight Estimate Variance.
_Avoid_: Equivalent carrier substitution, normal transit variation, cost saving

**Customer-Requested Logistics Change**:
A customer change after PI issuance but before Confirmed Order creation to
product quantity, Delivery Address, Ship Together or Split Shipment plan, or
transport method that affects freight or trade terms. It requires a Quote
Revision and replacement PI before the changed commercial plan becomes binding.
_Avoid_: Freight Estimate Variance, seller packing error, silent order edit

**Customer Order Progress**:
The intentionally simple customer-facing sequence `Order Confirmed`, `Ready to
Ship`, `Shipped`, and `Delivered`. Factory-link access, production photographs,
Proof Test records, preparation, and internal inspection do not change or
appear in this sequence. Owner/Admin explicitly marks the applicable Shipment
`Ready to Ship` after confirming completion outside Factory Mobile. `Ready to
Ship` is informational and does not request or require customer approval;
dispatch continues under the accepted PI and the customer receives tracking
information after the Shipment is marked `Shipped`. In a split Order, each
Shipment independently sends its Ready-to-Ship notification when marked ready;
the notice identifies `Shipment X of N` and lists that Shipment's products and
quantities without waiting for the remaining Shipments.
_Avoid_: Preparing Items, Quality Check, In Production, Factory Link Opened,
Production Started, automatically exposed factory activity, customer shipment
approval

**Package Tracking Record**:
The carrier, tracking number, carrier tracking URL, ship date, estimated
delivery date, and delivery status for one physical package in a Shipment. A
Shipment may contain several Package Tracking Records.
_Avoid_: Shipment, packing-list carton count, Order status

**Shipment Dispatch Minimum**:
The minimum data required to mark a Shipment `Shipped`: actual ship date and
carrier name. Tracking number, tracking URL, and estimated delivery date may be
added later. Until a usable tracking number or URL exists, the customer sees
`Tracking pending` and no active tracking action.
_Avoid_: Tracking-number gate, empty Track Shipment link, estimated ship date

**Manual Delivery Confirmation**:
The authorized transition of a Shipment without usable tracking information to
`Delivered`. It requires actual delivery date and a confirmation source of
`Carrier Confirmation` or `Customer Confirmation`. Supporting proof of delivery
may be attached but is not mandatory. The customer does not receive a
self-service delivery-confirmation control; an Owner or authorized Admin
Subaccount records a customer confirmation received through Support or email.
_Avoid_: Assumed delivery date, tracking-number requirement, mandatory signature image

**Shipment Status Notification**:
The email and matching Personal Center event emitted once when a Shipment first
enters `Shipped` and once when it enters `Delivered`. A later tracking-number
update changes the Shipment detail without resending the `Shipped` notification
or emitting a separate tracking-available notification. Customs Review is not a
notification event.
_Avoid_: Tracking-update spam, customs-status notice, email-only history

**Processing Lead Time**:
The time from the business day after Confirmed Order creation until products
are expected to complete preparation, inspection, and packing as `Ready to
Ship`. It excludes international transit and customs time.
_Avoid_: Delivery time, transit time, PI acceptance period

**Reference Processing Lead Time**:
A public, non-binding starting estimate used before factory scheduling. For a
Standard Product, including a Length-Based Hose Order, it is 10 business days;
for a made-to-order Hose Assembly it begins at 15 business days. Neither value
is a promised date for every quantity.
_Avoid_: Confirmed Processing Lead Time, fixed large-order schedule, delivery time

**Transit Time**:
The separately quoted estimate from Shipment dispatch to delivery at the named
destination. It is not part of Processing Lead Time.
_Avoid_: Processing Lead Time, guaranteed delivery date, production time

**Seller-Caused Customs Failure**:
A final inability to deliver a DDP Shipment caused by the seller's declaration,
documentation, or product-compliance failure. The customer chooses a no-cost
replacement or a full seller-caused refund.
_Avoid_: Ordinary inspection delay, customer-requested change, tracking delay

**Fulfillment Calendar**:
The China operating calendar used to calculate Processing Lead Time and the
Estimated Ready-to-Ship Date, including normal workdays, public holidays,
factory shutdowns, and approved exceptional workdays. It does not calculate the
Payment Due Date.
_Avoid_: Customer time zone, carrier transit calendar, generic weekdays

**Estimated Ready-to-Ship Date**:
The date calculated from Confirmed Order creation, line-item Processing Lead
Times, and the applicable Fulfillment Calendar, then confirmed in the accepted
PI and snapshotted into each resulting planned Shipment. A Ship Together Order
has one Shipment and one date; an accepted Split Shipment plan has one date per
Shipment. Order detail displays each Shipment's date as its sole pre-dispatch
schedule reference without a countdown, percentage, or factory-stage progress.
Factory Mobile activity does not recalculate it. It is not an estimated
delivery date.
_Avoid_: Delivery date, ship date, Transit Time, production countdown, live
factory progress

**Ready-to-Ship Date Revision**:
An Owner/Admin update made after the current Estimated Ready-to-Ship Date can no
longer be met. Passing the date creates only an internal reminder and never an
automatic customer-visible `Delayed` status or message. After Owner/Admin
confirms a revised date, the website preserves the original date in history,
displays the revised date as `Updated Estimated Ready-to-Ship Date`, and sends
one email and matching Personal Center notification identifying the affected
Shipment. A split Order revises only the selected Shipment date. A date-only
revision does not replace the PI; changes to price, quantity, or transport terms
use the applicable commercial-change workflow.
_Avoid_: Automatic delay notice, customer-visible production status, edited PI,
silent date overwrite

**Split Shipment Request**:
A customer's non-binding RFQ preference to dispatch products in more than one
Shipment. Sales must quote the resulting freight and trade terms; it is not an
automatic fulfilment instruction.
_Avoid_: Partial delivery failure, backorder, confirmed shipment plan

**DDP Retail Order**:
A Retail Customer order for which the seller is responsible for transport,
import clearance, duties, and import taxes through delivery at the named
destination.
_Avoid_: Tax-free order, free-shipping order

**Provider-Managed DDP Clearance**:
The launch-stage fulfillment arrangement in which an identified logistics
provider arranges the import and clearance path for an eligible low-value DDP
Shipment. The customer is not asked to select an Importer of Record or complete
ordinary import-clearance steps, while the seller remains responsible for the
customer-facing DDP delivery commitment.
_Avoid_: Customer-managed clearance, DAP, public IOR configuration

**DDP Fulfillment Failure**:
The seller's inability to complete an accepted DDP delivery because no compliant
DDP logistics route remains available. The seller first seeks an alternative
DDP provider at its own cost; it may not silently transfer clearance or import
charges to the customer. If DDP remains impossible, the seller offers a full
seller-caused refund unless the customer accepts a replacement DAP PI.
_Avoid_: Freight Estimate Variance, automatic DAP conversion, customer default

**DDP Import Charge Variance**:
The difference between the DDP import charges accepted in a PI and the seller's
final import-clearance, duty, and import-tax cost when the products, quantities,
Delivery Address, and accurate customer-supplied import information have not
changed. The seller bears overruns and retains savings without an automatic
supplemental charge or refund.
_Avoid_: US Sales Tax, customer data error, changed order, customs penalty

**Customer-Supplied Import Data Error**:
Materially inaccurate or incomplete customer information used to prepare DDP
import treatment, such as consignee identity, delivery information, or declared
end use. A resulting commercial change requires a Quote Revision and replacement
PI rather than treatment as a DDP Import Charge Variance.
_Avoid_: Seller classification error, ordinary customs review, cost variance

**DAP Retail Order**:
A Retail Customer order delivered by the seller to the named destination while
the customer acts as importer and is responsible for import clearance, duties,
and import taxes.
_Avoid_: Unpaid order, customer-shipping order

**Sales Tax Treatment**:
The PI-level determination for US state and local sales or use tax: `Collected`,
`Exempt`, or `Not Collected`. It is separate from DDP or DAP import duties and
taxes.
_Avoid_: DDP tax status, default tax exemption, import duty

**Sales Tax Exemption Evidence**:
The accepted resale or exemption certificate supporting an `Exempt` Sales Tax
Treatment for a specific customer and applicable jurisdiction.
_Avoid_: Customer checkbox, tax identification number alone, Not Collected

**Return Authorization (RA)**:
The seller's recorded approval for an eligible product to be sent to the Return
Location under stated shipping and inspection conditions. It authorizes return
for inspection and does not pre-approve a refund. The merchandise must arrive
at the Return Location within 30 calendar days after RA issuance; an expired RA
requires a new support review and does not guarantee renewed authorization.
_Avoid_: Return label, refund approval

**RA Expiration Date**:
The date 30 calendar days after Return Authorization issuance by which the
authorized merchandise must be received at the Return Location. The issuance
date in `America/New_York` is day 0 and the RA closes at 11:59 PM ET on day 30. Expiration
closes the authorization without automatically deciding the underlying
After-sales Case or issuing a refund.
_Avoid_: Return request window, carrier ship date, automatic case rejection

**Refund Initiation Deadline**:
The seller's commitment to initiate an approved refund within 10 business days
after Operations approves the refund, calculated under the US Business
Calendar. It is not a promise that the customer's bank or PayPal account will
post the funds within that period. The website records amount, channel,
initiation date, and external reference but does not move money.
_Avoid_: Customer posting date, automatic payout, inspection completion estimate

**Refund Account**:
The account used to receive an approved refund. PayPal refunds return through
the original PayPal transaction when available; WorldFirst or bank payments
return to a verified account belonging to the same Individual Customer or
Organization Purchasing Context. Once a refund is approved and payable,
the customer can provide a bank account or PayPal email from the Order. Selecting
a different channel from the original payment requires Owner approval for that refund. Account Provided means the
customer has submitted the details, not that a payment has occurred or the bank
has independently verified ownership. Operations checks the account before
remitting funds. A corrected account replaces the account for unpaid refunds
without changing earlier remittance records. An alternative account requires explicit
Owner approval and a recorded reason, bound to that exact refund and destination
version; a changed destination needs a new approval. Cash and default store
credit are not launch refund methods.
_Avoid_: Unverified third-party account, cash refund, automatic store credit

**Refund Completed**:
The seller has recorded the full approved refund as remitted outside the
website, including its account, amount, date and transaction reference. It does
not assert that the customer's bank has credited the funds. The related
After-sales Case closes when all claimed returns have been received and
decided, all refunds have been fully remitted and no unresolved replacement or
refund hold remains. A partial remittance does not close the Case.
_Avoid_: Refund approval, bank receipt confirmation, automatic bank transfer

**Convenience Return Condition**:
The condition required for a customer-choice return: unused, uninstalled,
undamaged, complete with supplied accessories, and in original packaging where
reasonably applicable. Inspection includes threads, sealing surfaces, finish,
and evidence of installation or fluid exposure. Failure to meet the condition
may reduce or eliminate the approved merchandise refund.
Detailed inspection notes are optional internal records; Operations may assess
the physical condition offline before recording the decision.
_Avoid_: RA issuance, seller-error defect, automatic full refund

**Return Inspection Gate**:
The requirement that a post-delivery merchandise refund involving physical
return cannot be approved until the authorized product is received at the
Return Location and its inspection is completed. RA issuance, customer-provided
tracking, and carrier in-transit status do not satisfy the gate. The rule also
applies to returned seller-error and Nonconforming Products; it does not apply
to pre-dispatch cancellation or inability-to-supply refunds where no product
was delivered.
_Avoid_: Refund on tracking upload, refund on RA issuance, pre-shipment refund gate

**Return Inspection Deadline**:
The target for Operations to complete inspection and record `Approved`,
`Partially Approved`, or `Declined` within 5 business days after the authorized
return is received at the Return Location, calculated under the US Business
Calendar. Missing the target creates an Owner or Admin Backoffice reminder but
never automatically approves a refund or bypasses the Return Inspection Gate.
_Avoid_: Refund initiation deadline, automatic approval, carrier delivery estimate

**Return Inspection Decision Notification**:
The email and matching Personal Center event sent when Operations records an
`Approved`, `Partially Approved`, or `Declined` return inspection decision. A
partial or declined decision requires a customer-visible reason. Every refund
shows the returned merchandise amount, restocking fee, tax and other approved
adjustments, and final refund amount. A full approval does not require an
additional written explanation; standard deductions are disclosed in the
breakdown, and any third-party deduction requires supporting evidence.
_Avoid_: Internal note only, unexplained refund amount, inspection photo dump

**Return Inspection Evidence**:
Photographs and files recorded during return inspection and stored privately in
R2. Evidence is `Internal` by default. An Owner or authorized Admin Subaccount
may explicitly share selected items that directly support a customer-visible
partial approval or decline reason; the complete evidence set is never shared
automatically.
_Avoid_: Public inspection gallery, automatic photo disclosure, Shipment Document

**Inspection Decision Revision**:
An audited change by an Owner or authorized Admin Subaccount to a return
inspection decision after further discussion in the same After-sales Case. It
does not create a separate appeal workflow. If a prior refund was already
initiated, any additional approved amount becomes a Supplemental Refund and
never overwrites the original refund record. Before any initiation, the revised
refund keeps the original approval deadline. A reduction that stays above what
was already initiated replaces only unpaid authorizations; one that would claw
back money or split a partly initiated refund is flagged and places a Refund
Hold on every unpaid remainder.
_Avoid_: New appeal case, edited refund history, customer-controlled decision

**Refund Hold**:
A pause on the unpaid remainder of an approved refund after a flagged
Inspection Decision Revision. A held refund cannot be initiated; a later
revision of the same decision releases the hold. Amounts already initiated are
never reversed by the website.
_Avoid_: Clawback, cancelled refund, edited approval

**Supplemental Refund**:
An additional externally initiated refund linked to an earlier refund and the
Inspection Decision Revision that authorized it. It records its own amount,
channel, initiation date, and external reference.
_Avoid_: Replacement refund record, edited original payout, store credit

**Convenience Return Request Window**:
The 14-calendar-day period beginning on the actual delivery date of the
applicable Shipment during which a customer may submit an After-sales Case for
an eligible, unused Standard Product. The delivery date in `America/New_York`
is day 0 and the window closes at 11:59 PM ET on day 14. This is the single
launch policy; no earlier return-policy version applies. Submission within the window does not
automatically issue a Return Authorization or approve a refund. Length-Based
Hose Orders and made-to-order Hose Assemblies are excluded.
_Avoid_: PI validity period, automatic return approval, defect-report deadline

**Product Return Eligibility Disclosure**:
The concise product-specific return statement shown near `Add to Quote` and
linked to the complete return policy. Eligible Standard Products state the
14-calendar-day unused-item request window and 10% restocking fee. Length-Based
Hose Orders and made-to-order Hose Assemblies state that convenience return is
unavailable after cutting or Production Approval. The disclosure does not add
an acknowledgement checkbox to `Add to Quote`; required made-to-order
acknowledgements occur during acceptance of the fixed PI.
_Avoid_: Policy-page-only disclosure, universal free returns, hidden custom-product rule

**Convenience Return Restocking Fee**:
A 10% deduction from the discounted merchandise amount of the approved returned
quantity when an eligible Standard Product is returned for a customer-choice
reason. The customer pays return shipping. The same fee applies when Admin
determines on inspection that an "Other problem" was caused by the buyer, if
the Order's accepted refund terms disclose it. Seller error and Nonconforming
Product remedies do not use this fee, and the seller bears reasonable return or
replacement logistics for those cases.
_Avoid_: Pre-dispatch cancellation fee, freight percentage, seller-error deduction

**Convenience Return Logistics Treatment**:
The non-refundability of the original DDP Shipping and Import Charges for an
approved customer-choice return after delivery because the outbound logistics
and import service has already been performed. The merchandise refund remains
subject to the Convenience Return Restocking Fee, and Sales Tax is adjusted
under the applicable treatment. Seller error and Nonconforming Product remedies
remain seller-funded.
_Avoid_: Automatic freight refund, import-charge reversal, seller-error policy

**After-sales Case**:
A numbered customer request associated with delivered Order lines for a return,
wrong item, damage, or possible Nonconforming Product. It records evidence,
review, each customer-visible decision with its reason and attachments, and the
approved resolution but does not itself approve a return or issue a refund.
Discussion about a Case happens in Messages, labelled with the Case.
_Avoid_: Return Authorization, automatic refund, general Quote Conversation

## Payment

**Manual Payment Confirmation**:
The launch payment workflow in which Owner/Admin verifies receipt outside the
website and then uses the Admin Backoffice to record the result against a PI.
The website has no WorldFirst, bank, or PayPal balance, reconciliation, or
payment-status integration. `Mark Payment Confirmed` records the current PI,
actor, UTC timestamp, and the PI Total Due as confirmed; an external reference
or internal note is optional. If acceptance and every required specification
approval are already present, the same action atomically creates the Confirmed
Order and initializes fulfillment; there is no second `Create Order` button.
The action is idempotent so retrying it cannot create a duplicate payment
confirmation or Order. The resulting payment statuses drive website workflow
only and do not constitute independent evidence that money moved.
_Avoid_: Bank feed, payment webhook, automatic reconciliation, customer payment
screenshot

**Payment Confirmation Correction**:
An append-only Owner/Admin correction used when Cleared Funds were recorded in
the website by mistake. `Correct Payment Confirmation` requires a reason and
records the original confirmation, correcting actor, and UTC timestamp rather
than editing or deleting history. If no Confirmed Order exists, the PI returns
to the workflow state implied by its acceptance and specification approvals. If
an Order was created, the Order is preserved and placed on a Payment
Confirmation Review Hold that blocks further production release and dispatch
until Owner resolves the discrepancy.
_Avoid_: Delete payment, edit audit history, customer refund, silent Order
cancellation

**Cleared Funds**:
Full payment that Owner/Admin has verified in the seller's receiving account
outside the website and manually recorded against a PI, net of any bank
deductions. Payment through superseded Payment Instructions may still qualify
when the destination remains seller-controlled and the receipt is matched to the
PI; the record stores the actual receipt channel and marks `Paid via Superseded
Instructions`. A remittance receipt or screenshot is not evidence of Cleared
Funds.
_Avoid_: Payment screenshot, transfer proof, partial payment

**Partial Funds Received**:
The current cumulative settled amount Owner/Admin has externally verified for a
PI while it remains below Total Due. Launch does not keep a required website
ledger for each bank or PayPal transfer. Each update records the previous amount,
new amount, actor, and UTC timestamp; a downward correction also requires a
reason. It does not release production, dispatch, or Order creation.
_Avoid_: Cleared Funds, deposit terms, per-transfer reconciliation ledger

**Funds Received - Acceptance Pending**:
The state created when Owner/Admin manually records full Cleared Funds against
the current issued PI before that PI is Accepted. The website notifies the
customer to complete PI acceptance, but does not create a Confirmed Order or
release production or dispatch. When valid acceptance is later recorded, the
website atomically creates the Confirmed Order and initializes fulfillment if
all required specification approvals are present. No additional Owner/Admin
action or second payment confirmation is required.
_Avoid_: Payment Pending, Accepted PI, Production Release

**Funds Received - PI Review Required**:
The state used when Owner/Admin manually records externally verified funds
against an Expired PI or a superseded PI. The funds remain traceable to that
historical PI but are not automatically applied to a current offer and do not
create a Confirmed Order or release production or dispatch. Owner/Admin must
review the current commercial terms and issue a new current PI. The customer
must accept that PI and authorize allocation of the received funds to it, or
request a refund.
Expired and superseded PI versions remain immutable historical records and are
not restored as current versions.
_Avoid_: Funds Received - Acceptance Pending, automatic payment allocation,
reactivated historical PI, Production Release

**Unallocated Excess Funds**:
Settled funds above the amount allocated to a PI or other authorized customer
obligation. They are not Order value or customer credit and remain separately
traceable until the customer authorizes a refund or allocation.
_Avoid_: Store credit, discount, Order overpayment revenue

**Refund Fee Allocation**:
The responsibility rule for documented, non-refundable bank or payment-channel
costs associated with an approved refund. Seller-caused refunds are seller-paid;
customer-caused refunds may deduct only permitted and disclosed actual costs.
_Avoid_: Restocking fee, refund penalty, administrative markup

**Prepayment**:
Payment of the full PI Price as Cleared Funds before production or shipment is
released. Accepted PI status alone never satisfies Prepayment.
_Avoid_: Deposit, down payment, payment proof

## Products

**Catalog Master Data**:
The current product, compatibility, price, and availability data stored in D1
and used by the storefront and configurator. Excel workbooks are import and
export formats, not a concurrent source of truth.
_Avoid_: Product spreadsheet database, RFQ line snapshot, supplier catalogue

**Catalog Import**:
A traceable Excel intake batch producing independently reviewable Product
Change Requests and retaining related compatibility source records.
_Avoid_: Direct spreadsheet sync, partial row update, unreviewed upload

**Product Data Maintenance**:
The Admin Backoffice area containing Excel import, Manage All Products,
Sales, Packaging and Price, and Assembly Management.
_Avoid_: Spreadsheet database, draft archive, direct storefront edit

**Manual Catalog Entry**:
An authorized administrator's submission of one series or SKU revision directly
to its chosen product state, without entering the Excel review queue. An Online
SKU submission includes its required parameters, price, currency, applicable
packaging, and resolved main image as one indivisible unit.
_Avoid_: Manual compatibility editor, shared Catalog Draft, online spreadsheet

**Catalog Review**:
The review of individual Product Change Requests from Excel or legacy Draft
migration, applying each accepted request to its target product state. The
importing administrator may review their own requests.
_Avoid_: Four-eyes approval, whole-catalog publication, manual-entry approval queue

**Product Revision**:
An immutable version of one stable series or exact SKU and its owned data.
Later successful publications replace the current published revision of that
entity without changing its earlier versions or unrelated entities.
_Avoid_: Catalog Release, editable history, inherited values owned by the SKU

**Product Change Request**:
An independently reviewable proposal for a series or SKU, with its source,
indivisible owned-data payload, dependencies, and intended product state.
Its review state is separate from the target product's lifecycle state.
_Avoid_: Shared Catalog Draft, Excel file, product lifecycle status

**Series Commercial Rule**:
The shared sales unit, MOQ, lead time, origin, and quantity-entry rules inherited
by a series' variants. SKU prices, currencies, and packaging remain separately
owned by each variant.
_Avoid_: SKU price, supplier cost, copied per-variant sales rule

**Catalog Release**:
An identified immutable whole-catalog snapshot from the legacy publication
workflow, retained for historical reading after item-level publication replaces
it as the maintenance workflow.
_Avoid_: Excel file version, individual SKU edit, website deployment

**Quote Line Snapshot**:
The immutable product identity, description, selected specifications, quantity,
and commercial values captured on an RFQ or PI line when that record version is
created, including the original currency and the product and rule versions used.
Later product publications do not rewrite it.
_Avoid_: Live product relation, current catalogue price, order fulfilment update

**Standard Product**:
A predefined hose, fitting, adapter, or coupling variant that can be purchased
without engineering or commercial review.
_Avoid_: Regular product, normal SKU

**Hose Assembly**:
A made-to-order finished product consisting of a specified hose length and
compatible end connections.
_Avoid_: Custom hose, combined hose

**Factory-built Hose Assembly**:
A Hose Assembly produced and inspected at the existing China Assembly Facility
after the customer order is confirmed.
_Avoid_: Locally assembled hose, stocked assembly

**Crimp Specification**:
The approved production instruction that links one Hose Size Variant, fitting,
and ferrule combination to its required dies and final crimp diameter.
_Avoid_: Machine setting, crimp number

**Assembly Facility**:
A qualified location that produces Hose Assemblies using approved equipment,
Crimp Specifications, inspection, and traceability controls. The existing China
factory is an Assembly Facility.
_Avoid_: Warehouse, crimping location

**Fulfillment Location**:
A location that holds sellable inventory and dispatches customer orders; it
does not necessarily have the capability to produce Hose Assemblies.
_Avoid_: Assembly Facility, factory

**Return Location**:
A designated US location that receives eligible Standard Product returns but
is not a Fulfillment Location, retail store, or customer pickup point.
_Avoid_: US warehouse, US office, pickup address

**Quote-only Product**:
A product or order requiring engineering or commercial review before price and
fulfillment can be confirmed.
_Avoid_: Special item, contact-us product

**Hose Series**:
A family of hoses sharing the same construction and governing standards, such
as 601R2 / EN 853 2SN / SAE 100 R2AT.
_Avoid_: Model, hose type

**Core Hose Series**:
One of the six hose families approved for the primary retail range: 601R1,
601R2, EN1SC, EN2SC, EN4SP, or EN4SH.
_Avoid_: Main model, launch hose

**Hose Size Variant**:
One nominal bore and dash size within a Hose Series, such as 601R2-06 for
1/4-inch, dash -4 hose.
_Avoid_: Style, size option

**Hose Size Variant SKU**:
The internal identifier for a Hose Size Variant, formed from its Hose Series,
an underscore, and a three-digit sequence that restarts at 001 for each series,
such as 601R2_001.
_Avoid_: Manufacturer model, Sales SKU, dash-derived SKU

**Packaged Hose**:
A Hose Size Variant sold in a predefined coil length, such as 100 feet.
_Avoid_: Bulk hose, roll option

**Cut-Length Hose**:
A made-to-order Hose Size Variant cut to a customer-approved length rather than
sold as a Packaged Hose.
_Avoid_: Packaged Hose, per-foot SKU

**Length-Based Hose Order**:
A Standard Product request for one Hose Size Variant expressed as Length per
Piece in feet and Number of Pieces. Presets such as 25, 50, and 100 feet are
input shortcuts rather than defaults, separate SKUs, or guaranteed continuous
lengths. The customer must explicitly supply both fields before adding the line
to the Quote List.
The requested piece length and piece count are retained in the Quote Line
Snapshot and confirmed in the Quote and PI. It is a made-to-order product:
after payment is confirmed and cutting begins, convenience cancellation and
return are unavailable. Before cutting, an authorized admin may approve a
cancellation after checking actual factory progress.
_Avoid_: Fixed-length SKU, total-footage-only line, Packaged Hose

**Total Hose Footage**:
The calculated product of Length per Piece and Number of Pieces for one
Length-Based Hose Order. It drives the storefront merchandise estimate at the
active per-foot Reference Price but does not replace the requested piece length
or authorize the seller to split or combine pieces. Length per Piece and Number
of Pieces are commercial specifications: any proposed split or consolidation
requires an accepted replacement Quote and PI before fulfillment.
_Avoid_: Number of pieces, maximum continuous length, confirmed production length

**Length-Based Line Merge Key**:
The combination of exact Hose Size Variant SKU and Nominal Cut Length used to
consolidate repeated additions to an unsubmitted Quote List. Matching additions
increase Number of Pieces on one line; the same SKU at a different Nominal Cut
Length remains a separate line. Consolidation recalculates Total Hose Footage,
the merchandise estimate, and any Cutting and Labeling Fee.
_Avoid_: SKU-only merge, total-footage merge, submitted RFQ rewrite

**Nominal Cut Length**:
The customer-requested minimum length of each piece in a Length-Based Hose
Order. A delivered piece must not be shorter. A small production overage may be
supplied without charge, but billing, the Quote Line Snapshot, PI, and piece
label remain based on the Nominal Cut Length. Launch does not publish an
unverified fixed positive cutting tolerance.
_Avoid_: Hose Assembly Finished Overall Length, billed actual overage, symmetric tolerance

**Cutting and Labeling Fee**:
A customer-visible per-piece service fee for a Length-Based Hose Order that may
recover cutting, end protection, individual labeling, and handling effort. A
Hose Series override takes precedence over the global USD rate; the launch
default is USD 0. The resolved rate and calculated amount are snapshotted at
RFQ submission and shown separately from hose merchandise in the Quote and PI.
It contributes to the final amount due but not Merchandise Subtotal or any RFQ
submission and DDP/DAP routing threshold. Its US sales-tax treatment is not
globally hardcoded as taxable or exempt; the PI-level jurisdictional Sales Tax
Treatment determines whether it enters the tax base.
_Avoid_: Hidden surcharge, per-foot price, freight, SKU master field

**Cutting and Labeling Fee Refund**:
The full reversal of a Cutting and Labeling Fee when an authorized admin
approves cancellation before cutting begins. Only previously disclosed, actual,
non-refundable bank or third-party costs may reduce the total customer refund;
no administrative fee is added. Seller error or a Nonconforming Product makes
the fee seller-funded as part of the applicable refund or replacement remedy.
_Avoid_: Restocking fee, automatic post-cut cancellation, retained service fee

**Cutting and Labeling Fee Refresh**:
The pre-submission replacement of a retained Length-Based Hose Order's
per-piece fee with the current applicable Hose Series override or global rate.
The customer sees the former and current estimated fee before RFQ submission;
the submitted RFQ snapshot is never changed by a later configuration update.
_Avoid_: Submitted RFQ repricing, silent fee change, PI recalculation

**Large-bore Hose**:
A Hose Size Variant above 1 inch that remains visible in the catalogue but is
available only through a made-to-order RFQ.
_Avoid_: Packaged Hose, unavailable size

**Configurator-supported Size**:
A common Hose Assembly dash size available in the launch configurator: -4, -6,
-8, -10, -12, or -16.
_Avoid_: Every available hose size, automatic compatibility

**Manually Reviewed Assembly**:
A Hose Assembly that requires engineering review before quotation because its
size or component combination is outside the launch configurator.
_Avoid_: Configurator-supported assembly, unavailable assembly

**Manual Assembly Quote Request**:
The customer-facing fallback for a Hose Assembly requirement that cannot be
completed in the configurator. It captures known dimensions and interfaces and
permits photographs or drawings for Sales and technical review.
_Avoid_: Invalid free-form configuration, support ticket, Production Approval

**Application Requirements**:
The customer's stated fluid medium, maximum system working pressure, and
minimum and maximum operating temperatures for a requested Hose Assembly.
Customer-facing temperature values use Fahrenheit as the primary unit with the
Celsius equivalent; Factory Mobile and the bilingual Production Instruction use
Celsius first with Fahrenheit second. Both views derive from one canonical
unrounded temperature value, and display rounding does not control range
validation.
_Avoid_: Certified operating envelope, product specification, usage guarantee

**Temperature Display**:
The system-generated dual-unit temperature rendering used for catalogue ranges
and Application Requirements. Customer surfaces render `°F (°C)`; Factory
Mobile and Production Instructions render `°C / °F`. The second unit is never
entered or converted manually, and `Not Sure` remains a state rather than a
numeric temperature.
_Avoid_: Independent Fahrenheit field, independent Celsius field, hand
conversion, rounded validation input

**Technical Review Required**:
A quote-line status showing that suitability cannot be concluded from the
customer's submitted Application Requirements without human review.
_Avoid_: Rejected configuration, Production Approval, unsafe by definition

**Hose End Interface Family**:
A group of hose-end connections sharing a mating and sealing standard. The
launch configurator supports JIC 37-degree, NPT/NPTF, ORFS, and BSPP/BSPT.
_Avoid_: Fitting series, thread size, interchangeable connection

**Standard Hose End Form**:
An approved launch combination of Hose End Interface Family, gender, swivel or
fixed construction, and angle that may be selected in the configurator.
_Avoid_: Every fitting in the factory catalogue, guaranteed compatibility

**Representative Product Image**:
An owned, reviewed product-shape image shared by SKUs that differ only in size
or another visually minor attribute. A Hose End image may be an original
AI-generated technical product render when its interface family, gender,
swivel or fixed construction, angle, and visible sealing form have been checked
against the approved catalog structure. It is clearly labelled that dimensions
vary by size and supports recognition rather than replacing the SKU's structured
interface and size specification.
_Avoid_: Exact-size claim, unreviewed AI output, competitor image, dimensional
authority, image-only product identification

**Hose Series Structure Illustration**:
A reviewed AI-generated cutaway illustration representing the reinforcement
construction of one Hose Series across its size variants. It is an explanatory
series asset rather than a photograph, dimensional drawing, or exact-size
product representation. The six approved launch illustrations use the exact
outer-cover wordmark `Fluidpowerhose` and contain no other generated product
marking or specification text.
_Avoid_: Product photograph, exact diameter, unreviewed reinforcement count,
AI-generated specification text

**Catalog Product Family**:
A customer-facing group of Standard Product SKU Variants that share the same
core construction and differ primarily by connection size, hose size, body
size, port size, or another selectable dimension. The family supports browsing
and one canonical Product Detail page but is not itself quotable.
_Avoid_: SKU, Quote line, Hose End Interface Family, approximate product

**SKU Variant**:
The exact purchasable or quotable Standard Product within a Catalog Product
Family. Search may open a family page with this variant selected, and every
Quote List line, PI line, and fulfillment record retains its exact SKU.
_Avoid_: Product family name, unselected size, interchangeable substitute

**Catalog Publication Status**:
The lifecycle state controlling whether Catalog Master Data is customer-visible:
`Draft`, `Published`, or `Archived`. Publication does not imply RFQ eligibility,
production qualification, stock availability, or guaranteed compatibility.
_Avoid_: Qualification Status, RFQ Eligibility, in-stock status, validation

**Supply Availability**:
The current new-business state `Available for Quote`, `Temporarily Unavailable`,
or `Discontinued` for an exact SKU. It controls whether a customer may add that
SKU to a new Quote List and never represents a real-time inventory count.
_Avoid_: In Stock, inventory quantity, Catalog Publication Status, RFQ Eligibility

**Quote List Availability Conflict**:
A pre-submission condition in which a retained Quote List line or one of its
required configured-assembly components is no longer Available for Quote. The
line remains visible but blocks RFQ submission until the customer removes it or
Supply Availability is restored.
_Avoid_: Silent removal, automatic substitution, submitted RFQ change

**RFQ Eligibility**:
The commercial workflow state `Eligible`, `Manual Quote Only`, or `Blocked`
controlling whether an exact Standard Product or compatibility relationship may
enter the guided Quote workflow. It is independent of production qualification.
_Avoid_: Catalog Publication Status, Production Approval, guaranteed sale

**Qualification Status**:
The production-evidence state `Not Tested`, `Approved`, or `Rejected` for an
exact hose, hose-end, ferrule, method, and crimp-data relationship. `Not Tested`
does not prevent a separately curated relationship from being RFQ-Eligible, but
it is not a Production-Approved Combination.
_Avoid_: Catalog Publication Status, RFQ Eligibility, market-reference data

**Technical Data Status**:
The completeness state `Complete`, `Inherited`, or `Pending` for customer-facing
and internal technical attributes of a Standard Product SKU. `Inherited` means
the SKU resolves attributes from an identified Specification Profile, while
`Pending` means unavailable values remain undisplayed and require confirmation
during quote review. Technical Data Status is independent of Catalog Publication
Status and RFQ Eligibility and does not by itself disable `Add to Quote`.
_Avoid_: Qualification Status, production approval, invented value, blank-field
placeholder

**Specification Profile**:
A versioned set of technical attributes shared by an explicitly scoped product
family, standard, body size, material option, role, or other declared variant
dimensions. A SKU may inherit this data and override documented exceptions; it
must not inherit from a merely similar competitor item or an unmatched material
or connection option.
_Avoid_: Universal series default, approximate competitor copy, SKU identity

**RFQ-Eligible Combination**:
An exact Hose Size Variant, hose-end SKU, and ferrule relationship that may be
selected in the configurator and submitted for review. It may come from an
approved worksheet 04 source row or Automatic Compatibility Expansion, without
implying that the combination is approved for production.
_Avoid_: Verified combination, guaranteed compatibility, purchasable assembly

**Automatic Compatibility Expansion**:
The deterministic materialization of exact RFQ-Eligible Combinations from the
declared Hose Dash, Hose End Hose Tail Dash, Hose Series, Ferrule Series,
Ferrule Hose Tail Dash, Skive Requirement, and product lifecycle gates. It
carries system-rule provenance and never supplies crimp dimensions, programs,
pressure ratings, production qualification, or suitability certification.
_Avoid_: Manual compatibility entry, name matching, thread similarity, image
matching, Production-Approved Combination

**Derived Assembly Data**:
Versioned configurator combinations, ferrule mappings, and indexes generated
from current published products and explicit RFQ-Eligible Combinations. It
excludes customer-selected length, Clocking, Installed Protection, and pricing;
affected stale combinations are unavailable until refreshed.
_Avoid_: Customer configuration, inferred compatibility, finished-assembly SKU,
Production-Approved Combination

**Affected Assembly Series**:
The complete system-computed set of Hose Series affected by changes to the
existing Dash-based compatibility matching keys, component availability, or
explicit relationships. It includes both old and new dependencies and cannot
be reduced by an administrator.
_Avoid_: Manually selected regeneration scope, visibly edited series only,
unchecked partial update

**Assembly Component Combination**:
A stable ordered combination of one Hose Size Variant, End A Hose End and
Ferrule, and End B Hose End and Ferrule, generated from RFQ-Eligible Combinations
or explicitly maintained in Assembly Management. Reversing unlike ends changes
its identity; length, Clocking, protection, and price are not part of that identity.
_Avoid_: Assembly SKU, unordered end pair, customer configuration, Assembly Number

**Assembly Management**:
The Admin Backoffice workspace for inspecting ordered Assembly Component
Combinations, maintaining manual combinations and disable exclusions, and
updating Derived Assembly Data for Affected Assembly Series.
_Avoid_: Physical assembly tracking, Catalog Review, finished-assembly SKU editor

**Assembly Exclusion**:
A persistent, auditable disable rule attached to an Assembly Component
Combination's stable identity. Automatic regeneration preserves it until an
authorized enable action ends its effect.
_Avoid_: Physical deletion, generated-row identifier, production rejection

**Production-Approved Combination**:
An exact Hose Size Variant, hose-end SKU, ferrule, production method, final
crimp diameter, and working-pressure record approved for Hose Assembly
production.
_Avoid_: RFQ-Eligible Combination, same-size parts, assumed compatibility

**Clocking**:
The approved relative angular orientation between End A and End B when both
ends of a Hose Assembly use angled hose ends. It is measured while viewing
along the hose axis from End A toward End B, with the End B elbow held at the
6-o'clock position as `000 degrees`; the End A elbow angle is then measured
clockwise from that reference and recorded from `000` through `359` degrees.
_Avoid_: Bend angle, unspecified viewing direction, counter-clockwise angle,
fitting rotation, installer adjustment

**Clocking Tolerance**:
The permitted finished-assembly variation from an approved Clocking target.
The standard launch tolerance is `+/- 3 degrees`; a tighter requirement must be
handled as a Manual Assembly Quote Request and confirmed before PI issuance.
_Avoid_: Angle-input increment, unmeasured visual estimate, automatic tight
tolerance

**Finished Overall Assembly Length**:
The approved finished dimension of a Hose Assembly, measured between the
defined points for its selected hose-end constructions and including both hose
ends.
_Avoid_: Hose cut length, nominal hose length, unreferenced overall length

**Single-End Assembly Request**:
A Manual Assembly Quote Request for a hose with one factory-crimped hose end
and one open cut end. It is not a guided Hose Assembly configuration because
its measurement endpoint, contamination protection, and later field-assembly
responsibility require case-specific confirmation.
_Avoid_: Standard two-end assembly, bulk hose, automatically compatible field
completion

**Specified Length Unit**:
The feet-and-inches, decimal-inches, or millimetres unit in which the customer
states Finished Overall Assembly Length. The original value and unit remain the
authoritative customer requirement alongside its exact conversion. The
bilingual Production Instruction displays the original approved value and the
stored exact millimetre equivalent together, and applies the same dual-unit
presentation to Assembly Length Tolerance. The PDF never performs a separate
manual conversion or silently rounds either value.
_Avoid_: Display preference, silently rounded metric value, hose cut unit

**Assembly Length Tolerance**:
The permitted variation from the approved Finished Overall Assembly Length,
using the launch SAE J517 schedule and recorded with the customer specification.
It is separate from the length-input increment.
_Avoid_: Input precision, hose cut tolerance, unbounded approximate length

**Length Measurement Method**:
A versioned rule and diagram defining the measurement endpoint for each Hose
End form and how those endpoints establish Finished Overall Assembly Length.
The customer explicitly selects M01-M07 or `Not Sure`; the system does not
assign one method from the selected Hose Ends.
_Avoid_: Product photograph, hose cut formula, unversioned illustration,
automatically assigned method

**Live Assembly Preview**:
The code-rendered two-dimensional technical schematic that responds to the
current Hose, Hose Ends, protection, length, and Clocking selections. It aids
configuration understanding but is not to scale, a product photograph, a
manufacturing drawing, or the authority for the approved specification.
_Avoid_: AI-composited product image, launch 3D model, dimensional authority

**Length Feasibility Review Required**:
An internal advisory status used when the selected hose-end combination lacks a
verified Minimum Finished OAL and the requested Finished Overall Assembly
Length therefore cannot be validated automatically. It permits RFQ submission
but requires factory confirmation before PI issuance.
_Avoid_: Customer-facing error, automatic rejection, verified minimum length,
Production Approval

**Standard Export Packaging**:
The mandatory caps, individual bag, coil restraint, external transit
protection, and shipping carton used for a Hose Assembly shipped from China.
It is not a permanently installed hose guard.
_Avoid_: Hose protection option, bare shipment, retail packaging

**Cut-Length Hose Export Packaging**:
The mandatory preparation for every piece in a Length-Based Hose Order: both
open ends receive dust protection, the coil is restrained for export transit,
and a simple tie-on tag is secured to the coil with its exact SKU, Nominal Cut
Length, and batch identifier. The Shipment also receives a packing list. It is
a fulfillment requirement rather than a customer-selectable packaging option.
Cut-length hose uses batch-level traceability and does not receive an adhesive
product label, unique per-piece serial number, QR code, or Assembly Record.
_Avoid_: Bare cut ends, optional protection, packing-list-only identification,
adhesive label, Hose Assembly label

**Cut Hose Packing Pack**:
The website-generated factory document set for a Length-Based Hose Order. Its
Factory Packing Sheet may be generated before a batch identifier exists and
shows the batch as Pending. After an Owner or authorized Admin Subaccount enters
the factory-supplied batch identifier, the website regenerates the final tie-on
tag pages for each coil. Tags carry SKU, Nominal Cut Length, and batch identifier
but no customer data, unique serial number, or QR code. The document set is sent
to the factory through the existing external communication channel; Factory
Mobile does not collect or compose this data. It is not the Commercial Packing
List used for shipping or customs.
_Avoid_: Assembly Label Pack, handwritten tag, Commercial Packing List,
customer-facing invoice

**Commercial Packing List**:
An optional final Shipment document. The website may generate it when actual
carton count, gross weight, and carton dimensions are recorded in the Final
Packing Record, or Operations may upload an externally prepared version without
re-entering those values. Neither path is a `Ready to Ship` prerequisite. It is
separate from the pre-packing Factory Packing Sheet and tie-on tag pages.
_Avoid_: Shipment Packing Estimate, Factory Packing Sheet, draft carton data

**Customs Documentation Boundary**:
The launch boundary under which the website does not automatically generate a
customs Commercial Invoice, customs declaration, or declaration dataset. An
Owner or authorized Admin Subaccount verifies HS classification, declaration
description, country of origin, and customs value with the logistics provider
outside the website. The PI is not reused as the customs Commercial Invoice.
_Avoid_: Automatic declaration, PI-as-Commercial-Invoice, unverified HS code

**Shipment Document**:
An externally prepared logistics, customs, or transport file uploaded by an
Owner or authorized Admin Subaccount to one Shipment and stored in private R2.
Its visibility is `Internal` by default; only an explicit `Customer Shared`
setting makes the file downloadable from the related Order in the Personal
Center. Uploading a file does not mean the website generated or verified its
customs content.
_Avoid_: Public R2 object, automatic customer attachment, website declaration

**Assembly Record**:
The traceable record linked to one unique Hose Assembly number, including its
approved specification, components, crimp results, inspections, packaging, and
delivery evidence.
_Avoid_: Product page, generic batch record, customer reference

**Assembly Production Package**:
The single order-level factory package automatically created when a Confirmed
Order contains one or more made-to-order Hose Assembly lines. It contains each
line's approved Production Instruction and exact component SKUs, creates one
Assembly Record and Assembly Number per physical assembly, and generates the
Assembly Label Pack and Factory Batch Access QR/link. Owner/Admin reviews and
sends the generated link or PDF to the factory through external WeChat or
email; the website does not send a WeChat message and does not require a
separate `Release Production` action.
_Avoid_: Separate batch task, one package per Order line, automatically
delivered factory message, factory account, standard-product picking task

**Assembly Number**:
The unique identifier assigned to one produced Hose Assembly and linked to its
approved specification and Assembly Record.
_Avoid_: Saved Configuration number, RFQ number, customer equipment reference

**Public Assembly Verification**:
The limited, non-customer-identifying product and inspection status visible
without authentication when an Assembly label QR code is scanned. It resolves
one minimal per-assembly record needed for the unique QR, approved specification
reference, and Proof Test result/date, but does not create a browsable customer
assembly list or expose customer, Order, payment, factory-note, or process-photo
data. Its URL uses an opaque Assembly Verification Token rather than the
Assembly Number and is excluded from indexing and sitemaps. It reports the
factory record at the time of manufacture and does not claim to determine the
assembly's current condition, remaining life, or suitability for continued use.
_Avoid_: Customer portal list, Order detail, public inspection photo gallery,
generic product page, current-serviceability certificate

**Assembly Verification Token**:
A high-entropy random token encoded in one physical assembly's public QR URL.
The URL does not expose a sequential Assembly Number, and D1 stores a lookup
hash rather than the raw token. Public verification routes use generic
not-found responses and rate limiting to resist enumeration. This long-lived
read-only token is distinct from time-limited Factory Batch Access and grants
no factory or customer-account permissions.
_Avoid_: Assembly Number as URL key, Factory Batch Access, login credential,
searchable public identifier

**Assembly Label Pack**:
The website-generated, print-ready labels and identifier manifest that assign
one Assembly Number and QR code to each physical Hose Assembly in a Confirmed
Order. The final label uses English field labels and literal standard codes.
From the order-level Assembly Production Package, Owner/Admin may bulk export
one multi-page roll-label PDF containing all Assembly QR labels or only selected
Hose Assembly lines. Each PDF page is exactly one physical label under the
active Label Print Profile, and the export includes one label for every ordered
physical assembly, ordered by Order line and piece index. It is not an A4 grid
or a cut-apart sheet and is not used for raw or cut-length hose, which uses a
Cut Hose Packing Pack. Owner/Admin may reprint selected active labels with the
same Assembly Number and QR code. Reprint does not require a reason, maintain a
reprint counter, or create another Assembly Number. A failed or otherwise
invalidated Assembly Number remains ineligible for reuse; a physical replacement
receives a new number under the Replacement Assembly rules. The same durable
label remains with its physical assembly through production, Proof Test,
inspection, packaging, and delivery; no separate temporary work-in-process
label or final relabelling step is used. If the assembly fails, the label is
destroyed and its Assembly Number remains invalidated.
_Avoid_: Factory QR system, order label, cut-hose tie-on tag, configuration number list

**Label Print Profile**:
The Admin Backoffice configuration that defines physical roll-label width,
height, orientation, margins, and QR-code size for Assembly Label Pack PDF
generation. Launch requires one active profile based on the factory's actual
label printer and consumable dimensions; the dimensions are not hardcoded
before that equipment is confirmed.
_Avoid_: A4 label grid, browser scale-to-fit, fixed unverified label size,
printer-specific ZPL at launch

**Proof Test**:
The liquid-pressure test performed on every finished Hose Assembly at twice
the assembly maximum working pressure for its configured Proof Test Hold Time,
with no leakage or pressure drop. Factory Mobile and the bilingual Production
Instruction display both assembly working pressure and Proof Test target as a
system-generated `psi / MPa` pair. Calculations use the canonical unrounded
pressure value; display formatting never becomes the calculation input.
_Avoid_: Burst test, impulse qualification, visual inspection

**Factory Pressure Display**:
The paired `psi / MPa` rendering of Assembly Working Pressure and Proof Test
Target in Factory Mobile and the bilingual Production Instruction, for example
`5,800 psi / 40 MPa`. Both units come from one canonical pressure value and a
central conversion rule. Factory workers and document templates do not enter,
convert, or round the second unit manually.
_Avoid_: Independent PSI field, independent MPa field, hand conversion,
display-rounded test calculation

**Proof Test Hold Time**:
The backoffice-controlled number of seconds for which one Hose Assembly must
remain at its required proof-test pressure. The value is stored with the
assembly record and is shown to the factory operator as the required hold
duration. A global default applies unless an authorized backoffice user sets an
order-specific override; the resolved value is locked when the production
record is issued. The factory page does not run a countdown, disable either
photo-upload button, or enforce the interval between uploads.
_Avoid_: Fixed 60-second timer, worker-selected duration, enforced photo interval

**Failed Assembly Record**:
The immutable record of a physical Hose Assembly that did not pass its required
Proof Test or final inspection. The associated Assembly Number cannot be
reactivated, completed, relabelled onto another assembly, or approved for
shipment. The physical assembly is removed from conforming stock, the hose is
cut, and its Assembly label is destroyed under batch-level disposal
confirmation.
_Avoid_: Editable test result, reusable label, cancelled configuration

**Test Setup Exception**:
A Proof Test attempt that cannot determine assembly conformity because the test
bench, test connector, adapter, or other test setup leaked or malfunctioned.
The attempt remains in the Assembly Record, but the same Assembly Number may be
tested again after the setup is corrected.
_Avoid_: Assembly failure, deleted attempt, passed test

**Replacement Assembly**:
A newly produced physical Hose Assembly with a new Assembly Number, linked to
the Failed Assembly Record it replaces and required to complete its own
inspection and Proof Test record.
_Avoid_: Retest under failed number, overwritten record, duplicate label

**Type Qualification**:
Documented burst, impulse, and connection-integrity evidence establishing that
an exact component system meets its applicable SAE or EN performance
requirements before it becomes a Verified Component Combination.
_Avoid_: Proof Test, visual approval, third-party certification without a report

**Standard Internal Cleaning**:
The mandatory projectile cleaning, post-test drying, final cleanliness check,
and immediate capping performed on every Hose Assembly without claiming a
measured ISO 4406 class.
_Avoid_: ISO-certified cleanliness, visual exterior cleaning, optional service

**Loose Crimp Component**:
A factory-approved hose end or ferrule sold separately with its compatible
Hose Series, size, and customer crimp-data sheet for professional assembly.
_Avoid_: Adapter, field-installable fitting, finished Hose Assembly
