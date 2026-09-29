# Separate Reference, Cost, and Quoted Prices

The system stores public Reference Price, internal Cost Basis, and
Sales-confirmed Quoted Unit Price as distinct values. Standard Products display
`Reference Price`, while the configurator presents its calculated Reference
Price as `Estimated Price`. PI prices are taken from the immutable Quote
Revision rather than recalculated from the live catalogue. Cost is never
exposed to customers, and every manual price or discount change creates an
audit event without requiring a launch-stage approval workflow.

Configured assembly estimates use versioned formula inputs rather than a fixed
Installed Protection amount. Exact finished length is normalized to feet without
early rounding. Assembly service charges USD 0.50 per started foot. Protection
material charges use exact feet, while protection installation charges USD 1.00
per started foot. Nylon Protective Sleeving has a USD 8.00 base and USD 1.35 per
foot material rate; Plastic Spiral Guard has a USD 8.00 base and USD 1.00 per
foot material rate. Final customer-facing amounts are rounded to two decimals.
