# Retain Original Reference Price Currencies

Spec 11 permits each SKU revision to carry a Reference Price in a supported
original currency, replacing the USD-only product-maintenance restriction.
Customer lists and RFQ snapshots retain amount and currency together, with
subtotals grouped by currency and no automatic foreign-exchange conversion.

Mixed-currency assembly estimates and USD threshold decisions that cannot be
resolved from the available currency amounts use manual pricing or commercial
confirmation, without fabricating a numeric total or silently treating a
threshold as passed or failed. Existing USD service schedules and immutable
Quote Revision and PI prices retain their own currency and meaning under ADR 0020.
