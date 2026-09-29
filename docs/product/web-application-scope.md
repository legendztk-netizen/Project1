# Web Application Scope

## Cloudflare Deployment

- The customer storefront, Personal Center, Admin Backoffice, Factory Mobile
  workflow, APIs, and webhooks are deployed on Cloudflare Workers.
- Cloudflare D1 is the system-of-record relational database for identities,
  organizations, catalogue metadata, configurations, RFQs, PIs, Orders,
  Assembly Records, conversations, message metadata, and audit events.
- Cloudflare R2 remains private and stores product media, customer uploads, PI
  documents, production photographs, email attachments, and other binary
  artifacts. D1 stores object keys and metadata rather than binary files.
- Authorized uploads and downloads use Worker authorization or short-lived R2
  signed URLs; R2 buckets containing customer or commercial records are never
  configured as public buckets.
- Cloudflare Queues handles asynchronous email sending, inbound-email parsing,
  attachment processing, document generation, and retryable notifications. A
  dead-letter queue retains repeatedly failed jobs for Admin Backoffice review.
- Cloudflare Email Routing and an Email Worker receive customer replies on a
  dedicated reply subdomain. Resend sends transactional messages, including
  email verification, quote, PI, payment, and order notifications.
- Email sending and receiving remain behind application adapters so either
  service can be changed without rewriting Quote Conversation records.
- Third-party Pre-Quote Support Chat also remains behind a storefront adapter.
  The preferred launch provider is tawk.to, subject to successful registration
  and real-network validation from China; Chatwoot Cloud is the fallback. Live
  chat is not stored as the authoritative Quote Conversation in D1.

## Launch Surfaces

- **Customer Storefront:** catalogue, search and filters, Hose Assembly
  configurator, Quote List, quote request submission, and public Assembly
  verification, with contextual access to Pre-Quote Support Chat.
- **Personal Center:** Overview, Saved Configurations, My Quotes, Orders,
  Addresses, and Profile / Company. RFQs and PIs appear together under My
  Quotes; Orders contains only payment-confirmed formal orders and does not
  provide a My Assemblies list.
- **Admin Backoffice:** catalogue and compatibility data, Reference Prices,
  customers and organizations, RFQ review, PI issuance, payment confirmation,
  orders, production packages, shipping, and record review.
- **Factory Mobile:** a minimal Chinese WeChat-browser workflow for scanning an
  assigned assembly, viewing approved specifications, uploading Proof Test
  photographs, selecting a test result, and uploading the final product
  photograph. It uses short Chinese labels, direct selections, and photo
  controls rather than narrative text entry. It is not a factory MES,
  order-management system, or customer-status control surface.

## Launch Languages

- Customer Storefront, Personal Center, Public Assembly Verification,
  transactional customer email, and customer-facing generated documents use
  English at launch. Factory Mobile uses concise Simplified Chinese. Admin
  Backoffice uses Simplified Chinese while preserving literal SKUs, connection
  standards, and commercial abbreviations.
- The printable factory Production Instruction uses paired Simplified-Chinese
  and English field labels in one document. Technical identifiers, SKUs,
  interface standards, dimensions, units, and approved values appear once and
  are not translated into alternate codes. The final Assembly QR label uses
  English field labels and literal standard codes for the North American
  recipient.
- Launch does not provide a customer, factory, or Admin Backoffice language
  switcher. Product identifiers and standards are not translated into alternate
  codes.
- In Admin Backoffice, mouse hover and keyboard focus on the following terms
  opens a short plain-Chinese tooltip from one shared glossary:
  `SKU`: `商品或零件的唯一编号`; `JIC`: `美制 37 度扩口液压接口`;
  `NPT`: `美制锥管螺纹接口`; `RFQ`: `客户提交的询价需求`;
  `PI`: `形式发票，列明已确认的产品和交易条款`.
- The tooltip supplements rather than replaces the literal term. It does not
  add explanatory paragraphs to ordinary factory or customer screens.
- The launch Seller of Record is `Hangzhou Rongyao Trading Co., Ltd.`. Quotes,
  PIs, Payment Instructions, Confirmed Orders, and refund records use this exact
  English seller name. No unconfirmed Chinese legal name is generated or shown.
- Storefront brand name, logo, primary domain, and customer-email presentation
  are configurable independently from the Seller of Record. Development uses
  `Rongyao Hydraulics` only as a visible placeholder. Production deployment is
  blocked until Owner records an approved final brand and domain and confirms
  completion of a trademark-conflict review.
- The final Storefront Brand may appear in customer navigation, product pages,
  email styling, and support presentation, but it never replaces `Hangzhou
Rongyao Trading Co., Ltd.` in Quotes, PIs, Payment Instructions, Confirmed
  Orders, or refund records.
- Admin Backoffice provides one English-formatted China `Seller Registered
Address` setting. It may remain empty during development and catalogue setup,
  but the PI issuance action is disabled until the address is present. Quotes,
  PIs, Payment Instructions, Confirmed Orders, and refund documents snapshot the
  configured seller identity used for that transaction.
- The Plano Return Location is identified only in authorized return instructions
  as a return service address. It is not presented as the Seller of Record's US
  legal address, a fallback seller address, a US warehouse, a retail location,
  or a customer pickup point.
- Customer Storefront, Personal Center, transactional email, PI, and other
  customer-facing documents display date-only values with an English month
  name, for example `Aug 19, 2026`. Factory Mobile, Admin Backoffice, and the
  bilingual Production Instruction use ISO order, for example `2026-08-19`.
  Launch never displays an ambiguous short numeric date such as `08/09/26`.
- These are presentation rules only. Audit records remain UTC, stored dates keep
  their canonical values, and any deadline with a time component displays its
  explicit time zone under the existing deadline rules.
- Customer-facing PI deadlines, Personal Center deadlines, and corresponding
  email use `America/New_York` and display `ET`. The implementation relies on
  the IANA time-zone database so daylight-saving transitions are handled
  automatically; it does not hardcode `EST` or `EDT` year-round.
- For Payment Due Date, Return Inspection Deadline, and Refund Initiation
  Deadline, the triggering event's ET date is day 0. The next eligible day in
  the US Business Calendar is day 1, and the deadline expires at `11:59 PM ET`
  on the final counted business day.
- Admin Backoffice and Factory Mobile display timestamps in `Asia/Shanghai` as
  Beijing Time. Audit events and canonical deadline instants remain UTC. A
  custom PI validity deadline is entered in Beijing Time and previewed in
  customer ET before issuance. A custom Payment Due Date is selected as an ET
  calendar date, fixed at `11:59 PM ET` on that date, and shown with the exact
  corresponding Beijing Time instant in Admin Backoffice.

## Storefront Information Architecture

- Launch prioritizes qualified traffic, configurator engagement, and completed
  RFQ submissions rather than online checkout. Storefront calls to action use
  `Add to Quote`, and `Build a Hose` remains the primary differentiated journey.
- The Hose Assembly configurator uses a technology-forward industrial interface:
  stable step navigation, immediate compatibility feedback, clear dimensional
  diagrams, and a Live Assembly Preview that responds to customer selections.
  Visual polish must not obscure standards, sizes, pressure limits, warnings,
  or the final review data.
- Motion is limited to purposeful state transitions and preview updates. The
  experience must remain fast on mobile and search-accessible; heavy decorative
  effects, forced intro animation, and science-fiction styling are not launch
  requirements.
- Primary product navigation contains `Build a Hose`, `Hydraulic Hose`, `Hose
Fittings`, `Adapters`, and `Quick Couplings`.
- Crimp ferrules appear under `Hose Fittings > Crimp Ferrules` rather than as a
  top-level retail category.
- A standalone Crimp Ferrule Product Detail page presents Ferrule Series, Hose
  Construction, Hose Tail Dash, material, and coating and may be added to the
  Quote List as a Standard Product. It does not describe a ferrule as universal
  or interchangeable outside its stated system.
- `Build a Hose` is a prominent primary workflow, not a secondary contact form.
- The first storefront viewport provides product search and direct access to
  `Build a Hose`; launch does not use a marketing-only landing screen.
- Search indexes SKU, product name and aliases, SAE and EN standards, interface
  families including JIC, NPT, ORFS, and BSP, dash size, angle, and working
  pressure. Search and category filters use Catalog Master Data.
- Browsing and SEO use Catalog Product Family pages rather than one thin page
  for every size SKU. Hose Dash, connection and hose-tail Dash, adapter size
  pairs, coupling Body Dash, Port Dash, and comparable dimensions are selected
  as exact SKU Variants within the applicable family.
- A SKU search or operator-supplied canonical link opens the correct family page
  with the exact SKU Variant preselected. The active variant's name, SKU,
  dimensions, price, and availability replace the family defaults; Quote List,
  PI, and fulfillment records always retain that exact SKU. The Catalog Product
  Family itself cannot be added to a Quote List.
- Quick Coupling Product Detail pages retain the customer action `Add to Quote`.
  A missing nonessential technical attribute does not rename or disable this
  action. The page renders only resolved attributes and omits unavailable rows;
  it never displays invented values, empty labels, or a claim that RFQ
  eligibility is production approval.
- Every Product Detail page shows a concise Product Return Eligibility
  Disclosure near `Add to Quote` with a link to the complete return policy.
  Eligible ordinary Standard Products display `Unused items: request return
within 14 days; 10% restocking fee applies.`
- A Length-Based Hose Order displays `Made to order; no convenience returns
after cutting.` A configured Hose Assembly displays `Made to order; no
convenience returns after production approval.` The website does not use a
  universal `Free returns` claim.
- Product Detail and `Add to Quote` do not require a return-policy checkbox. The
  disclosure remains visible without adding an early acceptance record or
  blocking Quote List preparation.
- Search engines receive the family page as the canonical indexable Product
  Detail URL. Variant state may be represented in a stable query parameter or
  fragment for customer navigation without creating hundreds of near-duplicate
  indexable pages.

## Standard Hose Length Ordering

- The 61 `Hose Variant` rows in worksheet 07 use the `Length x Pieces` quantity
  input mode. The remaining 454 launch sales SKUs use `Units`.
- A selected Hose Size Variant accepts `Length per piece (ft)` and `Number of
pieces`. Both are positive whole numbers at launch; the minimum piece length
  and length increment are each 1 foot.
- `Length per piece` is the Nominal Cut Length and the minimum acceptable
  delivered length. A supplied piece must not be shorter. A small production
  overage may be included without charge, while the Quote, PI, billing, and
  piece label continue to use the customer-requested nominal length.
- Launch does not publish a fixed positive cut-length tolerance until actual
  factory capability is verified. The absence of a published positive
  tolerance never permits a short piece.
- The Product Detail page offers 25, 50, and 100 feet as shortcut buttons. These
  values populate Length per piece and do not create fixed-length SKUs.
- On initial page load, no shortcut or default length is selected. Length per
  piece and Number of pieces are both explicitly required; `Add to Quote`
  becomes available only after both values pass validation. Choosing a shortcut
  fills the length field but does not silently choose or change piece count.
- The interface always shows the calculation in piece terms, for example
  `50 ft x 2 pieces = 100 total ft`. The Quote List line retains all three
  values rather than reducing the request to total footage alone.
- Repeated additions with the same exact Hose Size Variant SKU and Nominal Cut
  Length merge into one unsubmitted Quote List line by increasing Number of
  Pieces. For example, adding `50 ft x 2 pieces` twice produces `50 ft x 4
pieces`; Total Hose Footage, merchandise estimate, and Cutting & Labeling Fee
  are recalculated from the merged quantity.
- The same SKU at different Nominal Cut Lengths never merges. Each requested
  length remains an independent Quote List, RFQ, Quote, PI, and fulfillment
  line. Merge behavior never rewrites a submitted RFQ or later commercial
  record.
- Length per piece and Number of pieces are exact requested specifications. A
  quoted `50 ft x 2 pieces` line is fulfilled as two 50-foot pieces; the seller
  does not silently replace it with one 100-foot piece or another split. Any
  proposed split or consolidation requires a replacement Quote and PI accepted
  by the customer before fulfillment.
- The estimated merchandise amount equals the active per-foot Reference Price
  multiplied by Total Hose Footage calculated from Nominal Cut Length. Any
  unrequested production overage is excluded from Total Hose Footage and is not
  billed. Piece count does not create an automatic quantity discount or a
  separate price tier.
- A configurable `Cutting & Labeling Fee` may apply to every requested piece.
  The application resolves a Hose Series override first and otherwise uses the
  global USD per-piece rate; the launch default is USD 0. This is commercial
  configuration and is not duplicated across the 61 Hose Variant spreadsheet
  rows.
- When the resolved rate is greater than zero, the Product Detail estimate and
  Quote List show `Cutting & Labeling Fee` separately from hose merchandise.
  RFQ submission snapshots the rate, piece count, and calculated amount. The
  formal Quote and PI continue to show it as a separate customer-visible charge
  rather than hiding it in freight or the per-foot hose price.
- Maximum continuous length is not claimed from launch master data. Every
  Length-Based Hose Order carries `Quote Review`; Sales confirms the requested
  piece length, exact piece count, price, and production availability in the
  Quote and PI.
- Every supplied cut-length piece receives dust protection at both open ends,
  coil restraint suitable for export transit, and a simple tie-on tag secured
  with a cable tie. The tag contains the exact SKU, Nominal Cut Length, and
  batch identifier. The Shipment also receives a packing list. This is mandatory
  Cut-Length Hose Export Packaging, not a customer-selectable option.
- The website may generate the Cut Hose Packing Pack's Factory Packing Sheet
  before a batch identifier is known; the sheet shows batch status as `Pending`
  and does not block factory preparation. It contains the order's SKU, Nominal
  Cut Length, Number of Pieces, and packaging instructions.
- After the batch identifier is recorded, the website regenerates the final
  tie-on tag pages in the required quantity. Factory staff print the pages and
  secure one tag to each coil; they do not manually compose tag text. Final tag
  printing, rather than initial Packing Sheet generation, requires the batch
  identifier.
