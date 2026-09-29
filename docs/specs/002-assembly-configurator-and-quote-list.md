# Spec 2: Hose Assembly Configurator and Quote List

> Status: Complete. Spec 1 / Issue #2 supplied the published catalogue,
> compatibility, public Measurement Guide, Anonymous Quote List, and Reference
> Price prerequisites; all Spec 2 tickets have been implemented and verified.

## Problem Statement

Customers need custom Hose Assemblies, but a flat list of hoses and fittings
does not prevent incompatible selections or explain length and clocking. A
checkout-style cart would also misrepresent an estimate as a confirmed sale.

## Solution

Provide a guided `Build a Hose` workflow driven only by published
RFQ-Eligible Combinations. Preserve customer-entered values while continuously
revalidating derived compatibility, display a deterministic technical preview,
and add only valid configured assemblies to a non-binding Quote List.

## User Stories

1. As a customer, I want to select an eligible Hose Series and Hose Size Variant, so that the assembly begins with an exact hose specification.
2. As a customer, I want to filter End A and End B by familiar interface and construction attributes, so that I do not have to interpret a flat list of part numbers.
3. As a customer, I want to search eligible Hose Ends by SKU, thread, dash size, or alias, so that I can find a known connection quickly.
4. As a customer, I want to copy End A to End B when the same exact end is eligible, so that common assemblies require less repeated input.
5. As a customer, I want the correct ferrules included automatically, so that I am not asked to select an internal production component.
6. As a customer, I want to review the public measurement guide and explicitly select M01-M07 or `Not Sure` before entering Finished Overall Assembly Length, so that the requested dimension and any uncertainty are retained.
7. As a customer with two angled Hose Ends, I want to specify or flag uncertainty about Clocking, so that rotational orientation is not silently assumed.
8. As a customer, I want to choose installed protection and optionally state Operating Conditions, so that I can proceed without technical data I do not have while still giving quote review useful context when known.
9. As a customer, I want a Live Assembly Preview and exact text summary, so that I can catch obvious selection mistakes before requesting a quote.
10. As a customer, I want changed upstream selections to retain but clearly invalidate affected downstream values, so that the system never silently discards or substitutes my input.
11. As a customer, I want unresolved problems linked back to their steps, so that I can correct the configuration efficiently.
12. As a customer, I want to add a valid assembly to the Quote List and receive an estimated assembly amount, so that I can prepare an RFQ without checking out.
13. As a customer ordering similar assemblies, I want to duplicate and edit an existing configuration, so that I can change only the differing dimensions or ends.
14. As a customer, I want an unsupported or uncertain requirement routed to a Manual Assembly Quote Request or support, so that the website does not pretend it is automatically manufacturable.

## Implementation Decisions

- The guided order is Choose Hose, Select End A, Select End B, Select the
  M01-M07 measurement method or `Not Sure` and set Finished Length, set
  Orientation when applicable, add Protection, optionally add Operating
  Conditions, set Quantity and Review, then `Add Assembly to Quote`.
- Spec 2 reuses Spec 1's signed cookie, 30-day D1 Anonymous Quote Session, line
  model, stable identity, and quantity-merge APIs. It adds configured assembly
  line content only and must not create a parallel cart or session.
- Hose End finders narrow by Interface Family, form, gender, swivel/fixed
  construction, and Connection Dash, and search only candidates supported by a
  current RFQ-Eligible Combination for the chosen Hose Size Variant.
- The exact Hose End SKU is a customer selection. Ferrule SKUs are derived per
  end and remain internal to production records rather than separate PI lines.
- An upstream change never silently clears a customer value. It recalculates
  compatibility, ferrules, availability, and estimate; affected customer values
  become Retained Invalid Selections or require reconfirmation and block addition
  until resolved.
- Finished Length becomes available after End A and End B are selected. The
  customer opens the public guide as needed, then selects one versioned M01-M07
  method or `Not Sure`; the system does not infer the method from either Hose End
  SKU. Original value and unit are authoritative and an exact millimetre
  conversion is retained for internal calculation. `Not Sure` remains addable to
  the Quote List with Manual Technical Review Required.
- Guided imperial length uses 1/8-inch increments, metric uses 1-mm increments,
  and the maximum guided length is 50 feet. Finer, longer, tighter-tolerance,
  or single-end requirements use Manual Assembly Quote Request.
- The configured tolerance follows the adopted SAE J517 schedule. The customer,
  PI, and production views show original length, converted length, and tolerance.
