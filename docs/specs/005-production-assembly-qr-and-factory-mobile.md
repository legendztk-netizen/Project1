# Spec 5: Production Package, Assembly QR, and Factory Mobile

> Status: Blocked. Prerequisites: Spec 2 / Issue #3, Spec 4A / Issue #5, and
> Spec 4B / Issue #6.

## Problem Statement

Custom Hose Assemblies are manufactured in China by workers who should not have
to interpret complex English records or re-enter technical specifications. The
seller still needs one approved production package, unique physical labels,
simple proof-test evidence, and a traceable record without turning the website
into a factory MES.

## Solution

Automatically create an order-level Assembly Production Package when a
Confirmed Order is created. Generate bilingual Production Instructions and
roll-label PDFs with one Assembly Number and QR code per physical assembly.
Provide a time-limited, concise Chinese Factory Mobile workflow for opening the
batch, scanning each label, viewing approved work, uploading evidence, and
recording simple results.

## User Stories

1. As an administrator, I want an Assembly Production Package created automatically from the accepted Order, so that I do not rebuild factory instructions manually.
2. As an administrator, I want one bilingual Production Instruction containing every assembly line and quantity, so that the factory receives one consistent work package.
3. As an administrator, I want one Assembly Number for every physical assembly, so that identical quantities remain individually traceable.
4. As an administrator, I want to bulk-export selected or all Assembly QR labels, so that multiple assembly types and quantities can be printed efficiently.
5. As an administrator, I want labels formatted for the actual roll-label printer, so that they can be attached directly to finished assemblies.
6. As an administrator, I want to reprint active labels without creating new identifiers, so that damaged print output can be replaced simply.
7. As a factory worker, I want one QR link that opens all tasks in the assigned package, so that I do not need an Admin account.
8. As a factory worker, I want to scan an assembly label and immediately see the correct Assembly Number and work details, so that I do not type identifiers.
9. As a factory worker, I want both proof-test photo controls available without a countdown, so that I can upload the start and finish evidence in the real work order.
10. As a factory worker, I want to select a simple test result and upload a final-product photograph, so that the required record can be completed with minimal text.
11. As an administrator, I want failed and replacement assemblies to retain separate histories, so that a failed identifier can never appear valid later.
12. As a customer scanning a delivered label, I want limited assembly verification, so that I can confirm the approved product without seeing another customer's or the factory's private data.
13. As a customer, I want my Order page to stay simple, so that internal per-piece factory records do not overwhelm the purchase view.

## Implementation Decisions

- Creation of a Confirmed Order automatically creates one order-level Assembly
  Production Package for all configured Hose Assembly lines. Standard Product
  picking is not represented as a Hose Assembly production task.
- The package snapshots accepted Hose, End A/B, resolved Ferrules, Finished
  Overall Assembly Length, original/converted units, tolerance, Length
  Measurement Method and diagram version, Clocking, protection, Application
  Requirements, working pressure, Proof Test target, quantities, and commercial
  source identifiers needed for traceability.
- Every physical assembly receives a unique Assembly Number, Assembly Record,
  high-entropy Assembly Verification Token, and durable Assembly label. Quantity
  five therefore creates five records and five labels even when specifications
  are identical.
- Production Instruction is one printable bilingual Chinese/English document.
  Technical codes and values appear once. It does not require factory narrative
  writing, actual carton dimensions, gross weight, or a production batch number
  before generation.
- Proof Test Target is deterministically calculated from the approved canonical
  Assembly Working Pressure under the accepted rule. Displayed bilingual values
  come from one canonical value rather than manual duplicate entry.
- `Bulk Export Assembly QR Labels` supports the whole Order or selected assembly
  lines and orders output by line and piece index. Output is a multi-page
  roll-label PDF with one label per page, not an A4 grid.
- Label dimensions, orientation, margin, and QR size come from one active Label
  Print Profile based on the actual printer and consumable. Browser scale-to-fit
  is not an accepted production layout.
- `Reprint Assembly QR Labels` retains the same active Assembly Numbers and QR
  tokens. No reason or reprint count is required.
- Admin downloads or shares the generated package externally by WeChat or email.
  Launch has no WeChat sending API and no separate `Mark Sent to Factory` action.
- Factory Batch Access is a time-limited authorization to the minimal Factory
  Mobile surface. One batch link opens the package task list; scanning a physical
  Assembly label resolves the individual task without text entry.
