# Use one-piece crimp fittings paired by Fitting Line

User decision, 2026-10-14. Supersedes the ferrule parts of ADR 0031 and ADR 0032.

Every crimp Hose End is a one-piece fitting whose ferrule is already attached at
the factory, as on the US market and at Hydraulax, our benchmark retailer. R4
suction hose follows the same rule. New Assembly Component Combinations are
therefore a Hose Size Variant plus two Hose Ends; the ferrule slot of an
endpoint and of a combination identity is `null`. Combinations and quotes that
already carry ferrule SKUs keep them as history, and ferrule SKUs are archived
rather than deleted.

Each Hose End carries a Fitting Line: `B` braided, `W` bite-the-wire, `JJ`
six-wire skive, `SS` stainless braided or `SSW` stainless bite-the-wire. `SS`
pairs like `B` and `SSW` like `W`. Each Hose Size Variant lists the Fitting
Lines it accepts and, per line, a reference crimp diameter. Automatic
Compatibility Expansion pairs a Hose End with a Hose Size Variant when the Hose
End's line is accepted and its hose tail dash equals the hose dash. The accepted
lines per size copy Hydraulax's assembly builder. Applied to the Hydraulax
fittings in scope, this rule adds 7 pairs and drops 3 of Hydraulax's 3,568 pairs,
all of them omissions or typos on their pages. Hose Ends without a Fitting Line
keep the earlier ferrule matching, so legacy data still regenerates the way it
did.

Customers do not know Fitting Lines, so the storefront tells them how to
choose by hose. Every Fitting Line and length of one shape is its own catalog
family, named by how it is crimped: `W` and `SSW` ends read _Bite-the-Wire_,
`JJ` ends _Skive_, stainless ends start with _Stainless_. A family title ends
with every hose its sizes fit under the pairing rule, by the short name printed
on the hose (`… Hose End for R1, R2, R4, R16, R17 Hose`), and each size lists
its own hoses with their standards. Hoses are named by standard as at Hydraulax,
`SAE 100R2AT Hydraulic Hose (R2)`, not by our series code.

The factory is Hydraulax's supplier, so Hydraulax's published sizes, threads and
Uniflex crimp diameters are accepted as ours; crimp diameters stay reference
values until a Production-Approved Combination exists. The factory part number
is our SKU, and Hose End pressure, dimensions, weight, coating and salt-spray
time are optional until orders justify asking the factory.

Keeping separate ferrule SKUs was rejected: one-piece fittings have no loose
ferrule, US buyers do not expect to buy one, and the configurator never showed
ferrules to customers anyway. Storing an explicit pair table imported from
Hydraulax was rejected because the line rule reproduces it and every new fitting
would otherwise need hand-entered pair rows.
