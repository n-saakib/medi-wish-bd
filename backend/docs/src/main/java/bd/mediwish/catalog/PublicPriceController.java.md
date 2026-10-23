# PublicPriceController.java

Anonymous GET /api/products/{id}/price calls only CurrentPrices.forActiveProduct. Missing, inactive, unpriced and malformed Product ids share the same 404 NOT_FOUND. It exposes only productId, stored sellingPrice, optional mrp, effective price, saving, and an optional targetType/kind/value discount description; no actor, target id, dates or internal snapshot details leave this boundary. Money is represented as two-decimal strings and percentage values as whole numbers. Request correlation supplies no-store and X-Request-ID.

Verification is recorded in the Ticket 16 evidence; preparation and discovery alone are not acceptance.

Price string and discount-value formatting is shared with Ticket 17 catalog projections through `PublicCatalogViews.price`; the route's `discount` field reuses the shared `PublicDiscount` record, so it keeps its existing field names, field order and JSON shape.