- The factory supplies its production batch identifier through the existing
  operating communication channel. An Owner or authorized Admin Subaccount
  records it in the Admin Backoffice and regenerates the final tag pages, then
  sends the file to the factory by the existing WeChat or email process. Launch
  does not add batch entry, document layout, or tag generation to Factory Mobile.
- Cut-length hose is traceable by production batch rather than individual
  physical identity. Launch does not generate a unique serial number, QR code,
  adhesive product label, public verification page, or Assembly Record for each
  cut piece. Those controls remain exclusive to factory-built Hose Assemblies
  that undergo the assembly inspection and Proof Test workflow.
- The Product Detail page may summarize this as `Ends protected and each coil
individually identified`. Detailed factory handling instructions remain in
  fulfillment records rather than filling the storefront with packing rules.

## Storefront Price Presentation

- Standard Product listing and detail pages display the public USD `Reference
Price` when one is available.
- Launch displays one Reference Unit Price per selected SKU Variant and does not
  publish or calculate automatic quantity-tier pricing.
- The Hose Assembly configurator displays its calculated Reference Price under
  the customer-facing label `Estimated Price`. It does not display a misleading
  `Starting at` price or expose the component-level calculation.
- Both presentations state that final product pricing, freight, applicable
  duties and taxes, trade terms, and delivery timing are confirmed in the
  formal quote. The storefront does not present either amount as an online
  checkout price.
- Internal Cost Basis is never exposed through customer-facing pages, APIs,
  documents, or page source.

## Storefront Supply Availability

- The storefront does not display `In Stock`, remaining units, warehouse counts,
  or other real-time inventory claims because launch has no live factory or
  warehouse inventory integration.
- A Published, Eligible SKU whose Supply Availability is `Available for Quote`
  may use `Add to Quote`. This label means the seller currently accepts an RFQ;
  it does not promise stock on hand or immediate dispatch.
- Standard Products display the reference `Estimated processing time: 10
business days`, while the page and Quote List state that the concrete schedule
  is confirmed in the formal quote and PI.
- `Temporarily Unavailable` retains the published Product Detail page and exact
  SKU information but disables `Add to Quote`. `Discontinued` also blocks new
  Quote use while preserving historical references and any intentionally
  retained product page.
- Every imported SKU begins `Temporarily Unavailable`. Catalog users update
  Supply Availability manually at launch, including bulk changes by worksheet
  category, Hose Series, or explicit multi-selection. The application does not
  derive it from RFQ Eligibility, Publication Status, technical-data
  completeness, or an invented stock quantity.
- A SKU already retained in a Quote List is never silently removed or
  substituted when its Supply Availability changes. Before RFQ submission, the
  website revalidates every Standard Product and every required Hose Assembly
  component against the active Catalog Release.
- If any retained line is no longer `Available for Quote`, the Quote List shows
  `Currently unavailable for new quotes` on that line and blocks submission of
  the complete RFQ. The customer may remove the line or wait until availability
  is restored; the website does not choose an alternative SKU.
- Supply Availability changes do not rewrite a submitted RFQ, issued or
  accepted PI, Confirmed Order, or their Quote Line Snapshots. Any later
  substitution, inability to supply, or commercial revision is handled by the
  existing admin review and revision workflow.

## Product Media

- The 61 launch Hose SKUs use six Hose Series Structure Illustrations, one for
  each of `601R1`, `601R2`, `EN1SC`, `EN2SC`, `EN4SP`, and `EN4SH`. These are
  reviewed AI-generated cutaway illustrations rather than 18 separate real
  photographs or one image per dash size.
- The six outputs are controlled by three reinforcement templates derived from
  the supplied image-generation rules: `601R1` and `EN1SC` show one gold steel-
  wire braid between two black rubber layers; `601R2` and `EN2SC` show two gold
  steel-wire braids separated by and enclosed within three black rubber layers;
  `EN4SP` and `EN4SH` show four gold steel-wire spiral layers separated by and
  enclosed within five black rubber layers. Braid and spiral patterns must
  remain visually distinct.
- Each series page displays its own approved image file even where two series
  share the same reinforcement template. The image is labelled `Illustration -
diameter and proportions vary by size`; structured catalog data remains the
  authority for reinforcement, dimensions, pressure, temperature, and standard.
  The visible outer-cover marking is the exact word `Fluidpowerhose`; no series
  code, specification, certification mark, or other AI-generated text appears
  in the image.
  Before publication, each image is checked for tube, cover, reinforcement
  count, layer order, and braid-versus-spiral construction against the approved
  rule document.
- Approved launch files are stored in `assets/hose-series/` as one 1254 x 1254
  PNG per Hose Series.
- The 200 launch Hose End SKUs map to 16 visual construction groups based on
  Interface Family, gender, swivel or fixed construction, angle, and sealing
  form. Launch does not require a separate photograph for every connection and
  hose-tail size combination.
- Each of the 16 Hose End construction groups receives one owned, reviewed
  AI-generated three-quarter technical product render showing the overall form
  and visible sealing end. SKUs in the same construction group share the image
  and display `Representative image - dimensions vary by size`.
- The approved launch renders use a consistent square white-background product
  composition and silver zinc-plated carbon-steel appearance. Generated images
  contain no logo, watermark, text, dimensions, arrows, SKU, thread designation,
  or competitor branding. Product labels and technical values are rendered as
  deterministic website text rather than baked into the image.
- Before publication, each Hose End image is checked against its approved
  construction group for Interface Family, gender, swivel or fixed construction,
  straight/45-degree/90-degree form, and visible sealing feature. In particular,
  the ORFS male form must show an open center bore with an O-ring around it;
  the BSPP male 60-degree form must show a recessed conical bore rather than a
  projecting JIC-style flare nose;
  BSPP female swivel forms must show their convex 60-degree cone within the nut,
  JIC female swivel forms their recessed 37-degree conical seat, and ORFS female
  swivel forms a flat annular sealing face without an O-ring;
  female JIC, BSPP, and ORFS images must not be treated as interchangeable merely
  because their external silhouettes are similar.
- Approved files and the internal contact sheet are stored in
  `assets/product-images/generated-hose-ends/`; `manifest.json` is the canonical
  mapping from each visual construction group to its asset file. Competitor
  photographs and catalog drawings are structural references only and are not
  copied into the website.
- A Representative Product Image aids recognition and never overrides the
  displayed interface family, sealing form, thread, hose size, exact SKU, or
  approved technical data. It is not an exact-size photograph, dimensional
  drawing, proof of inventory, or production authority.

## Hose Assembly Configurator Journey

The launch configurator uses a fixed guided sequence:

1. `Choose Hose`: Hose Series, dash size, and displayed working-pressure data.
2. `Select End A`.
3. `Select End B`.
4. `Set Finished Length`: customer-required Finished Overall Assembly Length,
   not raw hose cut length. The step loads the mapped measurement method for the
   selected ends. The default control uses feet and inches, with decimal inches
   and millimetres also available.
5. `Set Orientation`: shown only when the selected angled ends require
   Clocking.
6. `Add Protection`: standard installed protection choices.
7. `Application`: fluid medium, maximum system working pressure, and minimum
   and maximum operating temperatures. Each field permits `Not Sure`; fluid
   medium also permits `Other`.
8. `Quantity & Review`.
9. `Add Assembly to Quote`.

- After `Add Assembly to Quote` succeeds, the confirmation state provides three
  clear next actions: `Configure Another` starts a blank In-progress
  Configuration Draft, `Duplicate and Edit` creates a new draft copied from the
  just-added assembly, and `View Quote List` opens the current Quote List.
- If `Add Assembly to Quote` matches an existing unsubmitted line by the exact
  Configured Assembly Line Merge Key, the application increases that line's
  quantity instead of creating a duplicate and confirms `Quantity updated`.
  Quantity and Estimated Price are not part of the key. Any difference in the
  customer-approved configuration creates a separate Quote List line.
- `Duplicate and Edit` never changes the source Quote List line. It is intended
  for efficiently requesting similar assemblies with different Hose Ends,
  dimensions, lengths, protection, application values, or quantities; the
  copied draft passes through the same current compatibility and availability
  validation as a new configuration.
- Editing an existing configured-assembly Quote List line opens a Quote Line
  Edit Draft. Changes remain isolated from the stored line until the customer
  explicitly selects `Save Changes`. Leaving or cancelling the edit keeps the
  original line unchanged. Saving replaces only that unsubmitted line and
  recalculates its current derived compatibility and Estimated Price.
- Launch does not include a per-line `Customer Reference`, equipment identifier,
  installation-location field, or corresponding Quote, PI, production-document,
  or QR mapping. It may be added after actual customer demand establishes the
  required format and where the value must appear.
- When making a new selection, each step presents only options supported by an
  RFQ-Eligible Combination and the current selections. The interface does not
  infer or permit arbitrary component combinations.
- Returning to an upstream step and changing Hose, Hose Size, End A, or End B
  never silently clears or substitutes customer-entered downstream values. The
  application immediately revalidates the complete draft, retains incompatible
  values as `Retained Invalid Selection`, and marks the affected step and field.
  The customer may correct it immediately or continue reviewing other steps.
- System-derived compatibility records, Ferrule SKUs, measurement-method
  resolution, availability, and Estimated Price are recalculated after every
  upstream change. A stale derived value is not displayed or stored as valid
  merely because the corresponding customer selection remains visible.
- If End A or End B changes after Finished Overall Assembly Length was entered,
  the numeric length and unit remain visible. When the mapped Length Measurement
  Method changes, the length becomes `Reconfirmation Required`; the customer
  must reopen Set Finished Length, inspect the new diagram, and confirm the
  retained value rather than retyping it.
- Quantity & Review lists every unresolved incompatibility or reconfirmation
  requirement with a direct link to the affected step. `Add Assembly to Quote`
  is blocked until none remain. RFQ submission revalidates configured lines
  again and blocks any invalid retained draft that entered through stale browser
  state or a later Catalog Release change.
- Select End A and Select End B use the same layered Hose End finder rather than
  one flat SKU list. The customer first narrows by Interface Family (`JIC`,
  `NPT`, `ORFS`, or `BSP`), then form (`Straight`, `45-degree Elbow`, or
  `90-degree Elbow`), followed by gender, swivel or fixed construction, and
  Connection Dash where those values vary.
- The finder queries only RFQ-Eligible Hose Ends for the selected Hose Size
  Variant and the other current compatibility inputs. Each layer shows current
  eligible-result counts and updates the candidate list immediately; an empty
  result explains which active filters produced no match without choosing a
  substitute.
- A search field within the step matches exact or partial Hose End SKU, thread
  designation, dash size, and approved aliases, but still returns only eligible
  candidates. Clearing search or filters never clears the customer's selected
  Hose End.
- Candidate Hose End cards show the Representative Product Image, human-readable
  construction name, actual connection thread, Connection Dash, compatible hose
  size or Hose Tail Dash, and exact SKU. The interface never auto-selects the
  first candidate or treats a filter choice as a Hose End selection.
- Select End B shows `Use Same as End A` only when the exact End A Hose End SKU
  remains RFQ-Eligible for End B under the current Hose Size Variant. The
  customer must click the command to copy that exact SKU; entering the step does
  not preselect it. The copied End B is an ordinary editable selection and may
  be replaced through the same finder.
- The configurator maintains a code-rendered two-dimensional Live Assembly
  Preview. It updates the Hose body, End A and End B construction silhouettes,
  End labels, selected protection, Finished Overall Assembly Length label, and
  compatibility state as the customer works. When Clocking is required, the
  preview includes the dynamic M08 end-view inset at the selected angle.
- The preview is an explanatory technical schematic and is explicitly labelled
  `Not to scale`. It is not a product photograph, manufacturing drawing, hose
  cut-length calculation, or dimensional authority. Exact text specifications,
  M01-M07 measurement overlays, and the accepted PI remain authoritative.
- Launch does not generate an AI-composited assembly image or a 3D model for
  every combination. Representative Product Images remain in Hose and Hose End
  selection cards, while the dynamic preview uses controlled construction
  silhouettes and deterministic labels. An equivalent text summary remains
  available for accessibility and as a rendering fallback.
- A Retained Invalid Selection remains visible in the preview with a clear
  warning treatment; the preview never redraws it as though the combination were
  valid or silently substitutes another component.
- On desktop, Build a Hose is a full-page work surface with the active step and
  option browser in the main column and a sticky Live Assembly Preview plus
  current specification summary in a stable right column. The preview and
  summary are functional workspace regions rather than nested decorative cards,
  and dynamic labels or warnings do not resize the primary step controls.
- On mobile, one step occupies the main viewport width. A fixed bottom action
  bar provides `Back` and `Next`, while a separate control expands the Live
  Assembly Preview and current specification summary without discarding the
  active step or its scroll position.
- The step navigation always distinguishes completed, current, warning, and
  incomplete states with icon, text, and accessible state rather than color
  alone. Selecting an earlier step preserves all retained customer inputs under
  the existing validation rules.
- Sticky navigation, the mobile preview control, validation messages, and the
  Pre-Quote Support Chat launcher use reserved layout space and responsive
  constraints. They must not cover one another, obscure `Back`, `Next`, or `Add
Assembly to Quote`, or move those controls when content changes.
- The exact Ferrule SKU for each end is resolved from the RFQ-Eligible
  hose/hose-end/ferrule relationship and is never a customer-selectable or
  replaceable configurator choice. Customer review states `Matched ferrules
included`, and the PI does not expand a configured assembly product line into
  Ferrule SKU sub-lines. The factory production package and Assembly Record
  retain the exact End A and End B Ferrule SKUs.
- Select End A and Select End B each provide `Not sure which fitting you need?
Chat with us` as a support action, not as a selectable Hose End value. Opening
  chat preserves the in-progress configuration, but the customer must return
  and actively select an exact eligible Hose End SKU before continuing. An
  assembly cannot store `Unknown Fitting` or submit a Quote line with an
  unresolved end.
