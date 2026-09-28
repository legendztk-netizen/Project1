# Order after-sales subtab verification

Date: 2026-09-28

The Order's cancellation and after-sales section now contains three child tabs:
cases, refunds, and order cancellation requests. Only the selected child panel
is mounted. Each tab shows its record count; the refund count excludes superseded
authorizations to match the rendered refund list.

Selection is encoded in the `afterSalesTab` query parameter. Parent tab changes
also use the URL, preserving the list return destination and child selection.
Successful after-sales actions retain the selected child tab in their redirect.
The central after-sales queues link directly to the appropriate Order child tab.
Invalid or absent child values default to cases. Arrow keys, Home, and End support
keyboard navigation with a single active tab stop.

Verification:

- Two focused UI tests passed: deep-link selection, exclusive panel rendering,
  switching, preserved return URL, history navigation, invalid values, and keyboard
  interaction.
- TypeScript, targeted lint, and whitespace checks passed.
- Verified the actual local Order's cases, cancellation, and refund panels and
  confirmed cancellation selection survives a browser reload. Inspected desktop
  layout. No cancellation, refund, or account action was submitted.
