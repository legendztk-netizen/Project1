# Delivery Specs

The project-level product and data model is defined by the
[top-level PRD](../prd/hydraulic-hose-rfq-platform.md). Each file in this
directory is a bounded Delivery Spec. A Spec becomes suitable for conversion
into implementation Tickets only when its status is `Ready`.

| Order | Spec                                                      | GitHub Issue                                                   | Status            | Depends on            |
| ----- | --------------------------------------------------------- | -------------------------------------------------------------- | ----------------- | --------------------- |
| 1     | Product Catalogue and Catalog Release                     | [#2](https://github.com/legendztk-netizen/Project1/issues/2)   | Ready             | -                     |
| 2     | Hose Assembly Configurator and Quote List                 | [#3](https://github.com/legendztk-netizen/Project1/issues/3)   | Ready             | #2 completed          |
| 3     | Customer Identity, Personal Center, and RFQ               | [#4](https://github.com/legendztk-netizen/Project1/issues/4)   | Blocked           | #2, #3                |
| 4A    | Quote Review, Quote Revision, and PI                      | [#5](https://github.com/legendztk-netizen/Project1/issues/5)   | In progress       | #4 completed          |
| 4B    | Manual Payment and Confirmed Order                        | [#6](https://github.com/legendztk-netizen/Project1/issues/6)   | Blocked           | #5                    |
| 5     | Production Package, Assembly QR, and Factory Mobile       | [#7](https://github.com/legendztk-netizen/Project1/issues/7)   | Blocked           | #3, #5, #6            |
| 6     | Shipment and Customer Order Progress                      | [#8](https://github.com/legendztk-netizen/Project1/issues/8)   | Blocked           | #6, #7                |
| 7     | After-sales, Return Inspection, and Refund                | [#9](https://github.com/legendztk-netizen/Project1/issues/9)   | Blocked           | #6, #8                |
| 8     | Product Data Maintenance and Derived Assembly Publication | [#64](https://github.com/legendztk-netizen/Project1/issues/64) | Ready             | #2, #3 completed      |
| 9     | Product Series, Variant, and Commercial Rule Maintenance  | [#75](https://github.com/legendztk-netizen/Project1/issues/75) | Completed         | #64 and #73 completed |
| 11    | Item-level Product Publication and Assembly Management    | [#81](https://github.com/legendztk-netizen/Project1/issues/81) | Completed (local) | #64 and #75 completed |

The `ready-for-agent` label means the Spec is ready for `to-tickets`; `blocked`
means the named prerequisites must complete first. The labels are mutually
exclusive and do not remove the dependency order shown above.

Spec 11 was accepted and closed for local scope on 2026-09-14; remote deployment requires separate go-live acceptance. Downstream constraints: [confirmed data contract](../reviews/2026-09-14-downstream-data-contract.md). Ticket #51 awaits the user's implementation instruction.