- Each Hose End option leads with a human-readable construction name, for
  example `Female JIC 37-degree Swivel, Straight`. A second line displays the
  actual connection thread, compatible hose inside diameter, and dash size, for
  example `9/16-18 thread - For 3/8 in hose (-06)`. The exact Hose End SKU,
  such as `JIC_F_SW_06_06`, remains visible as secondary reference text and is
  repeated with the name on review, Quote Revision, PI, and production views.
  Angled forms explicitly use `45-degree Elbow` or `90-degree Elbow`.
- Customer-facing Hose End choices do not expose competitor part numbers,
  Compatibility IDs, Ferrule SKUs, reference crimp diameters, or other internal
  production data. A product image supports shape recognition but never replaces
  the displayed interface, thread, hose size, and exact SKU.
- Clocking uses one unambiguous convention throughout the customer review, PI,
  and factory production view: look along the hose axis from End A toward End
  B, hold the End B elbow vertically downward at the 6-o'clock position as
  `000 degrees`, and measure the End A elbow clockwise from `000` through `359`
  degrees. Each view includes the same end-view diagram, End A/End B labels,
  viewing-direction indicator, zero reference, and clockwise arrow; an uploaded
  customer drawing that uses another convention is treated as reference input
  and is converted to this convention before approval.
- The standard Clocking Tolerance is `+/- 3 degrees` from the approved target
  angle. The configurator, review, PI, and factory production view display the
  target and tolerance together, for example `090 degrees +/- 3 degrees`. This
  is a finished-assembly acceptance tolerance rather than an angle-input
  increment. A tighter customer requirement becomes a Manual Assembly Quote
  Request and is not represented as automatically manufacturable.
- Set Orientation is shown only when both selected hose ends are angled. The
  configurator does not preselect `000 degrees` or infer Clocking from fitting
  images. The customer must choose a common preset (`000`, `090`, `180`, or
  `270` degrees), enter a custom whole-degree target from `000` through `359`,
  or select `Not Sure`. `Not Sure` routes the line to a Manual Assembly Quote
  Request and prompts the customer to attach an existing-assembly photograph or
  drawing when available. One angled end paired with one straight end does not
  require Clocking because the straight end provides no rotational datum.
- The configurator stores the original Finished Overall Assembly Length and its
  Specified Length Unit as the authoritative customer input, together with an
  exact millimetre conversion for internal calculation. Unit conversion does
  not silently round or replace the requested production length.
- Guided imperial length input uses a minimum increment of `1/8 in`; guided
  metric input uses a minimum increment of `1 mm`. A requirement with finer
  input precision becomes a Manual Assembly Quote Request.
- Launch applies the agreed SAE J517 Assembly Length Tolerance schedule to the
  target Finished Overall Assembly Length: up to 12 inches, `+/- 1/8 in`; over
  12 through 18 inches, `+/- 3/16 in`; over 18 through 36 inches, `+/- 1/4 in`;
  and over 36 inches, `+/- 1%`.
- A request for a tighter tolerance remains possible through `Request a Manual
Quote` but is not represented as automatically manufacturable. Sales confirms
  the achievable tolerance with the factory before issuing the PI.
- Each selectable Hose End form maps to a versioned Length Measurement Method.
  The Set Finished Length step shows the applicable diagram and measurement
  endpoints; an unmapped end form is routed to Manual Assembly Quote Request
  rather than presented with an assumed method.
- Set Finished Length is unavailable until End A and End B are selected and a
  versioned M01-M07 Length Measurement Method resolves. It opens with that
  mapped diagram immediately; the configurator never shows M04 as a temporary
  pre-selection diagram or as a fallback for an unmapped hose-end form. M04
  remains the mapped method for its supported straight-to-90-degree geometry and
  may also appear in general help content.
- Measurement graphics use an original, brand-neutral illustrated base asset,
  which may be AI-generated, with deterministic website overlays for endpoint
  markers, centerlines, arrows, labels, and values. Generated artwork is not the
  authority for technical placement and is reviewed against the adopted
  industry reference before release.
- The launch base-art set is versioned in
  `assets/measurement-diagrams/manifest.json`. M01 through M07 cover the
  supported Finished Overall Assembly Length scenes; M08 is reserved for the
  double-elbow Clocking end view. The manifest is an asset registry, not a
  substitute for the hose-end SKU-to-method mapping.
- M08 is rendered entirely by code at runtime so End A rotates to the selected
  Clocking value. Its AI-generated PNG is retained only as visual-development
  reference and must not be shown as a fixed customer angle.
- The Quote Revision and PI snapshot the Length Measurement Method identifier
  and diagram version used for customer approval. Later artwork changes do not
  rewrite an accepted specification.
- Because the launch Hose End master data does not yet contain Dimension A or
  Cut-off B values, the website does not calculate hose cut length. The factory
  produces and inspects to the approved Finished Overall Assembly Length and
  Assembly Length Tolerance.
- The launch data also does not contain a verified Minimum Finished OAL for each
  hose-end combination. The configurator therefore does not impose an invented
  universal minimum such as 6 or 12 inches. It rejects zero and negative length
  values but permits a positive requirement to be submitted, displays
  `Minimum buildable length will be confirmed with your quote.`, and marks the
  line `Length Feasibility Review Required` internally. The business operator
  confirms feasibility with the factory before PI issuance. A future verified
  Minimum Finished OAL value may enable combination-specific inline validation
  without changing the approved customer specification.
- Guided configuration accepts a requested Finished Overall Assembly Length up
  to and including `50 ft` (`15,240 mm`). A longer requirement remains
  submittable through `Request a Manual Quote` so continuous hose availability,
  packaging, handling, and freight can be confirmed before PI issuance. The
  50-foot boundary is a launch workflow limit, not a published manufacturing
  maximum; the launch Hose master data does not contain verified maximum
  continuous-length values.
- A hose with only one factory-crimped end and one open cut end is not offered
  in the guided configurator at launch. The customer may submit a `Request a
Manual Quote` describing the open-end use. Sales and the factory then confirm
  the applicable length endpoint, open-end contamination protection, and the
  responsibility boundary for any later field-installed fitting. Bulk Hose and
  Hose Ends remain available as separate Standard Product quote lines.
- Review, Quote Revision, PI, and production specification display the original
  length, conversion, and Assembly Length Tolerance, for example `72 in +/- 1%
(1828.8 mm +/- 18.3 mm)`, so customer and factory are referring to the same
  dimension and acceptance band.
- The review shows one configured-assembly `Estimated Price` and the selected
  component identities without exposing the internal price breakdown.
- Application Requirements are screening inputs rather than an automated
  suitability certification. If a stated pressure or temperature exceeds the
  applicable catalogue reference range, the configuration is redirected to a
  Manual Assembly Quote Request and cannot continue as a normal configured
  line. `Other` or `Not Sure` remains quotable but marks the line `Technical
Review Required` for Admin Backoffice review.
- Customer-facing product ranges, Application inputs, configuration review,
  Quote, and PI show temperature as Fahrenheit primary with Celsius secondary,
  for example `284°F (140°C)`. Factory Mobile and the bilingual Production
  Instruction reverse the reading order to `140°C / 284°F`. Both presentations
  come from one canonical temperature value and the shared conversion service;
  no worker or document template enters the second unit.
- Suitability screening compares canonical unrounded values. Display precision
  may format either unit for readability but never changes the range result.
  `Not Sure` remains a nonnumeric review state and is not converted to a
  placeholder temperature.
- `Technical Review Required` is an advisory work flag, not a system-enforced
  PI approval gate and not a separate role workflow. Before issuing the PI,
  the business operator confirms the unresolved application with the factory
  through the launch-stage operating process and remains responsible for
  issuing only a factory-confirmed specification.
- Customer-facing pressure data is labelled `Reference Maximum Working
Pressure`. A formal suitability and pressure conclusion exists only after
  technical review and confirmation in the accepted PI specification.
- A customer who knows the required hose, connection, size, length, or
  protection but cannot find that known specification in the launch catalog
  uses `Request a Manual Quote` and may upload a supporting drawing. This
  creates a Manual Assembly Quote Request for review rather than an invalid
  configuration. Identification of an unknown Hose End begins in Pre-Quote
  Support Chat; after receiving guidance, the customer still selects an exact
  website option before submitting a guided configuration.

## Customer Identity

- Browsing, configuration, and Quote List preparation do not require login.
- Email verification creates or updates a Customer Profile and enables the
  Personal Center through a one-time code or secure link; passwords are
  optional.
- Each RFQ uses an individual or organization Purchasing Context. Launch
  supports one Primary Company Contact per Organization Profile while retaining
  an organization-member data model for later multi-user access.

## In-progress Configuration Exit

- An unauthenticated customer's current Build a Hose selections remain an
  In-progress Configuration Draft only for the active browser page session.
  They are not written to the Anonymous Quote Session, do not reappear after the
  customer leaves and later returns, and are distinct from a configured assembly
  already added to the Quote List.
- When an unauthenticated customer uses a website navigation action that would
  leave Build a Hose with a non-empty draft, the application displays: `Your
selected configuration will be lost when you leave.` The customer may choose
  `Stay and Continue` or `Leave and Discard`. After Spec 3 launches, the same
  warning also offers account registration.
- The registration option starts Passwordless Access; it is not a standalone
  email-save action. One exact draft may travel inside the 24-hour registration
  transaction but cannot be recovered by email alone or retained as a 30-day
  anonymous draft. Successful verification converts it into an account-owned
  Saved Configuration. Expired or abandoned registration transactions are
  deleted.
- Browser tab closing, refresh, device shutdown, browser failure, and other
  external exits cannot reliably display a custom application dialog or offer
  email registration. Where supported, the application uses the browser's
  native unsaved-changes warning as a best-effort safeguard, but it does not
  promise custom wording or recovery after such an exit.
- A draft becomes part of the Anonymous Quote Session only after the customer
  completes `Add Assembly to Quote`. The existing 30-day Anonymous Quote List
  behavior then applies to that Quote List line.

## Anonymous Quote List

- Spec 1 owns the single minimum Anonymous Quote List for Standard Products and
  Length-Based Hose. Spec 2 reuses it and only adds configured assembly lines.
- An unauthenticated browser receives a signed, non-personal cookie that maps to
  an Anonymous Quote Session in D1 for 30 days from last activity. The cookie
  does not store product, price, specification, or personal data.
- Adding the same stable line identity merges quantity. Length-Based Hose line
  identity includes exact SKU and entered cut length.
- Email verification associates the current Anonymous Quote Session with the
  Customer Profile. Cross-device access requires verified customer access and
  is not granted by the anonymous cookie alone.
- If the Customer Profile already has a Quote List, the website performs a
  Quote List Merge instead of overwriting either list. Exact Standard Product
  and configured-assembly matches combine quantities using their applicable
  line merge keys; different configurations remain separate lines.
- The merge is recorded so support staff can explain unexpected quantities or
  restore context without exposing a public Quote List URL.

## Quote List Estimate

- The Quote List displays `Estimated Merchandise Subtotal` in USD from the
  current Standard Product Reference Prices and configured-assembly Estimated
  Prices.
- Each line estimate uses the current Reference Unit Price multiplied by the
  requested quantity. Changing quantity does not trigger an invented tier or
  automatic volume discount.
- Opening the Quote List and attempting RFQ submission refreshes every retained
  Reference Price from the active Catalog Release. When a value changed, the
  line displays `Estimated price updated` together with its former and current
  estimated amounts rather than silently retaining the old value.
- The same pre-submission refresh resolves the current Cutting & Labeling Fee
  for each Length-Based Hose Order from its Hose Series override or the global
  rate. A changed fee displays its former and current estimated amount before
  submission. RFQ submission snapshots the resolved rate, piece count, and fee;
  later configuration changes do not alter that RFQ, Quote, PI, or Order.
- The customer does not separately accept a Reference Price Refresh because the
  amount remains a non-binding estimate. RFQ submission snapshots the refreshed
  amount that was visible at submission.
- After Reference Price Refresh, submission performs Submission Threshold
  Revalidation using the current discounted Merchandise Subtotal. A retained
  Quote List receives no grandfathered minimum or trade-term treatment from an
  earlier estimated amount.
- A refreshed subtotal below $100 blocks RFQ submission and prompts the customer
  to add products. An Individual Customer above $4,500 must select or create an
  Organization Purchasing Context; a Business Customer above $3,000 is shown
  the applicable DAP route before submission.
- The customer sees the refreshed subtotal and resulting customer-friendly
  import-duty treatment before confirming RFQ submission. Freight, insurance,
  duties, import taxes, sales tax, and other fees remain excluded from all
  threshold calculations.
- Freight is shown as `Calculated after quote request`; the storefront does not
  invent a freight estimate or present the current subtotal as a delivered
  total.
- The $100 submission minimum is evaluated only against the discounted
  Merchandise Subtotal. Freight, insurance, duties, import taxes, sales tax,
  Cutting & Labeling Fee, and other fees do not help an RFQ reach the minimum.
- Final product amounts, logistics charges, trade terms, delivery timing, and
  any applicable tax are confirmed in the formal quote and PI.

## Admin Backoffice Accounts and Permissions

- The Admin Backoffice uses a dedicated hostname protected by Cloudflare Access.
  Only explicitly allowed Cloudflare account members with MFA may reach it.
- The Worker validates the Cloudflare Access JWT and maps its verified identity
  to an active D1 Admin Identity before applying application permissions. It
  does not authorize requests from an unvalidated email header.
- Launch has one Owner Account with every Admin Backoffice permission, including
  creating, disabling, and assigning permissions to Admin Subaccounts.
- The second staff member uses a separate Admin Subaccount with every operational
  Owner permission except creating, disabling, or changing permissions for
  Admin Subaccounts. The Owner and subaccount never share credentials.
- The application authorizes individual Admin Permissions rather than fixed
  Sales, Operations, or Catalog roles. As staff grows, the Owner creates
  additional independent subaccounts and selects each allowed capability with
  permission checkboxes.
- Only the Owner Account may manage Admin Subaccounts or their permissions. An
  Admin Subaccount cannot grant itself or another account additional access.
