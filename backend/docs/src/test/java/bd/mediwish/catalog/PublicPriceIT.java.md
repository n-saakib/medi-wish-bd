# PublicPriceIT.java

Real anonymous public-price integration/security contract. An active priced Product receives the greatest current discounted price through `CurrentPrices`' own transaction. The exact public projection includes only Product/base/MRP/current price/saving and the minimal discount descriptor; staff identifiers and audit fields are absent.

An authenticated or invalid bearer header cannot change this anonymous route's behavior. Unknown, inactive, unpriced and malformed identities share the bounded NOT_FOUND envelope. The shared application harness checks no-store, generated request IDs and non-echo of caller IDs on every response.

Requires the accepted Ticket 16 public price route and real PostgreSQL. Fixtures control only the promotion calendar.
