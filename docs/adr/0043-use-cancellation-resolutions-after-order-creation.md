# Use Cancellation Resolutions After Order Creation

After a Confirmed Order exists, an eligible customer cancellation may target
specific unshipped Standard Product lines and quantities. Approval creates an
immutable Cancellation Resolution that records the affected quantities and all
commercial and refund adjustments while preserving the original PI and Order.
It does not send the completed purchase backward through Quote Revision or
replacement PI. Freight is recalculated for the remaining fulfillment plan and
is refunded only to the extent it is actually recoverable, not automatically in
proportion to cancelled merchandise.

Submission places only the requested eligible, unshipped quantities on a
Cancellation Review Hold. Those quantities cannot enter a Shipment while the
request is pending, but unrelated quantities continue through fulfillment. The
hold becomes cancelled quantity on approval or returns to normal fulfillment on
decline.