- Factory workers are not Admin Backoffice users. Factory Batch Access is a
  separate, time-limited QR authorization for the minimal Factory Mobile
  workflow.
- The customer storefront, Personal Center, Factory Mobile, provider webhooks,
  and Admin Backoffice use separate routes or hostnames and do not share the
  Admin Backoffice's human Access policy. Provider webhooks use their own
  signature or service authentication.

## Admin Audit Log

- Security- and business-significant Admin Backoffice changes create append-only
  Admin Audit Events containing the actor, UTC timestamp, request identifier,
  IP address, entity and action, and permitted before-and-after field values.
- Required coverage includes PI issuance and replacement, Cleared Funds
  confirmation and correction, Payment Confirmation Review Holds, Catalog
  Release publication, price and discount changes, Order and Shipment changes,
  after-sales resolutions, and admin account or role changes.
- Admin users may search and export audit events according to permission but cannot
  edit or delete them through the application.
- Audit payloads must redact passwords, one-time codes, API secrets, full bank
  credentials, payment tokens, and other sensitive authentication or payment
  material.

## Catalog Master Data and Excel

- The approved 01-07 workbook is the initial import source and the supported
  bulk import/export template. D1 becomes the sole runtime source of Catalog
  Master Data after import.
- Catalog users may edit draft records individually or prepare a Catalog Import
  from Excel. The import preview reports additions, changes, deactivations, and
  validation errors before publication.
- Every imported SKU defaults to `Temporarily Unavailable`. Draft tools support
  bulk Supply Availability changes by worksheet category, Hose Series, and
  selected rows before publication.
- Catalog Publication Status, Supply Availability, RFQ Eligibility,
  Qualification Status, and Technical Data Status are independent fields.
  `Published` controls customer visibility; `Available for Quote` controls
  current acceptance of new Quote lines; `Eligible` permits an exact Standard
  Product or relationship to enter the guided Quote workflow; `Approved` records
  production qualification; and `Complete`, `Inherited`, or `Pending` records
  technical-data completeness.
  No import formula may require Qualification Status `Approved` or Technical
  Data Status `Complete` merely to establish RFQ Eligibility.
- A `Published` and `Eligible` reference relationship may appear in the RFQ
  configurator while its Qualification Status remains `Not Tested`, consistent
  with RFQ-Eligible Combination. It is not represented as tested, approved, or
  guaranteed compatible. `Manual Quote Only` leaves a known requirement
  accessible to Sales without permitting a guided path, and `Blocked` prevents
  new quote use while preserving historical snapshots.
- Before the first Catalog Import, the 01-07 workbook template must replace the
  overloaded `Status` and `Configurator Eligible` formula with the separated
  fields and allowed values. Existing rows remain draft until their public
  required fields and release validation pass; changing the model does not
  automatically publish every row.
- The 57 launch Quick Coupling SKUs are not manually populated with unsupported
  performance, material, seal, dimension, weight, or drawing values. Shared
  values may resolve through versioned Specification Profiles scoped at least
  by coupling standard or family and Body Dash, with material option, role, and
  port type included whenever they affect the value. An exact SKU override wins
  over inherited data. Unresolved values remain `Pending` and are confirmed as
  needed during quote review; they do not block a Published and Eligible SKU
  from `Add to Quote`.
- For launch Quick Couplings, Rated Flow, Pressure Drop Basis, Overall Length,
  Unit Weight, and Drawing Number are optional catalogue attributes. The
  storefront omits any unresolved optional value. Max Working Pressure,
  Minimum Burst Pressure, Body Material, Coating, Seal Material, and Temperature
  Range may also remain unresolved at initial publication, but must not be
  represented as confirmed until resolved from an exact supplier source,
  applicable Specification Profile, or SKU-specific record.
- In worksheet 07, SKU Net Unit Weight, Package Length, Inner Pack Quantity,
  Master Carton Quantity, Carton Gross Weight, carton dimensions, Packing Basis,
  and HS Code are launch-optional import fields. Their absence does not block a
  SKU from publication or RFQ Eligibility. Existing confirmed values may still
  be imported and used as planning inputs, but they are not treated as the
  final packing result for a particular quoted quantity.
- A Catalog Import is all-or-nothing. A required-field, duplicate-SKU,
  compatibility, reference, or data-type error rejects the entire import; no
  valid subset is silently applied.
- Draft changes do not affect customers until an authorized Catalog user
  publishes one identified Catalog Release.
- Products referenced by historical records are deactivated rather than
  deleted.
- RFQ and PI revisions retain immutable Quote Line Snapshots, so later product,
  compatibility, description, or Reference Price changes do not rewrite
  customer history.

## Quote Pricing

- Each submitted RFQ retains the Reference Price shown to the customer at the
  time of submission.
- Later Catalog Reference Price changes do not reprice a submitted RFQ, issued
  or accepted PI, or Confirmed Order. Only an unsubmitted Quote List participates
  in Reference Price Refresh.
- Authorized Admin Backoffice users may view the internal Cost Basis. Cost
  Basis is never returned by customer-facing APIs, exports, documents, or email.
- The quote editor initializes Quoted Unit Price from the captured Reference
  Price. Sales may change the quoted price or discount for the current Quote
  Revision.
- An authorized admin may apply a Manual Quantity Discount during quote review.
  The PI shows the resulting Quoted Unit Price and discount, and the Pricing
  Audit Event records the change; no public tier schedule is implied.
- Product amounts, discounts, freight, insurance, duties, import taxes, and
  other fees are represented as separate commercial values rather than folded
  into an unexplained line price.
- Cutting and Labeling Fee is calculated as the snapshotted per-piece rate
  multiplied by the quoted Number of Pieces. Sales may revise it in a Quote
  Revision with the same pricing audit and customer-acceptance rules as other
  commercial values; it is never recalculated on an accepted PI.
- An issued PI uses the current Quote Revision's confirmed Quoted Unit Prices
  and commercial charges; it does not recalculate from the live catalogue.
- Launch does not require multi-level price approval. Every price and discount
  change creates a Pricing Audit Event containing the actor, timestamp, old
  value, and new value.

## Customer-facing Trade Terms

- Thresholds use the discounted Merchandise Subtotal only; freight, duties,
  import taxes, insurance, Cutting & Labeling Fee, and other fees do not
  contribute.
- An Individual Customer may submit a DDP RFQ from $100 through $4,500. The
  storefront presents `Import Duties Included (DDP)` and states that US sales
  tax is calculated separately if applicable.
- An Individual Customer above $4,500 cannot submit in an individual Purchasing
  Context and is prompted to use or create an Organization Profile.
- A Business Customer uses DDP through $3,000, also presented as `Import Duties
Included (DDP)` with sales tax stated separately.
- A Business Customer above $3,000 uses DAP, presented as `Import Duties &
Taxes Paid by Customer`, with `DAP` explained in supporting detail and US
  sales tax still treated separately.
- The PI uses the formal Incoterm and named place regardless of the simplified
  storefront label.
- Launch-stage DDP uses Provider-Managed DDP Clearance for eligible low-value
  Shipments. The storefront does not expose Importer of Record selection or ask
  the customer to complete ordinary import-clearance steps.
- Sales confirms that the selected logistics provider accepts the quoted
  products, quantities, and destination before issuing a DDP PI. The Admin
  Backoffice records the selected provider and its shipment or quotation
  reference; the application does not model the provider's internal IOR,
  brokerage, or bond structure.
- If the selected provider becomes unavailable before Cleared Funds, Sales
  obtains another DDP route or issues a revised Quote and replacement PI before
  payment proceeds.
- If the provider becomes unavailable after Cleared Funds, Operations first
  obtains an alternative DDP route without charging the customer for the added
  cost. The Admin Backoffice must not convert the Order to DAP or transfer
  clearance obligations to the customer without explicit customer acceptance.
- If no compliant DDP route remains available, Operations records a DDP
  Fulfillment Failure. The seller offers a full seller-caused refund, including
  absorbed payment-channel or bank costs, unless the customer chooses and
  accepts a replacement DAP PI. The original PI and decision history remain
  immutable.

## Quote-stage Packing and Freight

- The storefront does not calculate cross-border freight from incomplete SKU
  weights or generic carton assumptions. It displays `Calculated after quote
request` until Sales prepares the formal quote.
- Before PI issuance, each planned dispatch has a Shipment Packing Estimate
  containing expected carton count, gross weight, carton dimensions or
  dimensional weight, transport method, estimate source, currency, freight
  amount, and validity period. Sales obtains or prepares it for the exact quoted
  products, quantities, destination, and Ship Together or Split Shipment plan.
- A Shipment Packing Estimate may come from the factory, freight forwarder, or
  an authorized internal calculation supported by identified inputs. It is an
  order-level commercial planning record and is not copied into all underlying
  SKU master records.
- PI freight and DDP or DAP charges use the active Shipment Packing Estimate.
  The estimate remains historically attached to that Quote Revision.
- After packing, Operations records a separate Final Packing Record for each
  Shipment. Actual carton counts, weights, dimensions, and packing documents do
  not overwrite the quote-stage estimate or silently revise the accepted PI.
- Actual carton count, gross weight, and carton dimensions are optional website
  records and do not block `Ready to Ship`. Operations may rely on the factory
  or logistics provider's external packing workflow and upload the resulting
  document without re-entering every value.
- When Operations chooses to record actual packing data, identical cartons are
  entered as one Packing Group containing carton quantity, per-carton length,
  width, height, and gross weight. The website calculates group totals, total
  carton count, total gross weight, and dimensional weight. Different carton
  sizes or weights remain separate groups; identical cartons do not require one
  row per physical carton.
- Dimensional Weight Divisor is an optional Shipment-level input supplied for
  the selected logistics method and is never hardcoded as 5000, 6000, or another
  universal value. When present, dimensional weight is the sum of each Packing
  Group's `carton quantity x length x width x height / divisor`, using the
  recorded dimension unit consistently. When absent, the website totals volume
  only and omits dimensional weight.
- Packing calculations are operational references and do not automatically
  recalculate freight, revise an accepted PI, or replace the logistics
  provider's chargeable-weight determination.
- Commercial Packing List handling is optional and supports two equivalent
  paths. When actual carton count, gross weight, and carton dimensions are
  present, Operations may generate it from the Final Packing Record. Otherwise,
  Operations may upload the factory or logistics provider's externally prepared
  document without re-entering its packing values.
- Neither generating nor uploading a Commercial Packing List is required for
  `Ready to Ship`. The pre-packing Factory Packing Sheet and tie-on tag pages
  are never reused as the customs or transport Commercial Packing List.
- Launch does not automatically generate a customs Commercial Invoice, customs
  declaration, or machine-readable declaration dataset. The PI remains the
  customer-accepted quotation and payment document and is not relabeled or
  reused as the customs Commercial Invoice.
- Before customs documents are submitted, an Owner or authorized Admin
  Subaccount verifies HS classification, declaration description, country of
  origin, and customs value with the logistics provider outside the website.
  Optional or unresolved SKU import fields are never promoted into an automatic
  customs declaration.
- An Owner or authorized Admin Subaccount may upload externally prepared
  Commercial Invoices, customs files, and other logistics documents to the
  applicable Shipment as Shipment Documents. The record retains document type,
  original filename, uploader, upload timestamp, and Shipment relationship.
- Shipment Documents are stored in private R2 and default to `Internal`.
  Customers receive no object-storage URL and cannot discover internal files.
  Only a document explicitly changed to `Customer Shared` appears as a download
  under the related Order in the Personal Center. Sharing does not represent
  website authorship or customs verification.
- For a Shipment containing a Length-Based Hose Order, the Final Packing Record
  also retains evidence that the labelled pieces received end protection and
  coil restraint before dispatch.
- After the customer accepts the PI, a higher actual logistics cost caused by
  the seller's packing or freight estimate is a Freight Estimate Variance borne
  by the seller. If the quoted quantity, Delivery Address, shipment plan, and
  transport method are unchanged, the seller does not issue an additional
  charge or hold shipment for supplemental payment.
- The customer-facing logistics amount in an accepted PI is a Fixed Logistics
  Charge rather than a pass-through reconciliation to the seller's final
  carrier cost. If the actual cost is lower, the difference is not
  automatically refunded; Operations records actual internal cost for margin
  and reconciliation purposes.
- The seller may substitute an operationally equivalent carrier or routing when
  the accepted transport mode, insurance coverage, destination, and material
  transit commitment are preserved.
- A seller-proposed Logistics Service Downgrade, including a slower transport
  mode, removed insurance, or materially longer transit plan, requires customer
  agreement and a Quote Revision with any applicable price reduction before
  dispatch.
- A customer-requested change to quantity, Delivery Address, Ship Together or
  Split Shipment plan, or transport method is not a Freight Estimate Variance.
  Sales creates a Quote Revision with a new Shipment Packing Estimate and issues
  a replacement PI. The changed plan does not proceed until the customer accepts
  the replacement PI; earlier versions remain in history.

## US Sales Tax

- The storefront never assumes that an order is tax exempt. Quote List and RFQ
  pages show `Sales tax calculated separately if applicable` until the formal
  quote determines the treatment.
- Each PI records one Sales Tax Treatment: `Collected`, `Exempt`, or `Not
Collected`. A zero amount marked `Not Collected` must not be presented as an
  exempt transaction.
- `Collected` uses the complete ship-to address, applicable product and freight
  taxability, and the seller's configured collection obligations to calculate
  the tax shown as a separate PI amount.
- Cutting & Labeling Fee is not globally marked taxable or exempt. During PI
  preparation, its inclusion in the tax base follows the same jurisdictional
  Sales Tax Treatment and manual review as the products and other commercial
  charges. The storefront makes no taxability claim for the fee.
- `Exempt` requires accepted Sales Tax Exemption Evidence stored privately with
  the customer or Organization Profile and linked to the quote. A customer
  checkbox or tax identifier alone is insufficient.
- `Not Collected` means that the seller has determined it is not required to
  collect sales tax for that transaction; it does not represent a tax-exemption
  certificate or a conclusion about the purchaser's use-tax obligations.
