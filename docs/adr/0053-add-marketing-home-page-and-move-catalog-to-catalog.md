# Add a marketing home page and move catalog browsing to /catalog

User decision, 2026-09-30. Supersedes the "no marketing-only landing screen"
part of ADR 0031. Build a Hose remains the primary product action.

`/` is a marketing home page on `customhoseco.com`: a hero with Build a Hose
and product search, product entry points (Hydraulic Hose, Hose Ends, other
fittings), how the RFQ-to-PI flow works, the hose series, the factory and its
testing equipment, a pressure-test video, applications, and a closing call to
action. Its first viewport still offers direct configurator access and product
search, so the intent of ADR 0031 is preserved.

Catalog browsing and search move from `/` to `/catalog`. `/?q=...` redirects to
`/catalog?q=...`. Category and family routes are unchanged. The storefront
header on the home page and `/catalog` floats (sticky). Other storefront pages
keep a static header because their sticky panels assume a top offset of zero.
A shared footer (navigation and brand introduction) appears on both pages.

Home page facts about the factory (floor area, export reach, test equipment)
come from the manufacturer brochure and must be re-confirmed before launch.
Imagery that is not brand-neutral AI output is placeholder until regenerated.
