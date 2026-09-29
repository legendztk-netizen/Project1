# Use Confirmed Order Change Records for Address Updates

A customer may request a delivery-address change only before the affected
Shipment enters carrier handoff. The request holds that Shipment while
Operations requotes logistics, trade treatment, and sales tax. An accepted,
immutable Order Change Confirmation records the old and new address snapshots,
commercial changes, and any additional Cleared Funds or refund due. The system
does not overwrite the accepted PI or original Order, and an Address Book edit
never changes an existing fulfillment obligation.

An unresolved request never causes automatic dispatch to the original address.
The hold ends only when the customer completes the accepted change, explicitly
withdraws the request and restores the original address, or Operations records
another permitted manual resolution under the existing cancellation terms.