- Launch uses a manually confirmed Admin Backoffice tax amount and treatment at
  PI preparation. The data model keeps jurisdiction, calculation timestamp,
  evidence, and adjustment fields so a tax-calculation service can be added
  later without changing historical PI records.
- Before public launch, a qualified US tax adviser must determine the seller's
  state registration and collection obligations, including whether the actual
  activities associated with the Plano Return Location create Texas physical
  presence. The application does not infer nexus from an address alone.
- A DDP PI separates Merchandise, `DDP Shipping & Import Charges`, applicable
  `Sales Tax`, and `Total Due`. DDP ensures the customer is not charged import
  duties again at delivery; it does not silently include or waive US sales tax.
- After PI acceptance, the DDP Shipping & Import Charges are fixed when the
  products, quantities, Delivery Address, and accurate customer-supplied import
  information remain unchanged. The seller bears a higher final import cost and
  retains any saving; neither outcome creates an automatic supplemental charge
  or refund.
- A Customer-Supplied Import Data Error or customer-requested change affecting
  import treatment requires Sales to issue a Quote Revision and replacement PI
  before proceeding. A seller classification or declaration error remains the
  seller's responsibility and is not reclassified as a customer change.
- US Sales Tax Treatment and adjustments remain governed by the separate US
  Sales Tax rules and are not included in DDP Import Charge Variance.

## Ship-together and Split Shipments

- `Ship Together` is the default RFQ preference for an order containing
  Standard Products and made-to-order products. Dispatch waits until all quoted
  items are ready, reducing cross-border freight and clearance events.
- A customer may select `Request Split Shipment` while preparing an RFQ. Sales
  reviews feasibility and quotes the freight and trade terms for each planned
  dispatch.
- One Confirmed Order may contain multiple Shipments. Each Shipment stores its
  allocated products and quantities, packing documents, freight allocation,
  trade term, accepted Estimated Ready-to-Ship Date, carrier, tracking details,
  and status.
- A Split Shipment Request is not binding until represented in the accepted PI.
  If a split is introduced after PI acceptance and changes price or commercial
  terms, it creates a Quote Revision and requires a replacement PI and customer
  acceptance.

## Customer Order Progress

- The primary customer-facing sequence is `Order Confirmed`, `Ready to Ship`,
  `Shipped`, and `Delivered`. The customer does not see `Preparing Items`,
  `Quality Check`, `In Production`, Factory Link Opened, Production Started, or
  other factory activity.
- Standard Products have a default Processing Lead Time of 10 business days,
  counted from the business day after Payment Confirmed creates the Confirmed
  Order through preparation, inspection, and packing as `Ready to Ship`.
- A Length-Based Hose Order remains in the Standard Product 10-business-day
  Reference Processing Lead Time despite its cut-to-length cancellation and
  return restrictions. It does not inherit the Hose Assembly 15-business-day
  starting estimate merely because cutting is required.
- Made-to-order Hose Assemblies display `Estimated processing time: from 15
business days` as a Reference Processing Lead Time. The 15-day value is a
  small-batch starting estimate, not a fixed commitment for every quantity.
- Before issuing a PI containing a made-to-order Hose Assembly, Sales confirms
  the schedule with the factory and must enter a concrete Estimated
  Ready-to-Ship Date based on total quantity, configuration complexity, and
  current capacity. The PI cannot be issued without that date.
- Launch does not use invented quantity tiers or an unvalidated production-rate
  formula. Actual order quantities and achieved dates may later support a
  measured scheduling model without changing historical PI commitments.
- The 10-business-day Processing Lead Time is not a delivery promise. Before PI
  issuance, Sales confirms a concrete Estimated Ready-to-Ship Date for the
  quoted quantities and requested piece lengths. Processing Lead Time does not
  include international freight, customs processing, or final delivery;
  Transit Time is estimated and quoted separately.
- A Ship Together order containing items with different Processing Lead Times
  uses the longest confirmed line-item lead time for its planned Ready-to-Ship
  date. A customer who needs earlier dispatch may submit a Split Shipment
  Request for separate commercial review.
- Processing Lead Time uses a China Fulfillment Calendar maintained in the
  Admin Backoffice. It includes normal Monday-through-Friday workdays, Chinese
  public holidays, factory shutdowns such as Spring Festival closures, and any
  approved exceptional workdays. It is not used to calculate the Payment Due
  Date.
- The quote and PI display the resulting concrete `Estimated Ready-to-Ship
Date`; customers do not need to interpret the underlying China holiday
  calendar. Known closures are applied before PI issuance rather than announced
  only after payment.
- The accepted PI's Estimated Ready-to-Ship plan is snapshotted into the
  Confirmed Order's planned Shipment records and displayed in Order detail
  while each Shipment remains `Order Confirmed`. Each Shipment date is its only
  pre-dispatch schedule indicator: the page does not show a countdown,
  completion percentage, production stage, or Factory Mobile activity, and
  factory actions do not recalculate the date.
- If the current Estimated Ready-to-Ship Date passes before the Shipment is
  ready, the application creates an internal Owner/Admin reminder only. It does
  not automatically add `Delayed` to the customer timeline, change the date,
  or send the customer a message.
- After Owner/Admin confirms a new date, `Revise Estimated Ready-to-Ship Date`
  preserves the original and prior revisions in history, displays the current
  value as `Updated Estimated Ready-to-Ship Date`, and sends one email and one
  matching Personal Center notification identifying the affected Shipment. In
  a split Order, only the selected Shipment date changes. A date-only revision
  does not issue a replacement PI. Any accompanying price, quantity, or
  transport-term change follows its existing commercial-change and
  customer-acceptance workflow.
- Factory Mobile activity never advances Customer Order Progress. After the
  factory or logistics provider reports completion through the normal external
  operating process, Owner/Admin explicitly marks the applicable Shipment
  `Ready to Ship`. Actual carton dimensions, weights, or website-generated
  customs documents remain optional under the existing packing rules and are
  not new gates for that action.
- Marking a Shipment `Ready to Ship` sends one email and one matching Personal
  Center notification. Until then, its customer-facing state remains `Order
Confirmed` without speculative intermediate progress.
- In a confirmed Split Shipment plan, each Shipment triggers that notification
  independently as soon as Owner/Admin marks it `Ready to Ship`; the system does
  not wait for every Shipment in the Order. The email and Personal Center event
  identify `Shipment X of N` and list the products and quantities allocated to
  that Shipment. Other Shipments keep their existing states.
- `Ready to Ship` is informational and does not display `Approve Shipment`,
  `Confirm`, or another customer action. The page and notification state `No
action is required. Tracking details will be sent after dispatch.` Shipment
  proceeds under the accepted PI without a second customer approval.
- Each Shipment displays its own status, carrier, tracking number, tracking
  link, included quantities, and Estimated Ready-to-Ship Date. A confirmed Split
  Shipment plan labels these sections `Shipment 1 of N`, `Shipment 2 of N`, and
  so on. A Ship Together Order has one Shipment section and one date.
- A multi-shipment Order summarizes completion using language such as `1 of 2
shipments delivered`.
- Customer Order Progress is derived from the explicit Shipment milestones.
  Admin users cannot replace it with free-text progress or expose internal
  factory milestones as customer statuses.

## Launch Shipment Tracking

- Launch does not require a paid carrier-aggregation API. Operations records
  the carrier, tracking number, carrier tracking URL, ship date, estimated
  delivery date, and delivered status.
- Marking a Shipment `Shipped` requires only actual ship date and carrier name.
  Tracking number, tracking URL, and estimated delivery date are optional at
  dispatch because a freight forwarder may provide them later.
- Until a usable tracking number or URL is recorded, the Personal Center shows
  `Tracking pending` and does not render an inactive `Track Shipment` action.
  Adding tracking information later updates the existing Shipment without
  changing its ship date or creating another status transition.
- Launch does not create or expose a dedicated `Customs Review` status and does
  not send customs-entry or customs-release notifications. A dispatched Order
  remains `Shipped`; customers use the carrier tracking link or ask Support for
  clarification.
- A Shipment may contain multiple Package Tracking Records and tracking
  numbers. The Personal Center lists each package under its Shipment.
- `Track Shipment` opens the recorded carrier tracking page; the website does
  not represent manually entered progress as live carrier data.
- Operations marks delivery based on carrier information. The data model keeps
  a carrier-event adapter boundary for later integration with a tracking
  aggregator or carrier webhook.
- A Shipment without a tracking number may still be marked `Delivered` through
  Manual Delivery Confirmation. The admin must enter actual delivery date and
  select `Carrier Confirmation` or `Customer Confirmation` as the source.
  Supporting proof of delivery is an optional private Shipment Document rather
  than a status prerequisite.
- Personal Center does not provide a `Confirm Delivery` button at launch. A
  customer may confirm receipt through Support chat or email; an Owner or
  authorized Admin Subaccount records that communication as `Customer
Confirmation` and enters the actual delivery date. Customer communication
  never changes Shipment status directly.
- When a Shipment first enters `Shipped` and when it enters `Delivered`, the
  application sends the customer an email and records the same event in the
  Personal Center. Each transition emits once; later edits to carrier, tracking
  number, URL, or estimated delivery date update the detail without resending
  the original status notification.
- Adding a tracking number after dispatch does not send a separate email or
  Personal Center notification. The new tracking information and active `Track
Shipment` action appear when the customer next views the Order.
- Customs Review remains absent from the website status model and never emits a
  customer notification. Customers may ask Support about customs progress.
- If a DDP Shipment ultimately cannot be delivered because of the seller's
  declaration, documentation, or product-compliance failure, Operations records
  a Seller-Caused Customs Failure. The customer may choose a no-cost replacement
  Shipment or a full seller-caused refund.

## Pre-dispatch Cancellation Requests

- An Order containing an eligible, unshipped Standard Product provides `Request
Cancellation`. Submission creates a Cancellation Request for Operations
  review; it does not automatically cancel the Order or authorize a refund.
- The customer selects the specific Order lines and quantities requested for
  cancellation. Eligible Standard Product quantities may be requested without
  requiring cancellation of the entire Order; ineligible or already Shipped
  quantities cannot be selected.
- Submission immediately applies a Cancellation Review Hold to the requested,
  eligible, unshipped quantities. Those quantities cannot be assigned or
  released to a Shipment or marked Shipped until Operations resolves the
  request. Unrelated Order lines and quantities continue through fulfillment.
- Quantities already handed to the logistics provider or marked Shipped do not
  enter the hold and are shown as ineligible before submission.
- Operations reviews whether the affected products have been handed to the
  logistics provider and identifies any documented, non-refundable bank,
  payment-channel, booking, or other third-party costs before approving or
  declining the request.
- An approved customer-requested cancellation may deduct only those disclosed
  actual non-refundable costs where permitted. The seller does not add an
  administrative cancellation fee or markup.
- Once the applicable Shipment is marked `Shipped`, convenience cancellation is
  unavailable. After delivery, the customer uses the After-sales Case and return
  process.
- Made-to-order Hose Assemblies do not expose a customer cancellation or
  specification-change action after Production Approval. If the customer
  reports a configuration error through Support, an authorized admin may open
  an Administrative Assembly Cancellation Review using current factory
  information. The website does not calculate eligibility from cutting,
  crimping, assembly, or completion milestones.
- A Length-Based Hose Order is also made to order. After Cleared Funds are
  confirmed, a customer seeking cancellation contacts Support; an authorized
  admin checks actual factory progress. The admin may approve cancellation
  before cutting begins. Once cutting has begun, convenience cancellation is
  declined. The website does not infer cutting status from payment time or a
  fixed countdown.
- When cancellation is approved before cutting begins, the Cutting & Labeling
  Fee is refunded in full. The cancellation resolution may deduct only
  previously disclosed, actual, non-refundable bank or third-party costs and
  never adds an administrative fee.
- The admin either declines cancellation and leaves the approved assembly in
  fulfillment, or approves cancellation through a Cancellation Resolution with
  the applicable Refund Fee Allocation. The approved specification is never
  edited. Seller error, Nonconforming Product, and inability to supply remain
  separate remedies.
- A corrected Hose Assembly is always configured again and purchased through a
  new Follow-on Quote, PI, payment, and Order regardless of whether the admin
  approves cancellation of the original assembly.
- Approval creates an immutable Cancellation Resolution rather than editing the
  original PI or Confirmed Order. It records approved and declined line
  quantities, actor, reason, timestamps, customer-visible explanation, and all
  merchandise, logistics, tax, permitted-cost, and refund adjustments.
- Approval converts the held quantity to cancelled quantity; decline releases
  the hold back to normal fulfillment. Resolving one request does not change
  quantities outside that request.
- Operations recalculates the remaining packing and logistics requirement for
  the uncancelled quantities. Freight is not refunded in proportion to cancelled
  merchandise by default; the resolution returns only the logistics amount that
  is actually recoverable after the revised shipment plan, together with any
  applicable merchandise and tax adjustments and less permitted documented
  costs.
- A post-payment quantity reduction handled by Cancellation Resolution does not
  create a replacement PI. Quote Revision and replacement PI remain the path for
  a customer-requested quantity or logistics change before Confirmed Order
  creation.

## After-sales Cases and Returns

- An Order detail provides one customer-facing action: `Request Return or
Report a Problem`.
- An eligible, unused Standard Product may enter the convenience-return path
  only when the customer submits the After-sales Case within 14 calendar days
  after the actual delivery date of the Shipment containing that quantity. The
  date is evaluated per Shipment rather than from Order creation or payment.
- Submission within the Convenience Return Request Window starts review; it does
  not automatically issue a Return Authorization, approve a refund, or prove
  that the returned product is unused and eligible.
- RA authorizes shipment to the Return Location for inspection and does not
  pre-approve a refund. Convenience-return merchandise must be unused,
  uninstalled, undamaged, complete with supplied accessories, and in original
  packaging where reasonably applicable.
- Authorized merchandise must arrive at the Return Location within 30 calendar
  days after RA issuance. The RA displays its expiration date. If the return is
  not received by that date, the authorization expires; the customer must
  contact Support for a new review, and renewed authorization is not guaranteed.
