# Separate US Sales Tax from Import Charges

The storefront and PI treat US state and local sales tax separately from DDP or
DAP import charges. Sales tax is never presumed exempt: each PI records
Collected, Exempt with accepted evidence, or Not Collected, while launch uses a
manually confirmed amount until collection obligations justify a tax-service
integration. The application records the seller's externally determined tax
positions but does not decide legal nexus from customer or return addresses.
