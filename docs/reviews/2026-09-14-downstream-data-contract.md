# Spec 11 closure and downstream constraints

Confirmed 2026-09-14. Spec 11 and tickets #82-#86 are accepted for local scope.
Remote preview/production deployment remains separate go-live acceptance.

## Downstream Data Contract (confirmed 2026-09-14)

- Spec 11 supersedes whole-catalog publication for new maintenance. Read current products through the item-aware repository; preserve legacy Catalog Release resolution for old snapshots.
- Freeze the actual SKU and inherited series revisions, resolved attributes, sales unit, quantity/length basis, image versions, source amounts and currencies, assembly generation and applicable service/protection rule versions, or equivalent complete immutable evidence. Never resolve historical business records solely from today's SKU.
- Unsubmitted configurations and Quote Lists revalidate current availability and assembly readiness. Catalog changes do not rewrite submitted RFQs, issued Quotes/PIs, Orders or production records.
- Formal Quote Revisions and PIs use USD in version one. Preserve original reference amounts/currencies separately. Admin explicitly enters final USD prices and commercial charges; no automatic conversion, exchange-rate service, cross-currency sum or relabeling of source amounts as USD.
- Non-USD or mixed reference amounts require manual commercial confirmation of final USD pricing and applicable import terms before formal issuance. Incomplete review blocks issuance, not submission of a valid manual RFQ.
- Product publication's last-successful-write rule does not apply to Quote Preparation Drafts: retain explicit concurrency/version checks.
- Public catalog media and private review evidence have separate authorization. Cost Basis, tax evidence and internal notes remain private.

Local Specs 4A, 4B, 5, 6 and 7 and GitHub #5-#9/#51-#63 carry these constraints.
Ticket #51 remains unimplemented pending the user's explicit instruction.
Spec 10 was not found in the local specs or GitHub issue inventory and is not asserted reviewed.

Verification: prior Spec 11 logs inspected including failed-test reruns; current
cutover/currency regression 2 files / 9 tests passed; local schema 62 ready.