- Factory Mobile is concise Simplified Chinese. It presents direct selections,
  specification values, scan, and photo controls rather than management menus or
  long free-text forms.
- Proof testing has two independent photo upload controls available throughout
  the task. There is no countdown, enforced waiting period, disabled finish
  button, or automated trust judgement. The worker records the result and a
  final-product photograph.
- Factory activity updates internal production evidence only. It never exposes
  intermediate progress to customers or advances customer-facing Order status.
  Owner/Admin later decides when a Shipment is Ready to Ship.
- A failed Assembly Number is permanently invalidated. Its label is destroyed,
  the physical hose is removed from conforming stock and cut, and a replacement
  receives a new Assembly Number and label. Original evidence remains immutable.
- Public Assembly Verification returns only the approved specification,
  non-customer-identifying verification status, and permitted traceability data.
  It excludes customer identity, Order number, price, payment, private images,
  internal measurements, and Admin notes.
- Personal Center Order detail shows line-level product and quantity information,
  not a list of every Assembly Record. A customer reaches a specific public
  record by scanning its physical label.

## Testing Decisions

- The primary seam starts with one Confirmed Order containing multiple assembly
  lines and quantities, then verifies package generation, label export, Factory
  Batch Access, individual scan/evidence completion, and the resulting public QR
  projection.
- PDF tests verify bilingual required fields and one correctly sized roll-label
  page per Assembly Number using semantic and rendered-page inspection.
- Authorization tests cover expired or wrong batch links, cross-package token
  access, public-token enumeration resistance, Admin-only exports, and private
  R2 evidence access.
- Idempotency tests prove repeated Order initialization, document jobs, scans,
  and form submission do not duplicate Assembly Numbers or records.
- Failure tests prove invalidated numbers cannot be reactivated or relabelled and
  that replacement records preserve the failed history.
- Mobile Playwright tests use a WeChat-sized viewport and verify that the worker
  can complete the task without narrative text or overlapping controls.

## Out of Scope

- Factory MES, staff accounts, labor tracking, machine integration, or automatic
  crimper/test-bench data capture.
- WeChat API messaging or factory-entered customer/order status.
- Countdown enforcement or automated fraud detection from photographs.
- A4 assembly-label grids or mandatory packaging measurements.
- Customer access to private per-assembly production evidence.

## Further Notes

## Downstream Data Contract (confirmed 2026-09-14)

- Spec 11 supersedes whole-catalog publication for new maintenance. Read current products through the item-aware repository; preserve legacy Catalog Release resolution for old snapshots.
- Freeze the actual SKU and inherited series revisions, resolved attributes, sales unit, quantity/length basis, image versions, source amounts and currencies, assembly generation and applicable service/protection rule versions, or equivalent complete immutable evidence. Never resolve historical business records solely from today's SKU.
- Unsubmitted configurations and Quote Lists revalidate current availability and assembly readiness. Catalog changes do not rewrite submitted RFQs, issued Quotes/PIs, Orders or production records.
- Formal Quote Revisions and PIs use USD in version one. Preserve original reference amounts/currencies separately. Admin explicitly enters final USD prices and commercial charges; no automatic conversion, exchange-rate service, cross-currency sum or relabeling of source amounts as USD.
- Non-USD or mixed reference amounts require manual commercial confirmation of final USD pricing and applicable import terms before formal issuance. Incomplete review blocks issuance, not submission of a valid manual RFQ.
- Product publication's last-successful-write rule does not apply to Quote Preparation Drafts: retain explicit concurrency/version checks.
- Public catalog media and private review evidence have separate authorization. Cost Basis, tax evidence and internal notes remain private.

Production acceptance: create the package from the accepted Order snapshot, including ordered End A/B and ferrules, finished length, customer measurement choice, Clocking and protection. A catalog combination identifier is not a physical Assembly Number. Later catalog disablement does not rewrite or automatically cancel an accepted Order; manufacturing feasibility remains the established manual process. Test historical image/parameter retention and one identifier per physical assembly.

This Spec depends on Specs 2, 4A, and 4B. Shipment readiness remains an explicit
Admin action in Spec 6.

- Project PRD: https://github.com/legendztk-netizen/Project1/issues/1
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/7
- Blocked by: https://github.com/legendztk-netizen/Project1/issues/3, https://github.com/legendztk-netizen/Project1/issues/5, and https://github.com/legendztk-netizen/Project1/issues/6
