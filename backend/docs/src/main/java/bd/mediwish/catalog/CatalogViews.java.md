# `CatalogViews.java`

Response records for paged category/Product lists, full Product detail, price and flag history, and created-versus-replayed writes. They expose only the staff catalog contract fields.

Ticket 16 appends effectivePrice/appliedDiscount to Product list/detail and optional Discount detail to history. Unpriced Products expose null price projections; historical stored events retain their fields.
