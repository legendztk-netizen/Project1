# Use D1 as the Catalog Source of Truth

The approved 01-07 Excel workbook is used for initial and later bulk imports and
exports, while D1 is the sole runtime source of Catalog Master Data. Imports are
validated, previewed, and published atomically as Catalog Releases. Historical
RFQ and PI lines retain immutable snapshots and are not rewritten by later
catalogue changes.
