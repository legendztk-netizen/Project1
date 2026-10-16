# Derive Adapter End Threads from a Reference Chart

User decision, 2026-10-16. Narrows ADR 0019 for one piece of reference data.

Adapter SKUs store each end's interface and Dash size but no thread, while
customers choose Adapter sizes by thread. The storefront therefore derives each
Adapter End Thread from the end's interface and Dash size with a chart kept in
code, copied from the Hydraulax "Fluid Port and Connector Thread Sizes" chart
(master catalog p.158) and written the way Hose End threads are stored, such as
`7/16-20 UNF` or `1-11.5 NPTF`. The derived thread appears in the size picker,
the Technical specifications and the Dash to thread reference of an Adapter
page, and Quote Line Snapshots capture it like any other specification.

The chart describes the connection standards rather than individual products,
so it is not Catalog Master Data and does not pass through Excel import or
Catalog Review. D1 remains the source of every Adapter's interfaces and Dash
sizes. A Dash size missing from the chart shows its nominal size, Dash divided
by 16 inches as in the chart's Nominal Size column, and never a guessed thread.

Storing a thread per Adapter end in D1 was rejected for now: it would change the
import template and require 272 hand-entered values for the 136 launch Adapters,
all of which would have to agree with the same chart.
