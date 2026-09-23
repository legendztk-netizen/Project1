# Delivery Specs

The project-level product and data model is defined by the
[top-level PRD](../prd/hydraulic-hose-rfq-platform.md). Each file in this
directory is a bounded Delivery Spec. A Spec becomes suitable for conversion
into implementation Tickets only when its status is `Ready`.

| Order | Spec                                                      | GitHub Issue                                                   | Status            | Depends on            |
| ----- | --------------------------------------------------------- | -------------------------------------------------------------- | ----------------- | --------------------- |
| 1     | Product Catalogue and Catalog Release                     | [#2](https://github.com/legendztk-netizen/Project1/issues/2)   | Completed         | -                     |
| 2     | Hose Assembly Configurator and Quote List                 | [#3](https://github.com/legendztk-netizen/Project1/issues/3)   | Completed         | #2 completed          |
| 3     | Customer Identity, Personal Center, and RFQ               | [#4](https://github.com/legendztk-netizen/Project1/issues/4)   | Completed         | #2, #3 completed      |
| 4A    | Quote Review, Quote Revision, and PI                      | [#5](https://github.com/legendztk-netizen/Project1/issues/5)   | Completed         | #4 completed          |
| 4B    | Manual Payment and Confirmed Order                        | [#6](https://github.com/legendztk-netizen/Project1/issues/6)   | Completed         | #5 completed          |
| 5     | Production Package, Assembly QR, and Factory Mobile       | [#7](https://github.com/legendztk-netizen/Project1/issues/7)   | Deferred          | #3, #5, #6 completed  |
| 6     | Shipment and Customer Order Progress                      | [#8](https://github.com/legendztk-netizen/Project1/issues/8)   | Tickets published | #6 completed          |
| 7     | After-sales, Return Inspection, and Refund                | [#9](https://github.com/legendztk-netizen/Project1/issues/9)   | Blocked           | #6 completed; #8      |
| 8     | Product Data Maintenance and Derived Assembly Publication | [#64](https://github.com/legendztk-netizen/Project1/issues/64) | Completed         | #2, #3 completed      |
| 9     | Product Series, Variant, and Commercial Rule Maintenance  | [#75](https://github.com/legendztk-netizen/Project1/issues/75) | Completed         | #64 and #73 completed |
| 11    | Item-level Product Publication and Assembly Management    | [#81](https://github.com/legendztk-netizen/Project1/issues/81) | Completed (local) | #64 and #75 completed |

The `ready-for-agent` label means the Spec is ready for `to-tickets`; `blocked`
means the named prerequisites must complete first. The labels are mutually
exclusive and do not remove the dependency order shown above. `deferred` means
an intentionally later release, not unfinished prerequisites or completed work.

Completed statuses reflect implementation/acceptance and closed GitHub Issues,
not a claim that production deployment has occurred. Spec 11 was accepted for
local scope on 2026-09-14. Downstream constraints remain in the
[confirmed data contract](../reviews/2026-09-14-downstream-data-contract.md).

## First-release Fulfillment Scope

The 2026-09-23 decision in
[ADR-0051](../adr/0051-defer-factory-workflow-from-first-release.md) keeps
production and required inspection offline. The next first-release sequence is
completed **Spec 4B -> Spec 6 -> Spec 7**. Spec 5 remains open and deferred;
missing production packages or QR records do not block shipment or after-sales.
Its later activation must explicitly handle old Orders without inventing history.

Spec 6 has an [approved English ticket record](../tickets/spec-006-ticket-review.md)
with six published child issues (#94-#99). Ticket publication is separate from
implementation and does not imply deployment.