- Clocking is required only when both selected Hose Ends are angled. The shared
  End A toward End B viewing convention, End B at 6 o'clock as `000`, clockwise
  direction, and `+/- 3 degrees` standard tolerance apply everywhere. The UI
  provides presets and accepts any whole degree `000-359`. `Not Sure` routes to
  manual review rather than manufacturing an assumed angle.
- Standard Export Packaging applies to every order. Installed Protection
  separately offers `No additional installed protection` unless a Hose or
  supplied Operating Condition explicitly requires protection.
- Let `F` be the exact finished assembly length in feet. Convert customer input
  without early rounding: `F = inches / 12` or `F = millimetres / 304.8`.
  Assembly service is `USD 0.50 * ceil(F)`. Installed Protection is priced
  separately: Nylon Protective Sleeving is
  `USD 8.00 + USD 1.35 * F + USD 1.00 * ceil(F)`, and Plastic Spiral Guard is
  `USD 8.00 + USD 1.00 * F + USD 1.00 * ceil(F)`. The `ceil(F)` term is the
  protection-installation charge per started foot and is distinct from assembly
  service. Round only each final customer-facing amount to two decimal places.
- Operating Conditions are optional, collapsed by default, and visibly marked
  `Optional`. The customer may save Installed Protection without providing
  fluid medium, maximum system working pressure, or minimum/maximum operating
  temperature. If the section is opened, the fields are completed and validated
  together. Out-of-range values route to manual request; `Other` and `Not Sure`
  remain quotable with Technical Review Required. Omitted context is retained as
  not provided for quote review and does not trigger an assumed value.
- The Live Assembly Preview is a code-rendered, responsive 2D schematic labelled
  `Not to scale`. M08 clocking is dynamic. It is not an AI-composited product
  image, 3D model, manufacturing drawing, or cut-length authority.
- Desktop uses a stable main work area plus sticky preview/specification region.
  Mobile uses one step at a time, fixed Back/Next actions, and an expandable
  preview. Chat and sticky controls may not cover one another.
- An unauthenticated In-progress Configuration Draft exists only in the active
  page session. Website navigation warns that it will be lost and offers stay or
  discard; browser-level closing can provide only a best-effort native warning.
  Spec 2 does not collect an email address, persist an accountless configuration
  snapshot, or promise cross-session recovery. Spec 3 owns the registration
  entry, 24-hour verification transaction, identity binding, and creation of an
  account-owned Saved Configuration after successful verification.
- `Add Assembly to Quote` revalidates the entire draft. Exact matches under the
  Configured Assembly Line Merge Key increase quantity; other differences create
  separate lines.
- Successful addition offers `Configure Another`, `Duplicate and Edit`, and
  `View Quote List`. Editing a stored line uses an isolated Quote Line Edit Draft
  until explicit `Save Changes`.
- Launch omits a per-line Customer Reference or equipment-location field.
- Pre-Quote Support Chat helps identify unknown components but never supplies an
  unresolved Hose End value or submits the configuration.

## Testing Decisions

- The primary seam is the public browser workflow from selecting a Hose Size
  Variant through compatible ends, length, orientation, protection, optional
  operating conditions, review, and a resulting configured-assembly Quote List
  line.
- Tests assert visible candidate restrictions, warning states, blocked actions,
  exact resulting specification, derived ferrules, merge behaviour, and current
  estimate rather than internal component state.
- A catalog-change scenario proves that an unavailable or invalid relationship
  blocks addition or RFQ submission without deleting the customer's line.
- Measurement tests cover explicit M01-M07 and `Not Sure` selection, guide
  version retention, and dynamic M08 Clocking using deterministic rendered
  labels and text alternatives; no automatic per-Hose-End mapping is asserted.
- Responsive Playwright coverage verifies desktop and mobile controls do not
  overlap and that the active step and scroll context survive preview expansion.
- Pure domain tests cover compatibility, length tolerance, unit conversion,
  clocking applicability, application screening, length-based price formulas,
  and merge-key equality.

## Out of Scope

- Arbitrary combinations absent from published compatibility data.
- Automated suitability certification or hose cut-length calculation.
- Automatic per-Hose-End inference of M01-M07 measurement methods.
- A 3D configurator or generated photo for every possible assembly.
- Guided single-end assemblies or an open-ended `Unknown Fitting` line.
- Anonymous recovery of an unfinished configuration after leaving the page.
- PI issuance, payment, production, or shipment.

## Further Notes

This Spec depends on Spec 1 catalogue and compatibility contracts. Quote List
identity and RFQ submission are completed by Spec 3.

- Project PRD: https://github.com/legendztk-netizen/Project1/issues/1
- Published Spec: https://github.com/legendztk-netizen/Project1/issues/3
- Prerequisite completed: https://github.com/legendztk-netizen/Project1/issues/2
