# Default to Ship Together with Quoted Split Shipments

Mixed orders default to one Ship-together dispatch. Customers may request split
shipment during RFQ preparation, but Sales must quote each dispatch's freight
and trade terms. A Confirmed Order may contain several Shipment records, and a
post-acceptance split that changes commercial terms requires a Quote Revision
and replacement PI.