- Return inspection records the condition of threads, sealing surfaces, finish,
  accessories, packaging, and any evidence of installation or fluid exposure.
  Operations uses the documented result when approving, reducing, or declining
  the merchandise refund.
- A post-delivery merchandise refund involving physical return cannot be
  approved until the Return Location records the authorized quantity as
  received and Operations completes its inspection. RA issuance,
  customer-provided return tracking, and carrier in-transit status never trigger
  refund approval.
- The Return Inspection Gate also applies when returned merchandise is alleged
  to involve seller error or a Nonconforming Product. Pre-dispatch cancellation,
  inability to supply, and other refunds where no product was delivered remain
  outside this gate.
- Operations completes return inspection and records `Approved`, `Partially
Approved`, or `Declined` within 5 business days after the authorized return is
  received at the Return Location. The deadline uses the US Business Calendar
  rather than the China Fulfillment Calendar.
- An overdue inspection creates an Owner/Admin reminder and overdue indicator.
  It does not automatically approve a refund, change merchandise condition, or
  bypass the Return Inspection Gate.
- Recording `Approved`, `Partially Approved`, or `Declined` sends an email and
  writes the same event to the Personal Center. A partial or declined decision
  cannot be saved without a customer-visible reason.
- A partial approval presents the approved returned merchandise amount,
  Convenience Return Restocking Fee, Sales Tax adjustment, any other approved
  adjustment, and final refund amount. The customer is not shown only an
  unexplained net number.
- Return Inspection Evidence is stored in private R2 and defaults to `Internal`.
  Inspection photographs and files are not automatically included in the email
  or Personal Center decision.
- An Owner or authorized Admin Subaccount may explicitly share selected evidence
  that directly supports a customer-visible partial approval or decline reason.
  Sharing selected files never exposes the remaining internal evidence set or
  its object-storage URLs.
- A customer who disagrees replies in the original After-sales Case conversation;
  launch does not create a separate appeal object, queue, or customer form.
- An Owner or authorized Admin Subaccount may record an Inspection Decision
  Revision with the prior and new decision, reason, actor, and timestamp. The
  revision is communicated through the same case and does not delete the
  original decision.
- When the original refund has already been initiated, an increased approved
  amount creates a Supplemental Refund with its own amount, channel, initiation
  date, and external reference. It never edits or replaces the earlier refund
  record.
- An approved customer-choice convenience return deducts a 10% restocking fee
  calculated from the discounted merchandise amount of the approved returned
  quantity. The customer is responsible for return shipping to the authorized
  Return Location and must not send merchandise before RA instructions are
  issued.
- Original DDP Shipping & Import Charges are not refunded for a customer-choice
  return after delivery because that outbound logistics and import service has
  been performed. The refund is based on approved returned merchandise less the
  restocking fee, with Sales Tax adjusted under the applicable tax treatment.
- Seller error and a Nonconforming Product do not incur a restocking fee. The
  seller bears reasonable return or replacement logistics for an approved
  seller-funded remedy, including the appropriate original logistics and import
  charge adjustment when a refund is the selected remedy.
- The customer selects Order lines and quantities, chooses a reason, describes
  the issue, and uploads supporting photographs or documents. Submission
  creates an After-sales Case, not an automatic Return Authorization.
- The website uses delivery date and product type to explain apparent policy
  eligibility, but Operations decides whether to authorize a return, replace a
  product, record a refund, request more evidence, or decline the request.
- Made-to-order Hose Assemblies do not offer convenience return after Production
  Approval, but customers may still report seller error or a possible
  Nonconforming Product.
- Cut-length hose supplied through a Length-Based Hose Order does not offer a
  convenience return after cutting. Customers may still report a manufacturing
  defect, seller specification error, or another possible Nonconforming
  Product.
- A seller-funded refund or replacement remedy for seller error or a
  Nonconforming cut-length hose includes the associated Cutting & Labeling Fee;
  the seller does not retain that service fee from the customer's remedy.
- A US Return Location address and return instructions become visible only
  after Operations issues an RA for that case. The public storefront does not
  invite unsolicited returns to that address.
- The website records an externally completed refund or payment adjustment but
  does not automatically move money.
- After Operations approves a refund, the seller initiates it within 10 business
  days under the US Business Calendar. The backoffice records refund amount,
  payment channel, initiation date, and external reference number.
- The customer-facing status distinguishes `Refund approved` from `Refund
initiated` and states that bank or PayPal posting time may vary. The
  10-business-day commitment applies to seller initiation, not final posting to
  the customer's account.
- Refunds use the actual receipt channel whenever available, including when the
  payment arrived through superseded Payment Instructions. PayPal returns through
  the original PayPal transaction; WorldFirst or bank payments return to a
  verified account belonging to the same Individual Customer or Organization
  Purchasing Context.
- When the original destination is unavailable, an Owner or authorized Admin
  Subaccount may approve a verified alternative account and must record the
  reason. Launch does not offer cash refunds or automatically convert refunds
  into store credit.
- An approved refund caused by seller error, inability to supply, or a
  Nonconforming Product is seller-funded, so the customer receives the full
  approved refund amount without payment-channel or bank-fee deductions.
- For a customer-caused overpayment, input error, or permitted convenience
  cancellation, the refund may deduct only documented, non-refundable
  third-party bank or payment-channel costs where allowed by applicable law and
  the accepted terms. No administrative handling fee or markup is added.
- Before a customer-caused refund is processed, the Personal Center or Quote
  Conversation presents the gross amount, each supported deduction, and net
  refund amount for customer confirmation. The Admin Audit Event retains the
  evidence and external refund reference.

## RFQ to Confirmed Order

1. A customer submits a Verified RFQ; no payment is taken by the website.
2. The Admin Backoffice reviews technical compatibility, product pricing,
   freight, trade terms, lead time, and destination information.
3. The seller issues a PI containing products, quantities, trade terms, lead
   time, payment terms, cancellation scope, and refund conditions. Owner/Admin
   selects exactly one PI Payment Channel and pastes that PI's complete Payment
   Instructions. The same email provides the fixed PI PDF, the current Payment
   Instructions, and the Personal Center acceptance entry point.
4. The customer views or downloads the PI in the Personal Center and expressly
   accepts the PI and final specifications.
5. Owner/Admin verifies receipt in WorldFirst, the bank, or PayPal outside the
   website, then uses `Mark Payment Confirmed` in the Admin Backoffice. A
   remittance screenshot is not payment confirmation.
6. When `Mark Payment Confirmed` completes the last missing condition, the
   system atomically creates the Confirmed Order and initializes fulfillment.
   Standard Product and Length-Based Hose Order lines enter preparation;
   made-to-order Hose Assembly lines enter the production queue. There is no
   separate `Create Order` button.

The same rule applies in reverse order. If Owner/Admin has already recorded
full Cleared Funds for the current PI, valid PI acceptance atomically creates
the Confirmed Order as soon as every required specification approval is also
present. No additional admin action or repeated payment confirmation is needed.

## Automatic Hose Assembly Production Package

- Confirmed Order creation automatically creates one order-level Assembly
  Production Package when the Order contains one or more made-to-order Hose
  Assembly lines. The package contains all such lines; it is not a second batch
  object and does not create a separate package for every line. Standard
  Products and Length-Based Hose Orders do not receive Hose Assembly production
  records or labels.
- For each Hose Assembly line, the package snapshots the accepted finished
  length, End A and End B Hose End and Ferrule SKUs, clocking where applicable,
  installed protection, application data, quantity, proof-test pressure, and
  resolved Proof Test Hold Time. It does not expose customer payment details or
  internal margin to the factory.
- The application assigns one unique Assembly Number and creates one Assembly
  Record for each physical assembly in the ordered quantity. It generates the
  order-level Production Instruction PDF, Assembly Label Pack with
  per-assembly QR codes, and Factory Batch Access QR/link as parts of that same
  package.
- The Production Instruction PDF uses the approved bilingual factory template:
  each field name is shown in Simplified Chinese and English, while each SKU and
  technical code is rendered once as the authoritative identifier. Finished
  Overall Assembly Length shows the customer-approved original value/unit and
  the stored exact millimetre equivalent together, for example `72 in / 1828.8
mm`. Assembly Length Tolerance uses the same original-plus-metric
  presentation.
- Production Instruction generation reads both displayed length values from the
  approved specification and its canonical unit conversion. The document
  template cannot independently recalculate, manually edit, or silently round
  either value. When the approved original unit is already millimetres, that
  value remains authoritative without a redundant duplicate.
- `Assembly Working Pressure / 总成工作压力` and `Proof Test Target / 耐压测试目标`
  appear as system-generated `psi / MPa` pairs in both the bilingual Production
  Instruction and Factory Mobile, for example `5,800 psi / 40 MPa`. Both views
  read the same canonical pressure values and conversion service; the worker
  does not enter or calculate either unit.
- Proof Test Target is calculated from the canonical unrounded Assembly Working
  Pressure under the approved Proof Test rule. Fixed display precision may
  format the PSI and MPa values for readability, but a displayed rounded value
  is never fed back into the test-target calculation or saved as a separate
  competing pressure source.
- The Assembly Label Pack is customer-facing physical output and therefore uses
  English field labels with the unchanged standard codes.
- `Bulk Export Assembly QR Labels` exports a print-ready PDF with one label for
  every physical assembly. Owner/Admin may export all labels in the Order or
  select particular Hose Assembly lines. Labels are ordered by Order line and
  piece index and each contains its unique Assembly Number and QR code; a line
  with quantity 20 therefore produces 20 distinct labels in the bulk export.
- The batch export is a multi-page roll-label PDF, with exactly one physical
  label per PDF page. It does not generate an A4 grid or require labels to be
  cut apart. Page dimensions come from the active Admin-configured Label Print
  Profile: label width, height, orientation, margins, and QR-code size.
- No label dimensions are hardcoded until the factory's actual printer and
  consumables are confirmed. Launch supports exact-size PDF output through the
  printer driver and does not require printer-specific ZPL generation. The
  operating procedure uses oil-, water-, and abrasion-resistant synthetic
  label material rather than ordinary paper; the website controls layout but
  does not claim to verify the loaded consumable.
- `Reprint Assembly QR Labels` lets Owner/Admin select one or more active
  Assembly Numbers and regenerate labels with the same numbers and QR codes.
  The action does not require a reason, display or maintain a reprint count, or
  create new Assembly Numbers. It cannot reactivate a Failed Assembly Record or
  reuse an invalidated number; a Replacement Assembly receives a new Assembly
  Number and its own label.
- Each physical Hose Assembly uses one durable QR label from production through
  Proof Test, inspection, packaging, and delivery. Launch does not print a
  separate temporary work-in-process label or require final relabelling. When
  an assembly fails, the factory destroys that label, the Assembly Number stays
  invalidated, and any Replacement Assembly receives a new number and label.
- These generated materials appear immediately in the Admin Backoffice for
  review, download, printing, or sharing. Owner/Admin sends the selected link
  or PDF to the factory through the existing external WeChat or email process.
  Launch has no WeChat sending API and does not claim that automatic generation
  means the factory received or started the task.
- Launch does not provide `Mark Sent to Factory`. The first successful opening
  of the Factory Batch Access link records `Factory Link Opened` with its UTC
  timestamp. Repeat opens do not replace the first-open timestamp. This proves
  only that the link opened and is not a factory acceptance receipt.
- The first start photograph uploaded through Factory Mobile for any Assembly
  in the package records the package-level `Production Started` milestone. This
  is an internal workflow signal, not a verified cutting or crimping start time.
  Neither milestone appears in the customer timeline or triggers a customer
  notification.
- There is no separate `Release Production` button. Factory receipt and work
  begin through the existing scan-and-upload workflow. If a Payment
  Confirmation Review Hold is later applied, Factory Mobile shows the hold and
  blocks further production completion or shipment approval until Owner
  resolves it; generated identifiers and audit history are preserved.

## Assembly Verification and Customer Orders

- Personal Center Orders show ordered product lines, quantities, commercial
  documents, Shipment dates, statuses, and tracking information. They do not
  list, group, search, or expand every physical Assembly Number and do not
  provide a My Assemblies navigation item.
- The unique QR code on a delivered Hose Assembly opens Public Assembly
  Verification directly for that one physical assembly. The minimal record
  shows its Assembly Number, final approved specification summary, and Proof
  Test passed status/date.
- The QR URL contains a high-entropy random Assembly Verification Token, never
  a sequential or guessable Assembly Number. D1 stores an indexed hash for
  token lookup rather than the raw token. The rendered page may display the
  Assembly Number after a valid token resolves.
- Public verification responses include page metadata and an HTTP
  `X-Robots-Tag` that prohibit indexing and archiving, and these URLs never
  enter an XML sitemap or internal browse list. Invalid tokens receive the same
  generic not-found response, and the public route is rate-limited to reduce
  automated enumeration.
- The Assembly Verification Token is a long-lived, read-only identifier for the
  finished product. It is separate from time-limited Factory Batch Access and
  cannot authorize uploads, factory actions, Personal Center access, or Admin
  Backoffice access.
- Public Assembly Verification reports the approved manufacturing specification
  and Proof Test result/date recorded at the factory. It does not monitor field
  use and does not claim that the assembly is currently serviceable, has a
  particular remaining life, or remains suitable for continued use. Launch has
  no manual `Invalidate Assembly` status; a field problem reported by the
  customer proceeds through the normal support and After-sales Case workflow.
- The QR result contains no customer identity, Order number, price, payment,
  delivery address, factory note, operator identity, production stage, Proof
  Test process photograph, or final-product process photograph. It is not
  discoverable as a customer-account list.
- A minimal per-assembly record remains necessary in D1 to resolve a unique QR
  and its test result. The complete Assembly Record remains internal for factory
  and Admin traceability; neither record is rendered as a per-item list in the
  customer's Order or Personal Center.

## Manual Payment Module

An issued or Accepted PI without Cleared Funds remains a PI and does not enter
production or become a Confirmed Order.

Launch has no WorldFirst, bank, or PayPal balance feed, reconciliation API, or
payment-status webhook. `Mark Payment Confirmed` records the current PI, actor,
UTC timestamp, and the PI Total Due as confirmed. An external transaction
reference or internal note is optional. Payment states in the application are
manually initiated workflow controls, not independent evidence of bank or
payment-provider activity. The action is idempotent: a retry or repeated click
cannot create a duplicate payment confirmation or a second Order for the same
accepted PI.

- Before committing `Mark Payment Confirmed`, the Admin Backoffice shows a
  confirmation dialog with the PI number, customer, currency, and Total Due,
  and states whether the action will immediately create an Order.
- An erroneous confirmation is not deleted, edited in place, or reversed with
  a simple paid/unpaid toggle. Owner/Admin uses `Correct Payment Confirmation`
  and must enter a reason. The application appends a correction containing the
  original confirmation, correcting actor, UTC timestamp, and resulting
  workflow state.
- If the correction occurs before Order creation, the PI returns to the state
  implied by its acceptance and required specification approvals, normally
  `Payment Pending` for an Accepted PI.
- If the mistaken confirmation already created a Confirmed Order, the Order and
  its historical links remain intact. The application immediately applies a
  `Payment Confirmation Review Hold` that blocks new production release and
  dispatch until Owner records a resolution. Existing work and records are not
  silently erased.
- Owner may resolve the hold by recording a valid payment confirmation and
  resuming fulfillment, or by recording the appropriate cancellation or other
  commercial resolution. The correction itself does not issue a refund or
  cancel the Order.

### Payment Actions and Guards

| Admin action                   | Guard                                                                                                                                                                                  | Result                                                                                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Issue PI`                     | Current Quote Revision is ready; PI validity and Payment Due terms are valid; one Payment Channel and non-empty Payment Instructions are present; Seller Registered Address is present | Creates the immutable PI PDF and separate Payment Instructions version, then sends both to the customer                                                                                                                                                                                             |
| `Update Amount Received`       | Current PI has no Payment Confirmation; entered cumulative amount is at least zero, in PI currency, and below Total Due                                                                | Updates the single cumulative Amount Received, derives Remaining Balance, and appends old amount, new amount, actor, and UTC timestamp; a decrease also requires a reason                                                                                                                           |
| `Change Payment Channel`       | No Partial Funds Received or Cleared Funds; Total Due and currency are unchanged                                                                                                       | Versions the Payment Instructions and notifies the customer; PI acceptance and Payment Due Date remain unchanged                                                                                                                                                                                    |
| `Extend Payment Deadline`      | PI is Accepted; selected ET date is later than the current Payment Due Date                                                                                                            | Versions the deadline, notifies the customer, and returns an overdue PI from `Payment Review Required` to `Payment Pending`; it does not confirm payment                                                                                                                                            |
| `Mark Payment Confirmed`       | Owner/Admin has externally verified full net Total Due                                                                                                                                 | Idempotently records Cleared Funds. A current Accepted PI with required approvals and valid commercial terms atomically creates one Confirmed Order; an unaccepted PI becomes `Funds Received - Acceptance Pending`; an expired, superseded, or overdue PI enters the applicable manual review path |
| `Approve Late Payment`         | Full Cleared Funds were received after Payment Due Date and Sales revalidated the accepted terms                                                                                       | Applies the verified payment to the normal Order-creation conditions; changed terms require a replacement PI instead                                                                                                                                                                                |
| `Correct Payment Confirmation` | A Payment Confirmation exists and Owner/Admin supplies a reason                                                                                                                        | Appends a correction. Before Order creation it restores the implied PI state; after Order creation it applies Payment Confirmation Review Hold                                                                                                                                                      |

The customer cannot mark a PI paid, upload a remittance screenshot as payment
evidence, create an Order, release production, or bypass any action guard. The
application never creates more than one Confirmed Order from the same Accepted
PI.

## Additional Purchases After Order Creation

- A Confirmed Order is never reopened to add products, quantities, or a new Hose
  Assembly specification. Order detail provides `Add More Items`, which starts
  a new Quote List while preserving a reference to the originating Order.
- Submission creates a Follow-on Quote with its own RFQ, PI, acceptance,
  Cleared Funds, and Confirmed Order. The original PI, payment allocation, Order
  lines, and specification approvals remain unchanged.
- Sales may quote a coordinated dispatch with the earlier Order when fulfillment
  timing and commercial terms permit. This is not automatic and must be
  reflected in the new quote's logistics amount and shipment plan.
- The Follow-on Quote may offer `Request Combined Shipping` only while the
  originating Order has not entered carrier handoff. Selecting it creates a
  non-binding Combined Shipping Request and does not pause or delay the
  originating Order.
- Operations confirms feasibility before PI issuance. When consolidation would
  delay the originating Order, the Follow-on PI must show the revised concrete
  dispatch plan and Estimated Ready-to-Ship Date. Customer acceptance of that
  PI records agreement to the delay; without acceptance, the originating Order
  continues under its existing plan.
- Once the originating Order has entered carrier handoff or is marked Shipped,
  combined shipping is unavailable and the Follow-on Quote must use a separate
  dispatch plan.
- If Operations ultimately sends the purchases together, it creates a
  Consolidated Dispatch containing separate Shipment records for each Order.
  Each Order retains its own line allocation, logistics allocation, status,
  documents, and audit history even when carrier or tracking data are shared.

## Pre-dispatch Delivery Address Changes

- Order detail provides `Request Address Change` only for Shipments that have
  not entered carrier handoff. The customer selects the affected Shipment and
  submits a replacement delivery address; editing an Address Book entry never
  changes an existing Order.
- Submission creates a Delivery Address Change Request and places only the
  affected unshipped Shipments on hold. Unaffected Shipments may continue.
- Operations validates the new address and re-confirms carrier availability,
  DDP or DAP treatment, freight, import charges, and applicable Sales Tax
  Treatment before approving or declining the request.
- Approval produces an Order Change Confirmation showing the original and new
  address snapshots, affected Shipments, revised commercial terms, additional
  amount due or refund due, and the resulting dispatch plan. The original PI
  and Order history are never overwritten.
- The customer must explicitly accept the Order Change Confirmation. When an
  additional amount is due, the hold remains until the full additional amount
  is Cleared Funds; a payment screenshot does not release the Shipment. When an
  amount is refundable, the system records the approved refund adjustment and
  external refund reference.
- The hold is released only after all required acceptance and financial
  conditions are complete, or after Operations declines the request and the
  original address remains effective.
- Customer silence, non-acceptance, or an unpaid additional amount never causes
  automatic dispatch to the original address. The affected Shipment remains on
  hold until an explicit resolution is recorded.
- Before an Order Change Confirmation takes effect, the customer may select
  `Withdraw Address Change Request`. The resulting Order Change Withdrawal
  releases the hold and resumes fulfillment to the original accepted address;
  the request and withdrawal remain in history.
- If the request remains unresolved, Operations contacts the customer and
  manually continues the hold or applies the existing customer-caused
  cancellation rules where cancellation is permitted. The system does not
  choose an address or cancellation outcome automatically, and Production
  Approval restrictions continue to apply to made-to-order products.
- Once a Shipment enters carrier handoff, the website disables address-change
  submission and directs the customer to contact the carrier. It does not
  promise that a carrier redirect is available or successful.

## Pre-dispatch Shipping Changes

- Before carrier handoff, Order detail provides `Request Shipping Change` for
  an eligible Shipment. The customer may request a different transport mode,
  expedited service, or a split into multiple planned Shipments; the customer
  cannot directly edit the accepted shipping plan.
- Submission creates a Shipping Change Request and holds only the affected
  Shipment. Operations re-confirms carrier feasibility, freight, insurance,
  estimated timing, packing plan, and DDP or DAP treatment.
- Approval produces an Order Change Confirmation that preserves the original
  plan and records the requested and approved plan, affected Shipments,
  financial adjustment, and revised dispatch dates.
- The change becomes effective only after explicit customer acceptance and any
  additional amount is Cleared Funds. A refundable difference is recorded as an
  approved refund adjustment; the original PI and Order history are not
  overwritten.
- Customer silence never activates the requested change or resumes fulfillment.
  Before the confirmation takes effect, the customer may submit an Order Change
  Withdrawal, which releases the hold and restores the original accepted plan.
- Once carrier handoff begins, the website disables Shipping Change Requests and
  does not promise a carrier-side service change.

## PI Acceptance Evidence

- An issued PI is valid for 14 calendar days by default. An authorized Admin
  Backoffice user may set a different validity deadline for an individual PI,
  and the exact deadline appears in customer-facing PDF, Personal Center, and
  email as `ET` using `America/New_York`. Admin Backoffice shows the same instant
  in Beijing Time.
- An unaccepted PI becomes an Expired PI at its validity deadline. It remains
  available in quote history but its acceptance controls are disabled and the
  customer is offered `Request Updated Quote`.
- The PI validity deadline governs whether an issued offer can be accepted. The
  payment deadline after acceptance is a separate commercial rule.
- The default Payment Due Date is 10 business days after PI acceptance. A US
  business day is Monday through Friday in `America/New_York`,
  excluding configured US federal bank holidays. This US Business Calendar is
  maintained independently from the China Fulfillment Calendar. Before PI
  acceptance, the PI and accompanying Payment Instructions display `Payment due
within 10 US business days after PI acceptance` rather than a calendar date.
  Acceptance calculates and snapshots the concrete default deadline, which is
  then shown in ET in My Quotes and corresponding customer communication.
- An authorized Admin Backoffice user may instead set a fixed Payment Due Date
  before PI issuance by selecting an ET calendar date. The system fixes that
  override at `11:59 PM ET`, while Admin Backoffice displays the same instant in
  Beijing Time. The fixed date must be later than the PI validity deadline;
  otherwise the system blocks PI issuance.
- Once a PI is issued, its payment term and any fixed Payment Due Date cannot be
  edited in place. Before acceptance, changing either requires a replacement PI;
  the superseded PI remains immutable history.
- After PI acceptance, Owner or an authorized Admin Subaccount may use `Extend
Payment Deadline` to select only a later ET date. The action does not replace
  or alter the accepted PI, but it appends the prior deadline, new deadline,
  actor, and UTC timestamp to the audit history and sends one email plus a
  matching Personal Center notification. The control rejects an unchanged or
  earlier date and does not permit deadline shortening. If the PI is in
  `Payment Review Required` and the extended deadline is in the future, the
  action returns it to `Payment Pending` and clears the overdue indicator. It
  does not record Cleared Funds, create an Order, or release production.
- The deadline is satisfied only by full Cleared Funds. A remittance screenshot
  or customer-stated transfer date does not satisfy it.
- Each issued PI has exactly one PI Payment Channel, selected by Owner/Admin as
  `Bank Transfer` or `PayPal`. Payment Instructions expose only the selected
  channel; the customer does not choose between simultaneous payment methods.
- Launch does not require a structured or reusable Payment Beneficiary Profile.
  Owner/Admin pastes a required multiline plain-text Payment Instructions block
  while preparing each PI. The application preserves line breaks, sanitizes the
  content, renders valid `https` links such as a seller-issued PayPal link as
  clickable, and never parses, infers, translates, or auto-corrects bank fields.
  Arbitrary HTML is not accepted.
- PI issuance snapshots the exact Payment Instructions text and is blocked when
  the selected channel has no instructions. Historical snapshots remain readable
  in audit history after an authorized instruction or channel change.
- Payment Instructions are a separately versioned panel in the same My Quotes PI
  detail and the same transactional email as the fixed PI PDF. They are not
  embedded in the PI PDF, included in its document hash, or included in PI View
  Evidence or the PI Acceptance Record. Launch does not require a separate
  Payment Instructions PDF.
- Before any `Partial Funds Received` or Cleared Funds are recorded, Owner/Admin
  may use `Change Payment Channel` when Total Due and currency remain unchanged.
  The action keeps the current PI, replaces the current Payment Instructions,
  records old channel, new channel, actor, and UTC timestamp, and emails the
  updated instructions with a matching Personal Center notification. The
  customer's PI acceptance remains valid. The change does not recalculate or
  extend the Payment Due Date; Owner/Admin must use the separate `Extend Payment
Deadline` action when an extension is intended. If Total Due or currency
  changes, the seller must issue a replacement PI instead.
- A customer payment sent under superseded Payment Instructions is not rejected
  solely because the channel changed. When Owner/Admin verifies that the full
  funds settled in a seller-controlled account and match the PI, `Mark Payment
Confirmed` records the actual receipt channel and `Paid via Superseded
Instructions`. The customer is not asked to pay again.
- Bank-transfer Payment Instructions state that the payer is responsible for
  remitting-bank and intermediary-bank charges. The net amount settled in the
  seller's receiving account must equal the PI Total Due.
- Launch does not build a per-transfer reconciliation ledger. When Owner/Admin
  externally verifies a settled shortfall, `Update Amount Received` stores one
  cumulative amount in the PI currency and derives the remaining balance. Each
  update appends previous amount, new amount, actor, and UTC timestamp; a lower
  correction additionally requires a reason. My Quotes shows Amount Received and
  Remaining Balance, while its primary label remains `Quote Ready` before PI
  acceptance and `Payment Pending` after acceptance. No Order or production is
  released. After externally verifying full Total Due, Owner/Admin uses the
  separate `Mark Payment Confirmed` action.
- A seller-issued PayPal payment link charges the exact customer-facing amount
  stated in the instructions. PayPal processing fees are borne internally by
  the seller and are not added after payment or collected as a later shortfall.
- When Owner/Admin manually records full Cleared Funds against the current
  issued PI before acceptance, the application records `Funds Received -
Acceptance Pending`. It sends an email and matching Personal Center prompt
  asking the customer to accept the PI, and does not create a Confirmed Order
  or release production or dispatch.
- Once valid PI acceptance is later recorded, the normal Order-creation
  conditions are evaluated using the already confirmed funds. If all required
  specification approvals are present, the application atomically creates the
  Confirmed Order and initializes fulfillment. It does not require another
  Owner/Admin action, a second payment, or a repeated payment confirmation.
- When Owner/Admin manually records externally verified funds against an
  Expired PI or a superseded PI, the application records `Funds Received - PI
Review Required`. The funds remain traceable to the historical PI but are not
  automatically applied to a current offer and do not create a Confirmed Order
  or release production or dispatch.
- Owner/Admin reviews current pricing, availability, freight, trade terms, and
  lead time. If the commercial terms can still be honored, the seller issues a
  new current PI on those terms; if they have changed, the seller issues a
  revised Quote and replacement PI. An expired or superseded PI remains an
  immutable historical version and is not reactivated.
- The customer must accept the new current PI and authorize allocation of the
  received funds to it before the normal Order-creation conditions are
  evaluated. The customer may instead request a refund; any balance or excess
  is handled through the existing payment-adjustment and refund rules.
- Any settled amount above the applicable PI Total Due is recorded as
  `Unallocated Excess Funds`. It does not increase the Order value and is not
  automatically converted into customer account credit.
- With the verified customer's written authorization, excess funds may be
  refunded to the originating payment channel or allocated to another valid PI
  belonging to the same Purchasing Context. The allocation or refund records
  actor, authorization, amount, currency, timestamp, and external reference.
- Launch does not provide a Store Credit balance. Unresolved excess funds stay
  visible in the Admin Backoffice until reconciled rather than disappearing
  into a general payment total.
- If full Cleared Funds are absent after the Payment Due Date, the Accepted PI
  moves to `Payment Review Required`. It is not automatically cancelled, but no
  Confirmed Order is created and no production or dispatch is released until
  the seller completes the review.
- When Owner/Admin records externally verified Cleared Funds after the Payment
  Due Date, the action does not automatically create an Order. Sales revalidates
  product pricing, availability, freight, trade terms, and lead time before
  applying the payment to the order-creation workflow.
- If the original terms can still be honored, an authorized Admin Backoffice
  user approves the late payment and the normal Order-creation conditions are
  evaluated. If terms changed, the seller creates a Quote Revision and
  replacement PI; production remains blocked until the customer accepts it.
- For changed terms, the customer may authorize application of the received
  funds and pay a balance, receive an agreed excess refund, or request a full
  refund. The system records the late-payment decision, actor, timestamps,
  amount allocation, adjustment, and any external refund reference.
- The customer opens the fixed PI PDF version in the Personal Center before
  acceptance.
- `View PI` must successfully open the current fixed PDF once before the
  acceptance controls become available. The application records PI View
  Evidence containing the customer identity, UTC timestamp, PI version, and
  document hash.
- `Download PI` is an equivalent fallback when in-browser preview fails. Either
  path records PI View Evidence only after the authorized file response
  successfully returns the current fixed PDF; an attempted click, failed
  request, expired signed URL, or wrong-version response does not satisfy the
  requirement.
- Launch does not require a countdown, minimum viewing duration, forced scroll,
  page-by-page acknowledgement, or inferred reading completion.
- PI View Evidence and acknowledgement state are version-scoped. Issuing a
  replacement PI clears the new version's acceptance controls until the customer
  opens that fixed PDF and completes its acknowledgements. The superseded
  version's evidence remains immutable history and never satisfies the new PI.
- If the customer cannot complete the website flow and confirms by email, an
  Owner or authorized Admin Subaccount may use `Mark PI Accepted`. The action
  records acceptance source `Email`, actor, UTC timestamp, and automatically
  links the current fixed PI version and document hash. Launch does not require
  uploading the email, entering customer signature fields, or manually comparing
  hashes for this fallback.
- Acceptance requires explicit acknowledgement of price, trade terms, lead
  time, payment, cancellation, and refund terms.
- A PI containing a made-to-order product requires an additional specification
  approval and acknowledgement that the approved specification cannot be
  edited, customer self-service cancellation is unavailable, exceptional
  cancellation is subject to seller review, and convenience return is excluded.
- For a Length-Based Hose Order, that acknowledgement states that Nominal Cut
  Length and Number of Pieces are final approved specifications and that
  convenience cancellation or return becomes unavailable once cutting begins.
- When a PI contains multiple made-to-order lines, the acceptance page presents
  one Grouped Made-to-Order Acknowledgement. Immediately above its single
  checkbox, the page lists every covered line with SKU or configuration number,
  product description, Nominal Cut Length and Number of Pieces for cut hose,
  and the final approved assembly specifications for configured assemblies.
- The acknowledgement does not hide which lines it covers and does not require
  one repetitive checkbox per product. The PI Acceptance Record snapshots the
  covered-line list together with the fixed PI version and document hash.
- The customer enters a legal name; an organization Purchasing Context also
  requires the acting person's business title.
- A website PI Acceptance Record stores the verified Customer Profile, PI
  version and document hash, acknowledgement values, typed name and title, UTC
  timestamp, IP address, user agent, and linked PI View Evidence. A Manual Email
  PI Acceptance Record stores the current PI version and hash, source `Email`,
  actor, and UTC timestamp. Neither record can be edited in place.
- The website emails an acceptance copy to the customer. Launch does not depend
  on DocuSign or another external electronic-signature platform.
- Payment Instructions are already available with the issued PI. If full
  Cleared Funds have not been recorded, either acceptance path calculates and
  snapshots the default Payment Due Date unless the PI already has an authorized
  fixed-date override. It then moves the quote to `Payment Pending` and does not
  create an Order or release production or dispatch. If Cleared Funds and every
  required specification approval are already present, PI acceptance creates
  the Confirmed Order and initializes
  fulfillment in the same atomic operation. Conversely, if acceptance and
  approvals are already present, `Mark Payment Confirmed` performs that atomic
  transition. Neither path requires a separate `Create Order` action.

## Customer-facing Quote Journey

The Admin Backoffice retains RFQ, PI, Cleared Funds, and Confirmed Order as
separate domain records and statuses. The Personal Center uses customer-friendly
labels and presents the RFQ and PI lifecycle together under My Quotes:

| Customer-facing label | Backend state          |
| --------------------- | ---------------------- |
| Request Submitted     | Verified RFQ           |
| Under Review          | RFQ Under Review       |
| Quote Ready           | PI Issued              |
| Quote Accepted        | PI Accepted            |
| Payment Pending       | Awaiting Cleared Funds |
| Payment Confirmed     | Cleared Funds          |
| Order Created         | Confirmed Order        |

The formal document area identifies the Proforma Invoice as `Proforma Invoice
(PI)`, but ordinary navigation and primary status labels do not require the
customer to understand RFQ or PI terminology.

## Quote Revisions

- Saved Configurations and the Quote List remain editable before submission.
- A submitted RFQ, issued PI, and recorded acceptance are immutable historical
  records and are never edited in place.
- `Request a Change` copies the current quote into a new Quote Revision. The
  Admin Backoffice shows the changed products, quantities, specifications,
  destination data, and commercial terms against the prior version.
- If a PI has already been issued or accepted, a material change marks it
  `Superseded`. The seller issues a new PI and the customer must accept the new
  version before payment confirmation can create an Order.
- Earlier revisions and their status, documents, and acceptance history remain
  available to authorized customers and Admin Backoffice users.

## Quote Conversations and Email Replies

- Each My Quote has one authoritative Quote Conversation containing customer
  and seller messages and permitted attachments.
- The Admin Backoffice also provides Internal Quote Notes for factory
  confirmation summaries, WeChat screenshots, drawings, and other private
  commercial or technical context. Each note records its author and creation
  time and is never exposed in the Personal Center, customer email, or PI.
- An Internal Quote Note is supporting evidence rather than a mandatory PI
  issuance gate. The launch process may issue a PI after off-platform factory
  confirmation even when no internal note or attachment has been added.
- Messages created in the Personal Center are stored first and then sent as
  email notifications. Each notification uses a unique, unguessable reply
  address mapped to that Quote Conversation.
- An authorized customer's direct email reply, including permitted attachments,
  is received by Cloudflare Email Routing, parsed by an Email Worker, and
  appended to the same Quote Conversation. The message then appears in both the
  Personal Center and Admin Backoffice.
- Quote notification emails are sent through Resend with a unique Cloudflare
  reply address such as `quote+<unguessable-token>@reply.<domain>` in the
  `Reply-To` header.
- Inbound messages with an unknown conversation token or an unauthorized sender
  are quarantined for Admin Backoffice review rather than attached
  automatically.
- Email delivery, webhook, and provider message identifiers are retained for
  idempotency and troubleshooting. A duplicate webhook must not create a
  duplicate customer message.
- Attachments are downloaded from the email provider, validated and scanned,
  stored in private object storage, and served only through authorized,
  expiring links.

## Pre-Quote Support Chat

- Launch uses an embedded third-party chat widget rather than a custom realtime
  messaging system or a separate hose-end-identification form.
- tawk.to is the preferred provider. Before production release it must pass
  registration, desktop login, mobile push-notification, visitor image-upload,
  operator reply, and offline-message tests using the actual China operator
  network and a representative US visitor connection. Chatwoot Cloud is the
  fallback if those tests fail.
- Product and configurator pages show customer-friendly prompts such as `Chat
with us` and `Not sure which fitting you need? Send us a photo.` The widget
  supports pre-RFQ product assistance and does not require a Customer Profile to
  open.
- When an operator is online, the widget opens without a mandatory pre-chat
  form so a visitor can immediately ask a question or upload a photograph. When
  operators are offline, the offline form requires an email address and message;
  name is optional, and phone, company, and address are not requested.
- For an authenticated Customer Profile, the storefront uses the provider's
  secure identity mode and a server-generated integrity hash to prefill the
  verified name and email without exposing secrets in client code. An anonymous
  chat identity does not become a Purchasing Context. Creating or revising a
  My Quote still requires verified customer access and the normal specification
  confirmation flow.
- Customer-facing availability reflects actual operator presence. The widget
  shows `Online` or `Chat with us now` only while an operator is available and
  does not publish a fixed one-hour response promise or claim 24/7 support.
  Otherwise it displays `Leave a message and photos. We usually reply within 1
business day.` and the required offline contact form. Mobile push
  notifications do not change this response commitment or create a false
  online state.
- Pre-Quote Support Chat is informational assistance only. It cannot add an item
  to a Quote List, create or modify an RFQ or Quote Revision, select a component
  on the customer's behalf, or become an ordering channel. After the operator
  explains an uncertain component or configurator choice, the customer returns
  to the website, makes the selection, and completes the normal Quote workflow.
- Chat messages, photographs, and files are not copied into a Quote Revision or
  Quote Conversation and are not accepted specifications or Production
  Instructions. The structured website selection submitted and later confirmed
  by the customer remains authoritative; normal Sales review still occurs before
  PI issuance.
- Operators may send a canonical Product Detail URL or a configurator URL that
  navigates to and visually highlights a candidate Hose End option. Opening a
  support link never selects the option, changes a Saved Configuration, or adds
  a line to the Quote List; the customer must inspect and actively choose the
  item. If the referenced SKU is no longer published in the active Catalog
  Release, the page explains that it is unavailable and shows current searchable
  alternatives without silently substituting a specification.
- The chat widget loads only on public storefront discovery and pre-submission
  surfaces: the storefront home/search experience, Product Category and Product
  Detail pages, Build a Hose, every guided configurator step, and the Quote List
  before submission. Its mobile launcher and expanded panel must not cover the
  configurator's persistent navigation or submission controls.
- The widget is not loaded after RFQ submission or in My Quotes, PI acceptance,
  payment instructions, Orders, After-sales Cases, Admin
  Backoffice, Factory Mobile, or Public Assembly Verification. Existing quote
  questions use Quote Conversation, and order or after-sales issues use their
  corresponding formal website workflow.
- The launch chat widget exposes only the conversation experience and does not
  use the provider-hosted Articles or Knowledge Base as the storefront's help
  center. Measurement, identification, installation, commercial-policy, and
  other reviewed guidance is published as first-party `Help / Technical Guides`
  on the Cloudflare-hosted website under the site's own domain. Operators may
  share canonical guide links in chat, keeping searchable content and link
  ownership independent of the chat provider.
- Supported pages initially render a first-party `Chat with us` control without
  loading the provider script. The provider adapter loads tawk.to asynchronously
  only after the visitor activates that control and then opens the widget. No
  proactive invitation, timed popup, exit interception, or pre-interaction
  third-party chat connection is used at launch.
- If the provider script is blocked, times out, or fails to initialize, the same
  control changes to `Email us` and opens the first-party support contact path.
  Chat loading failure never blocks catalog browsing, configuration, Quote List
  submission, or authentication.
- The storefront integration uses a provider adapter and configuration flag so
  changing chat providers does not change RFQ, Quote Revision, PI, Customer
  Profile, or Quote Conversation records.

## Customer Notifications

- Launch uses email and mirrored Personal Center notifications; SMS is not a
  launch dependency.
- Required Transactional Notifications cover email verification, passwordless
  access, Quote Ready, revised or replaced PI, PI acceptance, payment
  deadline extension, payment confirmation, Order creation, Ready-to-Ship Date
  Revision, Ready to Ship, Shipment and tracking details, After-sales Case
  changes, and Quote Conversation replies.
- When `Mark Payment Confirmed` atomically creates a Confirmed Order, the
  application sends one email and one matching Personal Center event labelled
  `Payment Confirmed - Order Created`. It does not send separate payment and
  Order-creation messages for the same transaction.
- When payment is confirmed before PI acceptance, the application first sends
  the existing acceptance-required notice for `Funds Received - Acceptance
Pending`. After the customer later accepts the PI and the Order is created,
  it sends an `Order Created` email and matching Personal Center event; it does
  not repeat the earlier payment-confirmation notice.
- Customers may disable optional reminders but cannot suppress security or
  active quote, payment, order, shipment, and after-sales notices required to
  perform the transaction.
- Marketing email is separate, requires affirmative Marketing Consent, and is
  not enabled merely because a person configures a product, submits an RFQ,
  accepts a PI, or creates a Customer Profile.
- Marketing unsubscribe does not suppress Transactional Notifications.
